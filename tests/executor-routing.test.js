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
