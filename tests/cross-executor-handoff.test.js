import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";

class RecordingExecutor extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.kind = "cli";
    this.ready = false;
    this.capabilities = { persistentThreads: true, tokenUsage: true };
    this.discovery = { available: null, status: "unknown" };
    this.startedThreads = [];
    this.resumedThreads = [];
    this.turnStarts = [];
    this.threadCounter = 0;
  }

  async probe() {
    return { available: true, status: "available", reason: null };
  }

  setDiscovery(result) {
    this.discovery = result;
    return result;
  }

  async start() {
    this.ready = true;
  }

  async stop() {}
  respond() {}
  async listModels() { return { data: [] }; }
  async getSandboxReadiness() { return { status: "ready" }; }

  async startThread() {
    this.threadCounter += 1;
    const id = `${this.id}-thread-${this.threadCounter}`;
    this.startedThreads.push(id);
    return { thread: { id } };
  }

  async resumeThread({ threadId }) {
    this.resumedThreads.push(threadId);
    const ownThread = String(threadId).startsWith(`${this.id}-thread-`)
      || (this.id === "codex" && threadId === "legacy-codex-thread");
    if (!ownThread) {
      throw new Error(`${this.id} cannot resume foreign thread ${threadId}`);
    }
    return { thread: { id: threadId, turns: [] } };
  }

  async setGoal() { return {}; }
  async getGoal() { return { goal: null }; }

  async startTurn(params) {
    this.turnStarts.push(params);
    const turnId = `${this.id}-turn-${this.turnStarts.length}`;
    queueMicrotask(() => {
      this.emit("notification", {
        method: "turn/completed",
        params: {
          threadId: params.threadId,
          turn: {
            id: turnId,
            status: "completed",
            items: [{
              type: "agentMessage",
              phase: "final_answer",
              text: JSON.stringify({
                status: "completed",
                summary: `${this.id} completed ${this.turnStarts.length}`,
                changed_files: [`${this.id}.txt`],
                tests: [{ command: `${this.id} test`, status: "passed", detail: null }],
                blockers: [],
                next_action: null,
              }),
            }],
          },
        },
      });
    });
    return { turn: { id: turnId } };
  }

  async interruptTurn() { return {}; }
}

function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("Timed out"));
      setTimeout(check, 5);
    };
    check();
  });
}

function configFor(workspace) {
  return {
    workspaceRoots: [path.dirname(workspace)],
    executor: { provider: "codex", routing: { order: ["codex", "opencode"] } },
    codex: {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      networkAccess: false,
      defaultModel: null,
    },
    profiles: {
      economy: {
        model: "fake-model",
        effort: "low",
        maxSubagents: 0,
        tokenBudget: 30000,
        summary: "concise",
      },
    },
    limits: {
      maxBriefCharacters: 24000,
      maxConcurrentTasks: 1,
      maxQueuedTasks: 10,
      maxTokenBudget: 250000,
      maxStoredEventsPerTask: 50,
      maxTaskRuntimeMinutes: 1,
      discoveryRefreshMs: 0,
    },
  };
}

function setup() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-handoff-workspace-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-handoff-state-"));
  const store = new TaskStore(stateDir, 50);
  const codex = new RecordingExecutor("codex");
  const opencode = new RecordingExecutor("opencode");
  const orchestrator = new Orchestrator({
    config: configFor(workspace),
    store,
    executors: new Map([
      ["codex", codex],
      ["opencode", opencode],
    ]),
    defaultProvider: "codex",
  });
  return { workspace, stateDir, store, codex, opencode, orchestrator };
}

function cleanup(env) {
  fs.rmSync(env.workspace, { recursive: true, force: true });
  fs.rmSync(env.stateDir, { recursive: true, force: true });
}

function promptText(executor) {
  return executor.turnStarts.at(-1).input[0].text;
}

test("keeps persistent project threads isolated per executor", async () => {
  const env = setup();
  try {
    await env.orchestrator.start();
    const firstCodex = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "first codex pass",
      profile: "economy",
      executor: "codex",
    });
    await waitFor(() => env.store.getTask(firstCodex.id)?.status === "completed");

    const openCode = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "opencode pass",
      profile: "economy",
      executor: "opencode",
    });
    await waitFor(() => env.store.getTask(openCode.id)?.status === "completed");

    const secondCodex = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "second codex pass",
      profile: "economy",
      executor: "codex",
    });
    await waitFor(() => env.store.getTask(secondCodex.id)?.status === "completed");

    const canonical = env.store.getTask(firstCodex.id).workspace;
    assert.equal(env.codex.startedThreads.length, 1);
    assert.deepEqual(env.codex.resumedThreads, ["codex-thread-1"]);
    assert.equal(env.opencode.startedThreads.length, 1);
    assert.deepEqual(env.opencode.resumedThreads, []);
    assert.equal(env.store.getProject(canonical, "codex").threadId, "codex-thread-1");
    assert.equal(env.store.getProject(canonical, "opencode").threadId, "opencode-thread-1");
    assert.equal(env.store.getTask(secondCodex.id).threadId, "codex-thread-1");
  } finally {
    cleanup(env);
  }
});

test("legacy project state without an executor owner resumes only as Codex", async () => {
  const env = setup();
  try {
    const canonical = fs.realpathSync.native(env.workspace);
    env.store.setProject(canonical, { threadId: "legacy-codex-thread" });
    await env.orchestrator.start();

    const openCode = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "do not resume the legacy codex thread",
      profile: "economy",
      executor: "opencode",
    });
    await waitFor(() => env.store.getTask(openCode.id)?.status === "completed");
    assert.deepEqual(env.opencode.resumedThreads, []);
    assert.equal(env.opencode.startedThreads.length, 1);

    const codex = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "resume the legacy codex thread",
      profile: "economy",
      executor: "codex",
    });
    await waitFor(() => env.store.getTask(codex.id)?.status === "completed");
    assert.deepEqual(env.codex.resumedThreads, ["legacy-codex-thread"]);
    assert.equal(env.codex.startedThreads.length, 0);
    assert.equal(env.store.getProject(canonical, "codex").threadId, "legacy-codex-thread");
    assert.equal(env.store.getProject(canonical, "opencode").threadId, "opencode-thread-1");
  } finally {
    cleanup(env);
  }
});

test("hands completed evidence to another executor without its thread or the web conversation", async () => {
  const env = setup();
  try {
    await env.orchestrator.start();
    const source = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "implement the feature",
      profile: "economy",
      executor: "codex",
    });
    await waitFor(() => env.store.getTask(source.id)?.status === "completed");
    const sourceTask = env.store.getTask(source.id);

    const handoff = env.orchestrator.handoffTask(source.id, {
      executor: "opencode",
      objective: "review and verify the implementation",
      profile: "economy",
      evidence_required: ["report regressions"],
      idempotency_key: "handoff-once-01",
    });
    const replay = env.orchestrator.handoffTask(source.id, {
      executor: "opencode",
      objective: "review and verify the implementation",
      profile: "economy",
      evidence_required: ["report regressions"],
      idempotency_key: "handoff-once-01",
    });
    assert.equal(replay.id, handoff.id);
    await waitFor(() => env.store.getTask(handoff.id)?.status === "completed");

    const completed = env.store.getTask(handoff.id, true);
    assert.equal(completed.kind, "production");
    assert.equal(completed.handoff, true);
    assert.equal(completed.fresh_session, false);
    assert.equal(completed.parentTaskId, source.id);
    assert.equal(completed.logical_task_id, sourceTask.logical_task_id);
    assert.equal(completed.executor, "opencode");
    assert.equal(completed.reroute_reason, null);
    assert.equal(env.opencode.startedThreads.length, 1);
    assert.equal(env.opencode.resumedThreads.length, 0);
    assert.equal(env.opencode.turnStarts.length, 1);
    assert.equal(completed.continuation.purpose, "handoff");
    assert.equal(completed.continuation.current_state, "completed");
    assert.match(completed.continuation.summary, /codex completed/);
    assert.equal(JSON.stringify(completed.continuation).includes(sourceTask.threadId), false);

    const prompt = promptText(env.opencode);
    assert.match(prompt, /Execute the following compact engineering brief/);
    assert.match(prompt, /"previous_executor":"codex"/);
    assert.match(prompt, /codex completed/);
    assert.match(prompt, /codex\.txt/);
    assert.match(prompt, /codex test/);
    assert.equal(prompt.includes(sourceTask.threadId), false);
    assert.equal(prompt.includes("FULL CONVERSATION"), false);
    assert.ok(completed.events.some((event) => event.type === "task.handoff"));
  } finally {
    cleanup(env);
  }
});

test("a handoff resumes the target executor thread and leaves the source thread in place", async () => {
  const env = setup();
  try {
    await env.orchestrator.start();
    const openCode = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "opencode already knows this workspace",
      profile: "economy",
      executor: "opencode",
    });
    await waitFor(() => env.store.getTask(openCode.id)?.status === "completed");
    const source = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "codex implements the change",
      profile: "economy",
      executor: "codex",
    });
    await waitFor(() => env.store.getTask(source.id)?.status === "completed");

    const handoff = env.orchestrator.handoffTask(source.id, {
      executor: "opencode",
      objective: "review the codex change",
      profile: "economy",
      fresh_session: false,
    });
    await waitFor(() => env.store.getTask(handoff.id)?.status === "completed");

    assert.deepEqual(env.opencode.resumedThreads, ["opencode-thread-1"]);
    assert.equal(env.opencode.startedThreads.length, 1);
    assert.equal(env.codex.resumedThreads.length, 0);
    assert.equal(env.store.getTask(handoff.id).threadId, "opencode-thread-1");
    assert.equal(env.store.getTask(source.id).threadId, "codex-thread-1");
  } finally {
    cleanup(env);
  }
});

test("fresh_session starts an independent review without replacing the saved project thread", async () => {
  const env = setup();
  try {
    await env.orchestrator.start();
    const openCode = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "opencode already knows this workspace",
      profile: "economy",
      executor: "opencode",
    });
    await waitFor(() => env.store.getTask(openCode.id)?.status === "completed");
    const source = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "codex implements the change",
      profile: "economy",
      executor: "codex",
    });
    await waitFor(() => env.store.getTask(source.id)?.status === "completed");
    const canonical = env.store.getTask(openCode.id).workspace;

    const handoff = env.orchestrator.handoffTask(source.id, {
      executor: "opencode",
      objective: "independent review",
      profile: "economy",
      fresh_session: true,
      idempotency_key: "fresh-review-01",
    });
    assert.throws(
      () => env.orchestrator.handoffTask(source.id, {
        executor: "opencode",
        objective: "independent review",
        profile: "economy",
        fresh_session: false,
        idempotency_key: "fresh-review-01",
      }),
      { code: "idempotency_conflict" },
    );
    await waitFor(() => env.store.getTask(handoff.id)?.status === "completed");

    const completed = env.store.getTask(handoff.id);
    assert.equal(completed.fresh_session, true);
    assert.equal(completed.threadId, "opencode-thread-2");
    assert.equal(completed.logical_task_id, env.store.getTask(source.id).logical_task_id);
    assert.deepEqual(env.opencode.resumedThreads, []);
    assert.deepEqual(env.opencode.startedThreads, ["opencode-thread-1", "opencode-thread-2"]);
    assert.equal(env.store.getProject(canonical, "opencode").threadId, "opencode-thread-1");
    assert.equal(env.store.getTask(source.id).threadId, "codex-thread-1");
    const prompt = promptText(env.opencode);
    assert.match(prompt, /Execute the following compact engineering brief/);
    assert.match(prompt, /"previous_executor":"codex"/);
    assert.equal(prompt.includes(env.store.getTask(source.id).threadId), false);
  } finally {
    cleanup(env);
  }
});

test("rejects a non-boolean fresh_session", async () => {
  const env = setup();
  try {
    await env.orchestrator.start();
    const source = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "implement the feature",
      profile: "economy",
      executor: "codex",
    });
    await waitFor(() => env.store.getTask(source.id)?.status === "completed");
    assert.throws(
      () => env.orchestrator.handoffTask(source.id, {
        executor: "opencode",
        objective: "review the change",
        profile: "economy",
        fresh_session: "true",
      }),
      { code: "invalid_fresh_session" },
    );
    assert.equal(env.opencode.startedThreads.length, 0);
  } finally {
    cleanup(env);
  }
});

test("continue_project keeps same-executor session semantics and fresh cross-executor sessions", async () => {
  const env = setup();
  try {
    await env.orchestrator.start();
    const openCode = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "opencode baseline",
      profile: "economy",
      executor: "opencode",
    });
    await waitFor(() => env.store.getTask(openCode.id)?.status === "completed");
    const source = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "codex baseline",
      profile: "economy",
      executor: "codex",
    });
    await waitFor(() => env.store.getTask(source.id)?.status === "completed");

    const followUp = env.orchestrator.continueTask(source.id, {
      objective: "same executor correction",
      profile: "economy",
    });
    await waitFor(() => env.store.getTask(followUp.id)?.status === "completed");
    const continued = env.store.getTask(followUp.id);
    assert.equal(continued.handoff, false);
    assert.equal(continued.executor, "codex");
    assert.equal(continued.threadId, env.store.getTask(source.id).threadId);
    assert.equal(continued.logical_task_id, source.id);
    assert.match(promptText(env.codex), /Continue the existing engineering task/);
    assert.equal(env.codex.startedThreads.length, 1);

    const rerouted = env.orchestrator.continueTask(source.id, {
      executor: "opencode",
      objective: "explicit fresh continuation",
      profile: "economy",
    });
    await waitFor(() => env.store.getTask(rerouted.id)?.status === "completed");
    const switched = env.store.getTask(rerouted.id);
    assert.equal(switched.handoff, false);
    assert.equal(switched.executor, "opencode");
    assert.equal(switched.logical_task_id, source.id);
    assert.equal(switched.threadId, "opencode-thread-2");
    assert.equal(env.opencode.startedThreads.length, 2);
    assert.deepEqual(env.opencode.resumedThreads, []);
    assert.match(promptText(env.opencode), /Continue the existing engineering task/);
  } finally {
    cleanup(env);
  }
});

test("rejects a handoff when the target executor cannot satisfy the task", async () => {
  const env = setup();
  env.opencode.kind = "model-endpoint";
  try {
    await env.orchestrator.start();
    const source = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "implement the feature",
      profile: "economy",
      executor: "codex",
    });
    await waitFor(() => env.store.getTask(source.id)?.status === "completed");
    assert.throws(
      () => env.orchestrator.handoffTask(source.id, {
        executor: "opencode",
        objective: "review the change",
        profile: "economy",
      }),
      { code: "incompatible_executor" },
    );
    assert.equal(env.opencode.startedThreads.length, 0);
  } finally {
    cleanup(env);
  }
});

test("rejects handoff while the source task is still running", async () => {
  const env = setup();
  env.codex.startTurn = async function startTurn(params) {
    this.turnStarts.push(params);
    return { turn: { id: "codex-running-turn" } };
  };
  try {
    await env.orchestrator.start();
    const source = env.orchestrator.dispatch({
      workspace: env.workspace,
      objective: "long running task",
      profile: "economy",
      executor: "codex",
    });
    await waitFor(() => env.store.getTask(source.id)?.status === "running");
    assert.throws(
      () => env.orchestrator.handoffTask(source.id, {
        executor: "opencode",
        objective: "review too early",
        profile: "economy",
      }),
      /terminal state/,
    );
    await env.orchestrator.cancel(source.id);
  } finally {
    cleanup(env);
  }
});

test("a queued handoff recovers as a fresh brief rather than a same-thread follow-up", async () => {
  const env = setup();
  try {
    const canonical = fs.realpathSync.native(env.workspace);
    const parent = env.store.createTask({
      workspace: canonical,
      brief: {
        objective: "source",
        constraints: [],
        acceptanceCriteria: [],
        context: [],
        evidenceRequired: [],
      },
      policy: { name: "economy", effort: "low", maxSubagents: 0, tokenBudget: 30000, summary: "concise" },
      executor: "codex",
    });
    env.store.updateTask(parent.id, {
      status: "completed",
      threadId: "codex-thread-9",
      result: {
        status: "completed",
        summary: "compact evidence",
        changed_files: ["src/app.js"],
        tests: [],
        blockers: [],
        next_action: null,
      },
    });
    const child = env.store.createTask({
      workspace: canonical,
      brief: {
        objective: "review the change",
        constraints: [],
        acceptanceCriteria: [],
        context: [],
        evidenceRequired: [],
      },
      policy: parent.policy,
      parentTaskId: parent.id,
      executor: "opencode",
      logicalTaskId: parent.id,
      continuation: {
        purpose: "handoff",
        summary: "compact evidence",
        previous_executor: "codex",
      },
      handoff: true,
    });
    await env.orchestrator.start();
    await waitFor(() => env.store.getTask(child.id)?.status === "completed");
    const prompt = promptText(env.opencode);
    assert.match(prompt, /Execute the following compact engineering brief/);
    assert.doesNotMatch(prompt, /Continue the existing engineering task/);
    assert.match(prompt, /compact evidence/);
    assert.equal(prompt.includes("codex-thread-9"), false);
    assert.equal(env.opencode.resumedThreads.includes("codex-thread-9"), false);
  } finally {
    cleanup(env);
  }
});
