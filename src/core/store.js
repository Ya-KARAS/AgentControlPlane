import { workflowHash, workflowFingerprint } from "./workflow.js";
import { readDailyReport, writeDailyReport, reportEntryHash, reportDate } from "./daily-report.js";
import { createDeliveryHostService } from "./delivery-host.js";
import { safeDelivery, transitionDelivery } from "./delivery.js";
import { normalizeMessage, normalizeMessageQuery, messageOperationKey, messageFingerprint } from "./messages.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ControlPlaneError } from "./errors.js";
import { claimControlLease, renewControlLease, releaseControlLease } from "./controller-lease.js";
import { isTrustedControllerActor } from "../controllers/registry.js";
import { isNodeRecoveryCommand, nodeRecoveryTransition, assertNodeFence, sameRecoveryWorkspace } from "./node-recovery.js";

import { normalizeSubscriptionSnapshot, effectiveSubscription, subscriptionScope } from "./subscriptions.js";
import {
  adaptV1Event,
  normalizePresence,
  normalizeSettlement,
  normalizeTaskKind,
  normalizeToken,
} from "./usage-events.js";

function requireControllerActor(actor) {
  if (!isTrustedControllerActor(actor)) throw new ControlPlaneError("untrusted_controller", "A verified controller actor is required");
}

function initialControllerState(actor, mode, ttlMs) {
  if (actor == null) return { controller: null, control_lease: null };
  requireControllerActor(actor);
  if (!["single", "cooperative", "failover"].includes(mode)) throw new ControlPlaneError("invalid_config", "Invalid controller mode");
  return {
    controller: { id: actor.id, kind: actor.kind, mode },
    control_lease: claimControlLease({ lease: null, ownerId: actor.id, nowMs: Date.now(), ttlMs }),
  };
}

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

// Legacy project records stored one thread. Records without an executor owner
// predate multi-executor routing and are treated as Codex state.
function executorThreads(project) {
  const threads = { ...(project?.threads ?? {}) };
  if (Object.keys(threads).length === 0 && project?.threadId) {
    threads[project.executor || "codex"] = project.threadId;
  }
  return threads;
}

function normalizeTaskRecord(task) {
  if (!task) return null;
  return {
    ...structuredClone(Object.fromEntries(Object.entries(task).filter(([key])=>key!=="_delivery_evidence"&&key!=="_workflow"))),
    delivery:safeDelivery(task.delivery),
    workflow:null,
    execution_node_id: task.execution_node_id ?? null,
    node_recovery: task.node_recovery ? structuredClone(task.node_recovery) : null,
    controller: task.controller ? { id: task.controller.id, kind: task.controller.kind, mode: task.controller.mode } : null,
    control_lease: task.control_lease ? {
      owner: task.control_lease.owner, generation: task.control_lease.generation, expires_at: task.control_lease.expires_at,
    } : null,
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
    handoff: task.handoff === true,
    fresh_session: task.fresh_session === true,
  };
}

export class TaskStore {
  #deliveryHost = null;
  #deliveryHostEpoch = 0;
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
    return normalizeTaskRecord(task);
  }

  // Operator-local manual input only. Official adapters require a separate
  // verified admission path; a JSON file cannot self-assert that provenance.
  recordManualSubscription(input) {
    const snapshot = normalizeSubscriptionSnapshot(input);
    if (snapshot.source !== "manual" || snapshot.confidence !== "user_reported") {
      throw new ControlPlaneError("invalid_subscription", "Manual imports require manual/user_reported provenance");
    }
    const previous = this.state.subscription_snapshots;
    // Use the same normalization as reads; corrupted optional evidence must
    // not prevent a valid operator import. Keep the newest valid scope if a
    // damaged file contains duplicates, so sanitation cannot revive old data.
    const validByScope = new Map();
    for (const input of Array.isArray(previous) ? previous : []) {
      try {
        const item = normalizeSubscriptionSnapshot(input);
        const key = subscriptionScope(item);
        const current = validByScope.get(key);
        if (!current || Date.parse(item.observed_at) > Date.parse(current.observed_at)) validByScope.set(key, item);
      } catch { /* Match read-side omission of malformed evidence. */ }
    }
    const entries = [...validByScope.values()];
    const index = entries.findIndex(item => subscriptionScope(item) === subscriptionScope(snapshot));
    if (index >= 0) {
      if (JSON.stringify(entries[index]) === JSON.stringify(snapshot)) return structuredClone(snapshot);
      if (Date.parse(snapshot.observed_at) <= Date.parse(entries[index].observed_at)) {
        throw new ControlPlaneError("subscription_conflict", "A newer or conflicting subscription observation already exists");
      }
    } else if (entries.length >= 256) throw new ControlPlaneError("subscription_limit", "Subscription scope limit reached");
    const held = Boolean(this.checkpointLeaseToken);
    this.acquireExecutorLease();
    let persisted = false;
    try {
      const next = [...entries];
      if (index >= 0) next[index] = snapshot; else next.push(snapshot);
      this.state.subscription_snapshots = next;
      this.persist(); persisted = true;
      this.audit("subscription.manual_import", { provider: snapshot.provider, surface: snapshot.surface });
      return structuredClone(snapshot);
    } catch (error) {
      if (!persisted) {
        if (previous === undefined) delete this.state.subscription_snapshots;
        else this.state.subscription_snapshots = previous;
      }
      this.checkpointFaulted = true;
      throw error;
    } finally { if (!held && !this.checkpointFaulted) this.releaseExecutorLease(); }
  }

  listSubscriptionSnapshots(nowMs = Date.now()) {
    const entries = this.state.subscription_snapshots;
    if (!Array.isArray(entries)) return [];
    return entries.slice(0, 256).flatMap(input => {
      try { return [effectiveSubscription(input, nowMs)]; }
      catch { return []; } // Corrupt evidence cannot produce a green status.
    });
  }

  persist() {
    if (this.checkpointFaulted) throw checkpointError("checkpoint_store_faulted");
    // Ordinary writers use the same exclusive file for the whole transaction.
    // A pre-write exists check alone races with a checkpoint owner's acquisition.
    const persistentLease = Boolean(this.checkpointLeaseToken);
    if (!persistentLease) this.acquireExecutorLease();
    try {
      this.#requireExecutorLease();
      const temporary = `${this.statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      const bytes = JSON.stringify(this.state, null, 2);
      const fd = fs.openSync(temporary, "wx");
      try { fs.writeFileSync(fd, bytes, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, this.statePath);
      this.persistedStateHash = sha256(bytes);
    } catch (error) {
      this.checkpointFaulted = true;
      throw checkpointError(["checkpoint_store_drift", "checkpoint_store_locked"].includes(error?.code) ? error.code : "checkpoint_persist_failed");
    } finally {
      if (!persistentLease && !this.checkpointFaulted) this.releaseExecutorLease();
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
      this.releaseExecutorLease(); this.checkpointFaulted = true; throw checkpointError("checkpoint_store_drift");
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
    return structuredClone({ task: normalizeTaskRecord(task), checkpoint: c });
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
    handoff = false,
    freshSession = false,
    controllerActor = null,
    controllerMode = "single",
    controlLeaseTtlMs = 120_000,
  }) {
    const controllerState = initialControllerState(controllerActor, controllerMode, controlLeaseTtlMs);
    this.#pruneTasks();
    const id = crypto.randomUUID();
    const createdAt = now();
    const parent = parentTaskId ? this.state.tasks[parentTaskId] : null;
    const logicalTaskIdValue =
      logicalTaskId ?? parent?.logical_task_id ?? parent?.id ?? id;
    const task = {
      id,
      ...controllerState,
      logical_task_id: logicalTaskIdValue,
      parentTaskId,
      workspace,
      project_id: projectId,
      project_path_revision: projectPathRevision,
      workspace_relinked: workspaceRelinked === true,
      handoff: handoff === true,
      fresh_session: freshSession === true,
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
    try {
    this.audit("task.created", {
      taskId: id,
      workspace,
      policy: policy.name,
      handoff: handoff === true,
    });
    if (task.control_lease) this.audit("task.control_lease", {
      taskId: id, action: "claim", owner: task.control_lease.owner, generation: task.control_lease.generation,
    });
    } catch { this.checkpointFaulted=true; throw checkpointError('checkpoint_audit_failed'); }
    return normalizeTaskRecord(task);
  }

  // Trusted in-process API only; never exposed as an MCP/HTTP takeover tool.
  // Synchronous compare + persist shares the existing store writer lock/drift
  // checks. A released tombstone must survive restart to fence old generations.
  updateControlLease(id, { actor, action, generation, ttlMs = 120_000 }) {
    requireControllerActor(actor);
    const task = this.state.tasks[id];
    if (!task) throw new ControlPlaneError("task_not_found", "Task not found");
    const lease = task.control_lease ?? null;
    if (!Number.isSafeInteger(generation) || generation !== (lease?.generation ?? 0)) {
      throw new ControlPlaneError("control_lease_mismatch", "Controller fencing generation does not match");
    }
    const transition = { claim: claimControlLease, renew: renewControlLease, release: releaseControlLease };
    if (!Object.hasOwn(transition, action)) throw new ControlPlaneError("invalid_control_lease", "Unknown controller lease action");
    const mode = task.controller?.mode ?? "single";
    const nowMs = Date.now();
    if (action === "claim" && lease?.owner && lease.owner !== actor.id &&
        Date.parse(lease.expires_at) <= nowMs && mode !== "failover") {
      throw new ControlPlaneError("controller_takeover_disabled", "Only failover mode permits expired-owner takeover");
    }
    const nextLease = transition[action]({ lease, ownerId: actor.id, generation, nowMs, ttlMs });
    const next = { ...task, control_lease: nextLease,
      controller: { id: actor.id, kind: actor.kind, mode }, updatedAt: now() };
    const alreadyLocked = Boolean(this.checkpointLeaseToken);
    this.acquireExecutorLease(); // Detect another writer before changing memory.
    let persisted = false;
    try {
      this.state.tasks[id] = next;
      this.persist();
      persisted = true;
      this.audit("task.control_lease", { taskId: id, action, owner: nextLease.owner, generation: nextLease.generation });
      return normalizeTaskRecord(next);
    } catch (error) {
      if (!persisted) this.state.tasks[id] = task;
      this.checkpointFaulted = true; // Uncertain persistence/audit must not enable another writer.
      throw error;
    } finally {
      if (!alreadyLocked && !this.checkpointFaulted) this.releaseExecutorLease();
    }
  }

  #commitMessage(key, record, action) {
    const previous=this.state.messages; const held=Boolean(this.checkpointLeaseToken);this.acquireExecutorLease();let persisted=false;
    try {
      this.state.messages={...(previous??{}),[key]:record};this.persist();persisted=true;
      this.audit('message.updated',{messageKey:key,action,taskId:record.execution_task_id??record.task_id??null});
      return structuredClone(record);
    } catch(error){if(!persisted)this.state.messages=previous;this.checkpointFaulted=true;throw error;}
    finally{if(!held&&!this.checkpointFaulted)this.releaseExecutorLease();}
  }

  postMessage(input,maxMessages=1024) {
    const message=normalizeMessage(input),key=messageOperationKey(message),fingerprint=messageFingerprint(message);
    const previous=this.state.messages?.[key];
    if(previous){
      if(previous.fingerprint!==fingerprint)throw new ControlPlaneError('message_conflict','Message content conflicts with its existing identity');
      if(previous.channels.includes(message.channel))return structuredClone(previous);
      return this.#commitMessage(key,{...previous,channels:['foreground','background'].filter(c=>previous.channels.includes(c)||c===message.channel)},'channel_seen');
    }
    if(Object.keys(this.state.messages??{}).length>=maxMessages)throw new ControlPlaneError('message_capacity_reached','Local message capacity reached; preserve history before adding more');
    const related=message.task_id?this.getTask(message.task_id):null;
    if(message.task_id&&!related)throw new ControlPlaneError('task_not_found','Referenced task not found');
    const {channel,...content}=message;
    const record={...content,key,fingerprint,channels:[channel],sender_verified:false,source:'local_unverified',created_at:now(),sequence:Math.max(0,...Object.values(this.state.messages??{}).map(m=>m.sequence))+1,logical_task_id:related?.logical_task_id??null,execution_task_id:null,state:message.kind==='execution_request'?'dispatch_pending':'posted'};
    return this.#commitMessage(key,record,'posted');
  }

  linkMessageTask(key,taskId) {
    const message=this.state.messages?.[key],task=this.state.tasks[taskId];
    if(!message||message.kind!=='execution_request'||!task||task.idempotency_key!==key||message.execution_task_id&&message.execution_task_id!==taskId)throw new ControlPlaneError('message_conflict','Message/task binding could not be confirmed');
    if(message.execution_task_id===taskId)return structuredClone(message);
    return this.#commitMessage(key,{...message,execution_task_id:taskId,logical_task_id:task.logical_task_id??task.id,state:'dispatched'},'task_bound');
  }

  #validateRetainedAudit(allowEmpty=false) {
    try {
      let previous=null,sequence=null,started=false;
      for(const file of [this.auditArchivePath,this.auditPath]){
        if(!fs.existsSync(file))continue;
        if(fs.statSync(file).size>this.maxAuditBytes+1024*1024)throw checkpointError('checkpoint_audit_invalid');
        for(const line of fs.readFileSync(file,'utf8').split('\n').filter(line=>line.trim())){
          let entry;try{entry=JSON.parse(line);}catch{throw checkpointError('checkpoint_audit_invalid');}
          if(!entry||typeof entry!=='object')throw checkpointError('checkpoint_audit_invalid');
          if(entry.seq===undefined&&entry.h===undefined&&!started)continue;
          const {h,...payload}=entry;
          if(!Number.isSafeInteger(entry.seq)||entry.seq<1||typeof h!=='string'||this.#auditDigest(JSON.stringify(payload))!==h||started&&(entry.seq!==sequence||entry.prev!==previous))throw checkpointError('checkpoint_audit_invalid');
          started=true;previous=h;sequence=entry.seq+1;
        }
      }
      if(!started){if(allowEmpty&&Object.keys(this.state.tasks).length===0){this.auditSeq=1;this.auditPrev=null;return;}throw checkpointError('checkpoint_audit_invalid');}
      this.auditSeq=sequence;this.auditPrev=previous;
    }catch(error){this.checkpointFaulted=true;throw error;}
  }

  validateWorkflowAudit() {
    const held=Boolean(this.checkpointLeaseToken);this.acquireExecutorLease();
    try{this.#validateRetainedAudit();}finally{if(!held&&!this.checkpointFaulted)this.releaseExecutorLease();}
  }

  confirmMessageQueueRecovery(taskId,key) {
    if(this.checkpointFaulted)throw checkpointError('checkpoint_store_faulted');
    if(!this.isMessageTaskBound(taskId,key))throw new ControlPlaneError('message_conflict','Message binding missing');
    const held=Boolean(this.checkpointLeaseToken);this.acquireExecutorLease();
    try {
      this.#validateRetainedAudit();
      this.audit('message.queue_recovered',{taskId,messageKey:key});
      const fd=fs.openSync(this.auditPath,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    }catch(error){this.checkpointFaulted=true;throw error;}
    finally{if(!held&&!this.checkpointFaulted)this.releaseExecutorLease();}
  }

  isMessageTaskBound(taskId,key) {
    const message=this.state.messages?.[key];
    return message?.kind==='execution_request'&&message.execution_task_id===taskId&&messageOperationKey(message)===key;
  }

  listMessages(query={}) {
    const {conversation_id,channel,limit,before_sequence}=normalizeMessageQuery(query);
    return Object.values(this.state.messages??{}).filter(message=>(!conversation_id||message.conversation_id===conversation_id)&&(!channel||message.channels.includes(channel))&&(!before_sequence||message.sequence<before_sequence)).sort((a,b)=>a.sequence-b.sequence).slice(-limit).map(m=>structuredClone(m));
  }

  applyNodeRecovery(id, command) {
    if (!isNodeRecoveryCommand(command)) throw new ControlPlaneError('untrusted_node_recovery', 'Host node recovery evidence is required');
    const task = this.state.tasks[id];
    if (!task) throw new ControlPlaneError('task_not_found', 'Task not found');
    if (['bind','admit'].includes(command.action)) {
      const targetWorkspace = command.workspace ?? task.workspace;
      if (Object.values(this.state.tasks).some(other => other.id !== id && sameRecoveryWorkspace(other.workspace,targetWorkspace) &&
          (other.status === 'running' || other.node_recovery && other.node_recovery.phase !== 'completed'))) {
        throw new ControlPlaneError('node_workspace_busy','Another task reserves this workspace');
      }
    }
    const transition = nodeRecoveryTransition(normalizeTaskRecord(task), command);
    if (!transition.patch) return {task:normalizeTaskRecord(task),duplicate:true};
    const held = Boolean(this.checkpointLeaseToken);
    this.acquireExecutorLease();
    let persisted = false;
    try {
      const next = {...task,...transition.patch,updatedAt:now()};
      this.state.tasks[id] = next; this.persist(); persisted = true;
      this.audit('task.node_recovery', {taskId:id,action:command.action,owner:next.execution_node_id,generation:next.node_recovery.generation,phase:next.node_recovery.phase});
      return {task:normalizeTaskRecord(next),duplicate:false};
    } catch(error) {
      if (!persisted) this.state.tasks[id] = task;
      this.checkpointFaulted = true; throw error;
    } finally { if (!held && !this.checkpointFaulted) this.releaseExecutorLease(); }
  }

  quarantineNodeRecovery(id) {
    const task = this.state.tasks[id];
    if (!task?.node_recovery) return;
    // Host restart cannot prove whether durable admission reached its executor.
    const old = task; const held = Boolean(this.checkpointLeaseToken); this.acquireExecutorLease(); let persisted = false;
    try {
      this.state.tasks[id] = {...task,status:'blocked',node_recovery:{...task.node_recovery,phase:'uncertain'},updatedAt:now()};
      this.persist(); persisted = true;
      this.audit('task.node_recovery', {taskId:id,action:'restart_blocked',generation:task.node_recovery.generation});
    } catch(error) { if(!persisted)this.state.tasks[id]=old;this.checkpointFaulted=true;throw error; }
    finally {if(!held&&!this.checkpointFaulted)this.releaseExecutorLease();}
  }

  nodeWorkspaceReserved(taskId) {
    const task = this.state.tasks[taskId];
    return Object.values(this.state.tasks).some(other => other.id !== taskId && sameRecoveryWorkspace(other.workspace,task?.workspace) && (other.node_recovery && other.node_recovery.phase !== 'completed' || task?.node_recovery && other.status === 'running'));
  }

  enableWorkflowRetention() {
    if(this.state.workflow_retention===true)return;
    const previous=this.state.workflow_retention,held=Boolean(this.checkpointLeaseToken);this.acquireExecutorLease();let persisted=false;
    try {
      this.#validateRetainedAudit(true);
      this.audit('workflow.retention_enabled',{});const fd=fs.openSync(this.auditPath,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      this.state.workflow_retention=true;this.persist();persisted=true;
    }catch(error){if(!persisted)this.state.workflow_retention=previous;this.checkpointFaulted=true;throw error;}
    finally{if(!held&&!this.checkpointFaulted)this.releaseExecutorLease();}
  }

  async refreshDeliveryForWorkflow(id) { return this.#deliveryHost?.refresh(id)??null; }

  #workflowArchived(task,cache=new Map()) {
    const current=task?._workflow?.current;
    if(this.checkpointFaulted||!current||current.phase!=='archived'||current.binding!==workflowFingerprint(task))return false;
    const delivery=this.getDelivery(task.id);
    if(delivery?.source==='verified_host'&&delivery.review_state!=='approved')return false;
    try{
      if(!cache.has(current.report_date))cache.set(current.report_date,readDailyReport(this.stateDir,current.report_date));
      const row=cache.get(current.report_date).entries.find(row=>row.id===current.id);
      return !!row&&reportEntryHash(row)===current.entry_hash;
    }catch{return false;}
  }

  getWorkflowStatus(id) {
    const task=this.state.tasks[id],current=task?._workflow?.current;if(!current)return null;
    const archived=this.#workflowArchived(task);
    return {phase:archived?'archived':current.phase==='archived'?'needs_review':current.phase,active:!archived,report_date:current.report_date,report_id:current.id,archived_at:archived?current.archived_at:null,historical_acceptance:true};
  }

  listActiveTasks(limit=20) { return this.findTasks({limit,activeOnly:true}); }

  #workflowCommit(id,workflow,type) {
    const previous=this.state.tasks[id];let persisted=false;
    try{
      this.audit(type,{taskId:id,reportId:workflow.current.id,date:workflow.current.report_date});
      const fd=fs.openSync(this.auditPath,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      this.state.tasks[id]={...previous,_workflow:workflow,updatedAt:now()};this.persist();persisted=true;
    }catch(error){if(!persisted)this.state.tasks[id]=previous;this.checkpointFaulted=true;throw error;}
  }

  archiveVerifiedTask(id,{timeZone='UTC',clock=Date.now,isActive=()=>true}={}) {
    if(this.checkpointFaulted)throw checkpointError('checkpoint_store_faulted');
    const fail=code=>{throw new ControlPlaneError(code,'Archive prerequisites are not confirmed');};
    const task=this.state.tasks[id];if(!task)fail('task_not_found');
    if(this.#workflowArchived(task))return this.getTask(id);
    const held=Boolean(this.checkpointLeaseToken);this.acquireExecutorLease();
    try{
      this.#validateRetainedAudit();
      const nowMs=clock();if(!Number.isSafeInteger(nowMs)||nowMs<0)fail('workflow_binding_changed');
      const binding=workflowFingerprint(task);
      const decision=()=>{
        if(isActive()!==false||!['completed','partial'].includes(this.state.tasks[id]?.status)||this.state.tasks[id]?.node_recovery&&this.state.tasks[id].node_recovery.phase!=='completed')fail('workflow_task_active');
        const proof=this.#deliveryHost?.acceptance(id);
        if(!proof)fail('workflow_approval_required');
        if(workflowFingerprint(this.state.tasks[id])!==binding||proof.repository!==task.delivery?.repository||proof.pull_request_number!==task.delivery?.pull_request_number||proof.head_sha!==task.delivery?.head_sha)fail('workflow_binding_changed');
        return proof;
      };
      const proof=decision(),decisionHash=workflowHash([proof.repository,proof.pull_request_number,proof.head_sha,proof.user_id,proof.event_id]);
      let workflow=this.state.tasks[id]._workflow??{version:1,current:null,history:[]};
      if(workflow.version!==1||!Array.isArray(workflow.history)||workflow.history.length>64)fail('workflow_capacity_reached');
      if(!workflow.current||workflow.current.binding!==binding||workflow.current.decision_hash!==decisionHash){
        if(workflow.current&&workflow.history.length>=64)fail('workflow_capacity_reached');
        const date=reportDate(nowMs,timeZone),reportId=workflowHash([id,binding,decisionHash,date]);
        workflow={version:1,history:workflow.current?[...workflow.history,workflow.current]:workflow.history,current:{id:reportId,binding,decision_hash:decisionHash,accepted_at:new Date(nowMs).toISOString(),report_date:date,time_zone:timeZone,phase:'accepted',entry_hash:null,archived_at:null}};
        this.#workflowCommit(id,workflow,'workflow.accepted');
      }
      decision();
      const current=workflow.current,row={id:current.id,task_id:id,logical_task_id:task.logical_task_id??id,repository:proof.repository,pull_request_number:proof.pull_request_number,head_sha:proof.head_sha,task_status:task.status,accepted_at:current.accepted_at};
      const entryHash=writeDailyReport(this.stateDir,current.report_date,current.time_zone,row);
      decision();
      if(current.entry_hash!==entryHash||current.phase==='accepted'){
        workflow={...workflow,current:{...current,entry_hash:entryHash,phase:'reported'}};this.#workflowCommit(id,workflow,'workflow.reported');
      }
      decision();
      const verified=readDailyReport(this.stateDir,current.report_date).entries.find(entry=>entry.id===current.id);
      if(!verified||reportEntryHash(verified)!==entryHash)fail('workflow_report_unavailable');
      workflow={...workflow,current:{...workflow.current,phase:'archived',archived_at:new Date(clock()).toISOString()}};
      this.#workflowCommit(id,workflow,'workflow.archive_intent');
      return this.getTask(id);
    }finally{if(!held&&!this.checkpointFaulted)this.releaseExecutorLease();}
  }

  createDeliveryHost({adapter, authorizeUser, clock} = {}) {
    const epoch=++this.#deliveryHostEpoch;
    this.#deliveryHost=createDeliveryHostService({adapter,authorizeUser,clock,
      healthy:()=>epoch === this.#deliveryHostEpoch && !this.checkpointFaulted,
      read:(id)=>Object.hasOwn(this.state.tasks,id) ? {delivery:safeDelivery(this.state.tasks[id].delivery),journal:this.state.tasks[id]._delivery_evidence} : null,
      commit:(id,journal,expected,merge,decision)=>this.#persistDeliveryEvidence(id,journal,expected,epoch,merge,decision),
    });
    return this.#deliveryHost;
  }

  #persistDeliveryEvidence(id,journal,expected,epoch,merge,decision) {
    const task=this.state.tasks[id];
    if (epoch !== this.#deliveryHostEpoch || !task || JSON.stringify(safeDelivery(task.delivery)) !== expected) throw new ControlPlaneError("delivery_conflict", "Delivery binding changed");
    const wasLocked=Boolean(this.checkpointLeaseToken);
    this.acquireExecutorLease();
    let persisted=false;
    try {
      const current=task._workflow?.current;
      const invalidate=!!current&&current.binding===workflowFingerprint(task)&&decision&&['revoked','changes_requested'].includes(decision.decision)&&decision.repository===task.delivery?.repository&&decision.pull_request_number===task.delivery?.pull_request_number&&decision.head_sha===task.delivery?.head_sha;
      const invalidation=invalidate?workflowHash([decision.repository,decision.pull_request_number,decision.head_sha,decision.user_id,decision.event_id,decision.decision]):null;
      if (isDeepStrictEqual(task._delivery_evidence,journal)&&(!invalidate||current.invalidation_hash===invalidation)) return;
      const workflow=invalidate?{...task._workflow,current:{...current,phase:'needs_review',invalidation_hash:invalidation,invalidated_at:now()}}:task._workflow;
      this.state.tasks[id]={...task,_delivery_evidence:structuredClone(journal),...(workflow?{_workflow:workflow}:{})};
      this.persist(); persisted=true;
      this.audit("task.delivery_evidence",{taskId:id,repository:task.delivery.repository,pull_request_number:task.delivery.pull_request_number,head_sha:task.delivery.head_sha,...(merge ? {merged:merge.merged,merge_commit_sha:merge.merge_commit_sha,merge_event_id:merge.event_id,merge_source:merge.source} : {})});
    } catch(error) {
      if (!persisted) this.state.tasks[id]=task;
      this.checkpointFaulted=true;
      throw error;
    } finally { if (!wasLocked && !this.checkpointFaulted) this.releaseExecutorLease(); }
  }

  getDelivery(id) {
    if (this.#deliveryHost) return this.#deliveryHost.status(id);
    return Object.hasOwn(this.state.tasks,id) ? safeDelivery(this.state.tasks[id].delivery) : null;
  }

  // Offline operator observation, never an approval/merge operation.
  recordDelivery(id, input) {
    if (!Object.hasOwn(this.state.tasks, id)) throw new ControlPlaneError("task_not_found", "Task not found");
    const task = this.state.tasks[id];
    const current = safeDelivery(task.delivery) ? task.delivery : null;
    const delivery = transitionDelivery(current, input);
    const wasLocked = Boolean(this.checkpointLeaseToken);
    this.acquireExecutorLease();
    let persisted = false;
    try {
      if (isDeepStrictEqual(current, delivery)) return safeDelivery(delivery);
      this.state.tasks[id] = { ...task, delivery, updatedAt: now() };
      this.persist();
      persisted = true;
      this.audit("task.delivery_observed", { taskId: id, repository: delivery.repository,
        pull_request_number: delivery.pull_request_number, head_sha: delivery.head_sha });
      return safeDelivery(delivery);
    } catch (error) {
      if (!persisted) this.state.tasks[id] = task;
      this.checkpointFaulted = true;
      throw error;
    } finally {
      if (!wasLocked && !this.checkpointFaulted) this.releaseExecutorLease();
    }
  }

  updateTask(id, patch, controllerContext = undefined, nodeContext = undefined) {
    const task = this.state.tasks[id];
    if (!task) return null;
    if (Object.hasOwn(patch,"_delivery_evidence") || (Object.hasOwn(patch,"delivery") && !isDeepStrictEqual(patch.delivery,this.getDelivery(id)) && !isDeepStrictEqual(patch.delivery,safeDelivery(task.delivery))))throw new ControlPlaneError('delivery_update_required','Delivery observations require the checked operation');
    if(Object.hasOwn(patch,'_workflow')||Object.hasOwn(patch,'workflow')&&!isDeepStrictEqual(patch.workflow,this.getWorkflowStatus(id)))throw new ControlPlaneError('workflow_update_required','Workflow records require checked reporting transitions');
    for (const field of ['execution_node_id','node_recovery']) {
      if (Object.hasOwn(patch,field) && !isDeepStrictEqual(patch[field],task[field]??null)) throw new ControlPlaneError('node_recovery_update_required','Execution ownership requires a checked host operation');
    }
    assertNodeFence(task,nodeContext);
    if(['awaiting_stop','completed'].includes(task.node_recovery?.phase)&&patch.status!==undefined&&patch.status!==task.status)throw new ControlPlaneError('node_generation_mismatch','A stopped host receipt is required before another transition');
    for (const field of ["controller", "control_lease"]) {
      if (Object.hasOwn(patch, field) && !isDeepStrictEqual(patch[field], task[field] ?? null)) {
        throw new ControlPlaneError("control_lease_update_required", "Controller ownership must use the checked lease operation");
      }
    }
    // Legacy callers may write a full unchanged record; never assign ownership
    // fields from that patch, even when they compare equal.
    const { controller: ignoredController, control_lease: ignoredLease, execution_node_id: ignoredNode, node_recovery: ignoredRecovery, delivery: ignoredDelivery, workflow: ignoredWorkflow, ...safePatch } = patch;
    // Executor/internal writes remain compatible. Any controller-authored patch
    // must carry a verified actor and the live fencing generation.
    if (controllerContext !== undefined) {
      requireControllerActor(controllerContext?.actor);
      renewControlLease({ lease: task.control_lease, ownerId: controllerContext.actor.id,
        generation: controllerContext.generation, nowMs: Date.now(), ttlMs: 30_000 });
    }
    Object.assign(task, safePatch, { updatedAt: now() });
    if (task.node_recovery && safePatch.status) {
      task.node_recovery = {...task.node_recovery,phase:safePatch.status==='running'?'running':['completed','failed','cancelled','partial','blocked','interrupted'].includes(safePatch.status)?'awaiting_stop':task.node_recovery.phase};
    }
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
    copy.delivery=this.getDelivery(id);
    copy.workflow=this.getWorkflowStatus(id);
    if (!includeEvents) delete copy.events;
    return copy;
  }

  listTasks(limit = 20) {
    return Object.values(this.state.tasks)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((task) => {
        const copy = normalizeTaskRecord(task);
        copy.delivery=this.getDelivery(task.id);
        copy.workflow=this.getWorkflowStatus(task.id);
        delete copy.events;
        return copy;
      });
  }

  listTaskTimings() {
    return Object.values(this.state.tasks).map((task) => ({
      model: task.policy?.model ?? task.model ?? null,
      startedAt: task.startedAt ?? null,
      completedAt: task.completedAt ?? null,
    }));
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

  findTasks({ query = "", status = null, limit = 20, activeOnly = false } = {}) {
    const reportCache=new Map();
    const needle = String(query ?? "").trim().toLowerCase();
    const wanted = status ? new Set([status]) : null;
    const matches = Object.values(this.state.tasks).filter((task) => {
      if(activeOnly&&this.#workflowArchived(task,reportCache))return false;
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
      copy.delivery=this.getDelivery(task.id);
      copy.workflow=this.getWorkflowStatus(task.id);
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

  getProject(workspace, executor = null) {
    const project = this.state.projects[workspace];
    if (!project) return null;
    const copy = structuredClone(project);
    copy.threads = executorThreads(project);
    if (!executor) return copy;
    return {
      ...copy,
      executor,
      threadId: copy.threads[executor] ?? null,
    };
  }

  setProject(workspace, patch, executor = null) {
    const current = this.state.projects[workspace] ?? {
      workspace,
      threadId: null,
      createdAt: now(),
    };
    const resolvedExecutor = executor ?? patch.executor ?? null;
    // A new path revision means the workspace moved. Threads recorded at the
    // previous location must not be resumed.
    const revisionChanged = patch.pathRevision != null
      && current.pathRevision != null
      && patch.pathRevision !== current.pathRevision;
    const threads = revisionChanged ? {} : executorThreads(current);
    if (resolvedExecutor && patch.threadId) {
      threads[resolvedExecutor] = patch.threadId;
    }
    this.state.projects[workspace] = {
      ...current,
      ...patch,
      threads,
      threadId: revisionChanged && !(resolvedExecutor && patch.threadId)
        ? null
        : (patch.threadId ?? current.threadId ?? null),
      updatedAt: now(),
    };
    this.persist();
    return this.getProject(workspace, executor);
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
      .filter((task) => this.state.workflow_retention!==true && terminal.has(task.status) && !(task.executor_checkpoint?.retainUntil > Date.now()) && !/^message:[a-f0-9]{64}$/.test(task.idempotency_key??'') && !(task.node_recovery&&task.node_recovery.phase!=='completed') && !task._workflow)
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
