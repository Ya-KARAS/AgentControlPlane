import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
const api = await import("../src/executors/dsh-process-owner.js").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});

function setup(options = {}) {
  assert.equal(typeof api.spawnDshOwnedProcess, "function", "whole-Job process owner must exist");
  const runner = new EventEmitter();
  runner.stdio = [null, null, null, null, new PassThrough(), new PassThrough(), new PassThrough()];
  runner.connected = true;
  runner.sent = [];
  runner.send = (message, callback) => { runner.sent.push(message); callback?.(null); };
  runner.kills = 0;
  runner.kill = () => { runner.kills++; return true; };
  const calls = [];
  const invocation = { command: "target.exe", args: ["cli.js", "--json", "-"],
    options: { env: { PATH: "safe" }, shell: false },
    owner: { command: "owner.exe", args: ["runner.js", "--", "target.exe", "cli.js", "--json", "-"],
      env: { PATH: "safe", DSH_SUBPROCESS_RUNNER: "windows", ELECTRON_RUN_AS_NODE: "1" } } };
  const owner = api.spawnDshOwnedProcess(invocation, { cwd: "C:\\fixture", settlementTimeoutMs: 10, platform: "win32",
    spawn: (...args) => { calls.push(args); return runner; }, ...options });
  const errors = []; owner.on("error", (error) => errors.push(error));
  return { owner, runner, calls, errors };
}

test("Job owner uses IPC/carrier descriptors and a single sanitized start", () => {
  const s = setup();
  assert.equal(s.owner.stdin, s.runner.stdio[4]);
  assert.equal(s.owner.stdout, s.runner.stdio[5]);
  assert.equal(s.owner.stderr, s.runner.stdio[6]);
  assert.deepEqual(s.calls[0][2].stdio, ["ignore", "ignore", "ignore", "ipc", "pipe", "pipe", "pipe"]);
  assert.equal(s.calls[0][2].shell, false);
  s.runner.emit("spawn"); s.runner.emit("spawn");
  assert.deepEqual(s.runner.sent, [{ type: "start", cwd: "C:\\fixture", env: { PATH: "safe" } }]);
  s.runner.emit("message", { type: "target-exit", exitCode: 0 });
  s.runner.emit("close", 0, null);
});

test("direct target exit is not completion until the whole Job owner exits normally", async () => {
  const s = setup(); s.runner.emit("spawn");
  const events = []; s.owner.on("close", (...args) => events.push(args));
  s.runner.emit("message", { type: "target-exit", exitCode: 7 });
  assert.equal(events.length, 0);
  assert.equal(s.owner.quiescent, false);
  const closed = once(s.owner, "close");
  s.runner.emit("close", 0, null);
  assert.deepEqual(await closed, [7, null]);
  assert.equal(s.owner.quiescent, true);
  assert.equal((await s.owner.settlement).quiescent, true);
});

test("terminate requests the native Job once and waits for quiescence", async () => {
  const s = setup(); s.runner.emit("spawn");
  const a = s.owner.terminate(); const b = s.owner.terminate();
  assert.equal(s.runner.sent.filter((x) => x.type === "terminate").length, 1);
  s.runner.emit("message", { type: "target-exit", exitCode: 1 });
  s.runner.emit("close", 0, null);
  assert.equal((await a).quiescent, true);
  assert.equal((await b).quiescent, true);
  assert.equal(s.runner.kills, 0);
});

test("a silent runner is force-closed after grace but remains unknown and is never relaunched", async () => {
  const s = setup(); s.runner.emit("spawn");
  const result = await s.owner.terminate();
  assert.equal(result.quiescent, false);
  assert.equal(s.runner.kills, 1);
  assert.equal(s.calls.length, 1);
  assert.equal(s.errors.at(-1).code, "dsh_owner_unconfirmed");
  s.runner.emit("close", null, "SIGTERM");
});

for (const frame of [{ type: "target-exit", exitCode: -1 }, { type: "other", secret: "SECRET" },
  { type: "target-exit", exitCode: 0, extra: "SECRET" }]) {
  test(`Job owner rejects malformed IPC ${JSON.stringify(frame)}`, async () => {
    const s = setup(); s.runner.emit("spawn");
    s.runner.emit("message", frame);
    assert.equal(s.errors[0].code, "dsh_owner_protocol_error");
    assert.doesNotMatch(JSON.stringify(s.errors), /SECRET/);
    s.runner.emit("close", 1, null);
    assert.equal((await s.owner.settlement).quiescent, false);
    assert.equal(s.calls.length, 1);
  });
}

test("Job owner never treats runner error or exit without target result as a successful range", async () => {
  for (const errorFrame of [false, true]) {
    const s = setup(); s.runner.emit("spawn");
    if (errorFrame) s.runner.emit("message", { type: "error", error: { message: "SECRET_NATIVE_ERROR" } });
    s.runner.emit("close", 0, null);
    assert.equal((await s.owner.settlement).quiescent, false);
    assert.equal(s.owner.targetExitCode, null);
    assert.doesNotMatch(JSON.stringify(s.errors), /SECRET_NATIVE_ERROR/);
  }
});

test("Job owner rejects duplicate target exits and disconnected start without weak fallback", async () => {
  const s = setup(); s.runner.emit("spawn");
  s.runner.emit("message", { type: "target-exit", exitCode: 0 });
  s.runner.emit("message", { type: "target-exit", exitCode: 0 });
  s.runner.emit("close", 0, null);
  assert.equal((await s.owner.settlement).quiescent, false);
  assert.equal(s.calls.length, 1);
  const d = setup(); d.runner.connected = false; d.runner.emit("spawn"); d.runner.emit("close", 1, null);
  assert.equal((await d.owner.settlement).quiescent, false);
  assert.equal(d.runner.sent.length, 0);
});
