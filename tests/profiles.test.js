import assert from "node:assert/strict";
import test from "node:test";
import {
  inferProfileFromObjective,
  resolveProfile,
  resolveEndpointModel,
  estimateTaskMinutes,
} from "../src/core/profiles.js";

test("infers an automatic profile from task scope", () => {
  assert.equal(inferProfileFromObjective("写一个 hello 示例"), "economy");
  assert.equal(inferProfileFromObjective("给接口增加参数校验"), "balanced");
  assert.equal(inferProfileFromObjective("重构整个模块的架构"), "deep");
});

const config = {
  codex: { defaultModel: null },
  limits: { maxTokenBudget: 250000 },
  profiles: {
    economy: {
      model: "fast-model",
      effort: "low",
      maxSubagents: 0,
      tokenBudget: 30000,
      summary: "concise",
    },
  },
};

const catalog = [
  {
    id: "fast-model",
    model: "fast-model",
    isDefault: true,
    supportedReasoningEfforts: [
      { reasoningEffort: "low" },
      { reasoningEffort: "medium" },
    ],
  },
];

test("accepts an advertised model and effort", () => {
  const profile = resolveProfile(config, { profile: "economy" }, catalog);
  assert.equal(profile.model, "fast-model");
  assert.equal(profile.effort, "low");
});

test("rejects a model not advertised by Codex", () => {
  assert.throws(
    () =>
      resolveProfile(
        config,
        { profile: "economy", model: "broken-alias" },
        catalog,
      ),
    (error) => error.code === "unknown_model",
  );
});

test("rejects token budgets above the server maximum", () => {
  assert.throws(
    () =>
      resolveProfile(
        config,
        { profile: "economy", token_budget: 250001 },
        catalog,
      ),
    (error) => error.code === "invalid_token_budget",
  );
});

test("accepts and validates per-task time limits", () => {
  const limited = resolveProfile(
    config,
    { profile: "economy", time_limit_minutes: 10 },
    catalog,
  );
  assert.equal(limited.timeLimitMinutes, 10);
  assert.equal(
    resolveProfile(config, { profile: "economy" }, catalog).timeLimitMinutes,
    null,
  );
  assert.throws(
    () =>
      resolveProfile(
        config,
        { profile: "economy", time_limit_minutes: 0 },
        catalog,
      ),
    (error) => error.code === "invalid_time_limit",
  );
  assert.throws(
    () =>
      resolveProfile(
        config,
        { profile: "economy", time_limit_minutes: 241 },
        catalog,
      ),
    (error) => error.code === "invalid_time_limit",
  );
});

test("validates models for model-endpoint executors", () => {
  assert.equal(
    resolveEndpointModel("deepseek", "deepseek-chat", ["deepseek-chat", "deepseek-reasoner"]),
    "deepseek-chat",
  );
  assert.throws(
    () =>
      resolveEndpointModel("deepseek", "deepseek-v4-pro", ["deepseek-chat", "deepseek-reasoner"]),
    (error) => error.code === "unknown_model",
  );
  assert.equal(resolveEndpointModel("deepseek", null, ["deepseek-chat"]), null);
});

test("estimates task minutes from profile and time limit", () => {
  assert.equal(estimateTaskMinutes("economy"), 2);
  assert.equal(estimateTaskMinutes("balanced"), 5);
  assert.equal(estimateTaskMinutes("deep"), 12);
  assert.equal(estimateTaskMinutes("balanced", 3), 3);
  assert.equal(estimateTaskMinutes("economy", 10), 2);
});
