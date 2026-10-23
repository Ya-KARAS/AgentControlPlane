import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { TaskStore } from "../src/core/store.js";
import { Orchestrator } from "../src/core/orchestrator.js";
import { ExecutorAdapter } from "../src/executors/executor.js";
import { DshExecutor } from "../src/executors/dsh-executor.js";
import { DshJsonStream, verifyDshProfile } from "../src/executors/dsh-invocation.js";
import { profileFixture } from "./fixtures/dsh/profile-fixture.mjs";

// Characterization of today's fail-closed recovery, not an implementation or
// proof of native cross-restart session adoption. No native client/model runs.
function setup(t) {
  const f = profileFixture(t, "fixture-model");
  const stateDir = path.join(f.contract.runRoot, "state");
  const starts = { native: 0, fallback: 0 };
  class Fallback extends ExecutorAdapter {
    constructor() { super({ id: "codex", displayName: "offline only" }); }
    async start() { this.ready = true; }
    async stop() { this.ready = false; }
    async listModels() { return { data: [] }; }
    async startThread() { starts.fallback++; throw Error("Unexpected fallback dispatch"); }
  }
  const config = {
    workspaceRoots: [f.contract.runRoot],
    codex: { approvalPolicy: "never", sandbox: "workspace-write", networkAccess: false },
    profiles: { economy: { model: "fixture-model", effort: "low", maxSubagents: 0, tokenBudget: 1000 } },
    executor: { reroute: { enabled: true, max_reroutes: 3, allowed_reasons: ["provider_unavailable"] } },
    limits: { maxBriefCharacters: 24000, maxConcurrentTasks: 1, maxQueuedTasks: 10,
      maxTokenBudget: 250000, maxTaskRuntimeMinutes: 1, discoveryRefreshMs: 0 },
  };
  const instances = [];
  function fresh() {
    const store = new TaskStore(stateDir);
    const dsh = new DshExecutor({ clientContract: f.contract, workspaceRoots: [f.contract.runRoot] }, {
      profile: (c) => verifyDshProfile(c, { runtime: f.runtime, workspaceRoots: [f.contract.runRoot] }),
      invocation: () => ({ command: "OFFLINE-NEVER-LAUNCH", args: [], options: {} }),
      processOwner: () => { starts.native++; throw Error("Unexpected native dispatch"); },
    });
    const fallback = new Fallback();
    const orchestrator = new Orchestrator({ config: structuredClone(config), store,
      executors: new Map([["codex", fallback], ["dsh", dsh]]), defaultProvider: "codex" });
    instances.push(dsh, fallback);
    return { store, dsh, orchestrator };
  }
  t.after(async () => { for (const executor of instances) await executor.stop(); });
  const request = { workspace: f.contract.workspace, objective: "offline persisted uncertain native task",
    profile: "economy", executor: "dsh", model: "fixture-model", idempotency_key: "dsh-restart-fixture-once" };
  function seed(patch = {}) {
    const initial = fresh();
    // Prevent the initial fixture from draining. Production config is untouched.
    initial.orchestrator.config.limits.maxConcurrentTasks = 0;
    const task = initial.orchestrator.dispatch(request);
    initial.store.updateTask(task.id, {
      status: "running", threadId: "saved-acp-handle", turnId: "saved-turn", executorSessionId: "saved-native-id",
      parentTaskId: "original-parent-reference", logical_task_id: "original-logical-reference",
      execution_outcome: "unknown", usage: null, usage_state: "partial",
      usage_known: { input_tokens: 11, output_tokens: 3, total_tokens: 14 },
      continuation: { version: 1, logical_task_id: "original-logical-reference", decisions: ["keep original evidence"] },
      executor_history: [{ executor: "dsh", thread_id: "saved-acp-handle", turn_id: "saved-turn", attempts: 1,
        usage: null, usage_state: "partial" }], ...patch,
    });
    return initial.store.getTask(task.id);
  }
  function assertNoExecution() { assert.deepEqual(starts, { native: 0, fallback: 0 }); }
  return { ...f, stateDir, config, request, fresh, seed, assertNoExecution };
}

test("persisted native references survive a separate Node process without adopting a DSH session", (t) => {
  const s = setup(t); const task = s.seed();
  const source = `import {TaskStore} from ${JSON.stringify(new URL("../src/core/store.js", import.meta.url).href)};
    const store=new TaskStore(process.argv[1]);
    const task=store.getTask(process.argv[2]);
    store.addEvent(task.id,{type:'offline.reader_observed',sessionReference:task.executorSessionId});
    process.stdout.write(JSON.stringify(store.getTask(task.id)));`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    ["systemroot", "windir", "temp", "tmp"].includes(k.toLowerCase())));
  const read = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", source, s.stateDir, task.id],
    { encoding: "utf8", timeout: 5000, windowsHide: true, shell: false, env }));
  const restarted = s.fresh();
  for (const field of ["id", "logical_task_id", "parentTaskId", "threadId", "turnId", "executorSessionId", "continuation", "executor_history", "usage_known"]) {
    assert.deepEqual(read[field], task[field]);
    assert.deepEqual(restarted.store.getTask(task.id)[field], task[field]);
  }
  assert.equal(restarted.dsh.capabilities.persistentThreads, false);
  assert.equal(restarted.dsh.threads.size, 0);
  assert.ok(restarted.store.getTask(task.id, true).events.some((event) => event.type === "offline.reader_observed"));
  s.assertNoExecution();
});

test("running DSH work becomes interrupted after restart and duplicate dispatch preserves the same task", async (t) => {
  const s = setup(t); const task = s.seed(); const restarted = s.fresh();
  await restarted.orchestrator.start();
  const interrupted = restarted.store.getTask(task.id, true);
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.execution_outcome, "unknown");
  assert.equal(interrupted.error.code, "control_plane_restarted");
  assert.ok(interrupted.events.some((event) => event.type === "task.recovery_failed" && event.error.code === "dsh_session_unavailable"));
  assert.equal(restarted.orchestrator.dispatch(s.request).id, task.id);
  assert.equal(restarted.orchestrator.dispatch(s.request).status, "interrupted");
  assert.throws(() => restarted.orchestrator.dispatch({ ...s.request, objective: "different work" }), { code: "idempotency_conflict" });
  await delay(10);
  assert.equal(restarted.store.listByLogicalTask(task.logical_task_id).length, 1);
  assert.deepEqual(interrupted.executor_history, task.executor_history);
  assert.deepEqual(interrupted.continuation, task.continuation);
  assert.deepEqual(interrupted.usage_known, task.usage_known);
  assert.equal(interrupted.usage, null);
  s.assertNoExecution();
});

test("repeated cold recovery preserves unknown outcome and never creates another native attempt", async (t) => {
  const s = setup(t); const task = s.seed();
  for (let i = 0; i < 3; i++) {
    const restarted = s.fresh(); await restarted.orchestrator.start();
    const read = restarted.store.getTask(task.id);
    assert.equal(read.status, "interrupted");
    assert.equal(read.executorSessionId, "saved-native-id");
    assert.equal(read.parentTaskId, task.parentTaskId);
    assert.equal(read.logical_task_id, task.logical_task_id);
    assert.equal(read.retries, 0);
    assert.deepEqual(read.executor_history, task.executor_history);
    assert.equal(restarted.orchestrator.dispatch(s.request).id, task.id);
  }
  s.assertNoExecution();
});

test("explicit continuation of an unavailable restarted DSH handle fails without a fresh-session fallback", async (t) => {
  const s = setup(t); const task = s.seed(); const restarted = s.fresh();
  await restarted.orchestrator.start();
  let newThreads = 0;
  const startThread = restarted.dsh.startThread.bind(restarted.dsh);
  restarted.dsh.startThread = (...args) => { newThreads++; return startThread(...args); };
  const child = restarted.orchestrator.continueTask(task.id,
    { objective: "explicit offline continuation", model: "fixture-model", reasoning_effort: "low" });
  for (let i = 0; i < 100 && ["queued", "running"].includes(restarted.store.getTask(child.id).status); i++) await delay(5);
  const failed = restarted.store.getTask(child.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "dsh_session_unavailable");
  assert.equal(failed.parentTaskId, task.id);
  assert.equal(failed.logical_task_id, task.logical_task_id);
  assert.equal(failed.threadId, task.threadId);
  assert.equal(newThreads, 0);
  assert.equal(restarted.store.getTask(task.id).executorSessionId, "saved-native-id");
  assert.equal(restarted.store.listByLogicalTask(task.logical_task_id).length, 2);
  s.assertNoExecution();
});

test("truncated persistent state fails closed instead of silently overwriting task and idempotency references", (t) => {
  const s = setup(t); s.seed();
  const file = path.join(s.stateDir, "state.json"); const truncated = '{"version":1,"tasks":';
  fs.writeFileSync(file, truncated);
  assert.throws(() => new TaskStore(s.stateDir), SyntaxError);
  assert.equal(fs.readFileSync(file, "utf8"), truncated);
  s.assertNoExecution();
});

test("an orphaned partial state-write file cannot replace the last committed native references", (t) => {
  const s = setup(t); const task = s.seed();
  const orphan = path.join(s.stateDir, "state.json.123456789.tmp");
  fs.writeFileSync(orphan, '{"tasks":');
  const restarted = s.fresh();
  assert.equal(restarted.store.getTask(task.id).executorSessionId, task.executorSessionId);
  assert.equal(restarted.store.findByIdempotencyKey(s.request.idempotency_key).id, task.id);
  assert.equal(fs.readFileSync(orphan, "utf8"), '{"tasks":');
  s.assertNoExecution();
});

for (const suffix of ["\nInvalidOperation: Cannot create type. Only core types are supported in this language mode.", "\n[exit code: 1]"]) {
  test(`native tool errors accompanying a correct marker are not accepted: ${suffix.includes("InvalidOperation") ? "CLM" : "exit failure"}`, () => {
    const marker = "ACP_ENCODING_FIXTURE";
    const expectedTool = { name: "pwsh", command: `Write-Output '${marker}'`, marker, maxTimeoutMs: 5000 };
    const parser = new DshJsonStream({ expectedTool });
    const text = fs.readFileSync(new URL("./fixtures/dsh/completed.ndjson", import.meta.url), "utf8")
      .replace('"tool":"shell","input":{"secret":"PRIVATE_FIXTURE_INPUT"}',
        `"tool":"pwsh","input":${JSON.stringify({ command: expectedTool.command, timeoutMs: 5000 })}`)
      .replace('"result":"PRIVATE_FIXTURE_OUTPUT"', `"result":${JSON.stringify(marker + suffix)}`);
    parser.push(Buffer.from(text));
    const result = parser.finish(0);
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "dsh_tool_execution_unconfirmed");
    assert.equal(result.toolEvidence.verified, false);
    assert.equal(result.safeToReroute, false);
    assert.equal(result.finalText, "");
    assert.equal(result.usageEvidence.state, "partial");
    assert.equal(result.usageEvidence.knownUsage.total_tokens, 14);
  });
}
