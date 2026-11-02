import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/core/config.js";

function configFor(t, controllers) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "acp-controller-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "config.json");
  fs.writeFileSync(file, JSON.stringify(controllers === undefined ? {} : { controllers }));
  return loadConfig(file);
}

test("legacy configuration gets disabled single-controller defaults", (t) => {
  const config = configFor(t);
  assert.deepEqual(config.controllers, { enabled: false, mode: "single", leaseTtlSeconds: 120, agents: [] });
  assert.equal(config.server.host, "127.0.0.1");
  assert.equal(config.executor.reroute.enabled, false);
});

test("controller overrides preserve other defaults and accept TTL boundaries", (t) => {
  for (const leaseTtlSeconds of [30, 600]) {
    const config = configFor(t, { enabled: true, mode: "failover", leaseTtlSeconds });
    assert.equal(config.controllers.leaseTtlSeconds, leaseTtlSeconds);
    assert.equal(config.controllers.enabled, true);
    assert.deepEqual(config.controllers.agents, []);
    assert.equal(config.codex.networkAccess, false);
  }
});

for (const controllers of [
  { enabled: "true" }, { mode: "all" }, { mode: null },
  ...[29, 601, 30.5, "120", null].map((leaseTtlSeconds) => ({ leaseTtlSeconds })),
  { agents: null }, { agents: {} }, { agents: [{ id: "dot" }, { id: "dot" }] },
]) {
  test(`invalid controller config fails closed: ${JSON.stringify(controllers)}`, (t) => {
    assert.throws(() => configFor(t, controllers), (error) => error.code === "invalid_config");
  });
}
