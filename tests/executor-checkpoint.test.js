import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../src/core/store.js";
import { execFileSync } from "node:child_process";

function nodeChild(source, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["systemroot", "windir", "temp", "tmp"].includes(key.toLowerCase())));
  return execFileSync(process.execPath, ["--input-type=module", "-e",
    `import {TaskStore} from ${JSON.stringify(new URL("../src/core/store.js", import.meta.url).href)};${source}`, ...args],
  { encoding: "utf8", shell: false, windowsHide: true, timeout: 5000, env });
}

function fixture(t, maxTasks = 2000) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-checkpoint-"));
  const store = new TaskStore(root, 500, maxTasks);
  t.after(() => { store.releaseExecutorLease?.(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal(typeof store.acquireExecutorLease, "function", "TaskStore checkpoint single-writer lease must exist");
  store.acquireExecutorLease();
  const task = store.createTask({ workspace: root, brief: { objective: "fixture" }, policy: { name: "economy", model: "fixture", effort: "low" },
    executor: "dsh", idempotencyKey: "checkpoint-fixture-once", requestFingerprint: "c".repeat(64) });
  store.updateTask(task.id, { status: "running", threadId: "fixture-handle", turnId: "fixture-turn" });
  const binding = { executor: "dsh", acpHandle: "fixture-handle", turnId: "fixture-turn", runtimeFingerprint: "a".repeat(64),
    profileProofHash: "b".repeat(64), canonicalWorkspace: root, clientHomeReference: path.join(root, "home"), model: "fixture", effort: "low" };
  const begin = () => store.beginExecutorAttempt(task.id, binding, 10000);
  const evidence = { nativeSessionId: "native-fixture", range: "empty", toolVerified: true, status: "completed" };
  const patch = { status: "completed", result: { status: "completed", summary: "fixture report" }, error: null,
    executorSessionId: "native-fixture", execution_outcome: "confirmed", usage: null, usage_state: "unknown", completedAt: new Date().toISOString() };
  const complete = () => { const c = begin(); store.observeExecutorSession(task.id, c.attemptId, "native-fixture");
    store.commitExecutorCheckpoint(task.id, c.attemptId, evidence, patch); return c; };
  return { root, store, task, binding, begin, evidence, patch, complete };
}
test("checkpoint lease excludes another TaskStore writer and never silently steals a stale lock", (t) => {
  const s = fixture(t); const other = new TaskStore(s.root);
  assert.throws(() => other.acquireExecutorLease(), { code: "checkpoint_store_locked" });
  assert.throws(() => other.updateTask(s.task.id, { status: "queued" }), { code: "checkpoint_store_locked" });
  assert.equal(new TaskStore(s.root).getTask(s.task.id).status, "running");
  s.store.releaseExecutorLease();
  const reopened = new TaskStore(s.root); reopened.acquireExecutorLease(); reopened.releaseExecutorLease();
});
test("confirmed checkpoint/result commit survives reopening and preserves the retained request identity", (t) => {
  const s = fixture(t); const c = s.complete(); s.store.releaseExecutorLease();
  const child = JSON.parse(nodeChild(`const s=new TaskStore(process.argv[1]);s.acquireExecutorLease();
    const found=s.getAdoptableExecutorCheckpoint('fixture-handle',JSON.parse(process.argv[2]));
    process.stdout.write(JSON.stringify(found));s.releaseExecutorLease();`, s.root, JSON.stringify(s.binding)));
  assert.equal(child.task.id, s.task.id); assert.equal(child.checkpoint.nativeSessionId, "native-fixture");
  const restarted = new TaskStore(s.root); restarted.acquireExecutorLease();
  const found = restarted.getAdoptableExecutorCheckpoint("fixture-handle", s.binding);
  assert.equal(found.checkpoint.attemptId, c.attemptId); assert.equal(found.checkpoint.nativeSessionId, "native-fixture");
  assert.equal(found.task.id, s.task.id); assert.deepEqual(found.task.result, s.patch.result);
  assert.equal(restarted.findByIdempotencyKey("checkpoint-fixture-once").id, s.task.id);
  assert.throws(() => restarted.beginExecutorAttempt(s.task.id, s.binding, 10000), { code: "checkpoint_attempt_exists" });
  assert.equal(fs.existsSync(path.join(s.root, "session-map.json")), false);
  restarted.releaseExecutorLease();
});
test("intent, observed and uncertain ranges cannot be adopted or replayed", (t) => {
  const s = fixture(t); const c = s.begin();
  assert.throws(() => s.store.getAdoptableExecutorCheckpoint("fixture-handle", s.binding), { code: "checkpoint_not_adoptable" });
  s.store.observeExecutorSession(s.task.id, c.attemptId, "native-fixture");
  assert.throws(() => s.store.observeExecutorSession(s.task.id, c.attemptId, "foreign"), { code: "checkpoint_identity_mismatch" });
  assert.throws(() => s.store.getAdoptableExecutorCheckpoint("fixture-handle", s.binding), { code: "checkpoint_not_adoptable" });
  s.store.invalidateExecutorCheckpoint(s.task.id, c.attemptId);
  assert.equal(s.store.getTask(s.task.id).executor_checkpoint.phase, "unknown");
  assert.throws(() => s.store.beginExecutorAttempt(s.task.id, s.binding, 10000), { code: "checkpoint_attempt_exists" });
});
test("result, runtime, profile, workspace or retained key drift refuses adoption", (t) => {
  const s = fixture(t); s.complete();
  for (const change of [{ runtimeFingerprint: "d".repeat(64) }, { profileProofHash: "d".repeat(64) }, { canonicalWorkspace: path.dirname(s.root) }])
    assert.throws(() => s.store.getAdoptableExecutorCheckpoint("fixture-handle", { ...s.binding, ...change }), { code: "checkpoint_not_adoptable" });
  s.store.updateTask(s.task.id, { result: { summary: "changed" } });
  assert.throws(() => s.store.getAdoptableExecutorCheckpoint("fixture-handle", s.binding), { code: "checkpoint_not_adoptable" });
  s.store.updateTask(s.task.id, { result: s.patch.result, idempotency_key: "changed-key" });
  assert.throws(() => s.store.getAdoptableExecutorCheckpoint("fixture-handle", s.binding), { code: "checkpoint_not_adoptable" });
});
test("a checkpoint write failure quarantines further writes without fabricating a committed intent", (t) => {
  const s = fixture(t); const before = fs.readFileSync(s.store.statePath);
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => { if (to === s.store.statePath) throw Object.assign(Error("fixture disk failure"), { code: "EIO" }); return rename(from, to); });
  assert.throws(s.begin, { code: "checkpoint_persist_failed" });
  assert.deepEqual(fs.readFileSync(s.store.statePath), before);
  assert.throws(s.begin, { code: "checkpoint_store_faulted" });
});
test("adoption and task pruning obey the same bounded checkpoint retention", (t) => {
  const s = fixture(t, 1); s.complete();
  assert.throws(() => s.store.createTask({ workspace: s.root, brief: {}, policy: { name: "economy" } }), { code: "task_capacity_reached" });
  const later = Date.now() + 20000; t.mock.method(Date, "now", () => later);
  assert.throws(() => s.store.getAdoptableExecutorCheckpoint("fixture-handle", s.binding), { code: "checkpoint_not_adoptable" });
  s.store.createTask({ workspace: s.root, brief: {}, policy: { name: "economy" } });
  assert.equal(s.store.findByIdempotencyKey("checkpoint-fixture-once"), null);
});

test("a disappeared lease prevents checkpoint-owner writes even when state bytes still match", (t) => {
  const s = fixture(t); const token = fs.readFileSync(s.store.checkpointLeasePath); const disk = fs.readFileSync(s.store.statePath);
  fs.unlinkSync(s.store.checkpointLeasePath);
  try {
    assert.throws(() => s.store.updateTask(s.task.id, { status: "queued" }), { code: "checkpoint_store_locked" });
    assert.deepEqual(fs.readFileSync(s.store.statePath), disk);
  } finally { fs.writeFileSync(s.store.checkpointLeasePath, token); }
});
test("malformed checkpoint ordering or changed task workspace/turn cannot be adopted", (t) => {
  const s = fixture(t); s.complete(); const saved = s.store.getTask(s.task.id);
  for (const patch of [{ executor_checkpoint: { ...saved.executor_checkpoint, sequence: null } },
    { workspace: path.dirname(s.root) }, { turnId: "foreign-turn" }]) {
    s.store.updateTask(s.task.id, patch);
    assert.throws(() => s.store.getAdoptableExecutorCheckpoint("fixture-handle", s.binding), { code: "checkpoint_not_adoptable" });
    s.store.updateTask(s.task.id, saved);
  }
});

test("a crashed lease owner leaves a lock that a new process never steals automatically", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-checkpoint-crash-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  nodeChild(`const s=new TaskStore(process.argv[1]);s.acquireExecutorLease();process.exit(0);`, root);
  const bytes = fs.readFileSync(path.join(root, "executor-checkpoint.lock"));
  assert.throws(() => new TaskStore(root).acquireExecutorLease(), { code: "checkpoint_store_locked" });
  assert.deepEqual(fs.readFileSync(path.join(root, "executor-checkpoint.lock")), bytes);
});

test("a newer unknown attempt blocks adoption of an older confirmed result for the same handle", (t) => {
  const s = fixture(t); s.complete();
  const next = s.store.createTask({ workspace: s.root, brief: {}, policy: { name: "economy", model: "fixture", effort: "low" },
    executor: "dsh", idempotencyKey: "checkpoint-next-once", requestFingerprint: "e".repeat(64) });
  s.store.updateTask(next.id, { status: "running", threadId: "fixture-handle" });
  s.store.beginExecutorAttempt(next.id, { ...s.binding, turnId: "next-turn" }, 10000);
  assert.throws(() => s.store.getAdoptableExecutorCheckpoint("fixture-handle", s.binding), { code: "checkpoint_not_adoptable" });
});

test("ordinary TaskStore writes hold the same mutex through rename as checkpoint owners", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-state-mutex-"));
  const writer = new TaskStore(root); const task = writer.createTask({ workspace: root, brief: {}, policy: { name: "economy" } });
  const owner = new TaskStore(root); const rename = fs.renameSync; let acquiredDuringWrite = false;
  t.after(() => { owner.releaseExecutorLease(); fs.rmSync(root, { recursive: true, force: true }); });
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === writer.statePath) { try { owner.acquireExecutorLease(); acquiredDuringWrite = true; } catch (e) { assert.equal(e.code, "checkpoint_store_locked"); } }
    return rename(from, to);
  });
  writer.updateTask(task.id, { status: "running" });
  assert.equal(acquiredDuringWrite, false, "the mutex must cover the entire ordinary write, not a prior exists check");
  assert.equal(fs.existsSync(writer.checkpointLeasePath), false, "ordinary writes release their transient mutex");
});

test("a stale ordinary writer cannot overwrite state committed by a checkpoint owner after release", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-state-stale-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new TaskStore(root); const task = writer.createTask({ workspace: root, brief: {}, policy: { name: "economy" } });
  const owner = new TaskStore(root); owner.acquireExecutorLease(); owner.updateTask(task.id, { status: "completed" }); owner.releaseExecutorLease();
  assert.throws(() => writer.updateTask(task.id, { status: "queued" }), { code: "checkpoint_store_drift" });
  assert.equal(new TaskStore(root).getTask(task.id).status, "completed");
});
