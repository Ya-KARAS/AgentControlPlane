import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import test from "node:test";
import { TaskStore } from "../src/core/store.js";
import { Orchestrator } from "../src/core/orchestrator.js";
import { normalizeAgentRegistry, resolveControllerActor } from "../src/controllers/registry.js";
import { RecordingExecutor } from "./fixtures/recording-executor.js";

const registry = normalizeAgentRegistry([
  { id: "dot", principal_id: "verified-dot" }, { id: "muse", principal_id: "verified-muse" },
]);
const dot = resolveControllerActor({ principalId: "verified-dot", registry });
const muse = resolveControllerActor({ principalId: "verified-muse", registry });
const fails = (fn, code) => assert.throws(fn, (error) => error.code === code);

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "acp-ownership-"));
  const workspace = path.join(directory, "workspace");
  fs.mkdirSync(workspace);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, workspace, store: new TaskStore(path.join(directory, "state")) };
}
function create(store, workspace, extra = {}) {
  return store.createTask({ workspace, brief: { objective: "one task" }, policy: { name: "economy" }, executor: "codex", ...extra });
}
function claim(store, id, actor, generation, action = "claim") {
  return store.updateControlLease(id, { actor, generation, action, ttlMs: 30_000 });
}
function verifyAudit(store) {
  const entries = fs.readFileSync(store.auditPath, "utf8").trim().split("\n").map(JSON.parse);
  let prev = null;
  for (const entry of entries) {
    assert.equal(entry.prev, prev);
    const { h, ...value } = entry;
    assert.equal(h, crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"));
    prev = h;
  }
  return entries;
}

test("legacy JSON records load safe null defaults without rewriting lineage or audit", (t) => {
  const { store, workspace } = setup(t);
  const task = create(store, workspace);
  const state = JSON.parse(fs.readFileSync(store.statePath));
  delete state.tasks[task.id].controller;
  delete state.tasks[task.id].control_lease;
  fs.writeFileSync(store.statePath, JSON.stringify(state));
  const auditBefore = fs.readFileSync(store.auditPath, "utf8");
  const restarted = new TaskStore(store.stateDir);
  assert.equal(restarted.getTask(task.id).controller, null);
  assert.equal(restarted.getTask(task.id).control_lease, null);
  assert.equal(restarted.getTask(task.id).logical_task_id, task.id);
  assert.equal(fs.readFileSync(store.auditPath, "utf8"), auditBefore);
});

test("lease persists takeover and released high-water mark across cold restart", (t) => {
  const { store, workspace } = setup(t);
  let nowMs = Date.parse("2026-11-01T12:00:00Z");
  t.mock.method(Date, "now", () => nowMs);
  const task = create(store, workspace, { controllerActor: dot, controllerMode: "failover", controlLeaseTtlMs: 30_000 });
  assert.equal(task.control_lease.generation, 1);
  assert.equal(task.controller.id, "dot");
  nowMs += 30_000;
  const restarted = new TaskStore(store.stateDir);
  const taken = claim(restarted, task.id, muse, 1);
  assert.equal(taken.control_lease.generation, 2);
  assert.equal(taken.control_lease.owner, "muse");
  assert.equal(taken.logical_task_id, task.logical_task_id);
  const diskBefore = fs.readFileSync(store.statePath, "utf8");
  for (const action of ["claim", "renew", "release"]) fails(() => claim(restarted, task.id, dot, 1, action), "control_lease_mismatch");
  fails(() => restarted.updateTask(task.id, { status: "cancelled" }, { actor: dot, generation: 1 }), "control_lease_mismatch");
  assert.equal(fs.readFileSync(store.statePath, "utf8"), diskBefore);
  claim(restarted, task.id, muse, 2, "release");
  const afterRelease = new TaskStore(store.stateDir);
  assert.equal(afterRelease.getTask(task.id).control_lease.owner, null);
  assert.equal(claim(afterRelease, task.id, muse, 2).control_lease.generation, 3);
  fails(() => claim(afterRelease, task.id, muse, 2, "renew"), "control_lease_mismatch");
  assert.equal(afterRelease.updateTask(task.id, { status: "blocked" }, { actor: muse, generation: 3 }).status, "blocked");
  const audit = verifyAudit(afterRelease);
  assert.ok(audit.some((entry) => entry.type === "task.control_lease" && entry.action === "release"));
  assert.equal(JSON.stringify(audit).includes("verified-dot"), false);
});

test("concurrent same-generation contenders have one winner and cannot replace it", async (t) => {
  const { store, workspace } = setup(t);
  const task = create(store, workspace, { controllerActor: dot, controllerMode: "failover" });
  t.mock.method(Date, "now", () => Date.parse(task.control_lease.expires_at));
  const results = await Promise.allSettled([
    Promise.resolve().then(() => claim(store, task.id, muse, 1)),
    Promise.resolve().then(() => claim(store, task.id, dot, 1)),
  ]);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
  assert.equal(results[1].reason.code, "control_lease_mismatch");
  assert.equal(store.getTask(task.id).control_lease.owner, "muse");
});

for (const mode of ["single", "cooperative"]) {
  test(`${mode} permits current-owner operations but no automatic other-owner takeover`, (t) => {
    const { store, workspace } = setup(t);
    const task = create(store, workspace, { controllerActor: dot, controllerMode: mode });
    assert.equal(claim(store, task.id, dot, 1, "renew").control_lease.owner, "dot");
    t.mock.method(Date, "now", () => Date.parse(task.control_lease.expires_at) + 1);
    fails(() => claim(store, task.id, muse, 1), "controller_takeover_disabled");
    assert.equal(claim(store, task.id, dot, 1).control_lease.generation, 2);
  });
}

test("generic patches and forged actor objects cannot bypass fencing", (t) => {
  const { store, workspace } = setup(t);
  const task = create(store, workspace, { controllerActor: dot });
  for (const patch of [{ controller: { id: "muse" } }, { control_lease: null }]) {
    fails(() => store.updateTask(task.id, patch), "control_lease_update_required");
  }
  fails(() => claim(store, task.id, { ...dot }, 1), "untrusted_controller");
  fails(() => create(store, workspace, { controllerActor: { ...dot } }), "untrusted_controller");
  assert.equal(store.getTask(task.id).control_lease.owner, "dot");
});

test("stale store instance cannot overwrite a committed controller owner", (t) => {
  const { store, workspace } = setup(t);
  const task = create(store, workspace);
  const stale = new TaskStore(store.stateDir);
  claim(store, task.id, dot, 0);
  fails(() => claim(stale, task.id, muse, 0), "checkpoint_store_drift");
  assert.equal(new TaskStore(store.stateDir).getTask(task.id).control_lease.owner, "dot");
});

function configFor(workspace, enabled = true) {
  return {
    workspaceRoots: [workspace], controllers: { enabled, mode: "failover", leaseTtlSeconds: 30, agents: [] },
    executor: { provider: "codex", routing: { order: ["codex"] } },
    codex: { approvalPolicy: "never", sandbox: "workspace-write", networkAccess: false },
    profiles: { economy: { model: "fake-model", effort: "low", maxSubagents: 0, tokenBudget: 30000, summary: "concise" } },
    limits: { maxBriefCharacters: 24000, maxConcurrentTasks: 1, maxQueuedTasks: 10, maxTokenBudget: 250000, maxStoredEventsPerTask: 30, maxTaskRuntimeMinutes: 1, discoveryRefreshMs: 0 },
  };
}
async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("task did not reach expected state");
}
class HoldingExecutor extends RecordingExecutor {
  async startTurn(params) {
    this.turnStarts.push(params);
    return { turn: { id: "held-turn" } };
  }
}

test("two forged caller retries deduplicate; takeover of running task never launches another executor", async (t) => {
  const { store, workspace } = setup(t);
  const executor = new HoldingExecutor("codex");
  const orchestrator = new Orchestrator({ config: configFor(workspace), store, codex: executor });
  await orchestrator.start();
  const request = { workspace, objective: "same work", profile: "economy", idempotency_key: "controllers:one" };
  const first = orchestrator.dispatch({ ...request, controller: { id: "dot" }, caller_id: "verified-dot" });
  try {
  const replay = orchestrator.dispatch({ ...request, controller: { id: "muse" }, caller_id: "verified-muse" });
  assert.equal(replay.id, first.id);
  assert.equal(first.controller.id, "local-operator");
  fails(() => orchestrator.dispatch({ ...request, objective: "different" }), "idempotency_conflict");
  await until(() => executor.turnStarts.length === 1 && store.getTask(first.id).status === "running");
  t.mock.method(Date, "now", () => Date.parse(first.control_lease.expires_at));
  const taken = claim(store, first.id, muse, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(taken.control_lease.owner, "muse");
  assert.equal(executor.turnStarts.length, 1);
  assert.equal(store.listTasks().length, 1);
  assert.equal(store.getTask(first.id).status, "running");
  assert.equal(orchestrator.queue.length, 0);
  } finally { await orchestrator.cancel(first.id); }
});

test("feature-off dispatch ignores forged metadata and keeps controller fields null", async (t) => {
  const { store, workspace } = setup(t);
  const executor = new RecordingExecutor("codex");
  const config = configFor(workspace, false);
  delete config.controllers; // Legacy embedders need no config changes.
  const orchestrator = new Orchestrator({ config, store, codex: executor });
  await orchestrator.start();
  const task = orchestrator.dispatch({ workspace, objective: "legacy", profile: "economy", controller: { id: "dot", trusted: true } });
  assert.equal(task.controller, null);
  assert.equal(task.control_lease, null);
  await until(() => store.getTask(task.id).status === "completed");
});

test("continue and handoff preserve lineage and safely attribute only the local operator", async (t) => {
  const { store, workspace } = setup(t);
  const executor = new RecordingExecutor("codex");
  const orchestrator = new Orchestrator({ config: configFor(workspace), store, codex: executor });
  await orchestrator.start();
  const first = orchestrator.dispatch({ workspace, objective: "initial", profile: "economy" });
  await until(() => store.getTask(first.id).status === "completed");
  const child = orchestrator.continueTask(first.id, { objective: "follow up", profile: "economy", controller: { id: "dot" } });
  assert.equal(child.controller.id, "local-operator");
  assert.equal(child.logical_task_id, first.logical_task_id);
  assert.equal(child.parentTaskId, first.id);
  await until(() => store.getTask(child.id).status === "completed");
  const handed = orchestrator.handoffTask(child.id, { objective: "review", executor: "codex", profile: "economy", controller: { id: "muse" } });
  assert.equal(handed.controller.id, "local-operator");
  assert.equal(handed.logical_task_id, first.logical_task_id);
  await until(() => store.getTask(handed.id).status === "completed");
  assert.equal(executor.turnStarts.length, 3);
});

test("legacy full-record patches tolerate unchanged controller metadata without replacing ownership", (t) => {
  const { store, workspace } = setup(t);
  for (const extra of [{}, { controllerActor: dot }]) {
    const task = create(store, workspace, extra);
    const patched = store.updateTask(task.id, { ...store.getTask(task.id), status: "blocked" });
    assert.equal(patched.status, "blocked");
    assert.deepEqual(patched.control_lease, task.control_lease);
  }
});
