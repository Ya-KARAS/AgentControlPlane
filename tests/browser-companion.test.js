import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  controllerPrompt,
  extractTaskEnvelope,
  formatTaskResult,
  normalizeDispatch,
  resolveExecutorAlias,
  stableEnvelopeId,
} from "../browser-companion/src/protocol.js";
import {
  detectAdapter,
  supportedAdapters,
} from "../browser-companion/src/site-adapters.js";
import { STRINGS } from "../browser-companion/src/i18n.js";

test("companion strings have matching zh and en keys", () => {
  assert.deepEqual(
    Object.keys(STRINGS.zh).sort(),
    Object.keys(STRINGS.en).sort(),
  );
  for (const key of Object.keys(STRINGS.en)) {
    assert.ok(STRINGS.zh[key], `zh.${key} is non-empty`);
    assert.ok(STRINGS.en[key], `en.${key} is non-empty`);
  }
});

test("extracts and normalizes a local ACP task envelope", () => {
  const envelope = {
    workspace: "DEFAULT",
    objective: "Create hello.txt",
    acceptance_criteria: ["Content is exact"],
    profile: "economy",
  };
  const text = `Ready.\n<ACP_TASK>\n${JSON.stringify(envelope)}\n</ACP_TASK>`;
  assert.deepEqual(extractTaskEnvelope(text), envelope);
  assert.deepEqual(
    normalizeDispatch(envelope, {
      workspace: "C:\\work\\demo",
      executor: "opencode",
    }),
    {
      workspace: "C:\\work\\demo",
      objective: "Create hello.txt",
      profile: "economy",
      executor: "opencode",
      acceptance_criteria: ["Content is exact"],
    },
  );
});

test("controller prompt keeps local paths out of the web conversation", () => {
  const prompt = controllerPrompt(
    {
      workspace: "C:\\Users\\private\\project",
      profile: "balanced",
      executor: "auto",
    },
    [
      { id: "opencode", display_name: "OpenCode" },
      { id: "deepseek", display_name: "DeepSeek Harness" },
    ],
  );
  assert.match(prompt, /"workspace": "DEFAULT"/);
  assert.doesNotMatch(prompt, /Users\\private/);
  assert.match(prompt, /任务已暂存/);
  assert.match(prompt, /Dispatch is performed locally/);
  assert.match(prompt, /Model and reasoning check/);
  assert.match(prompt, /Automatic execution recommendation/);
  assert.match(prompt, /deepseek \(DeepSeek Harness\)/);
  assert.match(prompt, /Never invent or write an <ACP_RESULT>/);
});

test("web envelopes cannot override the locally selected workspace", () => {
  const request = normalizeDispatch(
    { workspace: "C:\\other-project", objective: "Try another project" },
    { workspace: "C:\\approved-project", executor: "auto" },
  );
  assert.equal(request.workspace, "C:\\approved-project");
});

test("panel-selected model and reasoning effort flow into dispatch", () => {
  const request = normalizeDispatch(
    { objective: "Create hello.txt" },
    {
      workspace: "C:\\approved-project",
      executor: "asterroute",
      model: "deepseek-v4-pro-official",
      reasoning_effort: "high",
    },
  );
  assert.equal(request.model, "deepseek-v4-pro-official");
  assert.equal(request.reasoning_effort, "high");

  const envelopeWins = normalizeDispatch(
    { objective: "Create hello.txt", model: "explicit-model" },
    {
      workspace: "C:\\approved-project",
      executor: "asterroute",
      model: "panel-model",
    },
  );
  assert.equal(envelopeWins.model, "explicit-model");

  const automatic = normalizeDispatch(
    { objective: "Create hello.txt" },
    {
      workspace: "C:\\approved-project",
      executor: "auto",
      profile: "auto",
      model: "auto",
      reasoning_effort: "auto",
    },
  );
  assert.equal(automatic.executor, "auto");
  assert.equal(automatic.profile, "economy");
  assert.equal("model" in automatic, false);
  assert.equal("reasoning_effort" in automatic, false);
});

test("controller prompt lists advertised models from the catalog", () => {
  const prompt = controllerPrompt(
    { workspace: "C:\\w", executor: "auto" },
    [
      { id: "asterroute", display_name: "AsterRoute" },
      { id: "opencode", display_name: "OpenCode" },
    ],
    {
      asterroute: [
        { id: "deepseek-v4-pro-official" },
        { id: "gpt-5.6-sol-economy" },
      ],
      opencode: [],
    },
  );
  assert.match(prompt, /Advertised models: AsterRoute: deepseek-v4-pro-official, gpt-5\.6-sol-economy/);
  assert.doesNotMatch(prompt, /deepseek-chat" or "deepseek-reasoner/);
});

test("string context and constraints from the web AI become string arrays", () => {
  const request = normalizeDispatch(
    {
      objective: "Create hello.txt",
      context: "Local smoke task",
      constraints: "Touch only hello.txt",
    },
    { workspace: "C:\\approved-project", executor: "auto" },
  );
  assert.deepEqual(request.context, ["Local smoke task"]);
  assert.deepEqual(request.constraints, ["Touch only hello.txt"]);
});

test("auto profile resolves from objective difficulty", () => {
  const base = { workspace: "C:\\approved-project", executor: "auto", profile: "auto" };
  assert.equal(
    normalizeDispatch({ objective: "重构整个模块的架构" }, base).profile,
    "deep",
  );
  assert.equal(
    normalizeDispatch({ objective: "写一个 hello 示例" }, base).profile,
    "economy",
  );
  assert.equal(
    normalizeDispatch({ objective: "给接口加参数校验" }, base).profile,
    "balanced",
  );
});

test("executor aliases resolve to registered ids", () => {
  const executors = [
    { id: "openai-compatible", display_name: "OpenCodex" },
    { id: "deepseek", display_name: "DeepSeek Harness" },
  ];
  assert.equal(resolveExecutorAlias("opencodex", executors), "openai-compatible");
  assert.equal(
    resolveExecutorAlias("DeepSeek Harness", executors),
    "deepseek",
  );
  assert.equal(resolveExecutorAlias("auto", executors), "auto");
  assert.equal(resolveExecutorAlias("codex", executors), "codex");
});

test("formats terminal results and creates stable envelope identifiers", () => {
  const task = {
    id: "task-1",
    logical_task_id: "logical-1",
    status: "completed",
    executor: "opencode",
    executor_history: [{ executor: "codex" }, { executor: "opencode" }],
    reroute_reason: "quota_exhausted",
    result: { summary: "Done" },
    error: null,
    usage: { total_tokens: 10 },
  };
  const result = formatTaskResult(task);
  assert.match(result, /<ACP_RESULT>/);
  assert.match(result, /"summary": "Done"/);
  assert.match(result, /"logical_task_id": "logical-1"/);
  assert.match(result, /"reroute_reason": "quota_exhausted"/);
  assert.match(result, /"executor": "codex"/);
  assert.equal(
    stableEnvelopeId({ objective: "same" }),
    stableEnvelopeId({ objective: "same" }),
  );
});

test("selects built-in web AI adapters and falls back to generic", () => {
  assert.equal(detectAdapter("https://chatgpt.com/c/1").id, "chatgpt");
  assert.equal(detectAdapter("https://chat.deepseek.com/a/chat/s/1").id, "deepseek");
  assert.equal(detectAdapter("https://claude.ai/new").id, "claude");
  assert.equal(detectAdapter("https://example.ai/chat").id, "generic");
  assert.deepEqual(
    supportedAdapters.map((entry) => entry.id),
    ["chatgpt", "deepseek", "claude", "generic"],
  );
});

test("companion panel and popup display the service version", () => {
  const panel = fs.readFileSync(
    path.resolve("browser-companion", "src", "panel.js"),
    "utf8",
  );
  assert.match(panel, /class="version"/);
  assert.match(panel, /options\?\.version/);

  const popupHtml = fs.readFileSync(
    path.resolve("browser-companion", "popup", "popup.html"),
    "utf8",
  );
  assert.match(popupHtml, /id="serviceVersion"/);
  assert.doesNotMatch(popupHtml, />v0\.4\.1</);

  const popupJs = fs.readFileSync(
    path.resolve("browser-companion", "popup", "popup.js"),
    "utf8",
  );
  assert.match(popupJs, /available\.version/);
  assert.match(popupJs, /serviceVersion\.textContent/);
});

test("companion surfaces recommendations without auto-selecting", () => {
  const panel = fs.readFileSync(
    path.resolve("browser-companion", "src", "panel.js"),
    "utf8",
  );
  assert.match(panel, /recommendModels/);
  assert.match(panel, /setRecommendation/);
  assert.match(panel, /selectRecommended/);
  assert.match(panel, /data-field="reasoning_effort"/);
  assert.match(panel, /profileAuto/);
  assert.match(panel, /reasoningAuto/);

  const content = fs.readFileSync(
    path.resolve("browser-companion", "src", "content.js"),
    "utf8",
  );
  assert.match(content, /ACP_RECOMMEND/);
  assert.match(content, /recommendFromPanel/);

  const background = fs.readFileSync(
    path.resolve("browser-companion", "src", "background.js"),
    "utf8",
  );
  assert.match(background, /ACP_RECOMMEND/);
  assert.match(background, /\/v1\/recommendations/);
  assert.match(background, /profile: "auto"/);
  assert.match(background, /reasoning_effort: "auto"/);
});

test("manifest grants only known AI sites by default", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.resolve("browser-companion", "manifest.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.manifest_version, 3);
  const packageVersion = JSON.parse(
    fs.readFileSync(path.resolve("package.json"), "utf8"),
  ).version;
  assert.equal(manifest.version, packageVersion);
  assert.ok(manifest.host_permissions.includes("https://chatgpt.com/*"));
  assert.ok(manifest.host_permissions.includes("https://chat.deepseek.com/*"));
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
  assert.equal(manifest.host_permissions.includes("https://*/*"), false);
});
