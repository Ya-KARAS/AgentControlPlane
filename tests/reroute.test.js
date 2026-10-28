import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExecutionReportObject } from "../src/core/execution-report.js";
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

test("normalized failure evidence still blocks quota and rate-limit reroute", () => {
  const cases = [
    [{ command: "unit", status: "error", detail: "Compilation failed" }],
    [{ command: "lint", status: "blocked", detail: "waiting" }],
    [{ command: "live", status: "skipped", detail: "Not executed" }],
    ["npm test failed"],
    [{ command: "live", status: "not_run", detail: "Previous: 4 failed" }],
  ];
  for (const tests of cases) {
    const result = normalizeExecutionReportObject({
      status: "failed",
      summary: "Stopped before the task could finish",
      changed_files: [],
      tests,
      blockers: [],
      next_action: null,
    });
    assert.equal(
      classifyExecutorFailure({ status: 402, message: "quota exhausted" }, { result }),
      "task_failure",
      JSON.stringify(result),
    );
    assert.equal(
      classifyExecutorFailure({ status: 429, message: "rate limit exceeded" }, { result }),
      "task_failure",
      JSON.stringify(result),
    );
  }
});

test("unproven test entries stay task failures for quota and rate limits", () => {
  const cases = [
    ["npm test exited with code 1"],
    ["not ok 1 - expected 200, got 500"],
    ["✖ 3 of 10 tests"],
    ["npm test"],
    [{ command: "npm test", detail: "exit code 1" }],
    [{ command: "unit", status: "passed", detail: "exit code 1" }],
    [{ command: "unit", status: "passed", detail: "not ok 1" }],
    [{ command: "unit", status: "passed", detail: "✖ 1 of 2 tests" }],
  ];
  for (const tests of cases) {
    const result = normalizeExecutionReportObject({
      status: "failed",
      summary: "Stopped before the task could finish",
      changed_files: [],
      tests,
      blockers: [],
      next_action: null,
    });
    assert.equal(
      classifyExecutorFailure({ status: 402, message: "quota exhausted" }, { result }),
      "task_failure",
      JSON.stringify(result),
    );
    assert.equal(
      classifyExecutorFailure({ status: 429, message: "rate limit exceeded" }, { result }),
      "task_failure",
      JSON.stringify(result),
    );
  }
  const missing = resultFrom([{ command: "npm test", detail: "exit code 1" }]);
  assert.equal(missing.tests[0].status, "unknown");
});

function resultFrom(tests, summary = "Stopped before the task could finish") {
  return normalizeExecutionReportObject({
    status: "failed",
    summary,
    changed_files: [],
    tests,
    blockers: [],
    next_action: null,
  });
}

test("plural summaries, negated passes, and exit status stay task failures", () => {
  const cases = [
    {
      summary: "Tests failed: expected 200, got 429",
      tests: [{ command: "lint", status: "passed", detail: "ok" }],
    },
    {
      summary: "Builds failed before packaging",
      tests: [{ command: "lint", status: "passed", detail: "ok" }],
    },
    {
      summary: "Stopped before the task could finish",
      tests: ["npm test has not passed"],
    },
    {
      summary: "Stopped before the task could finish",
      tests: ["npm test not passed"],
    },
    {
      summary: "Stopped before the task could finish",
      tests: ["npm test didn't pass"],
    },
    {
      summary: "Stopped before the task could finish",
      tests: [{ command: "unit", status: "passed", detail: "10 passed; exit status 1" }],
    },
    {
      summary: "Stopped before the task could finish",
      tests: [{ command: "unit", status: "passed", detail: "exited with status 2" }],
    },
    {
      summary: "Stopped before the task could finish",
      tests: [{ command: "unit", status: "passed", detail: "returned non-zero" }],
    },
    {
      summary: "Stopped before the task could finish",
      tests: [{ command: "unit", status: "passed", detail: "code 1" }],
    },
  ];
  for (const { summary, tests } of cases) {
    const result = resultFrom(tests, summary);
    for (const error of [
      { status: 402, message: "quota exhausted" },
      { status: 429, message: "rate limit exceeded" },
    ]) {
      assert.equal(
        classifyExecutorFailure(error, { result }),
        "task_failure",
        JSON.stringify({ error, result }),
      );
    }
  }
});

test("zero failure counts in details and summaries stay benign", () => {
  const infoFail = "\u2139 fail 0";
  for (const tests of [
    ["npm test passed (0 failed)"],
    ["npm test passed (0 failing)"],
    [{ command: "unit", status: "passed", detail: infoFail }],
    [{ command: "unit", status: "passed", detail: "no errors" }],
    [{ command: "unit", status: "not_run", detail: "Previous: 0 failed" }],
  ]) {
    const result = resultFrom(tests);
    assert.equal(
      classifyExecutorFailure({ status: 402, message: "quota exhausted" }, { result }),
      "quota_exhausted",
      JSON.stringify(result),
    );
  }
  for (const summary of [
    "npm test passed (0 failed)",
    `node --test\n${infoFail}`,
    "mocha: 0 failing",
    "test reported no errors",
  ]) {
    const result = resultFrom(
      [{ command: "unit", status: "passed", detail: "3 passed" }],
      summary,
    );
    assert.equal(
      classifyExecutorFailure({ status: 429, message: "rate limit exceeded" }, { result }),
      "rate_limited",
      summary,
    );
  }
});

test("a zero failure count stays benign after normalization", () => {
  for (const tests of [
    ["npm test passed (0 failed)"],
    [{ command: "unit", status: "passed", detail: "npm test passed (0 failed)" }],
    [{ command: "live", status: "not_run", detail: "Previous: 0 failed" }],
  ]) {
    const result = normalizeExecutionReportObject({
      status: "failed",
      summary: "Stopped before the task could finish",
      changed_files: [],
      tests,
      blockers: [],
      next_action: null,
    });
    assert.equal(
      classifyExecutorFailure({ status: 402, message: "quota exhausted" }, { result }),
      "quota_exhausted",
      JSON.stringify(result),
    );
    assert.equal(
      classifyExecutorFailure({ status: 429, message: "rate limit exceeded" }, { result }),
      "rate_limited",
      JSON.stringify(result),
    );
  }
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
