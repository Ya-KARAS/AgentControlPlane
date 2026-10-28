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
    assert.equal(handoff.inputSchema.required.includes("objective"), true);
  } finally {
    await app.close();
  }
});
