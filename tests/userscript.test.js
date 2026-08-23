import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import chatgpt from "../userscript/src/adapters/chatgpt.js";
import deepseek from "../userscript/src/adapters/deepseek.js";
import { createAdapterRegistry } from "../userscript/src/adapter-registry.js";

const scriptPath = path.resolve(
  "userscript",
  "agent-control-plane-web-bridge.user.js",
);
const readScript = () => fs.readFileSync(scriptPath, "utf8");

test("userscript declares the natural-language bridge metadata and supported sites", () => {
  const script = readScript();
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /^\/\/ ==UserScript==$/m);
  assert.match(script, /^\/\/ @name\s+AgentControlPlane Web Bridge Preview$/m);
  assert.match(script, /^\/\/ @version\s+0\.4\.0$/m);
  assert.match(script, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\/Ya-KARAS\/AgentControlPlane\/main\/userscript\/agent-control-plane-web-bridge\.user\.js$/m);
  assert.match(script, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\/Ya-KARAS\/AgentControlPlane\/main\/userscript\/agent-control-plane-web-bridge\.user\.js$/m);
  assert.match(script, /^\/\/ @connect\s+127\.0\.0\.1$/m);
  assert.match(script, /^\/\/ @grant\s+GM_openInTab$/m);
  assert.match(script, /^\/\/ @grant\s+GM_xmlhttpRequest$/m);
  assert.match(script, /^\/\/ @run-at\s+document-idle$/m);

  const matches = [...script.matchAll(/^\/\/ @match\s+(.+)$/gm)]
    .map((entry) => entry[1]);
  assert.deepEqual(matches, [
    "https://chatgpt.com/*",
    "https://chat.deepseek.com/*",
  ]);
});

test("userscript keeps routine operation inside the native web AI conversation", () => {
  const script = readScript();
  assert.match(script, /@AgentControlPlane/);
  assert.match(script, /<ACP_TASK>/);
  assert.match(script, /<ACP_RESULT>/);
  assert.match(script, /MutationObserver/);
  assert.match(script, /candidateFromEnvelope/);
  assert.match(script, /returnResultToConversation/);
  assert.match(script, /任务已准备，请回复“执行”/);
  assert.match(script, /!event\.isTrusted/);
  assert.match(script, /document\.body\.append\(root\)/);
  assert.match(script, /GM_xmlhttpRequest\(/);
  assert.match(script, /\/v1\/local-review\/candidates/);
  assert.match(script, /x-acp-client/);
  assert.match(script, /x-acp-status-secret/);
  assert.doesNotMatch(script, /ACP 本机任务候选/);
  assert.doesNotMatch(script, /创建本机审核候选/);
  assert.doesNotMatch(script, /document\.createElement\(["']textarea["']\)/);
  assert.doesNotMatch(script, /\/v1\/(?:companion\/)?tasks/);
  assert.doesNotMatch(script, /dispatch_project|api[_-]?key|authorization/i);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB/);
});

test("web adapters are independent data modules resolved by a shared registry", () => {
  const registry = createAdapterRegistry([chatgpt, deepseek]);
  assert.equal(registry.resolve({ origin: "https://chatgpt.com" })?.id, "chatgpt");
  assert.equal(registry.resolve({ origin: "https://chat.deepseek.com" })?.id, "deepseek");
  assert.equal(registry.resolve({ origin: "https://example.com" }), null);
  for (const adapter of registry.adapters) {
    for (const field of ["composer", "send", "assistant", "user"]) {
      assert.ok(adapter[field].length > 0);
    }
  }
  for (const fileName of ["chatgpt.js", "deepseek.js"]) {
    const source = fs.readFileSync(
      path.resolve("userscript", "src", "adapters", fileName),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /GM_xmlhttpRequest|document|window|local-review|dispatch|querySelector/i,
    );
  }
});

test("userscript documentation states the conversation and local safety boundary", () => {
  const readme = fs.readFileSync(path.resolve("userscript", "README.md"), "utf8");
  assert.match(readme, /native web AI\s+conversation/i);
  assert.match(readme, /@AgentControlPlane/);
  assert.match(readme, /reply with `执行`/i);
  assert.match(readme, /does not send local paths, raw logs, credentials, or raw errors/i);
  assert.match(readme, /device pairing, mobile relay support/i);
});
