import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { ProjectRegistry } from "../src/core/project-registry.js";
import { TaskStore } from "../src/core/store.js";

class ProjectExecutor extends EventEmitter {
  constructor() {
    super();
    this.id = "project-executor";
    this.kind = "cli";
    this.ready = false;
    this.capabilities = { persistentThreads: true, tokenUsage: true };
    this.discovery = { available: null, status: "unknown" };
    this.threadStarts = [];
    this.turnStarts = [];
  }

  async probe() { return { available: true, status: "available", reason: null }; }
  setDiscovery(value) { this.discovery = value; return value; }
  async start() { this.ready = true; }
  async stop() {}
  respond() {}
  async listModels() { return { data: [] }; }
  async getSandboxReadiness() { return { status: "ready" }; }
  async resumeThread({ threadId }) { return { thread: { id: threadId } }; }
  async setGoal() { return {}; }
  async getGoal() { return { goal: null }; }
  async interruptTurn() { return {}; }

  async startThread(params) {
    this.threadStarts.push(params);
    return { thread: { id: `thread-${this.threadStarts.length}` } };
  }

  async startTurn(params) {
    this.turnStarts.push(params);
    const turnId = `turn-${this.turnStarts.length}`;
    queueMicrotask(() => this.emit("notification", {
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
              summary: "done",
              changed_files: [],
              tests: [],
              blockers: [],
              next_action: null,
            }),
          }],
        },
      },
    }));
    return { turn: { id: turnId } };
  }
}

function waitFor(predicate, timeoutMs = 1500) {
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

test("a moved project continues on the same logical task with a fresh executor session", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-project-continuation-"));
  const rootC = path.join(temp, "C-drive");
  const rootD = path.join(temp, "D-drive");
  const original = path.join(rootC, "calculator");
  fs.mkdirSync(path.join(original, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(original, ".git", "config"),
    "[remote \"origin\"]\n  url = https://example.test/calculator.git\n",
  );
  fs.mkdirSync(rootD, { recursive: true });
  const stateDir = path.join(temp, "state");
  const store = new TaskStore(stateDir, 50);
  const registry = new ProjectRegistry({
    stateDir,
    discoveryRoots: [rootC, rootD],
    hasActiveTasks: (projectId) =>
      store.listByStatus(["queued", "running"]).some(
        (task) => task.project_id === projectId,
      ),
  });
  const projectId = registry.publicProjects()[0].id;
  const executor = new ProjectExecutor();
  const config = {
    workspaceRoots: [rootC],
    executor: {
      provider: executor.id,
      routing: { order: [executor.id] },
      reroute: { enabled: false },
    },
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
    },
  };
  const orchestrator = new Orchestrator({
    config,
    store,
    executors: new Map([[executor.id, executor]]),
    defaultProvider: executor.id,
    projectRegistry: registry,
  });
  await orchestrator.start();

  assert.throws(
    () =>
      orchestrator.dispatch({
        workspace: original,
        project_id: "project:00000000-0000-4000-8000-000000000000",
        executor: executor.id,
        objective: "Must not fall back from an unknown project id",
        profile: "economy",
      }),
    { code: "project_not_found" },
  );

  const rootTask = orchestrator.dispatch({
    workspace: projectId,
    executor: executor.id,
    objective: "Run calculator tests",
    profile: "economy",
  });
  await waitFor(() => store.getTask(rootTask.id)?.status === "completed");
  assert.equal(store.getTask(rootTask.id).threadId, "thread-1");

  const moved = path.join(rootD, "calculator");
  fs.renameSync(original, moved);
  registry.refresh();
  registry.relink(projectId, moved);

  const child = orchestrator.continueTask(rootTask.id, {
    objective: "Continue after moving the project",
    profile: "economy",
  });
  await waitFor(() => store.getTask(child.id)?.status === "completed");
  const completed = store.getTask(child.id, true);
  assert.equal(completed.logical_task_id, rootTask.id);
  assert.equal(completed.parentTaskId, rootTask.id);
  assert.equal(completed.project_id, projectId);
  assert.equal(completed.project_path_revision, 2);
  assert.equal(completed.workspace_relinked, true);
  assert.equal(completed.threadId, "thread-2");
  assert.equal(executor.threadStarts[1].cwd, fs.realpathSync.native(moved));
  assert.equal(completed.continuation.workspace_relinked, true);
  assert.ok(completed.events.some((entry) => entry.type === "workspace.relinked"));
});
