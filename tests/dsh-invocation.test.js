import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as api from "../src/executors/dsh-invocation.js";
import { profileFixture, digest } from "./fixtures/dsh/profile-fixture.mjs";
const fixture = fs.readFileSync(new URL("./fixtures/dsh/completed.ndjson", import.meta.url), "utf8");
function parser(options) {
  assert.equal(typeof api.DshJsonStream, "function", "DSH bounded stream parser must exist");
  return new api.DshJsonStream(options);
}
function stream(text = fixture, code = 0) {
  const p = parser();
  const bytes = Buffer.from(text);
  for (let i = 0; i < bytes.length; i += 7) p.push(bytes.subarray(i, i + 7));
  return p.finish(code);
}

test("DSH chunked protocol yields final report and known counts without persisting private frames", () => {
  const result = stream(fixture.replace("fixture only", "fixture 中文"));
  assert.equal(result.status, "completed");
  assert.equal(result.sessionId, "session-fixture-001");
  assert.match(result.finalText, /fixture 中文/);
  assert.equal(result.usageEvidence.state, "complete");
  assert.equal(result.usageEvidence.usage.total_tokens, 14);
  assert.equal(result.usageEvidence.usage.cached_input_tokens, null);
  assert.equal(result.usageEvidence.usage.reasoning_output_tokens, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FIXTURE/);
});

test("DSH missing or partial usage remains unknown rather than measured zero", () => {
  const missing = fixture.replace(/,"usage":\{[^\n]+\}(?=\})/, "");
  const result = stream(missing);
  assert.equal(result.status, "completed");
  assert.equal(result.usageEvidence.state, "unknown");
  assert.equal(result.usageEvidence.usage, null);
  const twoSteps = fixture.replace('{"type":"status","phase":"turn_end"',
    '{"type":"status","phase":"step_start","turn":1,"step":2}\n{"type":"status","phase":"step_end","turn":1,"step":2}\n{"type":"status","phase":"turn_end"');
  const partial = stream(twoSteps);
  assert.equal(partial.usageEvidence.state, "partial");
  assert.equal(partial.usageEvidence.knownUsage.total_tokens, 14);
  assert.equal(partial.usageEvidence.usage, null);
});

test("DSH requires native terminal, final and exit zero together", () => {
  assert.equal(stream(fixture, 1).status, "failed");
  assert.equal(stream(fixture, 1).safeToReroute, false);
  for (const text of [fixture.split('\n').slice(0, -2).join('\n') + '\n',
    fixture.replace('"kind":"completed"', '"kind":"error"')]) {
    assert.notEqual(stream(text).status, "completed");
  }
  assert.throws(() => stream(fixture.replace(/^\{"type":"session".*\n/, "")), { code: "dsh_protocol_error" });
  assert.equal(stream('{"type":"error","message":"SECRET_NATIVE_ERROR"}\n', 1).error.code, "dsh_native_error");
  assert.doesNotMatch(JSON.stringify(stream('{"type":"error","message":"SECRET_NATIVE_ERROR"}\n', 1)), /SECRET_NATIVE_ERROR/);
});

test("DSH rejects malformed, duplicate terminal/step and oversized streams", () => {
  for (const text of ["not json\n", fixture + '{"type":"final","text":"duplicate"}\n',
    fixture.replace('"phase":"turn_end"', '"phase":"step_end","step":1')]) {
    assert.throws(() => stream(text), { code: "dsh_protocol_error" });
  }
  assert.throws(() => parser({ maxLineBytes: 32 }).push(Buffer.from('x'.repeat(33))), { code: "dsh_output_limit" });
  assert.throws(() => parser({ maxOutputBytes: 32 }).push(Buffer.from('x'.repeat(33))), { code: "dsh_output_limit" });
  assert.throws(() => parser({ maxFinalBytes: 3 }).push(Buffer.from(fixture)), { code: "dsh_output_limit" });
});

test("DSH usage rejects negative/fractional or inconsistent counters without inventing totals", () => {
  for (const usage of [{ inputTokens: -1, outputTokens: 4 }, { inputTokens: 2.5, outputTokens: 4 },
    { inputTokens: 10, outputTokens: 4, totalTokens: 99 }]) {
    const text = fixture.replace('"usage":{"inputTokens":10,"outputTokens":4,"totalTokens":14}', `"usage":${JSON.stringify(usage)}`);
    assert.equal(stream(text).usageEvidence.state, "unknown");
  }
});

test("DSH cannot accept an out-of-order final, mismatched status or incomplete step as success", () => {
  const lines = fixture.trim().split('\n');
  const invalid = [
    [lines[0], lines.at(-1), ...lines.slice(1, -1)].join('\n') + '\n',
    fixture.replace('"phase":"turn_end","turn":1', '"phase":"turn_end","turn":2'),
    fixture.replace(/^.*"phase":"step_end".*\n/m, ""),
    fixture.replace(/^.*"phase":"turn_start".*\n/m, ""),
  ];
  for (const text of invalid) assert.throws(() => stream(text), { code: "dsh_protocol_error" });
});

test("DSH installation rejects an invalid archive and an unsupported launcher before execution", (t) => {
  assert.equal(typeof api.inspectDshInstallation, "function", "DSH installation inspector must exist");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-dsh-install-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shim = path.join(root, "resources", "runtime", "cli", "bin", "dsh.cmd");
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  fs.writeFileSync(shim, '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*\r\nexit /b %errorlevel%\r\n');
  fs.writeFileSync(path.join(root, "DeepSeek Harness.exe"), "fixture, never executed");
  fs.writeFileSync(path.join(root, "resources", "app.asar"), "fixture, never imported");
  assert.throws(() => api.inspectDshInstallation(root), { code: "dsh_installation_unsupported" });
  fs.appendFileSync(shim, "REM unexpected changed launcher\n");
  assert.throws(() => api.inspectDshInstallation(root), { code: "dsh_launcher_unsupported" });
});

test("DSH requires actual immutable profile evidence rather than an operator string", (t) => {
  assert.equal(typeof api.verifyDshProfile, "function", "native profile verifier must exist");
  const f = profileFixture(t);
  const result = api.verifyDshProfile(f.contract, { runtime: f.runtime, workspaceRoots: [f.contract.runRoot] });
  assert.equal(result.model, "fixture-model");
  assert.equal(result.networkIsolation, "not-enforced");
  assert.equal(result.expectedTool.command, f.expectedTool.command);
  assert.throws(() => api.verifyDshProfile({ reviewReference: "just say ready" }, { runtime: f.runtime }),
    { code: "dsh_client_contract_required" });
  fs.appendFileSync(f.contract.patchPath, "\n");
  assert.throws(() => api.verifyDshProfile(f.contract, { runtime: f.runtime, workspaceRoots: [f.contract.runRoot] }),
    { code: "dsh_profile_drift" });
});

for (const which of ["model", "workspace-write", "background", "guard", "profile-layer", "dotenv", "missing-proof"]) {
  test(`DSH rejects ${which} profile drift before any spawn`, (t) => {
    assert.equal(typeof api.verifyDshProfile, "function");
    const f = profileFixture(t);
    if (which === "model") f.contract.model = "unreviewed";
    if (which === "workspace-write") f.patch.find((p) => p.id === "sandbox-policy").config.mode = "workspace-write";
    if (which === "background") f.patch.find((p) => p.id === "tool-pwsh").config.promoteOnTimeout = true;
    if (["workspace-write", "background"].includes(which)) { fs.writeFileSync(f.contract.patchPath, JSON.stringify(f.patch)); f.refresh(); }
    if (which === "guard") fs.appendFileSync(f.contract.guardPath, "// changed");
    if (which === "profile-layer") fs.appendFileSync(path.join(f.contract.clientHome, "profiles", "headless", "profile.yml"), "changed: true\n");
    if (which === "dotenv") fs.writeFileSync(path.join(f.contract.workspace, ".env"), "SYNTHETIC=not-read");
    if (which === "missing-proof") fs.unlinkSync(f.contract.proofPath);
    assert.throws(() => api.verifyDshProfile(f.contract, { runtime: f.runtime, workspaceRoots: [f.contract.runRoot] }));
  });
}

test("DSH verified invocation passes only explicit home/patch and whole-Job ownership", (t) => {
  const f = profileFixture(t);
  const result = api.buildDshInvocation({ clientContract: f.contract, workspaceRoots: [f.contract.runRoot],
    environment: { PATH: "safe", DEEPSEEK_API_KEY: "SECRET", DSH_HOME: "AMBIENT", DSH_AGENTS_HOME: "AMBIENT" } },
    { inspectInstallation: () => f.runtime });
  assert.ok(result.args.includes(f.contract.patchPath));
  assert.equal(result.options.env.DSH_HOME, f.contract.clientHome);
  assert.equal(result.options.env.DSH_AGENTS_HOME, f.contract.agentsHome);
  assert.equal(result.options.env.DEEPSEEK_API_KEY, undefined);
  assert.ok(result.owner.args.includes(f.runtime.jobEntry));
  assert.ok(result.owner.args.includes("--"));
  assert.equal(result.owner.env.DSH_SUBPROCESS_RUNNER, "windows");
  assert.equal(result.profileProofHash, f.contract.proofSha256);
});

test("native tool evidence cannot be replaced by a final model claim", () => {
  const expectedTool = { name: "pwsh", command: "Write-Output 'ACP_TEST_MARKER'", marker: "ACP_TEST_MARKER", maxTimeoutMs: 5000 };
  const absent = parser({ expectedTool }); absent.push(Buffer.from(fixture));
  assert.notEqual(absent.finish(0).status, "completed");
  const text = fixture.replace('"tool":"shell","input":{"secret":"PRIVATE_FIXTURE_INPUT"}',
    `"tool":"pwsh","input":${JSON.stringify({ command: expectedTool.command, timeoutMs: 5000 })}`)
    .replace('"result":"PRIVATE_FIXTURE_OUTPUT"', '"result":"ACP_TEST_MARKER\\n"');
  const proved = parser({ expectedTool }); proved.push(Buffer.from(text));
  const result = proved.finish(0);
  assert.equal(result.status, "completed");
  assert.equal(result.toolEvidence.verified, true);
  assert.equal(result.toolEvidence.commandSha256, digest(expectedTool.command));
  assert.doesNotMatch(JSON.stringify(result.toolEvidence), /Write-Output|PRIVATE_FIXTURE/);
  const failed = parser({ expectedTool });
  failed.push(Buffer.from(text.replace('ACP_TEST_MARKER\\n', 'ACP_TEST_MARKER\\n[exit code: 1]')));
  assert.equal(failed.finish(0).status, "failed");
});

for (const kind of ["unbounded-output", "changed-endpoint", "changed-platform", "raw-secret", "embedded-expression", "extra-plugin"]) {
  test(`DSH rejects ${kind} even if local hashes were refreshed`, (t) => {
    const f = profileFixture(t);
    const provider = f.patch.find((r) => r.id === "llm-deepseek-account").config;
    if (kind === "unbounded-output") { provider.maxTokens = 1000000; provider.modelOverrides['fixture-model'].maxTokens = 1000000; }
    if (kind === "changed-endpoint") provider.baseURL = "https://unreviewed.invalid/anthropic";
    if (kind === "changed-platform") f.patch.find((r) => r.id === "deepseek-account").config.platformOrigin = "https://unreviewed.invalid";
    if (kind === "raw-secret") provider.apiKey = "SYNTHETIC-NOT-A-KEY";
    if (kind === "embedded-expression") f.patch.push({ id: "not-reviewed", config: { value: { __jsExpr: "SYNTHETIC-EXPRESSION" } } });
    if (kind === "extra-plugin") f.patch.push({ id: "not-reviewed", name: "unreviewed-plugin", config: {} });
    fs.writeFileSync(f.contract.patchPath, JSON.stringify(f.patch)); f.refresh();
    assert.throws(() => api.verifyDshProfile(f.contract, { runtime: f.runtime, workspaceRoots: [f.contract.runRoot] }));
  });
}

test("an interrupted native run preserves a known usage lower bound", () => {
  const p = parser();
  p.push(Buffer.from(fixture.split('\n').filter((l) => !l.includes('turn_end') && !l.includes('"type":"final"')).join('\n')+'\n'));
  assert.equal(typeof p.usageEvidence, "function");
  assert.equal(p.usageEvidence().state, "partial");
  assert.equal(p.usageEvidence().usage, null);
  assert.equal(p.usageEvidence().knownUsage.total_tokens, 14);
});

test("a proof without successful native schema validation is rejected", (t) => {
  const f = profileFixture(t);
  const proof = { ...f.proof, nativeValidation: { jsonSchema: false } };
  fs.writeFileSync(f.contract.proofPath, JSON.stringify(proof));
  f.contract.proofSha256 = digest(fs.readFileSync(f.contract.proofPath));
  assert.throws(() => api.verifyDshProfile(f.contract, { runtime: f.runtime, workspaceRoots: [f.contract.runRoot] }));
});

test("ASCII profile compatibility binds the sandbox module, native CLI, exact command and pwsh bytes", (t) => {
  const f = profileFixture(t);
  const modulePath = path.join(f.contract.runRoot, "compat.mjs");
  fs.copyFileSync(new URL("../src/executors/dsh-pwsh-compat.js", import.meta.url), modulePath);
  const pwshPath = path.join(f.contract.runRoot, "pwsh.exe"); fs.writeFileSync(pwshPath, "synthetic shell bytes");
  const compatibility = { modulePath, moduleSha256: digest(fs.readFileSync(modulePath)),
    pwshPath, pwshSha256: digest(fs.readFileSync(pwshPath)), pwshVersion: "7.6.5", command: f.expectedTool.command,
    cliEntry: f.runtime.cliEntry };
  f.contract.compatibility = compatibility;
  f.patch.push({ id: "pwsh-sandbox", disabled: true });
  f.patch.push({ insert: [{ id: "acp-pwsh-compat", name: modulePath, disabled: false, config: {
    cliEntry: compatibility.cliEntry, pwshPath, pwshSha256: compatibility.pwshSha256,
    pwshVersion: compatibility.pwshVersion, command: compatibility.command } }] });
  fs.writeFileSync(f.contract.patchPath, JSON.stringify(f.patch)); f.refresh();
  const proof = { ...f.proof, compatibility };
  fs.writeFileSync(f.contract.proofPath, JSON.stringify(proof));
  f.contract.proofSha256 = digest(fs.readFileSync(f.contract.proofPath));
  const options = { runtime: f.runtime, workspaceRoots: [f.contract.runRoot] };
  assert.equal(api.verifyDshProfile(f.contract, options).compatibility.pwshSha256, compatibility.pwshSha256);
  fs.appendFileSync(pwshPath, "changed");
  assert.throws(() => api.verifyDshProfile(f.contract, options), { code: "dsh_profile_drift" });
  fs.writeFileSync(pwshPath, "synthetic shell bytes"); fs.appendFileSync(modulePath, "//changed");
  assert.throws(() => api.verifyDshProfile(f.contract, options), { code: "dsh_profile_drift" });
});
