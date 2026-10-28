import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../src/core/store.js";

test("persists tasks, projects, events, and usage totals", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-store-"));
  const store = new TaskStore(stateDir, 2);
  const task = store.createTask({
    workspace: "C:\\workspace",
    brief: { objective: "test" },
    policy: { name: "economy" },
  });
  store.updateTask(task.id, {
    usage: {
      input_tokens: 10,
      cached_input_tokens: 4,
      output_tokens: 3,
      reasoning_output_tokens: 2,
      total_tokens: 15,
    },
  });
  store.addEvent(task.id, { method: "one" });
  store.addEvent(task.id, { method: "two" });
  store.addEvent(task.id, { method: "three" });
  store.setProject("C:\\workspace", { threadId: "thread-1" });

  const reloaded = new TaskStore(stateDir, 2);
  assert.equal(reloaded.getProject("C:\\workspace").threadId, "thread-1");
  assert.equal(reloaded.getTask(task.id, true).events.length, 2);
  assert.equal(reloaded.usageReport().total_tokens, 15);
  assert.equal(reloaded.usageReport().uncached_input_tokens, 6);
  assert.equal(reloaded.listByStatus(["queued"]).length, 1);
});

test("stores continuation fields and inherits the logical task id", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-store-p1-"));
  const store = new TaskStore(stateDir, 20);
  const root = store.createTask({
    workspace: "C:\\workspace",
    brief: { objective: "root" },
    policy: { name: "economy" },
    executor: "codex",
    capabilityRequirements: { tools_required: true },
    executorCapabilities: { tools: true },
  });
  const child = store.createTask({
    workspace: root.workspace,
    brief: { objective: "continue" },
    policy: root.policy,
    parentTaskId: root.id,
    executor: "opencode",
    continuation: {
      version: 1,
      logical_task_id: root.logical_task_id,
      objective: "root",
    },
    rerouteReason: "quota_exhausted",
  });

  assert.equal(root.logical_task_id, root.id);
  assert.equal(child.logical_task_id, root.id);
  assert.equal(child.reroute_reason, "quota_exhausted");
  assert.equal(root.capability_requirements.tools_required, true);
  assert.equal(root.executor_capabilities.tools, true);
  assert.equal(root.executor_history[0].executor, "codex");

  store.appendExecutorHistory(child.id, {
    executor: "claude",
    started_at: new Date().toISOString(),
    ended_at: null,
    ended_reason: null,
    thread_id: null,
    turn_id: null,
    attempts: 1,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  });
  const reloaded = new TaskStore(stateDir, 20);
  assert.equal(reloaded.getTask(child.id).executor_history.length, 2);
  assert.equal(reloaded.listByLogicalTask(root.id).length, 2);
});

test("old task records receive read-time continuation defaults", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-store-legacy-"));
  const createdAt = "2026-08-20T00:00:00.000Z";
  fs.writeFileSync(
    path.join(stateDir, "state.json"),
    JSON.stringify({
      version: 1,
      projects: {},
      tasks: {
        legacy: {
          id: "legacy",
          parentTaskId: null,
          workspace: "C:\\workspace",
          brief: { objective: "legacy" },
          policy: { name: "economy" },
          executor: "codex",
          status: "completed",
          createdAt,
          updatedAt: createdAt,
          completedAt: createdAt,
          threadId: "thread-legacy",
          turnId: "turn-legacy",
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
          retries: 0,
          events: [],
        },
      },
    }),
    "utf8",
  );

  const task = new TaskStore(stateDir, 20).getTask("legacy");
  assert.equal(task.logical_task_id, "legacy");
  assert.equal(task.continuation, null);
  assert.equal(task.reroute_reason, null);
  assert.equal(task.idempotency_key, null);
  assert.equal(task.request_fingerprint, null);
  assert.equal(task.capability_requirements, null);
  assert.equal(task.executor_capabilities, null);
  assert.equal(task.executor_history.length, 1);
  assert.equal(task.executor_history[0].thread_id, "thread-legacy");
  assert.equal(task.executor_history[0].usage.total_tokens, 3);
  assert.equal(task.handoff, false);
});

test("project threads stay isolated per executor and legacy records stay on codex", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-store-threads-"));
  const store = new TaskStore(stateDir, 20);
  store.setProject("C:\\workspace", { threadId: "legacy-thread" });
  assert.equal(store.getProject("C:\\workspace", "codex").threadId, "legacy-thread");
  assert.equal(store.getProject("C:\\workspace", "opencode").threadId, null);

  store.setProject(
    "C:\\workspace",
    { threadId: "opencode-thread", executor: "opencode" },
    "opencode",
  );
  store.setProject(
    "C:\\workspace",
    { threadId: "codex-thread", executor: "codex" },
    "codex",
  );
  const reloaded = new TaskStore(stateDir, 20);
  assert.equal(reloaded.getProject("C:\\workspace", "codex").threadId, "codex-thread");
  assert.equal(reloaded.getProject("C:\\workspace", "opencode").threadId, "opencode-thread");
  assert.equal(reloaded.getProject("C:\\workspace").threads.codex, "codex-thread");
  assert.equal(reloaded.getProject("C:\\workspace").threads.opencode, "opencode-thread");
});
