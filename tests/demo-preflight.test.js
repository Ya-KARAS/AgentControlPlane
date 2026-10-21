import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkDemoPreflight, discoverPreflightExecutors } from "../scripts/demo-preflight.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { executor: "auto" };
const config = { executor: { provider: "auto" } };
const forbidden = () => { throw new Error("Active operation must not run in preflight"); };
const cli = (id) => ({ id, command: id, probe: forbidden, start: forbidden, listModels: forbidden });

function dependencies(candidates) {
  return {
    nodeVersion: "22.0.0",
    loadConfiguration: () => config,
    resolveDependency: () => "installed",
    buildCandidates: () => candidates,
    discover: (entries) => discoverPreflightExecutors(entries, {
      resolveCommand: (command) => command === "opencode" ? "/installed/opencode" : null,
      resolveZCode: () => null,
    }),
  };
}

test("preflight selects an installed executor without active probes or filesystem writes", async (t) => {
  t.mock.method(globalThis, "fetch", forbidden);
  for (const method of ["mkdirSync", "mkdtempSync", "writeFileSync", "rmSync"]) {
    t.mock.method(fs, method, forbidden);
  }
  const result = await checkDemoPreflight(options, dependencies(new Map([
    ["codex", cli("codex")], ["opencode", cli("opencode")],
  ])));
  assert.equal(result.ok, true);
  assert.equal(result.selected.id, "opencode");
  assert.equal(result.selected.discovery.status, "installed");
  assert.deepEqual(result.checks.map((entry) => entry.name), [
    "Node.js", "Configuration", "@modelcontextprotocol/sdk", "zod", "Executor discovery",
  ]);
});

test("preflight reports missing executors and does not silently replace an explicit selection", async () => {
  const candidates = new Map([["opencode", cli("opencode")]]);
  const selected = await checkDemoPreflight({ executor: "opencode" }, dependencies(candidates));
  assert.deepEqual(selected.executors.map((entry) => entry.id), ["opencode"]);
  for (const executor of ["codex", "unknown"]) {
    const result = await checkDemoPreflight({ executor }, dependencies(candidates));
    assert.equal(result.ok, false);
    assert.equal(result.selected, null);
    assert.match(result.checks.at(-1).detail, /Install or configure/);
  }
  const result = await checkDemoPreflight(options, dependencies(new Map()));
  assert.equal(result.ok, false);
});

test("preflight rejects an unsupported Node runtime before constructing executors", async () => {
  const result = await checkDemoPreflight(options, {
    ...dependencies(new Map()), nodeVersion: "20.19.0", buildCandidates: forbidden,
  });
  assert.equal(result.ok, false);
  assert.match(result.checks[0].detail, /22 or newer/);
});

test("preflight diagnoses configuration and dependency failures without exposing config contents", async () => {
  const secret = "test-secret-do-not-print";
  const invalidConfig = await checkDemoPreflight(options, {
    ...dependencies(new Map()),
    loadConfiguration: () => { throw new SyntaxError(`Invalid JSON near ${secret}`); },
    buildCandidates: forbidden,
  });
  assert.equal(invalidConfig.ok, false);
  assert.doesNotMatch(JSON.stringify(invalidConfig), new RegExp(secret));
  const missingDependency = await checkDemoPreflight(options, {
    ...dependencies(new Map()),
    resolveDependency: () => { throw new Error("module missing"); },
    buildCandidates: forbidden,
  });
  assert.equal(missingDependency.ok, false);
  assert.equal(missingDependency.checks.filter((entry) => !entry.ok).length, 2);
  assert.match(missingDependency.checks.at(-1).detail, /npm ci/);
});

test("passive endpoint discovery checks configuration without network or leaking keys", (t) => {
  t.mock.method(globalThis, "fetch", forbidden);
  const endpoint = (baseUrl, apiKey = null) => ({
    kind: "model-endpoint", baseUrl, apiKey, protocol: "auto", probe: forbidden,
  });
  const entries = discoverPreflightExecutors(new Map([
    ["configured", endpoint("https://provider.example/v1", "secret-key")],
    ["missing-key", endpoint("https://provider.example/v1")],
    ["local", endpoint("http://[::1]:1234/v1")],
    ["invalid", endpoint("not-a-url")],
    ["invalid-scheme", endpoint("file:///private")],
    ["zcode", cli("zcode")],
  ]), { resolveZCode: () => ({ command: "node", scriptPath: "/installed/zcode.cjs" }) });
  assert.deepEqual(entries.map((entry) => entry.ready), [true, false, true, false, false, true]);
  assert.equal(entries[0].discovery.status, "configured");
  assert.equal(entries.at(-1).discovery.status, "installed");
  assert.doesNotMatch(JSON.stringify(entries), /secret-key|provider\.example|\/private/);
});

test("demo --check --yes stays passive and returns documented CLI exit codes", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-preflight-test-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const fixture = path.join(temp, "config.json");
  const executable = path.join(temp, "passive-executor.exe");
  fs.writeFileSync(executable, "Preflight must inspect this file without executing it.");
  fs.writeFileSync(fixture, JSON.stringify({
    codex: { command: "acp-missing-preflight-executor" },
    executor: {
      provider: "auto", opencode: { command: executable },
      relays: [{ id: "unrelated", preset: "invalid-preset" }],
    },
    workspaceRoots: [path.join(temp, "workspace")],
  }));
  const state = path.join(temp, "state");
  const env = { ...process.env, AGENT_CONTROL_CONFIG: fixture, AGENT_CONTROL_STATE_DIR: state };
  const run = (args) => spawnSync(process.execPath, [path.join(root, "scripts", "demo.js"), ...args], {
    encoding: "utf8", env,
  });
  const success = run(["--check", "--yes", "--executor", "opencode"]);
  assert.equal(success.status, 0, success.stdout + success.stderr);
  assert.match(success.stdout, /opencode: installed/);
  assert.match(success.stdout, /authentication.*not checked/i);
  assert.equal(fs.existsSync(state), false);
  assert.equal(fs.existsSync(path.join(temp, "workspace")), false);
  assert.doesNotMatch(success.stdout, /task:|DEMO PASS|status: running/);
  const unavailable = run(["--check", "--executor", "unknown"]);
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /Install or configure/);
  const invalid = run(["--check", "--unknown"]);
  assert.equal(invalid.status, 2);
  for (const flag of ["--model", "--executor"]) {
    const missingValue = run([flag, "--check", "--yes"]);
    assert.equal(missingValue.status, 2);
    assert.match(missingValue.stderr, /requires a value/);
  }
});

test("demo preflight diagnoses a clone without installed dependencies", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-preflight-no-deps-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const file of [
    "scripts/demo.js", "scripts/demo-preflight.js", "config/default.json",
    "src/core/config.js", "src/core/errors.js", "src/core/reroute.js",
    "src/core/execution-report.js", "src/executors/discovery.js",
    "src/executors/zcode-executor.js", "src/executors/executor.js",
  ]) {
    const target = path.join(temp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  fs.writeFileSync(path.join(temp, "package.json"), JSON.stringify({ type: "module" }));
  const fixture = path.join(temp, "fixture.json");
  fs.writeFileSync(fixture, JSON.stringify({
    codex: { command: "acp-missing-preflight-executor" },
    workspaceRoots: [path.join(temp, "workspace")],
  }));
  const state = path.join(temp, "state");
  const result = spawnSync(process.execPath, [path.join(temp, "scripts", "demo.js"), "--check"], {
    encoding: "utf8",
    env: { ...process.env, AGENT_CONTROL_CONFIG: fixture, AGENT_CONTROL_STATE_DIR: state },
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /@modelcontextprotocol\/sdk: Dependency is missing/);
  assert.match(result.stderr, /zod: Dependency is missing/);
  assert.match(result.stderr, /npm ci/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.equal(fs.existsSync(state), false);
});
