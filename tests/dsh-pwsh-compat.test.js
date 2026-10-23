import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
const api = await import("../src/executors/dsh-pwsh-compat.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function fixture(t) {
  assert.equal(typeof api.createReadonlyAsciiPwshExecutor, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-pwsh-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "pwsh.exe"); fs.writeFileSync(executable, "synthetic not executable");
  const prefix = "synthetic-native-encoding-prefix; ";
  const command = "Write-Output 'ACP_COMPAT_MARKER'";
  const policy = { mode: "read-only", workspaceRoot: root };
  const calls = [];
  class NativeSandbox {
    static inject = ["subprocess", "sandbox", "sandboxPolicy"];
    static Config = { native: true };
    constructor(ctx) { this.ctx = ctx; this.pwshPath = executable; }
    argv(spec) { return [this.pwshPath, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", prefix + spec.command]; }
    confine(spec, p, signal) { return this.ctx.sandbox.confine(this.argv(spec), p, signal); }
    async execute(spec) {
      const prepared = await this.confine(spec, spec.sandboxPolicy, spec.signal);
      return this.ctx.subprocess.spawn(prepared);
    }
  }
  const contract = { command, pwshPath: executable, pwshSha256: createHash("sha256").update(fs.readFileSync(executable)).digest("hex"), pwshVersion: "7.6.5" };
  const ctx = { sandbox: { confine: async (argv, p, signal) => { calls.push({ argv, policy: p, signal }); return { argv: ["native-confinement-runner", ...argv], policy: p, signal }; } },
    subprocess: { spawn: async (prepared) => { calls.push({ spawned: prepared }); return { stdout: "marker", stderr: "CLM ERROR MUST STAY", exitCode: 1 }; } } };
  const make = (c = contract) => new (api.createReadonlyAsciiPwshExecutor(NativeSandbox, c, prefix))(ctx);
  return { contract, command, policy, calls, NativeSandbox, ctx, make, spec: { command, sandboxPolicy: policy, onExpiry: "kill", signal: new AbortController().signal }, executable };
}
test("ASCII compatibility changes argv only and preserves native sandbox lifecycle and error result", async (t) => {
  const f = fixture(t); const instance = f.make();
  assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(instance)).execute, f.NativeSandbox.prototype.execute);
  assert.equal(instance.constructor.Config, f.NativeSandbox.Config);
  const result = await instance.execute(f.spec);
  assert.deepEqual(f.calls[0].argv, [f.executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", f.command]);
  assert.equal(f.calls[0].policy, f.policy); assert.equal(f.calls[0].signal, f.spec.signal);
  assert.equal(f.calls[1].spawned.argv[0], "native-confinement-runner");
  assert.equal(result.stderr, "CLM ERROR MUST STAY"); assert.equal(result.exitCode, 1);
});
test("confinement failure cannot reach spawn or a weaker executor", async (t) => {
  const f = fixture(t); f.ctx.sandbox.confine = async () => { throw Error("native confinement unavailable"); };
  await assert.rejects(f.make().execute(f.spec), /confinement unavailable/); assert.equal(f.calls.length, 0);
});
test("compatibility refuses other command, shell drift, non-readonly policy and background promotion", async (t) => {
  const f = fixture(t); const instance = f.make();
  for (const change of [{ command: "Get-Content private" }, { onExpiry: "promote" }, { sandboxPolicy: { mode: "danger-full-access" } }])
    assert.throws(() => instance.argv({ ...f.spec, ...change }), /compatibility contract/);
  fs.appendFileSync(f.executable, "drift"); assert.throws(() => instance.argv(f.spec), /compatibility contract/);
  assert.equal(f.calls.length, 0);
});
test("compatibility rejects Windows PowerShell, unbounded/non-ASCII command and native argv ABI drift", (t) => {
  const f = fixture(t);
  for (const change of [{ pwshVersion: "5.1" }, { command: "Write-Output '中文'" }, { pwshSha256: "unknown" }])
    assert.throws(() => f.make({ ...f.contract, ...change }), /compatibility contract/);
  f.NativeSandbox.prototype.argv = () => [f.executable, "-Command", f.command];
  assert.throws(() => f.make().argv(f.spec), /compatibility contract/);
});
