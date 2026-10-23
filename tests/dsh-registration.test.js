import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildExecutor, buildExecutors } from "../src/server.js";

const defaults = fs.readFileSync(new URL("../config/default.json", import.meta.url));
const config = () => JSON.parse(defaults);
const ids = ["codex", "openai-compatible", "deepseek", "claude", "opencode", "kimi", "zcode"];

test("disabled DSH cannot silently fall through to Codex", () => {
  assert.throws(() => buildExecutor(config(), "dsh"), { code: "executor_disabled" });
});

test("absent or disabled DSH preserves existing registrations, order and labels", () => {
  for (const dsh of [undefined, { enabled: false }, { enabled: "true" }]) {
    const c = config();
    if (dsh) c.executor.dsh = dsh;
    const executors = buildExecutors(c);
    assert.deepEqual([...executors.keys()], ids);
    assert.equal(executors.get("deepseek").describe().display_name, "DeepSeek Harness");
    assert.ok(!executors.has("dsh"));
  }
  assert.deepEqual(fs.readFileSync(new URL("../config/default.json", import.meta.url)), defaults);
});

test("DSH is independently opt-in and does not reserve a relay id when disabled", () => {
  const c = config();
  c.executor.relays = [{ id: "dsh", baseUrl: "https://fixture.invalid/v1" }];
  assert.equal(buildExecutors(c).get("dsh").kind, "model-endpoint");
  c.executor.dsh = { enabled: true };
  assert.throws(() => buildExecutors(c), { code: "duplicate_executor_id" });
  c.executor.relays = [];
  const executors = buildExecutors(c);
  assert.deepEqual([...executors.keys()], [...ids, "dsh"]);
  assert.equal(executors.get("dsh").kind, "cli");
  assert.equal(executors.get("dsh").ready, false);
  assert.equal(c.executor.provider, config().executor.provider);
  assert.deepEqual(c.executor.routing, config().executor.routing);
});

test("DSH registration is not tied to a model provider configuration", () => {
  const c = config();
  delete c.executor.deepseek;
  delete c.executor.openaiCompat;
  c.executor.relays = [];
  c.executor.dsh = { enabled: true };
  const executors = buildExecutors(c);
  assert.equal(executors.get("dsh").id, "dsh");
  assert.ok(executors.has("codex"));
  assert.ok(executors.has("opencode"));
});
