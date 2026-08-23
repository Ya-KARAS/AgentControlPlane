import { ControlPlaneError } from "../core/errors.js";
import { publicTaskStatus } from "../local-review/service.js";

const TERMINAL = new Set(["completed", "failed", "blocked", "partial", "cancelled"]);

function validateClaim(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ControlPlaneError("remote_claim_invalid", "Remote claim response is invalid");
  }
  if (typeof body.task?.id !== "string" || typeof body.lease_token !== "string") {
    throw new ControlPlaneError("remote_claim_invalid", "Remote claim is missing task or lease data");
  }
  const candidate = body.task.candidate;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new ControlPlaneError("remote_claim_invalid", "Remote task candidate is invalid");
  }
  return {
    remoteTaskId: body.task.id,
    leaseToken: body.lease_token,
    candidate,
  };
}

export class RemoteRelayWorker {
  constructor({
    credentials,
    candidateReview,
    settings,
    store,
    getCapabilities = null,
    fetchImpl = fetch,
    pollIntervalMs = 3000,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    this.credentials = credentials;
    this.candidateReview = candidateReview;
    this.settings = settings;
    this.store = store;
    this.getCapabilities = getCapabilities;
    this.fetch = fetchImpl;
    this.pollIntervalMs = pollIntervalMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.running = false;
    this.inFlight = false;
    this.active = null;
    this.lastContactAt = null;
    this.lastError = null;
    this.lastCapabilitiesAt = 0;
  }

  status() {
    const configured = this.credentials.current();
    return {
      ...configured,
      state: !configured.configured
        ? "not_configured"
        : !this.settings.autoDispatchSelection()
          ? "paused"
          : this.active
            ? "running"
            : this.lastError
              ? "degraded"
              : "ready",
      active_remote_task_id: this.active?.remoteTaskId ?? null,
      last_contact_at: this.lastContactAt,
      last_error: this.lastError,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.#schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }

  wake() {
    if (!this.running) return;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.#schedule(0);
  }

  async tick() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const auth = this.credentials.authorization();
      const current = this.credentials.current();
      const selection = this.settings.autoDispatchSelection();
      if (!auth || !current.base_url || !selection) return;
      if (this.getCapabilities && this.now() - this.lastCapabilitiesAt >= 30_000) {
        await this.#uploadCapabilities(current.base_url, auth);
        this.lastCapabilitiesAt = this.now();
      }
      if (this.active) {
        await this.#syncActive(current.base_url, auth);
      } else {
        await this.#claim(current.base_url, auth, selection);
      }
      this.lastContactAt = new Date(this.now()).toISOString();
      this.lastError = null;
    } catch (error) {
      this.lastError = error?.code ?? error?.message ?? "remote_relay_failed";
    } finally {
      this.inFlight = false;
    }
  }

  async #uploadCapabilities(baseUrl, auth) {
    const capabilities = this.getCapabilities();
    const response = await this.fetch(`${baseUrl}/api/acp/capabilities`, {
      method: "PUT",
      headers: {
        authorization: auth,
        "content-type": "application/json",
      },
      body: JSON.stringify({ capabilities }),
    });
    if (response.status !== 200) {
      throw new ControlPlaneError(
        "remote_capabilities_failed",
        `Capability sync failed with HTTP ${response.status}`,
      );
    }
  }

  async #claim(baseUrl, auth, selection) {
    const response = await this.fetch(`${baseUrl}/api/acp/tasks/claim`, {
      method: "POST",
      headers: { authorization: auth },
    });
    if (response.status === 204) return;
    const body = await response.json().catch(() => ({}));
    if (response.status !== 200) {
      throw new ControlPlaneError(
        "remote_claim_failed",
        body.error?.message ?? body.error ?? `Remote claim failed with HTTP ${response.status}`,
      );
    }
    const claim = validateClaim(body);
    try {
      const created = this.candidateReview.create(
        {
          objective: claim.candidate.objective,
          constraints: claim.candidate.constraints ?? [],
          execution: claim.candidate.execution ?? null,
          source: "userscript-preview",
        },
        {
          pageOrigin: "remote-relay",
          idempotencyKey: `remote:${claim.remoteTaskId}`,
        },
      );
      const dispatched = this.candidateReview.dispatchTrusted(created.candidate.id, selection);
      this.active = {
        ...claim,
        localTaskId: dispatched.task.id,
        lastLeaseAt: this.now(),
      };
    } catch (error) {
      await this.#complete(baseUrl, auth, claim, {
        id: claim.remoteTaskId,
        status: "failed",
        result_status: "failed",
        changed_files_count: 0,
        tests: { total: 0, passed: 0, failed: 0 },
        test_commands: { total: 0, passed: 0, failed: 0 },
        test_cases: null,
        blocker_count: 0,
        execution: {
          workspace: claim.candidate.execution?.workspace ?? null,
          executor: claim.candidate.execution?.executor ?? null,
          profile: claim.candidate.execution?.profile ?? null,
          model: claim.candidate.execution?.model ?? null,
          reasoning_effort: claim.candidate.execution?.reasoning_effort ?? null,
        },
        has_error: true,
        failure_category: "local_validation_failed",
        updated_at: new Date(this.now()).toISOString(),
        completed_at: new Date(this.now()).toISOString(),
      });
    }
  }

  async #syncActive(baseUrl, auth) {
    const task = this.store.getTask(this.active.localTaskId);
    if (!task) {
      await this.#complete(baseUrl, auth, this.active, {
        id: this.active.remoteTaskId,
        status: "failed",
        failure_category: "local_task_missing",
        changed_files_count: 0,
        tests: { total: 0, passed: 0, failed: 0 },
        blocker_count: 0,
      });
      return;
    }
    if (TERMINAL.has(task.status)) {
      await this.#complete(baseUrl, auth, this.active, publicTaskStatus(task));
      return;
    }
    if (this.now() - this.active.lastLeaseAt >= 30_000) {
      const response = await this.fetch(
        `${baseUrl}/api/acp/tasks/${encodeURIComponent(this.active.remoteTaskId)}/lease`,
        {
          method: "POST",
          headers: {
            authorization: auth,
            "content-type": "application/json",
          },
          body: JSON.stringify({ lease_token: this.active.leaseToken }),
        },
      );
      if (response.status !== 200) {
        throw new ControlPlaneError("remote_lease_failed", `Lease renewal failed with HTTP ${response.status}`);
      }
      this.active.lastLeaseAt = this.now();
    }
  }

  async #complete(baseUrl, auth, claim, result) {
    const response = await this.fetch(
      `${baseUrl}/api/acp/tasks/${encodeURIComponent(claim.remoteTaskId)}/complete`,
      {
        method: "POST",
        headers: {
          authorization: auth,
          "content-type": "application/json",
        },
        body: JSON.stringify({ lease_token: claim.leaseToken, result }),
      },
    );
    if (response.status !== 200) {
      throw new ControlPlaneError("remote_complete_failed", `Remote completion failed with HTTP ${response.status}`);
    }
    this.active = null;
  }

  #schedule(delay) {
    if (!this.running || this.timer) return;
    this.timer = this.setTimer(async () => {
      this.timer = null;
      await this.tick();
      this.#schedule(this.pollIntervalMs);
    }, delay);
    this.timer?.unref?.();
  }
}
