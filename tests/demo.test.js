import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, selectExecutor, verifiesMarker } from "../scripts/demo.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "..", "scripts", "demo.js");

test("demo parses explicit live-run options", () => {
  assert.deepEqual(
    parseArgs([
      "--executor",
      "opencode",
      "--model",
      "mimo-v2.5-free",
      "--timeout-seconds",
      "120",
      "--yes",
    ]),
    {
      executor: "opencode",
      model: "mimo-v2.5-free",
      yes: true,
      check: false,
      timeoutSeconds: 120,
      help: false,
    },
  );
});

test("demo parses quota-free preflight even with live confirmation", () => {
  const options = parseArgs(["--check", "--yes"]);
  assert.equal(options.check, true);
  assert.equal(options.yes, true);
});

test("demo never consumes a preflight flag as a missing option value", () => {
  for (const args of [
    ["--model", "--check", "--yes"],
    ["--executor", "--check", "--yes"],
    ["--model", "--yes", "--check"],
    ["--timeout-seconds", "--check"],
  ]) {
    assert.throws(() => parseArgs(args), /requires a value/);
  }
});

test("demo auto-selection prefers a ready OpenCode executor", () => {
  const selected = selectExecutor(
    [
      { id: "codex", ready: true, discovery: { available: true } },
      { id: "opencode", ready: true, discovery: { available: true } },
    ],
    "auto",
    "codex",
  );
  assert.equal(selected.id, "opencode");
});

test("demo selection rejects unavailable explicit executors", () => {
  const selected = selectExecutor(
    [{ id: "opencode", ready: false, discovery: { available: true } }],
    "opencode",
  );
  assert.equal(selected, null);
});

test("demo marker verification accepts a terminal newline only", () => {
  assert.equal(verifiesMarker("AgentControlPlane demo OK\r\n"), true);
  assert.equal(verifiesMarker("AgentControlPlane demo OK\nextra"), false);
});

test("demo help is quota-free and exits successfully", () => {
  const output = execFileSync(process.execPath, [script, "--help"], {
    encoding: "utf8",
  });
  assert.match(output, /live demo/);
  assert.match(output, /may consume account, subscription, or API/);
});
