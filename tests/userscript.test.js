import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import chatgpt from "../userscript/src/adapters/chatgpt.js";
import deepseek from "../userscript/src/adapters/deepseek.js";
import { createAdapterRegistry } from "../userscript/src/adapter-registry.js";
import { readCapabilitiesWithFallback } from "../userscript/src/capabilities.js";
import { parseRemoteTaskResponse } from "../userscript/src/remote-task-response.js";
import {
  clampFloatingPosition,
  pointerMoved,
  readFloatingPosition,
} from "../userscript/src/floating-position.js";

const scriptPath = path.resolve(
  "userscript",
  "agent-control-plane-web-bridge.user.js",
);
const metaPath = path.resolve(
  "userscript",
  "agent-control-plane-web-bridge.meta.js",
);
const releasePath = path.resolve(
  "userscript",
  "releases",
  "0.8.8",
  "agent-control-plane-web-bridge.user.js",
);
const readScript = () => fs.readFileSync(scriptPath, "utf8");

test("userscript declares the natural-language bridge metadata and supported sites", () => {
  const script = readScript();
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /^\/\/ ==UserScript==$/m);
  assert.match(script, /^\/\/ @name\s+AgentControlPlane Web Bridge Preview$/m);
  assert.match(script, /^\/\/ @version\s+0\.8\.8$/m);
  assert.match(script, /^\/\/ @name:zh-CN\s+AgentControlPlane 网页桥接预览$/m);
  assert.match(script, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\/Ya-KARAS\/AgentControlPlane\/refs\/heads\/main\/userscript\/releases\/0\.8\.8\/agent-control-plane-web-bridge\.user\.js$/m);
  assert.match(script, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\/Ya-KARAS\/AgentControlPlane\/refs\/heads\/main\/userscript\/agent-control-plane-web-bridge\.meta\.js$/m);
  assert.match(script, /^\/\/ @connect\s+127\.0\.0\.1$/m);
  assert.match(script, /^\/\/ @connect\s+acp\.asterroute\.com$/m);
  assert.match(script, /^\/\/ @grant\s+GM_openInTab$/m);
  assert.match(script, /^\/\/ @grant\s+GM_deleteValue$/m);
  assert.match(script, /^\/\/ @grant\s+GM_getValue$/m);
  assert.match(script, /^\/\/ @grant\s+GM_registerMenuCommand$/m);
  assert.match(script, /^\/\/ @grant\s+GM_setValue$/m);
  assert.match(script, /^\/\/ @grant\s+GM_xmlhttpRequest$/m);
  assert.match(script, /^\/\/ @run-at\s+document-idle$/m);

  const matches = [...script.matchAll(/^\/\/ @match\s+(.+)$/gm)]
    .map((entry) => entry[1]);
  assert.deepEqual(matches, [
    "https://chatgpt.com/*",
    "https://chat.deepseek.com/*",
  ]);
});

test("userscript update metadata is small and matches the install header", () => {
  const script = readScript();
  const meta = fs.readFileSync(metaPath, "utf8");
  const release = fs.readFileSync(releasePath, "utf8");
  const marker = "// ==/UserScript==";
  const expected = `${script.slice(0, script.indexOf(marker) + marker.length)}\n`;

  assert.equal(meta, expected);
  assert.equal(release, script);
  assert.match(meta, /^\/\/ @version\s+0\.8\.8$/m);
  assert.match(meta, /userscript\/releases\/0\.8\.8\/agent-control-plane-web-bridge\.user\.js/);
  assert.match(meta, /userscript\/agent-control-plane-web-bridge\.meta\.js/);
  assert.doesNotMatch(meta, /acp\.asterroute\.com\/downloads/);
  assert.doesNotMatch(meta, /MutationObserver|GM_xmlhttpRequest\(/);
  assert.ok(Buffer.byteLength(meta) < 2048);
});

test("userscript falls back to the paired portal when localhost returns an invalid response", async () => {
  let remoteReads = 0;
  const capabilities = await readCapabilitiesWithFallback({
    readLocal: async () => ({ status: 0, responseText: "" }),
    readRemote: async () => {
      remoteReads += 1;
      return {
        status: 200,
        responseText: JSON.stringify({ capabilities: { executors: [{ id: "opencode" }] } }),
      };
    },
  });

  assert.equal(remoteReads, 1);
  assert.equal(capabilities.executors[0].id, "opencode");
});

test("paired mobile capability discovery reads the remote portal first", async () => {
  const reads = [];
  const capabilities = await readCapabilitiesWithFallback({
    preferRemote: true,
    readLocal: async () => {
      reads.push("local");
      throw new Error("localhost_unreachable");
    },
    readRemote: async () => {
      reads.push("remote");
      return {
        status: 200,
        responseText: JSON.stringify({ capabilities: { current: { workspace: "mobile" } } }),
      };
    },
  });
  assert.deepEqual(reads, ["remote"]);
  assert.equal(capabilities.current.workspace, "mobile");
});

test("remote task responses accept both direct and wrapped portal shapes", () => {
  const task = { id: "d20d1432-a515-4948-85f2-dc271c91e501", status: "queued" };
  assert.deepEqual(parseRemoteTaskResponse({
    status: 201,
    responseText: JSON.stringify(task),
  }, 201), { task });
  assert.deepEqual(parseRemoteTaskResponse({
    status: 200,
    responseText: JSON.stringify({ task }),
  }), { task });
  assert.throws(
    () => parseRemoteTaskResponse({ status: 401, responseText: '{"error":{"code":"unauthorized"}}' }),
    /unauthorized/,
  );
});

test("floating ACP control position stays on screen and detects intentional drags", () => {
  assert.equal(readFloatingPosition({ x: 30, y: 40 }).x, 30);
  assert.equal(readFloatingPosition({ x: "30", y: 40 }), null);
  assert.deepEqual(clampFloatingPosition({
    x: 999,
    y: -50,
    width: 120,
    height: 40,
    viewportWidth: 360,
    viewportHeight: 640,
  }), { x: 232, y: 8 });
  assert.equal(pointerMoved(0, 0, 3, 4), false);
  assert.equal(pointerMoved(0, 0, 6, 1), true);
});

test("userscript keeps routine operation inside the native web AI conversation", () => {
  const script = readScript();
  assert.match(script, /@AgentControlPlane/);
  assert.match(script, /@ACP/);
  assert.match(script, /<ACP_TASK>/);
  assert.match(script, /<ACP_RESULT>/);
  assert.match(script, /MutationObserver/);
  assert.match(script, /candidateFromEnvelope/);
  assert.match(script, /returnResultToConversation/);
  assert.match(script, /executionSummary/);
  assert.match(script, /回复“执行”/);
  assert.match(script, /!event\.isTrusted/);
  assert.match(script, /document\.body\.append\(root\)/);
  assert.match(script, /GM_xmlhttpRequest\(/);
  assert.match(script, /\/v1\/local-review\/candidates/);
  assert.match(script, /\/v1\/local-review\/capabilities/);
  assert.match(script, /x-acp-client/);
  assert.match(script, /x-acp-status-secret/);
  assert.match(script, /x-acp-idempotency-key/);
  assert.match(script, /GM_setValue/);
  assert.match(script, /GM_getValue/);
  assert.match(script, /确认变更/);
  assert.match(script, /任务已变更 · 回复“确认变更”/);
  assert.match(script, /变更已确认/);
  assert.match(script, /任务已恢复/);
  assert.match(script, /navigator\.locks/);
  assert.match(script, /任务版本冲突 · 请刷新页面/);
  assert.match(script, /acp-stage-v2/);
  assert.match(script, /acp-result-delivery-v1/);
  assert.match(script, /resultAlreadyReturned/);
  assert.match(script, /rememberReturnedResult/);
  assert.match(script, /createDispatchedRecord/);
  assert.match(script, /observationWasDispatched/);
  assert.match(script, /observationWaitsBehindBarrier/);
  assert.match(script, /本对话任务已封存/);
  assert.match(script, /stable project id/);
  assert.match(script, /statusCompleted: "✓ 完成"/);
  assert.match(script, /statusCompleted: "✓ Completed"/);
  assert.match(script, /ACP 语言：中文/);
  assert.match(script, /ACP language: English/);
  assert.match(script, /acp-ui-language-v1/);
  assert.match(script, /languageSelect/);
  assert.match(script, /<select|document\.createElement\("select"\)/);
  assert.match(script, /ACP interface language/);
  assert.match(script, /button\[data-state="completed"\]/);
  assert.match(script, /acp-remote-relay-v1/);
  assert.match(script, /\/api\/acp\/pairings\/claim/);
  assert.match(script, /\/api\/acp\/tasks/);
  assert.match(script, /\/api\/acp\/capabilities/);
  assert.match(script, /Android\|iPhone\|iPad\|iPod/);
  assert.match(script, /statusAction === "pair-remote"/);
  assert.match(script, /void pairRemoteRelay\(\)/);
  assert.match(script, /acp-floating-position-v1/);
  assert.match(script, /pointerdown/);
  assert.match(script, /parseRemoteTaskResponse/);
  assert.doesNotMatch(script, /ACP 本机任务候选/);
  assert.doesNotMatch(script, /创建本机审核候选/);
  assert.doesNotMatch(script, /document\.createElement\(["']textarea["']\)/);
  assert.doesNotMatch(script, /\/v1\/(?:companion\/)?tasks/);
  assert.doesNotMatch(script, /dispatch_project|api[_-]?key/i);
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
  assert.match(readme, /@ACP/);
  assert.match(readme, /reply with `执行`/i);
  assert.match(readme, /Follow browser.*Chinese.*English/is);
  assert.match(readme, /does not send local\s+paths,\s+raw\s+logs, credentials, or raw errors/i);
  assert.match(readme, /explicitly paired HTTPS ACP portal/i);
  assert.match(readme, /scoped browser token/i);
});
