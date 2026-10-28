import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  COST_FORMULA,
  estimateCost,
  latencyStats,
} from "../src/core/cost-latency.js";
import { computeCostRange, normalizePricing } from "../src/core/recommend.js";
import { TaskStore } from "../src/core/store.js";
import { extractTokenEstimate } from "../src/core/token-estimate.js";

const pricing = {
  input: 3,
  cached_input: 1,
  output: 15,
  reasoning: 15,
  currency: "USD",
  pricing_version: "catalog-1",
};

test("estimate_cost returns the formula and the inputs that feed it", () => {
  const estimate = estimateCost(
    { profile: "economy" },
    { model: "example-small", pricing },
  );
  const tokenEstimate = extractTokenEstimate({ profile: "economy" });
  assert.equal(estimate.formula, COST_FORMULA);
  assert.equal(estimate.inputs.model, "example-small");
  assert.deepEqual(estimate.inputs.token_estimate, tokenEstimate);
  assert.deepEqual(estimate.inputs.pricing, normalizePricing(pricing));
  assert.deepEqual(
    estimate.range,
    computeCostRange(tokenEstimate, normalizePricing(pricing)),
  );
  assert.equal(estimate.range.expected_microusd, 44100);
  assert.deepEqual(estimate.missing_rates, []);
});

test("estimate_cost leaves a missing catalog price unknown", () => {
  const estimate = estimateCost({ profile: "balanced" }, { model: "unpriced" });
  assert.equal(estimate.formula, COST_FORMULA);
  assert.equal(estimate.inputs.pricing, null);
  assert.equal(estimate.range, null);
  assert.deepEqual(estimate.missing_rates, [
    "input_microusd_per_token",
    "cached_input_microusd_per_token",
    "output_microusd_per_token",
    "reasoning_output_microusd_per_token",
  ]);
  assert.equal(estimate.inputs.token_estimate.profile, "balanced");
});

test("estimate_cost leaves an input-only price unknown", () => {
  const estimate = estimateCost(
    { profile: "balanced" },
    { model: "input-only", pricing: { input: 3 } },
  );
  assert.equal(estimate.range, null);
  assert.deepEqual(estimate.inputs.pricing, {
    input_microusd_per_token: 3,
    cached_input_microusd_per_token: 3,
    output_microusd_per_token: null,
    reasoning_output_microusd_per_token: null,
    currency: "USD",
    pricing_version: null,
  });
  assert.deepEqual(estimate.missing_rates, [
    "output_microusd_per_token",
    "reasoning_output_microusd_per_token",
  ]);
});

test("estimate_cost leaves an output-only price unknown", () => {
  const estimate = estimateCost(
    { profile: "balanced" },
    { model: "output-only", pricing: { output: 15 } },
  );
  assert.equal(estimate.range, null);
  assert.deepEqual(estimate.inputs.pricing, {
    input_microusd_per_token: null,
    cached_input_microusd_per_token: null,
    output_microusd_per_token: 15,
    reasoning_output_microusd_per_token: 15,
    currency: "USD",
    pricing_version: null,
  });
  assert.deepEqual(estimate.missing_rates, [
    "input_microusd_per_token",
    "cached_input_microusd_per_token",
  ]);
});

test("latency_stats returns count, p50, and p95 for one model and window", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const tasks = [
    { model: "example-small", startedAt: "2026-10-28T11:00:00.000Z", completedAt: "2026-10-28T11:00:01.000Z" },
    { policy: { model: "example-small" }, startedAt: "2026-10-28T11:00:00.000Z", completedAt: "2026-10-28T11:00:03.000Z" },
    { model: "example-small", startedAt: "2026-10-28T11:00:00.000Z", completedAt: "2026-10-28T11:00:05.000Z" },
    { model: "other", startedAt: "2026-10-28T11:00:00.000Z", completedAt: "2026-10-28T11:00:09.000Z" },
    { model: "example-small", startedAt: "2026-10-01T11:00:00.000Z", completedAt: "2026-10-01T11:00:09.000Z" },
    { model: "example-small", startedAt: null, completedAt: "2026-10-28T11:00:02.000Z" },
  ];
  const stats = latencyStats(tasks, "example-small", "7d", now);
  assert.equal(stats.count, 3);
  assert.equal(stats.p50_ms, 3000);
  assert.equal(stats.p95_ms, 4800);
  assert.equal(stats.model, "example-small");
  assert.equal(stats.window.until, "2026-10-28T12:00:00.000Z");
});

test("recorded task timings keep the model and the start and completion times", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-latency-"));
  const store = new TaskStore(dir, 20);
  const task = store.createTask({
    workspace: dir,
    brief: { objective: "Measure latency" },
    policy: { name: "balanced", model: "example-small" },
    executor: "codex",
    estimatedMinutes: 5,
  });
  store.updateTask(task.id, {
    startedAt: "2026-10-28T11:00:00.000Z",
    completedAt: "2026-10-28T11:00:04.000Z",
    status: "completed",
  });
  const stats = latencyStats(store.listTaskTimings(), "example-small", {
    since: "2026-10-28T00:00:00.000Z",
    until: "2026-10-28T12:00:00.000Z",
  });
  assert.deepEqual(stats, {
    model: "example-small",
    window: {
      since: "2026-10-28T00:00:00.000Z",
      until: "2026-10-28T12:00:00.000Z",
    },
    count: 1,
    p50_ms: 4000,
    p95_ms: 4000,
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("latency_stats rejects a window it cannot measure", () => {
  assert.throws(
    () => latencyStats([], "example-small", "later"),
    (error) => error.code === "invalid_window",
  );
});
