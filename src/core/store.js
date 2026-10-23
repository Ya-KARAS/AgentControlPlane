import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ControlPlaneError } from "./errors.js";
import {
  adaptV1Event,
  normalizePresence,
  normalizeSettlement,
  normalizeTaskKind,
  normalizeToken,
} from "./usage-events.js";

function now() {
  return new Date().toISOString();
}

const checkpointError = (code) => new ControlPlaneError(code, "Executor checkpoint could not be confirmed", { safeToReroute: false });
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const checkpointResultHash = (task) => sha256(JSON.stringify(Object.fromEntries(
  ["status", "result", "error", "usage", "usage_state", "executorSessionId", "execution_outcome"].map((key) => [key, task[key] ?? null]),
)));

function emptyState() {
  return {
    version: 1,
    projects: {},
    tasks: {},
  };
}

function zeroExecutorUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
}

function defaultExecutorHistory(task) {
  if (!task?.executor) return [];
  return [
    {
      executor: task.executor,
      started_at: task.createdAt ?? null,
      ended_at: task.completedAt ?? null,
      ended_reason: task.reroute_reason ?? null,
      thread_id: task.threadId ?? null,
      turn_id: task.turnId ?? null,
      attempts: Math.max(1, Number(task.retries ?? 0) + 1),
      usage: {
        ...zeroExecutorUsage(),
        ...(task.usage ?? {}),
      },
    },
  ];
}

function normalizeTaskRecord(task) {
  if (!task) return null;
  return {
    ...structuredClone(task),
    logical_task_id: task.logical_task_id ?? task.id,
    executor_history: Array.isArray(task.executor_history)
      ? structuredClone(task.executor_history)
      : defaultExecutorHistory(task),
    continuation: task.continuation ?? null,
    reroute_reason: task.reroute_reason ?? null,
    capability_requirements: task.capability_requirements ?? null,
    executor_capabilities: task.executor_capabilities ?? null,
    idempotency_key: task.idempotency_key ?? null,
    request_fingerprint: task.request_fingerprint ?? null,
    project_id: task.project_id ?? null,
    project_path_revision: task.project_path_revision ?? null,
    workspace_relinked: task.workspace_relinked === true,
  };
}

export class TaskStore {
  constructor(
    stateDir,
    maxEvents = 500,
    maxTasks = 2000,
    maxAuditBytes = 10 * 1024 * 1024,
    integrityKey = null,
    maxUsageEvents = 50000,
  ) {
    this.stateDir = stateDir;
    this.statePath = path.join(stateDir, "state.json");
    this.auditPath = path.join(stateDir, "audit.jsonl");
    this.auditArchivePath = path.join(stateDir, "audit.jsonl.1");
    this.usagePath = path.join(stateDir, "usage.jsonl");
    this.reconciliationPath = path.join(stateDir, "usage-reconciliation.jsonl");
    this.maxEvents = maxEvents;
    this.maxTasks = maxTasks;
    this.maxAuditBytes = maxAuditBytes;
    this.maxUsageEvents = maxUsageEvents;
    this.integrityKey =
      typeof integrityKey === "string" && integrityKey.length > 0
        ? integrityKey
        : null;
    this.auditSeq = 1;
    this.auditPrev = null;
    this.usageEvents = [];
    this.reconciliations = new Map();
    fs.mkdirSync(stateDir, { recursive: true });
    this.state = fs.existsSync(this.statePath)
      ? JSON.parse(fs.readFileSync(this.statePath, "utf8"))
      : emptyState();
    this.persistedStateHash = fs.existsSync(this.statePath) ? sha256(fs.readFileSync(this.statePath)) : null;
    this.checkpointLeasePath = path.join(stateDir, "executor-checkpoint.lock");
    this.checkpointLeaseToken = null;
    this.checkpointFaulted = false;
    this.#loadUsageEvents();
    this.#loadReconciliations();
    this.#restoreAuditChain();
  }

  #loadReconciliations() {
    if (!fs.existsSync(this.reconciliationPath)) return;
    const lines = fs
      .readFileSync(this.reconciliationPath, "utf8")
      .split("\n")
      .filter(Boolean);
    for (const line of lines.slice(-this.maxUsageEvents)) {
      try {
        const entry = JSON.parse(line);
        // Legacy entries were keyed by request_id; migrate to the frozen
        // wire field asterroute_request_id and canonical state names.
        const id = entry?.asterroute_request_id ?? entry?.request_id ?? null;
        if (id) {
          this.reconciliations.set(id, {
            asterroute_request_id: id,
            presence_state: normalizePresence(entry.presence_state),
            token_state: normalizeToken(entry.token_state),
            settlement_state: normalizeSettlement(entry.settlement_state),
            settled_cost_microusd: entry.settled_cost_microusd ?? null,
            credit_microusd: entry.credit_microusd ?? null,
            net_cost_microusd: entry.net_cost_microusd ?? null,
            currency: entry.currency ?? "USD",
            pricing_version: entry.pricing_version ?? null,
            billing_revision: entry.billing_revision ?? null,
            reconciled_at: entry.reconciled_at ?? null,
          });
        }
      } catch {
        /* skip unreadable line */
      }
    }
  }

  #loadUsageEvents() {
    if (!fs.existsSync(this.usagePath)) return;
    const lines = fs
      .readFileSync(this.usagePath, "utf8")
      .split("\n")
      .filter(Boolean);
    const tail = lines.slice(-this.maxUsageEvents);
    this.usageEvents = tail
      .map((line) => {
        try {
          const row = JSON.parse(line);
          return row.schema_version ? row : adaptV1Event(row);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  appendUsageEvent(event) {
    const existing = this.usageEvents.find(
      (entry) =>
        entry.asterroute_request_id &&
        entry.asterroute_request_id === event.asterroute_request_id &&
        entry.task_id === event.task_id &&
        entry.attempt === event.attempt,
    );
    if (existing) return structuredClone(existing);
    this.usageEvents.push(event);
    if (this.usageEvents.length > this.maxUsageEvents) {
      this.usageEvents.splice(0, this.usageEvents.length - this.maxUsageEvents);
    }
    fs.appendFileSync(this.usagePath, `${JSON.stringify(event)}\n`, "utf8");
    return structuredClone(event);
  }

  applyReconciliations(rows) {
    const applied = [];
    for (const row of rows ?? []) {
      const requestId = String(row?.asterroute_request_id ?? "");
      if (!requestId) continue;
      const entry = {
        asterroute_request_id: requestId,
        presence_state: normalizePresence(row.presence_state),
        token_state: normalizeToken(row.token_state),
        settlement_state: normalizeSettlement(row.settlement_state),
        settled_cost_microusd: row.settled_cost_microusd ?? null,
        credit_microusd: row.credit_microusd ?? null,
        net_cost_microusd: row.net_cost_microusd ?? null,
        currency: row.currency ?? "USD",
        pricing_version: row.pricing_version ?? null,
        billing_revision: row.billing_revision ?? null,
        reconciled_at: new Date().toISOString(),
      };
      const existing = this.reconciliations.get(requestId);
      if (
        existing &&
        existing.presence_state === entry.presence_state &&
        existing.token_state === entry.token_state &&
        existing.settlement_state === entry.settlement_state &&
        existing.settled_cost_microusd === entry.settled_cost_microusd &&
        existing.credit_microusd === entry.credit_microusd &&
        existing.net_cost_microusd === entry.net_cost_microusd &&
        existing.currency === entry.currency &&
        existing.pricing_version === entry.pricing_version &&
        existing.billing_revision === entry.billing_revision
      ) {
        continue;
      }
      this.reconciliations.set(requestId, entry);
      fs.appendFileSync(
        this.reconciliationPath,
        `${JSON.stringify(entry)}\n`,
        "utf8",
      );
      applied.push(entry);
    }
    return applied;
  }

  listReconciliations() {
    return structuredClone([...this.reconciliations.values()]);
  }

  listUsageEvents({ taskId = null, since = null, kind = null, limit = 100, offset = 0 } = {}) {
    const filtered = this.usageEvents.filter((event) => {
      if (taskId && event.task_id !== taskId) return false;
      if (kind && event.request_kind !== kind) return false;
      if (since && String(event.at) < String(since)) return false;
      return true;
    });
    const bounded = Math.min(500, Math.max(1, Number(limit) || 100));
    const start = Math.max(0, Number(offset) || 0);
    return {
      total: filtered.length,
      offset: start,
      events: structuredClone(filtered.slice(start, start + bounded)),
    };
  }

  markTaskKind(taskId, kind) {
    const task = this.state.tasks[taskId];
    if (!task) return null;
    task.kind = normalizeTaskKind(kind);
    task.updatedAt = now();
    this.persist();
    this.audit("task.kind", { taskId, kind: task.kind });
    return structuredClone(task);
  }

  persist() {
    if (this.checkpointFaulted) throw checkpointError("checkpoint_store_faulted");
    if ((this.checkpointLeaseToken && !fs.existsSync(this.checkpointLeasePath)) ||
        fs.existsSync(this.checkpointLeasePath) && fs.readFileSync(this.checkpointLeasePath, "utf8") !== this.checkpointLeaseToken)
      throw checkpointError("checkpoint_store_locked");
    const leased = Boolean(this.checkpointLeaseToken);
    try {
      if (leased && (fs.existsSync(this.statePath) ? sha256(fs.readFileSync(this.statePath)) : null) !== this.persistedStateHash)
        throw checkpointError("checkpoint_store_drift");
      const temporary = `${this.statePath}.${process.pid}${leased ? `.${crypto.randomUUID()}` : ""}.tmp`;
      const bytes = JSON.stringify(this.state, null, 2);
      if (leased) {
        const fd = fs.openSync(temporary, "wx");
        try { fs.writeFileSync(fd, bytes, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      } else fs.writeFileSync(temporary, bytes, "utf8");
      fs.renameSync(temporary, this.statePath);
      this.persistedStateHash = sha256(bytes);
    } catch (error) {
      if (!leased) throw error;
      this.checkpointFaulted = true;
      throw checkpointError(error?.code === "checkpoint_store_drift" ? error.code : "checkpoint_persist_failed");
    }
  }

  acquireExecutorLease() {
    if (this.checkpointFaulted) throw checkpointError("checkpoint_store_faulted");
    if (this.checkpointLeaseToken) { this.#requireExecutorLease(); return; }
    const token = JSON.stringify({ version: 1, pid: process.pid, nonce: crypto.randomUUID() });
    let fd;
    try { fd = fs.openSync(this.checkpointLeasePath, "wx"); }
    catch { throw checkpointError("checkpoint_store_locked"); }
    try { fs.writeFileSync(fd, token); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.checkpointLeaseToken = token;
    const diskHash = fs.existsSync(this.statePath) ? sha256(fs.readFileSync(this.statePath)) : null;
    if (diskHash !== this.persistedStateHash) {
      this.releaseExecutorLease(); throw checkpointError("checkpoint_store_drift");
    }
  }

  releaseExecutorLease() {
    if (!this.checkpointLeaseToken) return;
    if (!fs.existsSync(this.checkpointLeasePath) || fs.readFileSync(this.checkpointLeasePath, "utf8") !== this.checkpointLeaseToken)
      throw checkpointError("checkpoint_store_locked");
    fs.unlinkSync(this.checkpointLeasePath); this.checkpointLeaseToken = null;
  }

  #requireExecutorLease() {
    if (this.checkpointFaulted) throw checkpointError("checkpoint_store_faulted");
    if (!this.checkpointLeaseToken || !fs.existsSync(this.checkpointLeasePath) ||
        fs.readFileSync(this.checkpointLeasePath, "utf8") !== this.checkpointLeaseToken) throw checkpointError("checkpoint_store_locked");
    if ((fs.existsSync(this.statePath) ? sha256(fs.readFileSync(this.statePath)) : null) !== this.persistedStateHash) {
      this.checkpointFaulted = true; throw checkpointError("checkpoint_store_drift");
    }
  }

  beginExecutorAttempt(taskId, binding, retentionMs) {
    this.#requireExecutorLease();
    const task = this.state.tasks[taskId];
    if (task?.executor_checkpoint) throw checkpointError("checkpoint_attempt_exists");
    const allowed = ["executor", "acpHandle", "turnId", "runtimeFingerprint", "profileProofHash", "canonicalWorkspace", "clientHomeReference", "model", "effort"];
    if (!task || Object.keys(binding).some((key) => !allowed.includes(key)) || task.status !== "running" || binding.executor !== task.executor || binding.acpHandle !== task.threadId ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(binding.turnId) ||
        !task.idempotency_key || !/^[a-f0-9]{64}$/.test(task.request_fingerprint) ||
        !Number.isSafeInteger(retentionMs) || retentionMs < 1000 || retentionMs > 86400000 ||
        ![binding.runtimeFingerprint, binding.profileProofHash].every((h) => /^[a-f0-9]{64}$/.test(h)) ||
        ![binding.canonicalWorkspace, binding.clientHomeReference].every((p) => typeof p === "string" && path.isAbsolute(p)) ||
        binding.canonicalWorkspace !== task.workspace || binding.model !== task.policy.model || binding.effort !== task.policy.effort)
      throw checkpointError("checkpoint_identity_mismatch");
    const previous = Object.values(this.state.tasks).map((t) => t.executor_checkpoint).filter((c) => c?.acpHandle === binding.acpHandle)
      .sort((a, b) => b.sequence - a.sequence)[0];
    if (previous) this.getAdoptableExecutorCheckpoint(binding.acpHandle, binding);
    const sequence = Math.max(0, ...Object.values(this.state.tasks).map((t) => t.executor_checkpoint?.sequence ?? 0)) + 1;
    const c = { version: 1, ...binding, sequence, taskId, logicalTaskId: task.logical_task_id, parentTaskId: task.parentTaskId,
      idempotencyKey: task.idempotency_key, requestFingerprint: task.request_fingerprint,
      attemptId: crypto.randomUUID(), phase: "intent", range: "unknown", nativeSessionId: null,
      retainUntil: Date.now() + retentionMs, resultHash: null };
    this.updateTask(taskId, { executor_checkpoint: c });
    return structuredClone(c);
  }

  #checkpointAttempt(taskId, attemptId) {
    this.#requireExecutorLease();
    const task = this.state.tasks[taskId]; const c = task?.executor_checkpoint;
    if (!c || c.attemptId !== attemptId || c.version !== 1 || c.taskId !== taskId) throw checkpointError("checkpoint_identity_mismatch");
    return { task, c };
  }

  observeExecutorSession(taskId, attemptId, nativeSessionId) {
    const { c } = this.#checkpointAttempt(taskId, attemptId);
    if (!["intent", "session-observed"].includes(c.phase) || !/^[A-Za-z0-9_-]{1,128}$/.test(nativeSessionId) ||
        c.nativeSessionId && c.nativeSessionId !== nativeSessionId) throw checkpointError("checkpoint_identity_mismatch");
    this.updateTask(taskId, { executorSessionId: nativeSessionId, executor_checkpoint: { ...c, nativeSessionId, phase: "session-observed" } });
  }

  invalidateExecutorCheckpoint(taskId, attemptId) {
    const { c } = this.#checkpointAttempt(taskId, attemptId);
    this.updateTask(taskId, { executor_checkpoint: { ...c, phase: "unknown", range: "unknown", resultHash: null } });
  }

  commitExecutorCheckpoint(taskId, attemptId, evidence, patch) {
    const { task, c } = this.#checkpointAttempt(taskId, attemptId);
    if (c.phase !== "session-observed" || evidence.nativeSessionId !== c.nativeSessionId || evidence.range !== "empty" ||
        evidence.toolVerified !== true || evidence.status !== "completed" || patch.status !== "completed" ||
        patch.executorSessionId !== c.nativeSessionId || patch.execution_outcome !== "confirmed" || patch.executor_checkpoint)
      throw checkpointError("checkpoint_not_adoptable");
    const checkpoint = { ...c, phase: "terminal-confirmed", range: "empty", resultHash: checkpointResultHash({ ...task, ...patch }) };
    return this.updateTask(taskId, { ...patch, executor_checkpoint: checkpoint });
  }

  getAdoptableExecutorCheckpoint(handle, binding) {
    this.#requireExecutorLease();
    const candidates = Object.values(this.state.tasks).filter((t) => t.executor_checkpoint?.acpHandle === handle);
    if (candidates.some((t) => !Number.isSafeInteger(t.executor_checkpoint.sequence) || t.executor_checkpoint.sequence < 1))
      throw checkpointError("checkpoint_not_adoptable");
    const task = candidates.sort((a, b) => b.executor_checkpoint.sequence - a.executor_checkpoint.sequence)[0];
    const c = task?.executor_checkpoint;
    if (!c || c.version !== 1 || c.phase !== "terminal-confirmed" || c.range !== "empty" || !Number.isSafeInteger(c.retainUntil) || c.retainUntil <= Date.now() ||
        c.taskId !== task.id || c.logicalTaskId !== task.logical_task_id || c.parentTaskId !== task.parentTaskId ||
        c.acpHandle !== task.threadId || c.turnId !== task.turnId || c.canonicalWorkspace !== task.workspace ||
        c.nativeSessionId !== task.executorSessionId || task.status !== "completed" ||
        c.idempotencyKey !== task.idempotency_key || !c.idempotencyKey || c.requestFingerprint !== task.request_fingerprint ||
        c.resultHash !== checkpointResultHash(task) || task.policy.model !== c.model || task.policy.effort !== c.effort ||
        ["executor", "runtimeFingerprint", "profileProofHash", "canonicalWorkspace", "clientHomeReference", "model", "effort"].some((key) => c[key] !== binding[key]))
      throw checkpointError("checkpoint_not_adoptable");
    return structuredClone({ task, checkpoint: c });
  }

  audit(type, payload) {
    if (
      fs.existsSync(this.auditPath) &&
      fs.statSync(this.auditPath).size >= this.maxAuditBytes
    ) {
      fs.rmSync(this.auditArchivePath, { force: true });
      fs.renameSync(this.auditPath, this.auditArchivePath);
    }
    const entry = {
      at: now(),
      type,
      ...payload,
      seq: this.auditSeq,
      prev: this.auditPrev,
    };
    const digest = this.#auditDigest(JSON.stringify(entry));
    entry.h = digest;
    fs.appendFileSync(
      this.auditPath,
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
    this.auditSeq += 1;
    this.auditPrev = digest;
  }

  #auditDigest(value) {
    if (this.integrityKey) {
      return crypto.createHmac("sha256", this.integrityKey).update(value).digest("hex");
    }
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  #restoreAuditChain() {
    const last =
      this.#readLastAuditLine(this.auditPath) ??
      this.#readLastAuditLine(this.auditArchivePath);
    if (!last) return;
    try {
      const entry = JSON.parse(last);
      if (entry && typeof entry.seq === "number") {
        this.auditSeq = entry.seq + 1;
        this.auditPrev = typeof entry.h === "string" ? entry.h : null;
      }
    } catch {
      // An unreadable tail line leaves the chain at its initial state.
    }
  }

  #readLastAuditLine(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (line) return line;
    }
    return null;
  }

  createTask({
    workspace,
    brief,
    policy,
    parentTaskId = null,
    executor = null,
    estimatedMinutes = null,
    recommendation = null,
    kind = "production",
    logicalTaskId = null,
    executorHistory = null,
    continuation = null,
    rerouteReason = null,
    capabilityRequirements = null,
    executorCapabilities = null,
    idempotencyKey = null,
    requestFingerprint = null,
    projectId = null,
    projectPathRevision = null,
    workspaceRelinked = false,
  }) {
    this.#pruneTasks();
    const id = crypto.randomUUID();
    const createdAt = now();
    const parent = parentTaskId ? this.state.tasks[parentTaskId] : null;
    const logicalTaskIdValue =
      logicalTaskId ?? parent?.logical_task_id ?? parent?.id ?? id;
    const task = {
      id,
      logical_task_id: logicalTaskIdValue,
      parentTaskId,
      workspace,
      project_id: projectId,
      project_path_revision: projectPathRevision,
      workspace_relinked: workspaceRelinked === true,
      brief,
      policy,
      executor,
      estimatedMinutes,
      kind: normalizeTaskKind(kind),
      status: "queued",
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      completedAt: null,
      threadId: null,
      turnId: null,
      executorSessionId: null,
      result: null,
      error: null,
      usage: null,
      subagents: [],
      events: [],
      recommendation: recommendation
        ? structuredClone(recommendation)
        : null,
      retries: 0,
      executor_history: Array.isArray(executorHistory)
        ? structuredClone(executorHistory)
        : executor
          ? [
              {
                executor,
                started_at: createdAt,
                ended_at: null,
                ended_reason: null,
                thread_id: null,
                turn_id: null,
                attempts: 1,
                usage: zeroExecutorUsage(),
              },
            ]
          : [],
      continuation: continuation ? structuredClone(continuation) : null,
      reroute_reason: rerouteReason ?? null,
      capability_requirements: capabilityRequirements
        ? structuredClone(capabilityRequirements)
        : null,
      executor_capabilities: executorCapabilities
        ? structuredClone(executorCapabilities)
        : null,
      idempotency_key: idempotencyKey ?? null,
      request_fingerprint: requestFingerprint ?? null,
    };
    this.state.tasks[id] = task;
    this.persist();
    this.audit("task.created", {
      taskId: id,
      workspace,
      policy: policy.name,
    });
    return normalizeTaskRecord(task);
  }

  updateTask(id, patch) {
    const task = this.state.tasks[id];
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: now() });
    this.persist();
    return normalizeTaskRecord(task);
  }

  appendExecutorHistory(id, entry) {
    const task = this.state.tasks[id];
    if (!task) return null;
    const history = Array.isArray(task.executor_history)
      ? task.executor_history
      : defaultExecutorHistory(task);
    history.push(structuredClone(entry));
    task.executor_history = history;
    task.updatedAt = now();
    this.persist();
    this.audit("task.executor_acquired", {
      taskId: id,
      logicalTaskId: task.logical_task_id ?? task.id,
      executor: entry?.executor ?? null,
    });
    return normalizeTaskRecord(task);
  }

  addEvent(id, event) {
    const task = this.state.tasks[id];
    if (!task) return;
    task.events.push({ at: now(), ...event });
    if (task.events.length > this.maxEvents) {
      task.events.splice(0, task.events.length - this.maxEvents);
    }
    task.updatedAt = now();
    this.persist();
    this.audit("task.event", {
      taskId: id,
      method: event.method ?? event.type ?? "event",
    });
  }

  getTask(id, includeEvents = false) {
    const task = this.state.tasks[id];
    if (!task) return null;
    const copy = normalizeTaskRecord(task);
    if (!includeEvents) delete copy.events;
    return copy;
  }

  listTasks(limit = 20) {
    return Object.values(this.state.tasks)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((task) => {
        const copy = normalizeTaskRecord(task);
        delete copy.events;
        return copy;
      });
  }

  resolveTaskId(prefixOrId) {
    const value = String(prefixOrId ?? "").trim();
    if (!value) return null;
    if (this.state.tasks[value]) return value;
    const matches = Object.keys(this.state.tasks).filter((id) =>
      id.startsWith(value),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  findTasks({ query = "", status = null, limit = 20 } = {}) {
    const needle = String(query ?? "").trim().toLowerCase();
    const wanted = status ? new Set([status]) : null;
    const matches = Object.values(this.state.tasks).filter((task) => {
      if (wanted && !wanted.has(task.status)) return false;
      if (!needle) return true;
      const objective = String(task.brief?.objective ?? "").toLowerCase();
      const summary = String(task.result?.summary ?? "").toLowerCase();
      return (
        task.id.toLowerCase().startsWith(needle) ||
        objective.includes(needle) ||
        summary.includes(needle)
      );
    });
    matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return matches.slice(0, Math.min(100, Math.max(1, Number(limit) || 20))).map((task) => {
      const copy = normalizeTaskRecord(task);
      delete copy.events;
      return copy;
    });
  }

  listByStatus(statuses) {
    const wanted = new Set(statuses);
    return Object.values(this.state.tasks)
      .filter((task) => wanted.has(task.status))
      .map((task) => normalizeTaskRecord(task));
  }

  listByLogicalTask(logicalTaskId) {
    return Object.values(this.state.tasks)
      .filter(
        (task) => (task.logical_task_id ?? task.id) === logicalTaskId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((task) => normalizeTaskRecord(task));
  }

  findByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    const task = Object.values(this.state.tasks).find(
      (entry) => entry.idempotency_key === idempotencyKey,
    );
    return normalizeTaskRecord(task ?? null);
  }

  getProject(workspace) {
    return structuredClone(this.state.projects[workspace] ?? null);
  }

  setProject(workspace, patch) {
    const current = this.state.projects[workspace] ?? {
      workspace,
      threadId: null,
      createdAt: now(),
    };
    this.state.projects[workspace] = {
      ...current,
      ...patch,
      updatedAt: now(),
    };
    this.persist();
    return structuredClone(this.state.projects[workspace]);
  }

  usageReport() {
    const total = {
      input_tokens: 0,
      cached_input_tokens: 0,
      uncached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 0,
      tasks_with_usage: 0,
    };
    for (const task of Object.values(this.state.tasks)) {
      if (!task.usage) continue;
      total.tasks_with_usage += 1;
      for (const key of Object.keys(total)) {
        if (key === "tasks_with_usage") continue;
        if (key === "uncached_input_tokens") {
          total[key] += Math.max(
            0,
            Number(task.usage.input_tokens ?? 0) -
              Number(task.usage.cached_input_tokens ?? 0),
          );
        } else {
          total[key] += Number(task.usage[key] ?? 0);
        }
      }
    }
    return total;
  }

  #pruneTasks() {
    const tasks = Object.values(this.state.tasks);
    if (tasks.length < this.maxTasks) return;
    const terminal = new Set([
      "completed",
      "partial",
      "blocked",
      "failed",
      "cancelled",
      "interrupted",
    ]);
    const removable = tasks
      .filter((task) => terminal.has(task.status) && !(task.executor_checkpoint?.retainUntil > Date.now()))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const removeCount = tasks.length - this.maxTasks + 1;
    if (removable.length < removeCount) {
      throw new ControlPlaneError(
        "task_capacity_reached",
        "Stored task capacity is full of active work",
      );
    }
    for (const task of removable.slice(0, removeCount)) {
      delete this.state.tasks[task.id];
    }
    this.persist();
  }
}
