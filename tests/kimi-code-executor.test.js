import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildKimiRunArgs,
  hasKimiOAuthCredential,
  KimiCodeExecutor,
  kimiModelsFromConfig,
  normalizeKimiEvents,
  parseKimiProviderConfig,
} from "../src/executors/kimi-code-executor.js";
import { assertLifecycle } from "../src/executors/lifecycle.js";

test("KimiCodeExecutor satisfies the agent lifecycle contract", () => {
  const executor = new KimiCodeExecutor();
  assert.equal(assertLifecycle(executor), executor);
  assert.equal(executor.id, "kimi");
  assert.equal(executor.capabilities.persistentThreads, false);
  assert.equal(executor.capabilities.tokenUsage, false);
});

test("parses configured Kimi providers and models", () => {
  const config = parseKimiProviderConfig(
    JSON.stringify({
      providers: { kimi: { type: "kimi" } },
      models: {
        "kimi-for-coding": { provider: "kimi", model: "kimi-k2.5" },
      },
    }),
  );
  assert.equal(Object.keys(config.providers).length, 1);
  const models = kimiModelsFromConfig(config, "kimi-for-coding");
  assert.equal(models[0].id, "kimi-for-coding");
  assert.equal(models[0].provider, "kimi");
  assert.equal(models[0].isDefault, true);
  assert.equal(parseKimiProviderConfig("not-json"), null);
});

test("detects only top-level Kimi OAuth credential files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-kimi-auth-"));
  fs.mkdirSync(path.join(root, "credentials", "mcp"), { recursive: true });
  fs.writeFileSync(path.join(root, "credentials", "mcp", "other.json"), "{}");
  assert.equal(hasKimiOAuthCredential(root), false);
  fs.writeFileSync(path.join(root, "credentials", "kimi-code.json"), "{}");
  assert.equal(hasKimiOAuthCredential(root), true);
});

test("builds fresh and resumed Kimi prompt invocations", () => {
  assert.deepEqual(buildKimiRunArgs("Do work"), [
    "-p",
    "Do work",
    "--output-format",
    "stream-json",
  ]);
  assert.deepEqual(
    buildKimiRunArgs("Continue", {
      model: "kimi-for-coding",
      sessionId: "session-1",
    }),
    [
      "-p",
      "Continue",
      "--output-format",
      "stream-json",
      "--session",
      "session-1",
      "--model",
      "kimi-for-coding",
    ],
  );
});

test("normalizes Kimi stream-json assistant output and resume hint", () => {
  const normalized = normalizeKimiEvents([
    { role: "meta", type: "system.version", version: "0.38.0" },
    {
      role: "meta",
      type: "session.resume_hint",
      session_id: "session-1",
    },
    { role: "assistant", content: "working" },
    { role: "tool", tool_call_id: "call-1", content: "done" },
    { role: "assistant", content: "final report" },
  ]);
  assert.equal(normalized.sessionId, "session-1");
  assert.equal(normalized.finalText, "final report");
  assert.equal(normalized.usage.total_tokens, 0);
});
