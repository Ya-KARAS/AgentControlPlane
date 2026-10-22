import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/server.js";

class StubExecutor extends EventEmitter {
  ready = true;
  stop() {}
}

async function withMcpSession(callback) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-mcp-limits-"));
  const dispatched = [];
  const app = await createApplication({
    config: {
      server: {
        host: "127.0.0.1",
        port: 0,
        authToken: "test-secret",
        allowedOrigins: [],
        maxMcpSessions: 2,
        mcpSessionIdleMinutes: 1,
      },
      stateDir,
      limits: { maxStoredEventsPerTask: 20 },
      profiles: {},
      codex: { networkAccess: false },
    },
    codex: new StubExecutor(),
    orchestrator: {
      dispatch(args) {
        dispatched.push(args);
        return { id: "test-task", policy: { name: "balanced" } };
      },
    },
    startCodex: false,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${app.server.address().port}/mcp`;
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: "Bearer test-secret",
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
    const initialized = await post("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "input-limit-test", version: "1.0.0" },
    });
    assert.equal(initialized.status, 200);
    assert.ok(headers["mcp-session-id"]);
    assert.equal((await post("notifications/initialized", {}, true)).status, 202);
    await callback({ post, dispatched });
  } finally {
    if (headers["mcp-session-id"]) {
      const response = await fetch(endpoint, { method: "DELETE", headers });
      await response.text();
    }
    await app.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

test("MCP rejects oversized tool argument collections before dispatch and keeps the session usable", async () => {
  await withMcpSession(async ({ post, dispatched }) => {
    const call = (args) => post("tools/call", {
      name: "dispatch_project",
      arguments: { workspace: "/workspace/test", objective: "test", ...args },
    });

    const oversized = await call({ constraints: Array(10_001).fill("x") });
    assert.equal(oversized.status, 200);
    assert.equal(oversized.body.result.isError, true);
    assert.match(oversized.body.result.content[0].text, /maximum of 10000 elements/);
    assert.equal(dispatched.length, 0);

    // Unknown nested keys count too, before Zod strips them from the schema.
    const nested = await call({ extra: { nested: Array(10_001).fill(null) } });
    assert.equal(nested.body.result.isError, true);
    assert.match(nested.body.result.content[0].text, /maximum of 10000 elements/);
    assert.equal(dispatched.length, 0);

    const valid = await call({ constraints: ["Stay local"] });
    assert.equal(valid.status, 200);
    assert.notEqual(valid.body.result.isError, true);
    assert.equal(valid.body.result.structuredContent.task.id, "test-task");
    assert.equal(dispatched.length, 1);
    assert.deepEqual(dispatched[0].constraints, ["Stay local"]);
  });
});

test("MCP rejects request bodies over one MiB before dispatch", async () => {
  await withMcpSession(async ({ post, dispatched }) => {
    const response = await post("tools/call", {
      name: "dispatch_project",
      arguments: { workspace: "/workspace/test", objective: "x".repeat(1024 * 1024) },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "request_too_large");
    assert.equal(dispatched.length, 0);
  });
});
