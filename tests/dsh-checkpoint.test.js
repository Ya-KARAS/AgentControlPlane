import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { DshExecutor } from "../src/executors/dsh-executor.js";
import { verifyDshProfile } from "../src/executors/dsh-invocation.js";
import { ExecutorAdapter } from "../src/executors/executor.js";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";
import { profileFixture } from "./fixtures/dsh/profile-fixture.mjs";
async function settled(store, id) {
  for (let i = 0; i < 150; i++) { const task = store.getTask(id); if (!["queued", "running"].includes(task.status)) return task; await delay(5); }
  assert.fail("Offline checkpoint task did not settle");
}
function fixture(t, failReceipt = false) {
  const cleanups = []; const f = profileFixture({ after: (fn) => cleanups.push(fn) }, "fixture-model");
  const stateDir = path.join(f.contract.runRoot, "state"); const instances = []; const calls = []; let terminalBarrier = () => {};
  class Fallback extends ExecutorAdapter {
    constructor() { super({ id: "codex" }); }
    async start() { this.ready = true; }
    async stop() {}
    async listModels() { return { data: [] }; }
    async startThread() { assert.fail("No fallback launch permitted"); }
  }
  const config = { workspaceRoots: [f.contract.runRoot], codex: { approvalPolicy: "never", sandbox: "workspace-write", networkAccess: false },
    profiles: { economy: { model: "fixture-model", effort: "low", maxSubagents: 0, tokenBudget: 1000 } },
    limits: { maxBriefCharacters: 24000, maxConcurrentTasks: 1, maxQueuedTasks: 10, maxTokenBudget: 250000, maxTaskRuntimeMinutes: 1, discoveryRefreshMs: 0 } };
  function fresh() {
    const store = new TaskStore(stateDir);
    const dsh = new DshExecutor({ clientContract: f.contract, workspaceRoots: [f.contract.runRoot], recovery: { enabled: true, retentionMs: 60000 } }, {
      profile: (c) => verifyDshProfile(c, { runtime: f.runtime, workspaceRoots: [f.contract.runRoot] }),
      invocation: ({ sessionId }) => ({ command: "NO-NATIVE-PROCESS", args: sessionId ? [sessionId] : [], options: {} }),
      processOwner: (invocation) => {
        const child = new EventEmitter(); Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), quiescent: false,
          terminate: async () => ({ quiescent: child.quiescent }) }); calls.push(invocation);
        child.stdin.resume(); child.stdin.on("finish", () => setImmediate(() => {
          let text = fs.readFileSync(new URL("./fixtures/dsh/completed.ndjson", import.meta.url), "utf8")
            .replace('"cwd":"WORKSPACE"', `"cwd":${JSON.stringify(f.contract.workspace)}`)
            .replace('"tool":"shell","input":{"secret":"PRIVATE_FIXTURE_INPUT"}', `"tool":"pwsh","input":${JSON.stringify({ command: f.expectedTool.command, timeoutMs: 5000 })}`)
            .replace('"result":"PRIVATE_FIXTURE_OUTPUT"', `"result":${JSON.stringify(f.expectedTool.marker + '\n')}`);
          if (failReceipt) text = text.replace(/^.*"type":"tool_(?:call|result)".*\n/gm, "");
          child.stdout.write(text); terminalBarrier(); child.quiescent = true; child.stdout.end(); child.stderr.end(); child.emit("close", 0, null);
        })); return child;
      },
    });
    instances.push(dsh);
    const orchestrator = new Orchestrator({ config, store, executors: new Map([["codex", new Fallback()], ["dsh", dsh]]), defaultProvider: "codex" });
    return { store, dsh, orchestrator };
  }
  t.after(async () => { for (const dsh of instances) await dsh.stop(); for (const fn of cleanups) fn(); });
  const request = { workspace: f.contract.workspace, executor: "dsh", objective: "offline checkpoint fixture", profile: "economy", model: "fixture-model", idempotency_key: "checkpoint-native-request" };
  return { fresh, calls, request, f, setTerminalBarrier: (fn) => { terminalBarrier = fn; } };
}
test("DSH completed checkpoint adopts the same native ID after cold start without redispatching the retained result", async (t) => {
  const s = fixture(t); const first = s.fresh();
  assert.equal(first.dsh.recoveryEnabled, true, "opt-in checkpoint integration must exist");
  await first.orchestrator.start(); const task = first.orchestrator.dispatch(s.request);
  const completed = await settled(first.store, task.id);
  assert.equal(completed.status, "completed", JSON.stringify(completed.error));
  assert.equal(completed.executor_checkpoint.phase, "terminal-confirmed");
  assert.equal(completed.executor_checkpoint.range, "empty"); assert.equal(s.calls.length, 1);
  await first.dsh.stop();
  const second = s.fresh(); await second.orchestrator.start();
  assert.equal(second.dsh.capabilities.persistentThreads, false, "native recovery has not been live-certified");
  assert.equal(second.orchestrator.dispatch(s.request).id, task.id); assert.equal(s.calls.length, 1);
  const resumed = await second.dsh.resumeThread({ threadId: completed.threadId });
  assert.equal(resumed.thread.executorSessionId, "session-fixture-001"); assert.equal(s.calls.length, 1);
  assert.throws(() => second.orchestrator.continueTask(task.id, { objective: "missing key", model: "fixture-model" }), { code: "continuation_idempotency_required" });
  const nextRequest = { objective: "explicit next fixture", model: "fixture-model", reasoning_effort: "low", idempotency_key: "checkpoint-continuation-once" };
  const next = second.orchestrator.continueTask(task.id, nextRequest);
  assert.equal(second.orchestrator.continueTask(task.id, nextRequest).id, next.id);
  const child = await settled(second.store, next.id);
  assert.equal(child.status, "completed", JSON.stringify(child.error));
  assert.equal(child.logical_task_id, completed.logical_task_id); assert.equal(child.parentTaskId, task.id);
  assert.deepEqual(s.calls[1].args, ["session-fixture-001"]); assert.equal(s.calls.length, 2);
  assert.throws(() => second.orchestrator.continueTask(task.id, { ...nextRequest, objective: "changed" }), { code: "idempotency_conflict" });
  second.orchestrator.executorDiscovery.dsh = { available: false, status: "unavailable" };
  assert.equal(second.orchestrator.continueTask(task.id, nextRequest).id, child.id, "retained result lookup must not require a live executor");
  assert.equal(s.calls.length, 2);
});
test("a failed native receipt keeps the persisted attempt unknown and cannot be adopted after restart", async (t) => {
  const s = fixture(t, true); const first = s.fresh();
  assert.equal(first.dsh.recoveryEnabled, true);
  await first.orchestrator.start(); const task = first.orchestrator.dispatch(s.request); const failed = await settled(first.store, task.id);
  assert.equal(failed.status, "failed"); assert.equal(failed.executor_checkpoint.phase, "unknown");
  assert.equal(failed.executorSessionId, "session-fixture-001"); await first.dsh.stop();
  const second = s.fresh(); await second.orchestrator.start();
  await assert.rejects(second.dsh.resumeThread({ threadId: failed.threadId }), { code: "checkpoint_not_adoptable" });
  assert.equal(second.orchestrator.dispatch(s.request).id, task.id); assert.equal(s.calls.length, 1);
});

test("checkpoint dispatch requires a retained idempotency key before creating or launching work", async (t) => {
  const s = fixture(t); const first = s.fresh(); await first.orchestrator.start();
  assert.throws(() => first.orchestrator.dispatch({ ...s.request, idempotency_key: undefined }), { code: "dispatch_idempotency_required" });
  assert.equal(first.store.listTasks().length, 0); assert.equal(s.calls.length, 0);
});

test("terminal persistence failure retains unknown disk evidence and quarantines new execution", async (t) => {
  const s = fixture(t); const first = s.fresh(); await first.orchestrator.start();
  let fail = false; const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => { if (fail && to === first.store.statePath) throw Error("fixture terminal disk failure"); return rename(from, to); });
  s.setTerminalBarrier(() => { fail = true; });
  const task = first.orchestrator.dispatch(s.request); const outcome = await settled(first.store, task.id);
  assert.notEqual(outcome.status, "completed"); assert.equal(first.dsh.recoveryFault, true);
  const disk = JSON.parse(fs.readFileSync(first.store.statePath, "utf8")).tasks[task.id];
  assert.equal(disk.status, "running"); assert.equal(disk.executor_checkpoint.phase, "session-observed");
  await assert.rejects(first.dsh.startThread({}), { code: "dsh_checkpoint_unavailable" });
  assert.equal(s.calls.length, 1);
});
