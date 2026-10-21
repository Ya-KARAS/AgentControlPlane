import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import test from "node:test";
import { runDemo } from "../scripts/demo.js";

const MARKER = "AgentControlPlane demo OK";
const SECRET = "demo-json-secret-sentinel";
const RESULT_FIELDS = [
  "executor", "model", "task_id", "status", "workspace", "file", "verified", "usage",
];

function fixture(t, settings = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-demo-json-test-"));
  t.after(() => {
    const absolute = path.resolve(workspace);
    const relative = path.relative(path.resolve(os.tmpdir()), absolute);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    assert.match(path.basename(absolute), /^acp-demo-json-test-/);
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  if (settings.marker !== null) {
    fs.writeFileSync(path.join(workspace, "hello.txt"), settings.marker ?? `${MARKER}\n`);
  }

  const calls = {
    runtime: 0, configuration: 0, discovery: 0, confirm: 0, application: 0,
    listen: 0, connect: 0, workspace: 0, dispatch: 0, wait: 0,
    clientClose: 0, appClose: 0, logs: [], requests: [], stateDirs: [],
  };
  const fail = (stage) => {
    if (settings.failAt === stage) throw new Error(`${stage}: ${SECRET}`);
  };
  const candidate = { displayName: "Mock executor", model: "candidate-model" };
  const config = {
    version: "0.9.0",
    server: { host: "127.0.0.1", port: 4318, authToken: SECRET },
    limits: { rateLimit: { enabled: true } },
    executor: { provider: "auto" },
    workspaceRoots: [workspace],
  };
  const task = settings.task ?? {
    id: "task-json-1",
    status: "completed",
    policy: { model: "actual-model" },
    usage: {
      input_tokens: 12,
      output_tokens: 8,
      reasoning_output_tokens: 3,
      cached_input_tokens: 2,
      total_tokens: 20,
      private_detail: SECRET,
    },
  };
  const app = {
    server: Object.assign(new EventEmitter(), {
      listen(port, host, callback) {
        calls.listen += 1;
        assert.equal(port, 0);
        assert.equal(host, "127.0.0.1");
        if (settings.failAt === "listen") {
          queueMicrotask(() => this.emit("error", new Error(SECRET)));
          return;
        }
        callback();
      },
      address: () => ({ port: 43189 }),
    }),
    async close() {
      calls.appClose += 1;
      fail("appClose");
    },
  };
  class Client {
    async connect(transport) {
      calls.connect += 1;
      assert.equal(transport.url.href, "http://127.0.0.1:43189/mcp");
      fail("connect");
    }
    async callTool(request) {
      calls.dispatch += 1;
      calls.requests.push(request);
      fail("dispatch");
      return settings.dispatch ?? { structuredContent: { task: { id: "task-json-1" } } };
    }
    async close() {
      calls.clientClose += 1;
      fail("clientClose");
    }
  }
  class StreamableHTTPClientTransport {
    constructor(url) { this.url = url; }
  }
  const overrides = {
    async loadRuntime() {
      calls.runtime += 1;
      fail("runtime");
      return {
        Client,
        StreamableHTTPClientTransport,
        async createApplication(options) {
          calls.application += 1;
          assert.equal(options.defaultProvider, "opencode");
          assert.equal(options.executors.get("opencode"), candidate);
          fail("application");
          return app;
        },
      };
    },
    loadConfiguration() {
      calls.configuration += 1;
      calls.stateDirs.push(process.env.AGENT_CONTROL_STATE_DIR);
      fail("configuration");
      return config;
    },
    async discoverCandidates(loadedConfig, requested) {
      calls.discovery += 1;
      assert.equal(loadedConfig, config);
      assert.equal(requested, "opencode");
      fail("discovery");
      return {
        candidates: new Map([["opencode", candidate]]),
        discovery: {
          opencode: settings.unavailable
            ? { available: false, status: "unavailable", reason: "mock_unavailable" }
            : { available: true, status: "available" },
        },
      };
    },
    async confirm(executor, options) {
      calls.confirm += 1;
      assert.equal(executor.id, "opencode");
      assert.equal(options.json, true);
      fail("confirm");
      return settings.confirmed !== false;
    },
    createWorkspace(loadedConfig) {
      calls.workspace += 1;
      assert.equal(loadedConfig, config);
      fail("workspace");
      return workspace;
    },
    async waitForTask(baseUrl, taskId, timeoutSeconds) {
      calls.wait += 1;
      assert.equal(baseUrl, "http://127.0.0.1:43189");
      assert.equal(taskId, "task-json-1");
      assert.equal(timeoutSeconds, 30);
      fail("wait");
      return task;
    },
    log(message) { calls.logs.push(String(message)); },
  };
  const options = {
    executor: "opencode", model: "requested-model", yes: true, json: true,
    check: false, timeoutSeconds: 30, help: false, ...settings.options,
  };
  return { workspace, calls, overrides, options };
}

function assertSafeFailure(result, logs) {
  for (const field of RESULT_FIELDS) assert.ok(Object.hasOwn(result, field), field);
  assert.equal(result.verified, false);
  assert.equal(typeof result.error?.code, "string");
  assert.ok(result.error.code);
  assert.equal(typeof result.error?.message, "string");
  assert.ok(result.error.message);
  assert.doesNotMatch(JSON.stringify({ result, logs }), new RegExp(SECRET));
}

test("JSON demo executes a mocked lifecycle and returns one safe result", async (t) => {
  const f = fixture(t);
  const stdout = [];
  t.mock.method(console, "log", (...args) => stdout.push(args));
  const result = await runDemo(f.options, f.overrides);

  assert.deepEqual(Object.keys(result).sort(), [...RESULT_FIELDS].sort());
  assert.equal(result.executor, "opencode");
  assert.equal(result.model, "actual-model");
  assert.equal(result.task_id, "task-json-1");
  assert.equal(result.status, "completed");
  assert.equal(result.workspace, f.workspace);
  assert.equal(result.file, path.join(f.workspace, "hello.txt"));
  assert.equal(result.verified, true);
  assert.equal(result.usage.input_tokens, 12);
  assert.equal(result.usage.total_tokens, 20);
  assert.equal(Object.hasOwn(result.usage, "private_detail"), false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  assert.deepEqual(stdout, []);
  assert.equal(f.calls.requests.length, 1);
  const request = f.calls.requests[0];
  assert.equal(request.name, "dispatch_project");
  assert.equal(request.arguments.executor, "opencode");
  assert.equal(request.arguments.model, "requested-model");
  assert.equal(request.arguments.workspace, f.workspace);
  assert.equal(request.arguments.max_subagents, 0);
  assert.ok(request.arguments.constraints.includes("Do not use the network."));
  assert.equal(f.calls.clientClose, 1);
  assert.equal(f.calls.appClose, 1);
});

test("JSON demo falls back to the requested or candidate model and null usage", async (t) => {
  const task = { status: "completed" };
  const requested = fixture(t, { task });
  const requestedResult = await runDemo(requested.options, requested.overrides);
  assert.equal(requestedResult.model, "requested-model");
  assert.equal(requestedResult.usage, null);
  const candidate = fixture(t, { task, options: { model: null } });
  const candidateResult = await runDemo(candidate.options, candidate.overrides);
  assert.equal(candidateResult.model, "candidate-model");
  assert.equal(candidateResult.usage, null);
});

test("JSON demo excludes invalid usage values and unknown usage properties", async (t) => {
  const f = fixture(t, {
    task: {
      status: "completed",
      usage: {
        input_tokens: -1,
        output_tokens: Infinity,
        total_tokens: NaN,
        cached_input_tokens: "3",
        reasoning_output_tokens: 0,
        authorization: SECRET,
      },
    },
  });
  const result = await runDemo(f.options, f.overrides);
  assert.equal(result.verified, true);
  assert.deepEqual(result.usage, { reasoning_output_tokens: 0 });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
});

test("JSON demo cancellation returns before creating an app or dispatching", async (t) => {
  const f = fixture(t, { confirmed: false });
  const result = await runDemo(f.options, f.overrides);
  assertSafeFailure(result, f.calls.logs);
  assert.equal(result.status, "cancelled");
  assert.equal(result.task_id, null);
  assert.equal(result.workspace, null);
  assert.equal(result.file, null);
  assert.equal(f.calls.application, 0);
  assert.equal(f.calls.workspace, 0);
  assert.equal(f.calls.dispatch, 0);
  assert.equal(f.calls.wait, 0);
});

test("JSON demo reports an unavailable executor without starting an app", async (t) => {
  const f = fixture(t, { unavailable: true });
  const result = await runDemo(f.options, f.overrides);
  assertSafeFailure(result, f.calls.logs);
  assert.equal(result.status, "failed");
  assert.equal(f.calls.application, 0);
  assert.equal(f.calls.dispatch, 0);
});

test("JSON demo catches local service listen errors and still closes the app", async (t) => {
  const f = fixture(t, { failAt: "listen" });
  const result = await runDemo(f.options, f.overrides);
  assertSafeFailure(result, f.calls.logs);
  assert.equal(result.error.code, "application_failed");
  assert.equal(f.calls.appClose, 1);
  assert.equal(f.calls.connect, 0);
  assert.equal(f.calls.dispatch, 0);
});

for (const stage of [
  "runtime", "configuration", "discovery", "confirm", "application",
  "connect", "workspace", "dispatch", "wait",
]) {
  test(`JSON demo safely reports a mocked ${stage} exception`, async (t) => {
    const f = fixture(t, { failAt: stage });
    const result = await runDemo(f.options, f.overrides);
    assertSafeFailure(result, f.calls.logs);
    assert.equal(result.status, "failed");
    if (f.calls.connect) assert.equal(f.calls.clientClose, 1);
    if (f.calls.listen) assert.equal(f.calls.appClose, 1);
    if (stage !== "wait") assert.equal(f.calls.wait, 0);
  });
}

for (const dispatched of [
  { isError: true, content: [{ type: "text", text: SECRET }] },
  { structuredContent: { task: {} }, content: [{ type: "text", text: SECRET }] },
]) {
  test("JSON demo rejects an unsuccessful dispatch without leaking its payload", async (t) => {
    const f = fixture(t, { dispatch: dispatched });
    const result = await runDemo(f.options, f.overrides);
    assertSafeFailure(result, f.calls.logs);
    assert.equal(result.status, "failed");
    assert.equal(f.calls.wait, 0);
    assert.equal(f.calls.clientClose, 1);
    assert.equal(f.calls.appClose, 1);
  });
}

for (const marker of [null, `${MARKER}\nextra`]) {
  test("JSON demo fails verification when the marker is missing or incorrect", async (t) => {
    const f = fixture(t, { marker });
    const result = await runDemo(f.options, f.overrides);
    assertSafeFailure(result, f.calls.logs);
    assert.equal(result.status, "failed");
    assert.equal(result.task_id, "task-json-1");
    assert.equal(result.file, path.join(f.workspace, "hello.txt"));
    assert.equal(f.calls.clientClose, 1);
    assert.equal(f.calls.appClose, 1);
  });
}

test("JSON demo safely fails when the completed task marker cannot be read", async (t) => {
  const f = fixture(t, { marker: null });
  fs.mkdirSync(path.join(f.workspace, "hello.txt"));
  const result = await runDemo(f.options, f.overrides);
  assertSafeFailure(result, f.calls.logs);
  assert.equal(result.status, "failed");
  assert.equal(f.calls.clientClose, 1);
  assert.equal(f.calls.appClose, 1);
});

for (const status of ["failed", "partial", "blocked", "cancelled", "interrupted"]) {
  test(`JSON demo preserves an unsuccessful ${status} terminal state`, async (t) => {
    const f = fixture(t, {
      task: { status, error: { message: SECRET }, result: { summary: SECRET } },
    });
    const result = await runDemo(f.options, f.overrides);
    assertSafeFailure(result, f.calls.logs);
    assert.equal(result.status, status);
    assert.equal(f.calls.clientClose, 1);
    assert.equal(f.calls.appClose, 1);
  });
}

test("JSON demo restores the state environment and leaves exit codes to main", async (t) => {
  const previousState = process.env.AGENT_CONTROL_STATE_DIR;
  const previousExit = process.exitCode;
  t.after(() => {
    if (previousState === undefined) delete process.env.AGENT_CONTROL_STATE_DIR;
    else process.env.AGENT_CONTROL_STATE_DIR = previousState;
    process.exitCode = previousExit;
  });
  process.env.AGENT_CONTROL_STATE_DIR = "prior-demo-state";
  process.exitCode = 23;
  const f = fixture(t, { failAt: "wait" });
  await runDemo(f.options, f.overrides);
  assert.equal(process.env.AGENT_CONTROL_STATE_DIR, "prior-demo-state");
  assert.equal(process.exitCode, 23);
  for (const stateDir of f.calls.stateDirs) {
    assert.notEqual(stateDir, "prior-demo-state");
    assert.equal(fs.existsSync(stateDir), false);
  }
});

test("JSON demo restores an absent state environment after success", async (t) => {
  const previousState = process.env.AGENT_CONTROL_STATE_DIR;
  t.after(() => {
    if (previousState === undefined) delete process.env.AGENT_CONTROL_STATE_DIR;
    else process.env.AGENT_CONTROL_STATE_DIR = previousState;
  });
  delete process.env.AGENT_CONTROL_STATE_DIR;
  const f = fixture(t);
  await runDemo(f.options, f.overrides);
  assert.equal(Object.hasOwn(process.env, "AGENT_CONTROL_STATE_DIR"), false);
});

for (const stage of ["clientClose", "appClose"]) {
  test(`JSON demo reports a ${stage} cleanup failure after closing both resources`, async (t) => {
    const f = fixture(t, { failAt: stage });
    const result = await runDemo(f.options, f.overrides);
    assertSafeFailure(result, f.calls.logs);
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "cleanup_failed");
    assert.equal(f.calls.clientClose, 1);
    assert.equal(f.calls.appClose, 1);
  });
}
