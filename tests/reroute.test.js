import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyExecutorFailure,
  evaluateExecutorCompatibility,
  resolveRerouteConfig,
  snapshotExecutorCapabilities,
} from "../src/core/reroute.js";

test("classifies only allowed infrastructure failures for reroute", () => {
  assert.equal(classifyExecutorFailure({ status: 429 }), "rate_limited");
  assert.equal(
    classifyExecutorFailure({ code: "insufficient_balance", status: 402 }),
    "quota_exhausted",
  );
  assert.equal(
    classifyExecutorFailure({ status: 401, code: "invalid_api_key" }),
    "authentication_unavailable",
  );
  assert.equal(
    classifyExecutorFailure({ status: 503, message: "upstream error" }),
    "provider_unavailable",
  );
  assert.equal(
    classifyExecutorFailure({ code: "ENOENT", message: "spawn failed" }),
    "executor_unavailable",
  );
});

test("test, build, implementation, and validation evidence never reroute", () => {
  for (const label of ["test", "build", "implementation", "validation"]) {
    assert.equal(
      classifyExecutorFailure(
        { status: 503 },
        { result: { status: "failed", tests: [`${label} failed`] } },
      ),
      "task_failure",
    );
  }
  assert.equal(
    classifyExecutorFailure({ message: "ordinary coding failure" }),
    "task_failure",
  );
});

test("passed or not_run tests do not mask quota or rate-limit failures", () => {
  const benignTests = [
    { command: "unit", status: "passed", detail: "3 passed" },
    { command: "live", status: "not_run", detail: "Not executed" },
    "npm test passed",
    "not_run",
  ];
  assert.equal(
    classifyExecutorFailure(
      { status: 402, code: "insufficient_balance", message: "quota exhausted" },
      {
        result: {
          status: "failed",
          summary: "Stopped before the task could finish",
          tests: benignTests,
          blockers: [],
        },
      },
    ),
    "quota_exhausted",
  );
  assert.equal(
    classifyExecutorFailure(
      { status: 429, message: "rate limit exceeded" },
      {
        result: {
          status: "blocked",
          summary: "Stopped before the task could finish",
          tests: [
            { command: "unit", status: "passed" },
            { command: "live", status: "not_run" },
          ],
        },
      },
    ),
    "rate_limited",
  );
  assert.equal(
    classifyExecutorFailure(
      { message: "ordinary coding failure" },
      { result: { tests: [{ command: "unit", status: "passed" }] } },
    ),
    "task_failure",
  );
});

test("failed, error, or blocked tests stay task failures despite a quota hint", () => {
  for (const status of ["failed", "error", "blocked"]) {
    assert.equal(
      classifyExecutorFailure(
        { status: 402, message: "quota exhausted" },
        {
          result: {
            status: "failed",
            summary: "quota exhausted",
            tests: [{ command: "unit", status, detail: "1 failed" }],
          },
        },
      ),
      "task_failure",
    );
  }
  assert.equal(
    classifyExecutorFailure(
      { status: 429, message: "rate limit exceeded" },
      {
        result: {
          tests: [
            { command: "unit", status: "passed" },
            { command: "integration", status: "failed" },
            { command: "live", status: "not_run", detail: "Previous: 4 failed" },
          ],
        },
      },
    ),
    "task_failure",
  );
  assert.equal(
    classifyExecutorFailure(
      { status: 429, message: "rate limit exceeded" },
      {
        result: {
          summary: "validation failed",
          tests: [{ command: "unit", status: "passed" }],
        },
      },
    ),
    "task_failure",
  );
});

test("reroute config is disabled by default and validates its guardrails", () => {
  const defaults = resolveRerouteConfig();
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.max_reroutes, 2);
  assert.deepEqual(defaults.allowed_reasons, [
    "quota_exhausted",
    "rate_limited",
    "executor_unavailable",
    "authentication_unavailable",
    "provider_unavailable",
  ]);
  assert.throws(
    () => resolveRerouteConfig({ enabled: true, max_reroutes: 11 }),
    /max_reroutes/,
  );
  assert.throws(
    () => resolveRerouteConfig({ allowed_reasons: ["test_failure"] }),
    /unsupported reason/,
  );
});

test("capability snapshots distinguish CLI tooling from model endpoints", () => {
  const cli = snapshotExecutorCapabilities({
    id: "opencode",
    kind: "cli",
    ready: true,
    capabilities: { persistentThreads: true },
  });
  assert.equal(cli.tools, true);
  assert.equal(cli.filesystem, true);
  assert.equal(cli.source, "cli");

  const endpoint = snapshotExecutorCapabilities(
    {
      id: "relay",
      kind: "model-endpoint",
      capabilities: { tokenUsage: true },
    },
    {
      model: "model-a",
      catalog: [
        {
          id: "model-a",
          context: 128000,
          capabilities: { tools: true, vision: false, reasoning: true },
        },
      ],
      discovery: { available: true },
    },
  );
  assert.equal(endpoint.tools, true);
  assert.equal(endpoint.vision, false);
  assert.equal(endpoint.context_tokens, 128000);
  assert.equal(endpoint.source, "model_catalog");
});

test("capability gate enforces verified tools and vision while allowing unknown context", () => {
  const requirements = {
    tools_required: true,
    vision_required: false,
    reasoning_level: "high",
    minimum_context_tokens: 64000,
    required_protocols: [],
  };
  const compatible = evaluateExecutorCompatibility(requirements, {
    available: true,
    tools: true,
    reasoning: true,
    context_tokens: null,
  });
  assert.equal(compatible.compatible, true);
  assert.ok(compatible.warnings.includes("context_unknown"));

  assert.deepEqual(
    evaluateExecutorCompatibility(requirements, {
      available: true,
      tools: null,
      reasoning: true,
      context_tokens: 128000,
    }).reasons,
    ["tools_unverified"],
  );
  assert.ok(
    evaluateExecutorCompatibility(
      { ...requirements, vision_required: true },
      {
        available: true,
        tools: true,
        vision: false,
        reasoning: true,
        context_tokens: 128000,
      },
    ).reasons.includes("vision_unsupported"),
  );
  assert.ok(
    evaluateExecutorCompatibility(requirements, {
      available: true,
      tools: true,
      reasoning: true,
      context_tokens: 32000,
    }).reasons.includes("context_insufficient"),
  );
});
