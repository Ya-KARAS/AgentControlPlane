import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertLifecycle } from "../src/executors/lifecycle.js";
import * as api from "../src/executors/dsh-executor.js";
import { buildDshInvocation, verifyDshProfile } from "../src/executors/dsh-invocation.js";
import { profileFixture } from "./fixtures/dsh/profile-fixture.mjs";
const fixture = fs.readFileSync(new URL("./fixtures/dsh/completed.ndjson", import.meta.url), "utf8");

function setup(t, overrides = {}) {
  assert.equal(typeof api.DshExecutor, "function", "native DSH executor must exist");
  const f = profileFixture(t);
  const { contract } = f;
  const { workspace } = contract;
  const calls = [];
  const executor = new api.DshExecutor({ workspaceRoots: [contract.runRoot], clientContract: contract, timeoutMs: 1000, ...overrides }, {
    profile: (c) => verifyDshProfile(c, { runtime: f.runtime, workspaceRoots: [contract.runRoot] }),
    invocation: (options) => buildDshInvocation(options, { inspectInstallation: () => f.runtime }),
    spawn: () => { throw new Error("A fixture must never launch a real process"); },
    processOwner: (invocation, options) => {
      const { command, args } = invocation;
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.quiescent = false;
      child.kills = 0; child.terminate = async () => { child.kills++; return { quiescent: child.quiescent }; };
      calls.push({ command, args, options, child });
      return child;
    },
  });
  t.after(() => executor.stop());
  const threadArgs = { cwd: workspace, model: "fixture-model", sandbox: "read-only", approvalPolicy: "never",
    config: { agents: { max_threads: 1 }, sandbox_workspace_write: { network_access: false } } };
  const turnArgs = (id) => ({ threadId: id, cwd: workspace, model: "fixture-model", effort: "low",
    sandboxPolicy: { ...executor.executionPolicy.sandboxPolicy }, approvalPolicy: "never", input: [{ text: "fixture task & $(never a shell command)" }] });
  const finish = (i = 0, text = fixture, code = 0, confirmed = true) => {
    const child = calls[i].child;
    child.stdout.write(text.replace('"cwd":"WORKSPACE"', `"cwd":${JSON.stringify(workspace)}`)
      .replace('"tool":"shell","input":{"secret":"PRIVATE_FIXTURE_INPUT"}',
        `"tool":"pwsh","input":${JSON.stringify({ command: f.expectedTool.command, timeoutMs: 5000 })}`)
      .replace('"result":"PRIVATE_FIXTURE_OUTPUT"', `"result":${JSON.stringify(f.expectedTool.marker + '\n')}`));
    child.quiescent = confirmed;
    child.stdout.end(); child.stderr.end(); child.emit("close", code, null);
  };
  return { executor, workspace, contract, calls, threadArgs, turnArgs, finish };
}

test("DSH passive discovery/start/catalog never execute a CLI; missing client review blocks execution", async (t) => {
  const { executor, calls, threadArgs } = setup(t, { clientContract: null });
  assertLifecycle(executor);
  assert.equal((await executor.probe()).available, false);
  assert.equal((await executor.getSandboxReadiness()).status, "blocked");
  assert.deepEqual(await executor.listModels(), { data: [] });
  await assert.rejects(executor.start(), { code: "dsh_client_contract_required" });
  await assert.rejects(executor.startThread(threadArgs));
  assert.equal(calls.length, 0);
  assert.equal(executor.capabilities.hardInterrupt, false);
  assert.equal(executor.capabilities.persistentThreads, false);
});

test("DSH one-shot maps native session and final report, emits truthful nullable usage", async (t) => {
  const s = setup(t);
  assert.equal((await s.executor.probe()).available, true);
  await s.executor.start();
  assert.equal(s.calls.length, 0);
  const { thread } = await s.executor.startThread(s.threadArgs);
  await s.executor.setGoal({ threadId: thread.id, objective: "fixture", tokenBudget: 1000 });
  const result = once(s.executor, "notification");
  const { turn } = await s.executor.startTurn(s.turnArgs(thread.id));
  let stdin = "";
  for await (const chunk of s.calls[0].child.stdin) stdin += chunk;
  assert.match(stdin, /fixture task & \$\(never a shell command\)/);
  assert.doesNotMatch(s.calls[0].args.join(" "), /fixture task/);
  s.calls[0].child.stderr.write("SECRET_NOT_FOR_LOGGING");
  s.finish();
  const [event] = await result;
  assert.equal(event.method, "turn/completed");
  assert.equal(event.params.turn.id, turn.id);
  assert.equal(event.params.turn.status, "completed");
  assert.equal(event.params.executorSessionId, "session-fixture-001");
  assert.equal(event.params.turn.usageEvidence.usage.total_tokens, 14);
  assert.doesNotMatch(JSON.stringify(event), /SECRET_|PRIVATE_FIXTURE/);
  assert.equal((await s.executor.getGoal({ threadId: thread.id })).goal.tokensUsed, 14);
  await s.executor.resumeThread({ threadId: thread.id });
  const next = once(s.executor, "notification");
  await s.executor.startTurn(s.turnArgs(thread.id));
  assert.ok(s.calls[1].args.includes("session-fixture-001"));
  s.finish(1); await next;
});

test("DSH refuses unknown native mapping, model, effort, cwd and permissions before spawn", async (t) => {
  const s = setup(t);
  await s.executor.start();
  await assert.rejects(s.executor.resumeThread({ threadId: "missing" }), { code: "dsh_session_unavailable" });
  const { thread } = await s.executor.startThread(s.threadArgs);
  for (const changes of [{ model: "other-model" }, { effort: "ultra" }, { cwd: path.dirname(s.workspace) },
    { sandboxPolicy: { type: "workspaceWrite" } }, { sandboxPolicy: { type: "readOnly", networkAccess: true } },
    { approvalPolicy: "on-request" }]) {
    await assert.rejects(s.executor.startTurn({ ...s.turnArgs(thread.id), ...changes }));
  }
  await assert.rejects(s.executor.startThread({ ...s.threadArgs, config: { agents: { max_threads: 2 } } }));
  await assert.rejects(s.executor.startThread({ ...s.threadArgs, config: { sandbox_workspace_write: { network_access: true } } }));
  assert.equal(s.calls.length, 0);
});

test("DSH duplicate active dispatch spawns once and missing usage never becomes zero", async (t) => {
  const s = setup(t); await s.executor.start();
  const { thread } = await s.executor.startThread(s.threadArgs);
  const done = once(s.executor, "notification");
  await s.executor.startTurn(s.turnArgs(thread.id));
  await assert.rejects(s.executor.startTurn(s.turnArgs(thread.id)), { code: "dsh_turn_in_progress" });
  assert.equal(s.calls.length, 1);
  s.finish(0, fixture.replace(/,"usage":\{[^\n]+\}(?=\})/, ""));
  const [event] = await done;
  assert.equal(event.params.turn.usageEvidence.state, "unknown");
  assert.equal(event.params.turn.usageEvidence.usage, null);
  assert.equal((await s.executor.getGoal({ threadId: thread.id })).goal.tokensUsed, null);
});

for (const action of ["cancel", "timeout", "malformed", "session-cwd-mismatch", "session-eof-mismatch", "nonzero", "spawn-error", "stdin-error", "stdout-error", "stderr-error"]) {
  test(`DSH ${action} is terminal once, forbids automatic replay and preserves uncertainty`, async (t) => {
    const s = setup(t, { timeoutMs: action === "timeout" ? 20 : 1000 }); await s.executor.start();
    const { thread } = await s.executor.startThread(s.threadArgs);
    const events = []; s.executor.on("notification", (e) => events.push(e));
    const done = once(s.executor, "notification");
    const { turn } = await s.executor.startTurn(s.turnArgs(thread.id));
    if (action === "cancel") await s.executor.interruptTurn({ turnId: turn.id });
    if (action === "malformed") s.calls[0].child.stdout.write("not json\n");
    if (action === "session-cwd-mismatch") s.calls[0].child.stdout.write('{"type":"session","sessionId":"session-fixture-001","cwd":"WRONG"}\n');
    if (action === "session-eof-mismatch") {
      s.calls[0].child.stdout.write('{"type":"session","sessionId":"session-fixture-001","cwd":"WRONG"}');
      s.calls[0].child.emit("close", 0, null);
    }
    if (action === "nonzero") s.finish(0, fixture, 1);
    if (action === "spawn-error") s.calls[0].child.emit("error", new Error("SECRET_SPAWN_DETAIL"));
    if (action === "stdin-error") s.calls[0].child.stdin.emit("error", new Error("SECRET_STDIN_DETAIL"));
    if (action === "stdout-error") s.calls[0].child.stdout.emit("error", new Error("SECRET_STDOUT_DETAIL"));
    if (action === "stderr-error") s.calls[0].child.stderr.emit("error", new Error("SECRET_STDERR_DETAIL"));
    const [event] = await done;
    assert.equal(event.params.turn.safeToReroute, false);
    assert.notEqual(event.params.turn.status, "completed");
    assert.equal(event.params.turn.executionOutcome, "unknown");
    assert.doesNotMatch(JSON.stringify(event), /SECRET_/);
    s.calls[0].child.emit("close", 1, null);
    assert.equal(events.length, 1);
    await assert.rejects(s.executor.resumeThread({ threadId: thread.id }), { code: "dsh_session_unavailable" });
    assert.equal(s.calls.length, 1);
  });
}

test("DSH cancellation quarantines an unconfirmed child until its close event", async (t) => {
  const s = setup(t); await s.executor.start();
  const { thread } = await s.executor.startThread(s.threadArgs);
  const { turn } = await s.executor.startTurn(s.turnArgs(thread.id));
  await s.executor.interruptTurn({ turnId: turn.id });
  await assert.rejects(s.executor.startThread(s.threadArgs), { code: "dsh_process_unconfirmed" });
  s.calls[0].child.quiescent = true; s.calls[0].child.emit("close", 1, null);
  await s.executor.startThread(s.threadArgs);
  assert.equal(s.calls.length, 1);
});

test("DSH cancellation wins a close event delivered during Job termination", async (t) => {
  const s = setup(t); await s.executor.start();
  const { thread } = await s.executor.startThread(s.threadArgs);
  const done = once(s.executor, "notification");
  const { turn } = await s.executor.startTurn(s.turnArgs(thread.id));
  s.calls[0].child.stdout.write(fixture.replace('"cwd":"WORKSPACE"', `"cwd":${JSON.stringify(s.workspace)}`));
  s.calls[0].child.terminate = async () => { s.calls[0].child.quiescent = true; s.calls[0].child.emit("close", 0, null); return { quiescent: true }; };
  await s.executor.interruptTurn({ turnId: turn.id });
  const [event] = await done;
  assert.equal(event.params.turn.status, "cancelled");
  assert.equal(event.params.turn.executionOutcome, "unknown");
});

test("DSH configured profile does not claim runtime authentication or OS network enforcement", async (t) => {
  const s = setup(t);
  const state = await s.executor.getSandboxReadiness();
  assert.equal(state.status, "configured");
  assert.equal(state.runtimeVerified, false);
  assert.equal(state.effectivePolicy.sandboxPolicy.networkIsolation, "not-enforced");
  assert.equal(s.calls.length, 0);
});

test("DSH final text without native tool evidence or whole-Job quiescence cannot complete", async (t) => {
  for (const kind of ["missing-tool", "range-not-empty"]) {
    const s = setup(t); await s.executor.start();
    const { thread } = await s.executor.startThread(s.threadArgs);
    const done = once(s.executor, "notification");
    await s.executor.startTurn(s.turnArgs(thread.id));
    s.finish(0, kind === "missing-tool" ? fixture.replace(/^.*"type":"tool_(?:call|result)".*\n/gm, "") : fixture,
      0, kind !== "range-not-empty");
    const [event] = await done;
    assert.equal(event.params.turn.status, "failed");
    assert.equal(event.params.turn.safeToReroute, false);
    if (kind === "range-not-empty") await assert.rejects(s.executor.startThread(s.threadArgs), { code: "dsh_process_unconfirmed" });
  }
});

test("DSH detects reviewed profile drift immediately before turn launch", async (t) => {
  const s = setup(t); await s.executor.start();
  const { thread } = await s.executor.startThread(s.threadArgs);
  fs.appendFileSync(s.contract.patchPath, "\n");
  await assert.rejects(s.executor.startTurn(s.turnArgs(thread.id)), { code: "dsh_profile_drift" });
  assert.equal(s.calls.length, 0);
});
