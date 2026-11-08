import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/server.js";
import { TaskStore } from "../src/core/store.js";

class StubCodex extends EventEmitter {
  constructor() {
    super();
    this.ready = true;
  }

  stop() {}
}

class StubOrchestrator {
  getRuntimeHealth() {
    return { windowsSandbox: "ready" };
  }

  getModels() {
    return [];
  }

  getDefaultExecutorId() {
    return "codex";
  }

  getExecutors() {
    return [];
  }
}

function testConfig() {
  return {
    server: {
      host: "127.0.0.1",
      port: 0,
      authToken: null,
      allowedOrigins: [],
      maxMcpSessions: 32,
      mcpSessionIdleMinutes: 30,
    },
    stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "acp-mcp-state-")),
    limits: { maxStoredEventsPerTask: 20 },
    profiles: {},
    codex: { networkAccess: false },
  };
}

test("server/discover is served statelessly without an MCP session", async () => {
  const config = testConfig();
  const store = new TaskStore(config.stateDir, 20);
  const app = await createApplication({
    config,
    store,
    codex: new StubCodex(),
    orchestrator: new StubOrchestrator(),
    startCodex: false,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "server/discover",
        params: {},
        id: 7,
      }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);

    const body = await response.json();
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, 7);
    assert.equal(body.result.serverInfo.name, "agent-control-plane");
    assert.equal(
      body.result.serverInfo.version,
      JSON.parse(
        fs.readFileSync(
          new URL("../package.json", import.meta.url),
          "utf8",
        ),
      ).version,
    );
    assert.equal(typeof body.result.protocolVersion, "string");
    assert.ok(body.result.capabilities?.tools);
    assert.ok(Array.isArray(body.result.tools));

    const names = body.result.tools.map((tool) => tool.name);
    for (const expected of [
      "dispatch_project",
      "dispatch_opencode",
      "task_status",
      "continue_project",
      "handoff_project",
      "cancel_task",
      "list_tasks",
      "list_executors",
      "list_profiles",
      "list_models",
      "estimate_cost",
      "latency_stats",
      "usage_report",
    ]) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }

    const dispatch = body.result.tools.find(
      (tool) => tool.name === "dispatch_project",
    );
    assert.equal(dispatch.inputSchema.properties.idempotency_key.type, "string");
    assert.equal(typeof dispatch.inputSchema, "object");
    assert.equal(dispatch.inputSchema.type, "object");
    assert.equal(dispatch.inputSchema.properties.executor.type, "string");
    const dispatchOpenCode = body.result.tools.find(
      (tool) => tool.name === "dispatch_opencode",
    );
    assert.equal(dispatchOpenCode.inputSchema.properties.executor.type, "string");
    const continuation = body.result.tools.find(
      (tool) => tool.name === "continue_project",
    );
    assert.equal(continuation.inputSchema.properties.executor.type, "string");
    const handoff = body.result.tools.find((tool) => tool.name === "handoff_project");
    assert.equal(handoff.inputSchema.properties.source_task_id.type, "string");
    assert.equal(handoff.inputSchema.properties.executor.type, "string");
    assert.equal(handoff.inputSchema.properties.idempotency_key.type, "string");
    assert.equal(handoff.inputSchema.properties.fresh_session.type, "boolean");
    assert.equal(handoff.inputSchema.required.includes("objective"), true);
    assert.equal(handoff.inputSchema.required.includes("fresh_session"), false);
    for (const tool of body.result.tools) {
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.equal(typeof tool.inputSchema.properties, "object", tool.name);
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    }
    assert.equal(dispatch.inputSchema.required.includes("executor"), false);
    const reconciliation = body.result.tools.find(tool => tool.name === "reconcile_usage");
    const row = reconciliation.inputSchema.properties.provider_rows.items;
    assert.equal(row.additionalProperties, false);
    assert.equal(row.properties.token_dimensions.additionalProperties, false);
  } finally {
    await app.close();
  }
});

test("standard MCP listing preserves discovery schemas and unknown-key parsing", async () => {
  const config = testConfig();
  const dispatched = [];
  const orchestrator = new StubOrchestrator();
  orchestrator.dispatch = (args) => {
    dispatched.push(args);
    return { id: "schema-test-task", policy: { name: "balanced" } };
  };
  const app = await createApplication({
    config,
    store: new TaskStore(config.stateDir, 20),
    codex: new StubCodex(),
    orchestrator,
    startCodex: false,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${app.server.address().port}/mcp`;
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  let nextId = 1;
  async function post(method, params, notification = false) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(notification ? {} : { id: nextId++ }),
        method,
        params,
      }),
    });
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const text = await response.text();
    const data = text.startsWith("event:")
      ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
      : text;
    return { status: response.status, body: data ? JSON.parse(data) : null };
  }
  try {
    const discovery = await post("server/discover", {});
    const initialized = await post("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "schema-contract-test", version: "1.0.0" },
    });
    assert.equal(initialized.status, 200);
    assert.ok(headers["mcp-session-id"]);
    assert.equal((await post("notifications/initialized", {}, true)).status, 202);
    const listed = await post("tools/list", {});
    assert.equal(listed.status, 200);
    assert.equal(listed.body.result.tools.length, 29);
    assert.deepEqual(listed.body.result.tools.map(({ execution, ...tool }) => {
      assert.deepEqual(execution, { taskSupport: "forbidden" });
      return tool;
    }), discovery.body.result.tools);

    const dispatchSchema = listed.body.result.tools.find(
      (tool) => tool.name === "dispatch_project",
    ).inputSchema;
    assert.equal(dispatchSchema.properties.executor.default, "auto");
    assert.equal(dispatchSchema.required.includes("executor"), false);
    assert.deepEqual(dispatchSchema.properties.model.type, ["string", "null"]);

    // JSON Schema advertises closed objects, as before. Runtime parsing still
    // strips unknown keys instead of changing existing callers to strict mode.
    const dispatchedResult = await post("tools/call", {
      name: "dispatch_project",
      arguments: { workspace: "/workspace/test", objective: "test", extra: true },
    });
    assert.notEqual(dispatchedResult.body.result.isError, true);
    assert.equal(dispatched.length, 1);
    assert.equal(Object.hasOwn(dispatched[0], "extra"), false);
    assert.equal(dispatched[0].executor, "auto");

    const reconciled = await post("tools/call", {
      name: "reconcile_usage",
      arguments: {
        extra: true,
        provider_rows: [{
          asterroute_request_id: "schema-test-request",
          extra: true,
          token_dimensions: { input: 1, output: 2, extra: true },
        }],
      },
    });
    assert.notEqual(reconciled.body.result.isError, true);
    assert.equal(reconciled.body.result.structuredContent.applied, 1);
  } finally {
    await app.close();
  }
});
