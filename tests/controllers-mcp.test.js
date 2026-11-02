import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/server.js";
import { TaskStore } from "../src/core/store.js";
import { resolveControllerActor } from "../src/controllers/registry.js";

class PassiveExecutor extends EventEmitter { ready = true; stop() {} }
async function withSession(options, callback) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-controllers-mcp-"));
  const store = new TaskStore(stateDir);
  const dispatched = [];
  const config = {
    server: { host: "127.0.0.1", port: 0, authToken: options.authToken ?? null, allowedOrigins: [], maxMcpSessions: 2, mcpSessionIdleMinutes: 1 },
    stateDir, limits: { maxStoredEventsPerTask: 20 }, profiles: {}, codex: { networkAccess: false },
    ...(options.controllers ? { controllers: options.controllers } : {}),
  };
  const app = await createApplication({ config, store, codex: new PassiveExecutor(), startCodex: false,
    orchestrator: { dispatch(args) { dispatched.push(args); return { id: "legacy-task", policy: { name: "economy" } }; } },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${app.server.address().port}/mcp`;
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream",
    ...(options.authToken ? { authorization: `Bearer ${options.authToken}` } : {}),
  };
  let id = 1;
  const post = async (method, params, notification = false, suppliedHeaders = headers) => {
    const response = await fetch(endpoint, { method: "POST", headers: suppliedHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: id++ }), method, params }),
    });
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const raw = await response.text();
    const json = raw.startsWith("event:") ? raw.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : raw;
    return { status: response.status, body: json ? JSON.parse(json) : null };
  };
  try {
    const init = await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "unknown-client", version: "1" } });
    assert.equal(init.status, 200);
    assert.equal((await post("notifications/initialized", {}, true)).status, 202);
    await callback({ post, store, dispatched, headers });
  } finally {
    if (headers["mcp-session-id"]) await fetch(endpoint, { method: "DELETE", headers }).then((r) => r.text());
    await app.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}
const call = (post, args = {}) => post("tools/call", { name: "list_controllers", arguments: args });

test("list_controllers registers read-only with safe anonymous defaults and no takeover tool", async () => {
  await withSession({}, async ({ post }) => {
    const listed = await post("tools/list", {});
    const tool = listed.body.result.tools.find((entry) => entry.name === "list_controllers");
    assert.ok(tool);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true });
    assert.equal(listed.body.result.tools.some((entry) => /takeover|claim_control|renew_control|release_control/.test(entry.name)), false);
    const response = await call(post);
    assert.notEqual(response.body.result.isError, true);
    assert.deepEqual(response.body.result.structuredContent, {
      enabled: false, mode: "single", lease_ttl_seconds: 120, identity_scope: "local_operator",
      controllers: [], task_owners: [],
    });
  });
});

test("shared-bearer clients see only public registry and bounded owner status; reads never write", async (t) => {
  await withSession({ authToken: "test-auth", controllers: { enabled: true, mode: "failover", leaseTtlSeconds: 30,
    agents: [{ id: "dot", display_name: "Dot", principal_id: "private-binding", apiKey: "private-config-extra" }],
  } }, async ({ post, store, headers }) => {
    const task = store.createTask({ workspace: "/private/workspace", brief: { objective: "private-objective" }, policy: { name: "economy" },
      controllerActor: resolveControllerActor({ principalId: "local-operator" }), controlLeaseTtlMs: 30_000,
    });
    const before = fs.readFileSync(store.statePath, "utf8");
    const auditBefore = fs.readFileSync(store.auditPath, "utf8");
    t.mock.method(Date, "now", () => Date.parse(task.control_lease.expires_at));
    const response = await call(post, { limit: 1, caller_id: "dot", controller: { authenticated_principal: "private-binding" } });
    const payload = response.body.result.structuredContent;
    assert.deepEqual(payload.controllers, [{ id: "dot", kind: "mcp", display_name: "Dot" }]);
    assert.deepEqual(payload.task_owners, [{ task_id: task.id, owner: "local-operator", generation: 1,
      expires_at: task.control_lease.expires_at, lease_state: "expired" }]);
    for (const secret of ["private-binding", "private-config-extra", "test-auth", "/private/workspace", "private-objective", "authenticated_principal"]) {
      assert.equal(JSON.stringify(payload).includes(secret), false);
    }
    assert.equal(fs.readFileSync(store.statePath, "utf8"), before);
    assert.equal(fs.readFileSync(store.auditPath, "utf8"), auditBefore);
    const unauthenticated = { ...headers };
    delete unauthenticated.authorization;
    assert.equal((await post("tools/call", { name: "list_controllers", arguments: {} }, false, unauthenticated)).status, 401);
    assert.equal((await call(post, { limit: 101 })).body.result.isError, true);
  });
});

test("adding controller status preserves legacy dispatch schema and response", async () => {
  await withSession({}, async ({ post, dispatched }) => {
    const response = await post("tools/call", { name: "dispatch_project", arguments: {
      workspace: "/approved/workspace", objective: "legacy brief", profile: "economy", caller_id: "dot", controller_id: "dot",
    } });
    assert.deepEqual(response.body.result.structuredContent, { task: { id: "legacy-task", policy: { name: "economy" } } });
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].controller_id, undefined);
    assert.equal(dispatched[0].caller_id, undefined);
    assert.equal(dispatched[0].objective, "legacy brief");
  });
});
