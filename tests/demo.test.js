import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import readline from "node:readline/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { confirmLiveRun, main, parseArgs, selectExecutor, verifiesMarker } from "../scripts/demo.js";

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
      json: false,
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

function captureCli(t) {
  const stdout = [];
  const stderr = [];
  const previousExitCode = process.exitCode;
  t.after(() => { process.exitCode = previousExitCode; });
  process.exitCode = 0;
  t.mock.method(console, "log", (value) => stdout.push(value));
  t.mock.method(console, "error", (value) => stderr.push(value));
  return { stdout, stderr };
}

test("demo JSON success writes one object with no human progress on stdout", async (t) => {
  const { stdout, stderr } = captureCli(t);
  const result = {
    executor: "opencode", model: "mock-model", task_id: "mock-task", status: "completed",
    workspace: "/mock/workspace", file: "/mock/workspace/hello.txt", verified: true,
    usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
  };
  await main(["--json", "--yes"], {
    runLive: async (options) => {
      assert.equal(options.json, true);
      console.error("mock progress");
      return result;
    },
  });
  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]), result);
  assert.deepEqual(stderr, ["mock progress"]);
  assert.equal(process.exitCode, 0);
});

test("demo JSON failures and cancellation remain parseable and exit non-zero", async (t) => {
  const { stdout, stderr } = captureCli(t);
  await main(["--json", "--yes"], {
    runLive: async () => { throw new Error("private-config-secret"); },
  });
  assert.equal(stdout.length, 1);
  const failed = stdout.pop();
  assert.equal(JSON.parse(failed).error.code, "demo_failed");
  assert.doesNotMatch(failed + stderr.join(""), /private-config-secret/);
  assert.equal(process.exitCode, 1);
  await main(["--json"], {
    runLive: async () => ({ status: "cancelled", verified: false, error: { code: "demo_cancelled" } }),
  });
  assert.equal(JSON.parse(stdout[0]).status, "cancelled");
  assert.equal(process.exitCode, 1);
});

test("JSON argument failures are machine-readable even when --json follows the invalid argument", async (t) => {
  const { stdout } = captureCli(t);
  for (const args of [["--private-secret", "--json"], ["--model", "--json", "--yes"]]) {
    await main(args, { runLive: () => assert.fail("Invalid CLI must never dispatch") });
    const result = JSON.parse(stdout.pop());
    assert.equal(result.error.code, "invalid_arguments");
    assert.doesNotMatch(JSON.stringify(result), /private-secret/);
    assert.equal(process.exitCode, 2);
  }
});

test("JSON help and preflight never enter the live demo", async (t) => {
  const { stdout, stderr } = captureCli(t);
  const noLive = () => assert.fail("Help and preflight must never dispatch");
  await main(["--help", "--json"], { runLive: noLive });
  const help = JSON.parse(stdout.pop());
  assert.equal(help.mode, "help");
  assert.match(help.help, /--json/);
  for (const ok of [true, false]) {
    await main(["--check", "--json", "--yes"], {
      runLive: noLive,
      preflight: async () => ({
        ok, selected: ok ? { id: "opencode" } : null,
        checks: [{ name: "mock", ok, detail: "passive" }], executors: [],
      }),
    });
    const result = JSON.parse(stdout.pop());
    assert.equal(result.mode, "check");
    assert.equal(result.status, ok ? "ready" : "blocked");
    assert.equal(result.task_id, null);
    assert.equal(process.exitCode, ok ? 0 : 1);
  }
  assert.deepEqual(stderr, []);
});

test("JSON preflight exceptions produce one safe blocked result", async (t) => {
  const { stdout, stderr } = captureCli(t);
  await main(["--check", "--json"], {
    preflight: async () => { throw new Error("private-config-secret"); },
    runLive: () => assert.fail("Preflight must never dispatch"),
  });
  assert.equal(stdout.length, 1);
  const result = JSON.parse(stdout[0]);
  assert.equal(result.status, "blocked");
  assert.doesNotMatch(stdout[0] + stderr.join(""), /private-config-secret/);
  assert.equal(process.exitCode, 1);
});

test("real JSON help and argument errors write a single JSON document", () => {
  const help = execFileSync(process.execPath, [script, "--help", "--json"], { encoding: "utf8" });
  assert.equal(JSON.parse(help).mode, "help");
  try {
    execFileSync(process.execPath, [script, "--model", "--check", "--yes", "--json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("Invalid arguments must fail");
  } catch (error) {
    assert.equal(error.status, 2);
    assert.equal(JSON.parse(error.stdout).error.code, "invalid_arguments");
    assert.equal(error.stderr, "");
  }
});

test("JSON confirmation uses stderr TTY when stdout is redirected", async (t) => {
  for (const [stream, value] of [[process.stdin, true], [process.stderr, true], [process.stdout, false]]) {
    const previous = Object.getOwnPropertyDescriptor(stream, "isTTY");
    Object.defineProperty(stream, "isTTY", { value, configurable: true });
    t.after(() => {
      if (previous) Object.defineProperty(stream, "isTTY", previous);
      else delete stream.isTTY;
    });
  }
  let closed = false;
  t.mock.method(readline, "createInterface", (options) => {
    assert.equal(options.input, process.stdin);
    assert.equal(options.output, process.stderr);
    return { question: async () => "yes", close: () => { closed = true; } };
  });
  assert.equal(await confirmLiveRun({ id: "mock" }, { json: true, yes: false }), true);
  assert.equal(closed, true);
});
