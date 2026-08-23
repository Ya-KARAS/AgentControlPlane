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

test("userscript declares the preview metadata and supported sites", () => {
  const script = readScript();
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /^\/\/ ==UserScript==$/m);
  assert.match(script, /^\/\/ @name\s+AgentControlPlane Web Bridge Preview$/m);
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

test("userscript submits only a manual candidate to local review", () => {
  const script = readScript();
  assert.match(script, /ACP 本机任务候选/);
  assert.match(script, /document\.body\.append\(root\)/);
  assert.match(script, /GM_xmlhttpRequest\(/);
  assert.match(script, /\/v1\/local-review\/candidates/);
  assert.match(script, /validatedReviewUrl\(body\.review_url/);
  assert.match(script, /GM_openInTab\(reviewUrl/);
  assert.match(script, /x-acp-client/);
  assert.match(script, /x-acp-status-secret/);
  assert.match(script, /\/status/);
  assert.doesNotMatch(script, /\/v1\/(?:companion\/)?tasks/);
  assert.doesNotMatch(script, /dispatch_project|ACP_TASK|api[_-]?key|authorization/i);
  assert.doesNotMatch(
    script,
    /document\.(?:documentElement|body)\.(?:innerText|textContent)|querySelectorAll\(/,
  );
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB/);
});

test("web adapters are independent data modules resolved by a shared registry", () => {
  const registry = createAdapterRegistry([chatgpt, deepseek]);
  assert.equal(registry.resolve({ origin: "https://chatgpt.com" })?.id, "chatgpt");
  assert.equal(registry.resolve({ origin: "https://chat.deepseek.com" })?.id, "deepseek");
  assert.equal(registry.resolve({ origin: "https://example.com" }), null);
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

test("userscript documentation states the preview safety boundary", () => {
  const readme = fs.readFileSync(path.resolve("userscript", "README.md"), "utf8");
  assert.match(readme, /desktop-only preview/);
  assert.match(readme, /does not read a conversation/i);
  assert.match(readme, /manually enter a task candidate/i);
  assert.match(readme, /device pairing, mobile relay support/i);
});
