import crypto from "node:crypto";
import { ControlPlaneError } from "./errors.js";

const ALLOWED_CANDIDATE_FIELDS = new Set([
  "objective",
  "constraints",
  "execution",
  "source",
]);

const ALLOWED_EXECUTION_FIELDS = new Set([
  "workspace",
  "executor",
  "profile",
  "model",
  "reasoning_effort",
]);

function secretHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function secretMatches(expected, supplied) {
  if (!expected || typeof supplied !== "string" || !supplied) return false;
  const actual = secretHash(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function normalizeCandidate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ControlPlaneError(
      "invalid_candidate",
      "Candidate must be a JSON object",
    );
  }
  const unexpected = Object.keys(input).filter(
    (key) => !ALLOWED_CANDIDATE_FIELDS.has(key),
  );
  if (unexpected.length) {
    throw new ControlPlaneError(
      "candidate_fields_denied",
      "Candidate contains fields that can only be selected locally",
      { fields: unexpected.sort() },
    );
  }
  const objective = String(input.objective ?? "").trim();
  if (!objective || objective.length > 4000) {
    throw new ControlPlaneError(
      "invalid_candidate_objective",
      "objective must contain 1 to 4000 characters",
    );
  }
  const rawConstraints = input.constraints ?? [];
  if (!Array.isArray(rawConstraints) || rawConstraints.length > 16) {
    throw new ControlPlaneError(
      "invalid_candidate_constraints",
      "constraints must be an array with at most 16 entries",
    );
  }
  const constraints = rawConstraints.map((entry) => String(entry).trim());
  if (constraints.some((entry) => !entry || entry.length > 1000)) {
    throw new ControlPlaneError(
      "invalid_candidate_constraints",
      "each constraint must contain 1 to 1000 characters",
    );
  }
  if (input.source !== "userscript-preview") {
    throw new ControlPlaneError(
      "invalid_candidate_source",
      "source must be userscript-preview",
    );
  }
  let execution = null;
  if (input.execution !== undefined && input.execution !== null) {
    if (typeof input.execution !== "object" || Array.isArray(input.execution)) {
      throw new ControlPlaneError(
        "invalid_candidate_execution",
        "execution must be an object",
      );
    }
    const unexpectedExecution = Object.keys(input.execution).filter(
      (key) => !ALLOWED_EXECUTION_FIELDS.has(key),
    );
    if (unexpectedExecution.length) {
      throw new ControlPlaneError(
        "candidate_execution_fields_denied",
        "execution contains unsupported fields",
        { fields: unexpectedExecution.sort() },
      );
    }
    const limits = {
      workspace: 1000,
      executor: 64,
      profile: 64,
      model: 200,
      reasoning_effort: 32,
    };
    execution = Object.fromEntries(
      Object.entries(limits)
        .map(([key, limit]) => [key, String(input.execution[key] ?? "").trim(), limit])
        .filter(([, value]) => value)
        .map(([key, value, limit]) => {
          if (value.length > limit) {
            throw new ControlPlaneError(
              "invalid_candidate_execution",
              `execution.${key} is too long`,
            );
          }
          return [key, value];
        }),
    );
    if (Object.keys(execution).length === 0) execution = null;
  }
  return { objective, constraints, execution, source: input.source };
}

function publicCandidate(candidate) {
  return {
    id: candidate.id,
    status: candidate.status,
    objective: candidate.objective,
    constraints: [...candidate.constraints],
    execution: candidate.execution ? { ...candidate.execution } : null,
    source: candidate.source,
    page_origin: candidate.pageOrigin,
    created_at: candidate.createdAt,
    expires_at: candidate.expiresAt,
    status_expires_at: candidate.statusExpiresAt,
    task_id: candidate.taskId ?? null,
  };
}

function publicStatus(candidate) {
  return {
    id: candidate.id,
    status: candidate.status,
    created_at: candidate.createdAt,
    status_expires_at: candidate.statusExpiresAt,
    task_id: candidate.taskId ?? null,
  };
}

export class CandidateReviewService {
  constructor({
    dispatch,
    validateApproval,
    audit = () => {},
    ttlMs = 5 * 60 * 1000,
    statusTtlMs = 60 * 60 * 1000,
    resolveTaskStatus = () => null,
    maxPending = 32,
    now = () => Date.now(),
  }) {
    if (typeof dispatch !== "function" || typeof validateApproval !== "function") {
      throw new TypeError("CandidateReviewService needs dispatch and validateApproval callbacks");
    }
    this.dispatch = dispatch;
    this.validateApproval = validateApproval;
    this.audit = audit;
    this.ttlMs = ttlMs;
    this.statusTtlMs = statusTtlMs;
    this.resolveTaskStatus = resolveTaskStatus;
    this.maxPending = maxPending;
    this.now = now;
    this.candidates = new Map();
  }

  create(input, { pageOrigin, idempotencyKey = null }) {
    const normalized = normalizeCandidate(input);
    this.#expireCandidates();
    const active = [...this.candidates.values()].filter((candidate) =>
      ["pending", "reviewing", "dispatching"].includes(candidate.status),
    ).length;
    if (active >= this.maxPending) {
      throw new ControlPlaneError(
        "candidate_limit_reached",
        "Too many candidates are waiting for local review",
      );
    }

    const id = crypto.randomUUID();
    const reviewSecret = crypto.randomBytes(32).toString("base64url");
    const statusSecret = crypto.randomBytes(32).toString("base64url");
    const createdAtMs = this.now();
    const candidate = {
      id,
      ...normalized,
      pageOrigin,
      status: "pending",
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + this.ttlMs).toISOString(),
      statusExpiresAt: new Date(createdAtMs + this.statusTtlMs).toISOString(),
      reviewSecretHash: secretHash(reviewSecret),
      statusSecretHash: secretHash(statusSecret),
      approvalSecretHash: null,
      taskId: null,
      idempotencyKey:
        typeof idempotencyKey === "string" &&
        /^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)
          ? idempotencyKey
          : null,
    };
    this.candidates.set(id, candidate);
    this.audit("candidate.created", {
      candidateId: id,
      source: candidate.source,
      pageOrigin: candidate.pageOrigin,
    });
    return {
      candidate: publicCandidate(candidate),
      reviewSecret,
      statusSecret,
    };
  }

  readStatus(id, statusSecret, { pageOrigin }) {
    const candidate = this.candidates.get(String(id ?? ""));
    if (!candidate) {
      throw new ControlPlaneError("candidate_not_found", "Candidate not found");
    }
    if (Date.parse(candidate.statusExpiresAt) <= this.now()) {
      throw new ControlPlaneError(
        "candidate_status_expired",
        "Candidate status access has expired",
      );
    }
    if (candidate.pageOrigin !== pageOrigin) {
      throw new ControlPlaneError(
        "candidate_status_denied",
        "Candidate status origin is invalid",
      );
    }
    if (!secretMatches(candidate.statusSecretHash, statusSecret)) {
      throw new ControlPlaneError(
        "candidate_status_denied",
        "Candidate status secret is invalid",
      );
    }
    return {
      candidate: publicStatus(candidate),
      task: candidate.taskId
        ? this.resolveTaskStatus(candidate.taskId)
        : null,
    };
  }

  beginReview(id, reviewSecret) {
    const candidate = this.#activeCandidate(id);
    if (!secretMatches(candidate.reviewSecretHash, reviewSecret)) {
      throw new ControlPlaneError(
        "candidate_review_denied",
        "Candidate review secret is invalid",
      );
    }
    if (!["pending", "reviewing"].includes(candidate.status)) {
      throw new ControlPlaneError(
        "candidate_state_conflict",
        `Candidate cannot be reviewed from status ${candidate.status}`,
      );
    }
    const approvalSecret = crypto.randomBytes(32).toString("base64url");
    candidate.status = "reviewing";
    candidate.approvalSecretHash = secretHash(approvalSecret);
    this.audit("candidate.reviewed", { candidateId: candidate.id });
    return { candidate: publicCandidate(candidate), approvalSecret };
  }

  approve(id, approvalSecret, selection) {
    const candidate = this.#activeCandidate(id);
    if (candidate.status !== "reviewing") {
      throw new ControlPlaneError(
        "candidate_state_conflict",
        `Candidate cannot be approved from status ${candidate.status}`,
      );
    }
    if (!secretMatches(candidate.approvalSecretHash, approvalSecret)) {
      throw new ControlPlaneError(
        "candidate_approval_denied",
        "Candidate approval secret is invalid",
      );
    }

    return this.#dispatchCandidate(candidate, selection, "candidate.approved");
  }

  dispatchTrusted(id, selection) {
    const candidate = this.#activeCandidate(id);
    if (!["pending", "reviewing"].includes(candidate.status)) {
      throw new ControlPlaneError(
        "candidate_state_conflict",
        `Candidate cannot be auto-dispatched from status ${candidate.status}`,
      );
    }
    return this.#dispatchCandidate(
      candidate,
      selection,
      "candidate.auto_approved",
    );
  }

  #dispatchCandidate(candidate, selection, approvalAuditType) {
    const approved = this.validateApproval({
      ...selection,
      ...(candidate.execution ?? {}),
    });
    candidate.status = "dispatching";
    candidate.approvalSecretHash = null;
    this.audit(approvalAuditType, {
      candidateId: candidate.id,
      workspace: approved.workspace,
      executor: approved.executor,
      profile: approved.profile,
      model: approved.model,
      reasoningEffort: approved.reasoning_effort,
    });

    try {
      const task = this.dispatch({
        objective: candidate.objective,
        constraints: [...candidate.constraints],
        workspace: approved.workspace,
        executor: approved.executor,
        profile: approved.profile,
        ...(approved.model ? { model: approved.model } : {}),
        ...(approved.reasoning_effort
          ? { reasoning_effort: approved.reasoning_effort }
          : {}),
        ...(candidate.idempotencyKey
          ? { idempotency_key: candidate.idempotencyKey }
          : {}),
      });
      candidate.status = "dispatched";
      candidate.taskId = task.id;
      this.audit("candidate.dispatched", {
        candidateId: candidate.id,
        taskId: task.id,
      });
      return { candidate: publicCandidate(candidate), task };
    } catch (error) {
      candidate.status = "failed";
      this.audit("candidate.failed", {
        candidateId: candidate.id,
        code: error?.code ?? "dispatch_failed",
      });
      throw error;
    }
  }

  #activeCandidate(id) {
    const candidate = this.candidates.get(String(id ?? ""));
    if (!candidate) {
      throw new ControlPlaneError("candidate_not_found", "Candidate not found");
    }
    if (Date.parse(candidate.expiresAt) <= this.now()) {
      if (candidate.status !== "expired") {
        candidate.status = "expired";
        candidate.approvalSecretHash = null;
        this.audit("candidate.expired", { candidateId: candidate.id });
      }
      throw new ControlPlaneError("candidate_expired", "Candidate has expired");
    }
    return candidate;
  }

  #expireCandidates() {
    for (const candidate of this.candidates.values()) {
      if (
        Date.parse(candidate.expiresAt) <= this.now() &&
        ["pending", "reviewing", "dispatching"].includes(candidate.status)
      ) {
        candidate.status = "expired";
        candidate.approvalSecretHash = null;
        this.audit("candidate.expired", { candidateId: candidate.id });
      }
    }
  }
}
