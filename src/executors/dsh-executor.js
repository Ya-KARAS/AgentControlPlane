import { randomUUID } from "node:crypto";
import path from "node:path";
import { ControlPlaneError } from "../core/errors.js";
import { resolveWorkspace } from "../core/workspace.js";
import { EXECUTION_REPORT_INSTRUCTION, normalizeExecutionReportText } from "../core/execution-report.js";
import { ExecutorAdapter } from "./executor.js";
import { buildDshInvocation, DshJsonStream, verifyDshProfile } from "./dsh-invocation.js";
import { spawnDshOwnedProcess } from "./dsh-process-owner.js";

const denied = (code, message = "DSH client contract does not permit this operation") =>
  new ControlPlaneError(code, message, { safeToReroute: false });
const samePath = (a, b) => process.platform === "win32"
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

// Native DSH transport, not an OpenAI-compatible endpoint. Enabling the adapter
// does not establish authentication or change any installed client configuration.
export class DshExecutor extends ExecutorAdapter {
  constructor({ installationRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Programs", "DeepSeek Harness") : null,
    clientContract = null, workspaceRoots = [], timeoutMs = 25000, limits = {}, recovery = {} } = {}, dependencies = {}) {
    super({ id: "dsh", displayName: "DSH CLI", capabilities: {
      persistentThreads: false, tokenUsage: true, hardInterrupt: false, subagents: false,
    } });
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86400000) {
      throw denied("dsh_invalid_limit");
    }
    this.kind = "cli";
    this.resumeFailureIsFatal = true;
    this.automaticReroute = false;
    this.explicitDispatchOnly = true;
    this.usageEvidenceMode = true;
    this.recoveryEnabled = recovery.enabled === true;
    this.recoveryRetentionMs = recovery.retentionMs ?? 86400000;
    if (!Number.isSafeInteger(this.recoveryRetentionMs) || this.recoveryRetentionMs < 1000 || this.recoveryRetentionMs > 86400000)
      throw denied("dsh_invalid_limit");
    this.recoveryFault = false;
    this.executionPolicy = Object.freeze({ sandbox: "read-only", approvalPolicy: "never",
      sandboxPolicy: Object.freeze({ type: "readOnly", readIsolation: "not-enforced",
        networkIsolation: "not-enforced", toolPolicy: "fixed-command" }) });
    Object.assign(this, { installationRoot, clientContract, workspaceRoots, timeoutMs, limits });
    this.invocation = dependencies.invocation ?? buildDshInvocation;
    this.profile = dependencies.profile ?? ((contract) => verifyDshProfile(contract,
      { installationRoot: this.installationRoot, workspaceRoots: this.workspaceRoots }));
    this.processOwner = dependencies.processOwner ?? ((invocation, options) => spawnDshOwnedProcess(invocation,
      { ...options, ...(dependencies.spawn ? { spawn: dependencies.spawn } : {}) }));
    this.threads = new Map();
    this.turns = new Map();
  }

  #contract() {
    if (!this.clientContract) {
      throw denied("dsh_client_contract_required",
        "DSH needs immutable isolated profile evidence before an explicit task can execute");
    }
    return this.profile(this.clientContract);
  }

  #invocation(sessionId = null) {
    this.#contract();
    return this.invocation({ installationRoot: this.installationRoot, clientContract: this.clientContract,
      workspaceRoots: this.workspaceRoots, sessionId });
  }

  async probe() {
    try {
      this.#invocation();
      return { available: true, status: "available", reason: null,
        detail: "Pinned runtime and isolated profile bytes validated; authentication and runtime enforcement unverified" };
    } catch (error) {
      return { available: false, status: "unavailable", reason: error instanceof ControlPlaneError ? error.code : "dsh_installation_unavailable" };
    }
  }

  attachTaskStore(store) { if (this.recoveryEnabled) this.recoveryStore = store; }
  quarantineRecovery() { this.recoveryFault = true; }
  #recoveryBinding(handle, turnId = null) {
    const c = this.#contract();
    return { executor: this.id, acpHandle: handle, turnId, runtimeFingerprint: c.runtime.fingerprint,
      profileProofHash: c.proofHash, canonicalWorkspace: this.#workspace(c.workspace),
      clientHomeReference: path.resolve(c.clientHome), model: c.model, effort: c.effort };
  }
  async start() {
    this.#invocation();
    if (this.recoveryEnabled) {
      if (!this.recoveryStore || this.recoveryFault) throw denied("dsh_checkpoint_unavailable");
      this.recoveryStore.acquireExecutorLease();
    }
    this.ready = true;
  }
  async stop() {
    this.ready = false;
    for (const turnId of this.turns.keys()) await this.interruptTurn({ turnId });
    if (this.recoveryEnabled && !this.turns.size && !this.recoveryFault && !this.recoveryStore?.checkpointFaulted)
      this.recoveryStore?.releaseExecutorLease();
  }
  request() { return Promise.reject(denied("unsupported", "DSH exposes lifecycle methods directly")); }
  respond() {} // No interactive permission protocol; unsupported policies fail before spawn.
  async listModels() {
    try {
      const c = this.#contract();
      return { data: [{ id: c.model, model: c.model, displayName: c.model, isDefault: true,
        source: "native-config-preflight", supportedReasoningEfforts:
          c.effort ? [{ reasoningEffort: c.effort }] : [] }] };
    } catch { return { data: [] }; }
  }
  async getSandboxReadiness() {
    const probe = await this.probe();
    return { status: probe.available ? "configured" : "blocked", reason: probe.reason,
      source: "native-config-preflight", runtimeVerified: false, authentication: "unverified", effectivePolicy: this.executionPolicy };
  }

  #workspace(cwd) {
    const c = this.#contract();
    const actual = resolveWorkspace(cwd, this.workspaceRoots);
    if (!samePath(actual, resolveWorkspace(c.workspace, this.workspaceRoots))) throw denied("dsh_workspace_mismatch");
    return actual;
  }
  #thread(id, { allowEmpty = false } = {}) {
    const thread = this.threads.get(id);
    if (!thread || thread.uncertain || (!allowEmpty && !thread.sessionId)) {
      throw denied("dsh_session_unavailable", "DSH native session mapping is unavailable; automatic fresh-session fallback is forbidden");
    }
    return thread;
  }
  #assertNoUnconfirmedChild() {
    if (this.recoveryFault || this.recoveryStore?.checkpointFaulted) throw denied("dsh_checkpoint_unavailable");
    if ([...this.turns.values()].some((turn) => turn.finished && turn.child)) {
      throw denied("dsh_process_unconfirmed", "An earlier DSH child has not confirmed exit; new execution is blocked");
    }
  }
  async startThread({ cwd, model, sandbox, approvalPolicy, config = {} } = {}) {
    this.#assertNoUnconfirmedChild();
    if (!this.ready) await this.start();
    const c = this.#contract();
    if (model !== c.model || sandbox !== "read-only" || approvalPolicy !== "never" ||
        (config.agents?.max_threads ?? 1) !== 1 || config.sandbox_workspace_write?.network_access === true) {
      throw denied("dsh_unsupported_policy");
    }
    const actual = this.#workspace(cwd);
    const id = randomUUID();
    this.threads.set(id, { cwd: actual, sessionId: null, uncertain: false, active: null,
      goal: { objective: "", tokenBudget: 0, tokensUsed: null, status: "active" } });
    return { thread: { id, cwd: actual, effectivePolicy: this.executionPolicy } };
  }
  async resumeThread({ threadId } = {}) {
    if (this.recoveryEnabled) {
      this.#assertNoUnconfirmedChild();
      if (!this.ready) await this.start();
      const { task, checkpoint } = this.recoveryStore.getAdoptableExecutorCheckpoint(threadId, this.#recoveryBinding(threadId));
      if (!this.threads.has(threadId)) this.threads.set(threadId, { cwd: checkpoint.canonicalWorkspace, sessionId: checkpoint.nativeSessionId,
        uncertain: false, active: null, goal: { objective: "", tokenBudget: 0, tokensUsed: task.usage?.total_tokens ?? null, status: "completed" } });
    }
    const thread = this.#thread(threadId);
    if (thread.active) throw denied("dsh_turn_in_progress");
    return { thread: { id: threadId, cwd: thread.cwd, turns: [], executorSessionId: thread.sessionId } };
  }
  async setGoal({ threadId, objective, tokenBudget } = {}) {
    const thread = this.#thread(threadId, { allowEmpty: true });
    thread.goal = { objective: objective ?? "", tokenBudget: tokenBudget ?? 0, tokensUsed: null, status: "active" };
    return {};
  }
  async getGoal({ threadId } = {}) {
    const thread = this.threads.get(threadId);
    return { goal: thread ? { threadId, ...thread.goal } : null };
  }

  async startTurn(params = {}) {
    this.#assertNoUnconfirmedChild();
    const c = this.#contract();
    const thread = this.#thread(params.threadId, { allowEmpty: true });
    if (!this.ready) throw denied("dsh_not_started");
    if (thread.active) throw denied("dsh_turn_in_progress");
    if (params.model !== c.model || (params.effort ?? null) !== c.effort ||
        params.approvalPolicy !== "never" || params.sandboxPolicy?.type !== "readOnly" ||
        params.sandboxPolicy?.toolPolicy !== "fixed-command" || params.sandboxPolicy?.networkIsolation !== "not-enforced" ||
        params.sandboxPolicy?.networkAccess === true || !samePath(this.#workspace(params.cwd), thread.cwd)) {
      throw denied("dsh_unsupported_policy");
    }
    const task = typeof params.input === "string" ? params.input :
      (Array.isArray(params.input) ? params.input.map((i) => typeof i?.text === "string" ? i.text : "").join("\n") : "");
    const prompt = [EXECUTION_REPORT_INSTRUCTION,
      params.outputSchema ? `Return JSON matching: ${JSON.stringify(params.outputSchema)}` : "",
      "Work only inside the provided read-only workspace. Return a compact report.", task].join("\n");
    if (!task.trim() || Buffer.byteLength(prompt) > 131072) throw denied("dsh_invalid_task");
    const invocation = this.#invocation(thread.sessionId);
    const turnId = randomUUID();
    const turn = { threadId: params.threadId, thread, child: null, timer: null, finished: false,
      parser: new DshJsonStream({ ...this.limits, expectedTool: c.expectedTool }), stderrBytes: 0 };
    if (this.recoveryEnabled) {
      const taskId = params.responsesapiClientMetadata?.task_id;
      const checkpoint = this.recoveryStore.beginExecutorAttempt(taskId, this.#recoveryBinding(params.threadId, turnId), this.recoveryRetentionMs);
      turn.checkpoint = { taskId, attemptId: checkpoint.attemptId };
    }
    thread.active = turnId;
    this.turns.set(turnId, turn);
    queueMicrotask(() => this.#launch(turnId, turn, invocation, prompt));
    return { turn: { id: turnId } };
  }

  #launch(turnId, turn, invocation, prompt) {
    if (turn.finished) return;
    try {
      const child = this.processOwner(invocation, { cwd: turn.thread.cwd });
      turn.child = child;
      const abort = (code) => {
        if (turn.finished) return;
        this.#finish(turnId, turn, { status: "failed", error: { code, message: "DSH execution was not confirmed" } });
        try { Promise.resolve(child.terminate()).catch(() => {}); } catch { /* Keep range unknown. */ }
      };
      turn.timer = setTimeout(() => abort("dsh_timeout"), this.timeoutMs);
      child.stdout.on("data", (bytes) => {
        if (turn.finished) return;
        try {
          turn.parser.push(bytes);
          if (turn.parser.sessionId && (!samePath(turn.parser.cwd, turn.thread.cwd) ||
              (turn.thread.sessionId && turn.parser.sessionId !== turn.thread.sessionId))) {
            abort("dsh_session_mismatch");
          }
          if (!turn.finished && turn.checkpoint && turn.parser.sessionId && !turn.sessionPersisted) {
            this.recoveryStore.observeExecutorSession(turn.checkpoint.taskId, turn.checkpoint.attemptId, turn.parser.sessionId);
            turn.sessionPersisted = true;
          }
        } catch (error) { abort(error instanceof ControlPlaneError ? error.code : "dsh_protocol_error"); }
      });
      child.stderr.on("data", (bytes) => {
        if (turn.finished) return;
        turn.stderrBytes += bytes.length;
        if (turn.stderrBytes > (this.limits.maxOutputBytes ?? 2097152)) abort("dsh_output_limit");
      });
      child.on("error", () => abort("dsh_spawn_error"));
      child.stdin.on("error", () => abort("dsh_stdin_error"));
      child.stdout.on("error", () => abort("dsh_stdout_error"));
      child.stderr.on("error", () => abort("dsh_stderr_error"));
      child.on("close", (code, signal) => {
        if (!turn.finished) {
          try {
            this.#finish(turnId, turn, child.quiescent === true ? turn.parser.finish(code, signal) : {
              status: "failed", error: { code: "dsh_owner_unconfirmed", message: "DSH process range exit is unconfirmed" },
            });
          }
          catch (error) { abort(error instanceof ControlPlaneError ? error.code : "dsh_protocol_error"); }
        }
        if (child.quiescent === true) this.turns.delete(turnId);
      });
      child.stdin.end(prompt);
    } catch {
      this.#finish(turnId, turn, { status: "failed", error: { code: "dsh_spawn_error", message: "DSH could not be launched" } });
      try { Promise.resolve(turn.child?.terminate()).catch(() => {}); } catch { /* Preserve quarantine. */ }
    }
  }

  #finish(turnId, turn, result) {
    if (turn.finished) return;
    turn.finished = true;
    clearTimeout(turn.timer);
    let complete = result.status === "completed";
    if (!complete && turn.checkpoint) {
      try { this.recoveryStore.invalidateExecutorCheckpoint(turn.checkpoint.taskId, turn.checkpoint.attemptId); }
      catch { this.recoveryFault = true; result = { status: "failed", error: { code: "dsh_checkpoint_unavailable", message: "DSH checkpoint persistence was not confirmed" } }; }
    }
    // Keep the observed native identity even on failure, without making it resumable.
    turn.thread.sessionId = result.sessionId ?? turn.parser.sessionId ?? turn.thread.sessionId;
    turn.thread.uncertain = !complete;
    turn.thread.active = null;
    const usageEvidence = result.usageEvidence ?? turn.parser.usageEvidence();
    turn.thread.goal.tokensUsed = usageEvidence.usage?.total_tokens ?? null;
    turn.thread.goal.status = complete ? "completed" : "interrupted";
    if (!turn.child || turn.child.quiescent === true) this.turns.delete(turnId);
    this.emit("notification", { method: "turn/completed", params: {
      threadId: turn.threadId, executorSessionId: turn.thread.sessionId,
      ...(turn.checkpoint ? { recoveryEvidence: { ...turn.checkpoint, nativeSessionId: turn.thread.sessionId,
        range: turn.child?.quiescent === true ? "empty" : "unknown", toolVerified: result.toolEvidence?.verified === true, status: result.status } } : {}),
      turn: { id: turnId, status: result.status, safeToReroute: false,
        executionOutcome: complete ? "confirmed" : "unknown", usageEvidence,
        toolEvidence: result.toolEvidence ?? null, processRange: turn.child?.quiescent === true ? "empty" : "unknown",
        error: result.error ? { ...result.error, details: { safeToReroute: false } } : null,
        items: complete ? [{ type: "agentMessage", phase: "final_answer",
          text: normalizeExecutionReportText(result.finalText) }] : [] } } });
  }

  async interruptTurn({ turnId } = {}) {
    const turn = this.turns.get(turnId);
    if (!turn) return {};
    this.#finish(turnId, turn, { status: "cancelled", error: {
      code: "dsh_interrupted", message: "DSH cancellation requested; native execution outcome is unknown" } });
    try { await turn.child?.terminate(); } catch { /* Never substitute a weaker process-tree operation. */ }
    return {};
  }
}
