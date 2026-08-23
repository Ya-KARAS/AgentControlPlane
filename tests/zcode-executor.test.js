import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertLifecycle } from "../src/executors/lifecycle.js";
import {
  buildZCodeRunArgs,
  normalizeZCodeEvents,
  parseZCodeOutput,
  prepareZCodeRuntime,
  readZCodeDesktopModel,
  resolveZCodeInvocation,
  ZCodeExecutor,
  zcodeModelsFromDesktop,
} from "../src/executors/zcode-executor.js";

function desktopFixture(root) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "config.json"),
    JSON.stringify({
      provider: {
        "builtin:bigmodel-coding-plan": {
          name: "BigModel Coding Plan",
          kind: "anthropic",
          enabled: false,
          options: {
            apiKey: "secret-desktop-token",
            baseURL: "https://coding-plan.example",
          },
          models: {
            "GLM-5.3": {
              reasoning: { variants: ["low", "high", "max"] },
              limit: { context: 1_000_000 },
              modalities: { input: ["text"] },
            },
            "GLM-5-Turbo": {
              reasoning: { variants: ["enabled", "off"] },
              limit: { context: 200_000 },
              modalities: { input: ["text", "image"] },
            },
          },
        },
        "builtin:bigmodel-start-plan": {
          name: "BigModel Start Plan",
          kind: "anthropic",
          enabled: true,
          options: {
            apiKey: "secret-desktop-token",
            baseURL: "https://zcode.example",
          },
          models: {
            "GLM-5.3": {
              reasoning: { variants: ["low", "high", "max"] },
              limit: { context: 1_000_000 },
              modalities: { input: ["text"] },
            },
            "GLM-5-Turbo": {
              reasoning: { variants: ["enabled", "off"] },
              limit: { context: 200_000 },
              modalities: { input: ["text", "image"] },
            },
          },
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(root, "setting.json"),
    JSON.stringify({
      modelProviderFamilySelectedKeys: {
        bigmodel: "coding-plan:builtin:bigmodel-start-plan",
      },
    }),
  );
}

test("ZCodeExecutor satisfies the agent lifecycle contract", () => {
  const executor = new ZCodeExecutor();
  assert.equal(assertLifecycle(executor), executor);
  assert.equal(executor.id, "zcode");
  assert.equal(executor.capabilities.tokenUsage, true);
  assert.equal(executor.capabilities.hardInterrupt, true);
});

test("discovers the packaged ZCode desktop CLI entry point", () => {
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "acp-zcode-app-"));
  const scriptPath = path.join(
    localAppData,
    "Programs",
    "ZCode",
    "resources",
    "glm",
    "zcode.cjs",
  );
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, "console.log('test')\n");
  const invocation = resolveZCodeInvocation({
    localAppData,
    programFiles: null,
  });
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.prefixArgs, [scriptPath]);
});

test("bridges enabled desktop model metadata without persisting its token", () => {
  const desktopRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "acp-zcode-desktop-"),
  );
  const storageRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "acp-zcode-runtime-"),
  );
  desktopFixture(desktopRoot);
  const desktop = readZCodeDesktopModel(desktopRoot);
  assert.equal(desktop.providerId, "builtin:bigmodel-coding-plan");
  assert.equal(desktop.defaultModel, "GLM-5.3");

  const runtime = prepareZCodeRuntime({ desktop, storageRoot });
  const written = fs.readFileSync(runtime.configPath, "utf8");
  assert.doesNotMatch(written, /secret-desktop-token/);
  assert.match(written, /builtin:bigmodel-coding-plan\/GLM-5\.3/);
  assert.equal(runtime.env.ZCODE_API_KEY, "secret-desktop-token");
  assert.equal(runtime.selectedModel, "GLM-5.3");

  const models = zcodeModelsFromDesktop(desktop);
  assert.equal(models.length, 2);
  assert.equal(models[0].isDefault, true);
  assert.deepEqual(models[0].supportedReasoningEfforts, []);
  assert.deepEqual(models[0].advertisedReasoningEfforts, ["low", "high", "max"]);
  assert.equal(models[1].capabilities.vision, true);
});

test("builds fresh and resumed headless ZCode invocations", () => {
  assert.deepEqual(
    buildZCodeRunArgs("Do work", { cwd: "C:\\work", mode: "yolo" }),
    [
      "--prompt",
      "Do work",
      "--json",
      "--cwd",
      "C:\\work",
      "--mode",
      "yolo",
    ],
  );
  assert.deepEqual(
    buildZCodeRunArgs("Continue", {
      cwd: "C:\\work",
      mode: "build",
      sessionId: "sess_1",
    }),
    [
      "--prompt",
      "Continue",
      "--json",
      "--cwd",
      "C:\\work",
      "--mode",
      "build",
      "--resume",
      "sess_1",
    ],
  );
});

test("normalizes ZCode JSON output, session identity, and usage", () => {
  const normalized = normalizeZCodeEvents([
    { sessionId: "sess_1", type: "session" },
    { message: { content: [{ type: "text", text: "working" }] } },
    {
      result: {
        status: "completed",
        text: "final report",
        usage: {
          inputTokens: 12,
          outputTokens: 4,
          reasoningTokens: 2,
          totalTokens: 18,
        },
      },
    },
  ]);
  assert.equal(normalized.sessionId, "sess_1");
  assert.equal(normalized.finalText, "final report");
  assert.equal(normalized.status, "completed");
  assert.equal(normalized.usage.total_tokens, 18);
});

test("parses ZCode pretty-printed JSON output", () => {
  const events = parseZCodeOutput(
    JSON.stringify(
      {
        sessionId: "sess_pretty",
        response: "done",
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      },
      null,
      2,
    ),
  );
  const normalized = normalizeZCodeEvents(events);
  assert.equal(normalized.sessionId, "sess_pretty");
  assert.equal(normalized.finalText, "done");
  assert.equal(normalized.usage.total_tokens, 3);
});

test("missing desktop model configuration remains unavailable", async () => {
  const scriptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acp-zcode-cli-"));
  const scriptPath = path.join(scriptRoot, "zcode.cjs");
  fs.writeFileSync(
    scriptPath,
    "if (process.argv.includes('--version')) console.log('0.16.3');\n",
  );
  const executor = new ZCodeExecutor({
    command: scriptPath,
    desktopRoot: path.join(scriptRoot, "missing"),
    storageRoot: path.join(scriptRoot, "runtime"),
  });
  const result = await executor.probe();
  assert.equal(result.available, false);
  assert.equal(result.reason, "not_configured");
});
