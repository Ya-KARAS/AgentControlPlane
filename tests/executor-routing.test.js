import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";
import { ControlPlaneError } from "../src/core/errors.js";
import { DshExecutor } from "../src/executors/dsh-executor.js";
import { verifyDshProfile } from "../src/executors/dsh-invocation.js";
import { profileFixture } from "./fixtures/dsh/profile-fixture.mjs";

class RecordingExecutor extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.ready = false;
    this.turnStarts = [];
    this.discovery = { available: null, status: "unknown" };
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

  request() {
    return Promise.resolve({});
  }

  respond() {}

  async listModels() {
    return { data: [] };
  }

  async getSandboxReadiness() {
    return { status: "ready" };
  }

  async startThread() {
    return { thread: { id: `${this.id}-thread` } };
  }

  async resumeThread() {
    return { thread: { id: `${this.id}-thread`, turns: [] } };
  }

  async setGoal() {
    return {};
  }

  async getGoal() {
    return { goal: null };
  }

  async startTurn(params) {
    this.turnStarts.push(params);
    const turnId = `${this.id}-turn`;
    queueMicrotask(() => {
      this.emit("notification", {
        method: "turn/completed",
        params: {
          threadId: params.threadId,
          turn: {
            id: turnId,
            status: "completed",
            items: [
              {
                type: "agentMessage",
                phase: "final_answer",
                text: JSON.stringify({
                  status: "completed",
                  summary: `${this.id} done`,
                  changed_files: [],
                  tests: [],
                  blockers: [],
                  next_action: null,
                }),
              },
            ],
          },
        },
      });
    });
    return { turn: { id: turnId } };
  }

  async interruptTurn() {
    return {};
  }
}

function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error("Timed out"));
      }
      setTimeout(check, 5);
    };
    check();
  });
}

function testConfig(workspace) {
  return {
    workspaceRoots: [path.dirname(workspace)],
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
      maxStoredEventsPerTask: 20,
      maxTaskRuntimeMinutes: 1,
    },
  };
}

test("routes a dispatch to a non-default executor", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-route-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-route-state-")),
    20,
  );
  const codex = new RecordingExecutor("codex");
  const opencode = new RecordingExecutor("opencode");
  const executors = new Map([
    ["codex", codex],
    ["opencode", opencode],
  ]);
  const orchestrator = new Orchestrator({
    config: testConfig(workspace),
    store,
    executors,
    defaultProvider: "codex",
  });
  await orchestrator.start();

  const task = orchestrator.dispatch({
    workspace,
    objective: "hello",
    profile: "economy",
    executor: "opencode",
  });
  await waitFor(() => store.getTask(task.id)?.status === "completed");

  const completed = store.getTask(task.id);
  assert.equal(completed.executor, "opencode");
  assert.equal(completed.result.summary, "opencode done");
  assert.equal(codex.turnStarts.length, 0);
  assert.equal(opencode.turnStarts.length, 1);
});

test("starts every discovered executor so non-default routes are selectable", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-start-all-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-start-all-state-")),
    20,
  );
  const codex = new RecordingExecutor("codex");
  const opencode = new RecordingExecutor("opencode");
  const orchestrator = new Orchestrator({
    config: testConfig(workspace),
    store,
    executors: new Map([
      ["codex", codex],
      ["opencode", opencode],
    ]),
    defaultProvider: "opencode",
  });

  await orchestrator.start();

  assert.equal(opencode.ready, true);
  assert.equal(codex.ready, true);
  assert.deepEqual(
    orchestrator
      .getExecutors()
      .filter((entry) => entry.ready)
      .map((entry) => entry.id),
    ["codex", "opencode"],
  );
});

test("keeps the primary executor ready when a secondary start fails", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-start-fail-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-start-fail-state-")),
    20,
  );
  const codex = new RecordingExecutor("codex");
  codex.start = async () => {
    throw new Error("secondary unavailable");
  };
  const opencode = new RecordingExecutor("opencode");
  const diagnostics = [];
  const orchestrator = new Orchestrator({
    config: testConfig(workspace),
    store,
    executors: new Map([
      ["codex", codex],
      ["opencode", opencode],
    ]),
    defaultProvider: "opencode",
  });
  orchestrator.on("diagnostic", (entry) => diagnostics.push(entry));

  await orchestrator.start();

  assert.equal(opencode.ready, true);
  const failed = orchestrator
    .getExecutors()
    .find((entry) => entry.id === "codex");
  assert.equal(failed.ready, false);
  assert.equal(failed.discovery.status, "degraded");
  assert.equal(failed.discovery.reason, "start_failed");
  assert.match(failed.discovery.detail, /secondary unavailable/);
  assert.deepEqual(diagnostics, [
    { source: "codex-start", text: "secondary unavailable" },
  ]);
});

test("rejects an unknown executor", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-route-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-route-state-")),
    20,
  );
  const orchestrator = new Orchestrator({
    config: testConfig(workspace),
    store,
    executors: new Map([["codex", new RecordingExecutor("codex")]]),
    defaultProvider: "codex",
  });
  await orchestrator.start();
  assert.throws(
    () =>
      orchestrator.dispatch({
        workspace,
        objective: "x",
        profile: "economy",
        executor: "nope",
      }),
    /Unknown executor/,
  );
});

test("auto routing selects the first available executor and stores its id", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-auto-route-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-auto-route-state-")),
    20,
  );
  const codex = new RecordingExecutor("codex");
  codex.probe = async () => ({
    available: false,
    status: "unavailable",
    reason: "usage_unavailable",
  });
  const opencode = new RecordingExecutor("opencode");
  const config = testConfig(workspace);
  config.executor = {
    provider: "auto",
    routing: { order: ["codex", "opencode"] },
  };
  const orchestrator = new Orchestrator({
    config,
    store,
    executors: new Map([
      ["codex", codex],
      ["opencode", opencode],
    ]),
    defaultProvider: "auto",
  });
  await orchestrator.start();

  assert.equal(orchestrator.getDefaultExecutorId(), "opencode");
  const task = orchestrator.dispatch({
    workspace,
    objective: "auto hello",
    profile: "economy",
  });
  await waitFor(() => store.getTask(task.id)?.status === "completed");

  assert.equal(store.getTask(task.id).executor, "opencode");
  assert.equal(opencode.turnStarts.length, 1);
  assert.equal(opencode.turnStarts[0].model, null);
});

test("auto routing prefers a healthy executor over an earlier degraded one", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-auto-health-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-auto-health-state-")),
    20,
  );
  const degraded = new RecordingExecutor("opencode");
  degraded.probe = async () => ({
    available: true,
    status: "degraded",
    reason: "version_check_failed",
  });
  const healthy = new RecordingExecutor("codex");
  const config = testConfig(workspace);
  config.executor = {
    provider: "auto",
    routing: { order: ["opencode", "codex"] },
  };
  const orchestrator = new Orchestrator({
    config,
    store,
    executors: new Map([
      ["opencode", degraded],
      ["codex", healthy],
    ]),
    defaultProvider: "auto",
  });
  await orchestrator.start();
  assert.equal(orchestrator.getDefaultExecutorId(), "codex");
});

function isolatedRoute(t, executor, changeConfig = () => {}, providedWorkspace = null) {
  const workspace = providedWorkspace ?? fs.mkdtempSync(path.join(os.tmpdir(), "acp-strict-route-"));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "acp-strict-state-"));
  const config = testConfig(workspace);
  config.limits.discoveryRefreshMs = 0;
  changeConfig(config);
  const store = new TaskStore(state, 20);
  const fallback = new RecordingExecutor("codex");
  const orchestrator = new Orchestrator({ config, store,
    executors: new Map([["codex", fallback], [executor.id, executor]]), defaultProvider: "codex" });
  t.after(async () => {
    await executor.stop();
    await fallback.stop();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
  });
  return { workspace, store, orchestrator, fallback };
}

for (const strict of [true, false]) {
  test(`resume failure ${strict ? "stops strict native recovery" : "preserves legacy fresh-thread fallback"}`, async (t) => {
    const executor = new RecordingExecutor("native-fixture");
    executor.resumeFailureIsFatal = strict;
    executor.resumeThread = async () => { throw new ControlPlaneError("native_session_unavailable", "Saved session unavailable"); };
    let started = 0;
    executor.startThread = async () => { started++; return { thread: { id: "new-thread" } }; };
    const s = isolatedRoute(t, executor);
    const canonical = fs.realpathSync.native(s.workspace);
    s.store.setProject(canonical, { threadId: "lost-native-thread", executor: executor.id });
    await s.orchestrator.start();
    const task = s.orchestrator.dispatch({ workspace: s.workspace, objective: "resume fixture", profile: "economy", executor: executor.id });
    await waitFor(() => ["failed", "completed"].includes(s.store.getTask(task.id)?.status));
    assert.equal(started, strict ? 0 : 1);
    assert.equal(s.store.getTask(task.id).status, strict ? "failed" : "completed");
    assert.equal(s.fallback.turnStarts.length, 0);
  });
}

test("native failure cannot automatically reroute even when global reroute is enabled", async (t) => {
  const executor = new RecordingExecutor("native-fixture");
  executor.automaticReroute = false;
  executor.startTurn = async () => { throw new ControlPlaneError("provider_unavailable", "503 provider unavailable", { safeToReroute: false }); };
  const s = isolatedRoute(t, executor, (config) => {
    config.executor = { routing: { order: ["codex", executor.id] },
      reroute: { enabled: true, max_reroutes: 1, allowed_reasons: ["provider_unavailable"] } };
  });
  await s.orchestrator.start();
  const task = s.orchestrator.dispatch({ workspace: s.workspace, objective: "no replay fixture", profile: "economy", executor: executor.id });
  await waitFor(() => ["failed", "completed", "blocked"].includes(s.store.getTask(task.id)?.status));
  assert.equal(s.store.getTask(task.id).status, "failed");
  assert.equal(s.fallback.turnStarts.length, 0);
  assert.equal(s.store.getTask(task.id).executor_history.length, 1);
});

test("native unknown usage stays null in task/history and is explicit in the result", async (t) => {
  const executor = new RecordingExecutor("native-fixture");
  executor.usageEvidenceMode = true;
  executor.startTurn = async (params) => {
    queueMicrotask(() => executor.emit("notification", { method: "turn/completed", params: {
      threadId: params.threadId, executorSessionId: "session-fixture",
      turn: { id: "unknown-usage-turn", status: "completed", safeToReroute: false,
        usageEvidence: { state: "unknown", usage: null, knownUsage: null },
        items: [{ type: "agentMessage", phase: "final_answer", text: JSON.stringify({
          status: "completed", summary: "fixture result", changed_files: [], tests: [], blockers: [], next_action: null }) }] } } }));
    return { turn: { id: "unknown-usage-turn" } };
  };
  const s = isolatedRoute(t, executor);
  await s.orchestrator.start();
  const task = s.orchestrator.dispatch({ workspace: s.workspace, objective: "usage fixture", profile: "economy", executor: executor.id });
  await waitFor(() => s.store.getTask(task.id)?.status === "completed");
  const completed = s.store.getTask(task.id);
  assert.equal(completed.usage, null);
  assert.equal(completed.usage_state, "unknown");
  assert.equal(completed.executor_history.at(-1).usage, null);
  assert.match(completed.result.summary, /usage unknown/i);
  assert.equal(completed.executorSessionId, "session-fixture");
});

test("ACP and native DSH adapter integrate offline with idempotency and same-lineage session continuation", async (t) => {
  const f = profileFixture(t, "fake-model");
  const calls = [];
  const executor = new DshExecutor({ clientContract: f.contract, workspaceRoots: [f.contract.runRoot] }, {
    profile: (c) => verifyDshProfile(c, { runtime: f.runtime, workspaceRoots: [f.contract.runRoot] }),
    invocation: ({ sessionId }) => ({ command: "NEVER-LAUNCH-IN-FIXTURE", args: sessionId ? [sessionId] : [], options: {} }),
    spawn: () => { throw new Error("No real process in an offline fixture"); },
    processOwner: ({ command, args }) => {
      const child = new EventEmitter();
      Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), quiescent: false,
        terminate: async () => ({ quiescent: child.quiescent }) });
      calls.push({ command, args });
      child.stdin.on("finish", () => setImmediate(() => {
        child.stdout.write(fs.readFileSync(new URL("./fixtures/dsh/completed.ndjson", import.meta.url), "utf8")
          .replace('"cwd":"WORKSPACE"', `"cwd":${JSON.stringify(s.workspace)}`)
          .replace('"tool":"shell","input":{"secret":"PRIVATE_FIXTURE_INPUT"}',
            `"tool":"pwsh","input":${JSON.stringify({ command: f.expectedTool.command, timeoutMs: 5000 })}`)
          .replace('"result":"PRIVATE_FIXTURE_OUTPUT"', `"result":${JSON.stringify(f.expectedTool.marker + '\n')}`));
        child.quiescent = true;
        child.stdout.end(); child.stderr.end(); child.emit("close", 0, null);
      }));
      child.stdin.resume();
      return child;
    },
  });
  const s = isolatedRoute(t, executor, () => {}, f.contract.workspace);
  await s.orchestrator.start();
  assert.equal(calls.length, 0);
  const request = { workspace: s.workspace, objective: "offline native fixture", profile: "economy",
    executor: "dsh", model: "fake-model", idempotency_key: "native-fixture-once" };
  const task = s.orchestrator.dispatch(request);
  assert.equal(s.orchestrator.dispatch(request).id, task.id);
  await waitFor(() => ["completed", "failed", "blocked", "interrupted"].includes(s.store.getTask(task.id)?.status));
  assert.equal(s.store.getTask(task.id).status, "completed", JSON.stringify(s.store.getTask(task.id).error));
  assert.equal(s.store.getTask(task.id).usage.total_tokens, 14);
  assert.equal(s.store.getTask(task.id).usage.cached_input_tokens, null);
  assert.equal(s.store.getTask(task.id).usage_state, "complete");
  assert.equal(s.store.getTask(task.id).executorSessionId, "session-fixture-001");
  assert.equal(calls.length, 1);
  const continued = s.orchestrator.continueTask(task.id, { objective: "same lineage, next fixture", model: "fake-model", reasoning_effort: "low" });
  await waitFor(() => ["completed", "failed", "blocked", "interrupted"].includes(s.store.getTask(continued.id)?.status));
  assert.equal(s.store.getTask(continued.id).status, "completed", JSON.stringify(s.store.getTask(continued.id).error));
  const childTask = s.store.getTask(continued.id);
  assert.equal(childTask.parentTaskId, task.id);
  assert.equal(childTask.logical_task_id, task.logical_task_id);
  assert.equal(childTask.threadId, s.store.getTask(task.id).threadId);
  assert.deepEqual(calls[1].args, ["session-fixture-001"]);
  assert.equal(calls.length, 2);
});

test("an explicit-only native executor is never selected by automatic routing", async (t) => {
  const executor = new RecordingExecutor("native-fixture");
  executor.explicitDispatchOnly = true;
  const s = isolatedRoute(t, executor, (config) => {
    config.executor = { routing: { order: [executor.id, "codex"] } };
  });
  s.orchestrator.defaultProvider = "auto";
  await s.orchestrator.start();
  assert.equal(s.orchestrator.getDefaultExecutorId(), "codex");
  s.orchestrator.executorDiscovery.codex.available = false;
  assert.throws(() => s.orchestrator.dispatch({ workspace: s.workspace, objective: "must not auto-run native", profile: "economy" }),
    { code: "no_executor_available" });
  const task = s.orchestrator.dispatch({ workspace: s.workspace, objective: "explicit fixture", profile: "economy", executor: executor.id });
  await waitFor(() => s.store.getTask(task.id)?.status === "completed");
  assert.equal(executor.turnStarts.length, 1);
});
