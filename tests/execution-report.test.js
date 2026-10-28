import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXECUTION_REPORT_INSTRUCTION,
  extractExecutionReportObject,
  normalizeExecutionReportObject,
  normalizeExecutionReportText,
} from "../src/core/execution-report.js";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function report(overrides = {}) {
  return {
    status: "completed",
    summary: "done",
    changed_files: ["result.txt"],
    tests: [{ command: "node --test", status: "passed", detail: null }],
    blockers: [],
    next_action: null,
    ...overrides,
  };
}

test("execution report instruction is shared by every executor", () => {
  assert.match(EXECUTION_REPORT_INSTRUCTION, /status/);
  assert.match(EXECUTION_REPORT_INSTRUCTION, /next_action/);
});

test("all executors and the orchestrator use the shared report contract", () => {
  const executors = [
    "claude-code-executor.js",
    "kimi-code-executor.js",
    "openai-compatible-executor.js",
    "opencode-executor.js",
    "zcode-executor.js",
  ];
  for (const file of executors) {
    const source = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "src", "executors", file),
      "utf8",
    );
    assert.match(source, /normalizeExecutionReportText/);
    assert.match(source, /EXECUTION_REPORT_INSTRUCTION/);
    assert.doesNotMatch(source, /#normalizeReport\s*\(/);
  }

  const orchestrator = fs.readFileSync(
    path.join(REPOSITORY_ROOT, "src", "core", "orchestrator.js"),
    "utf8",
  );
  assert.match(orchestrator, /extractExecutionReportObject/);
  assert.match(orchestrator, /normalizeExecutionReportObject/);
  assert.doesNotMatch(orchestrator, /JSON\.parse\(finalText\)/);
});

test("normalizes a direct structured report", () => {
  const normalized = normalizeExecutionReportObject(
    report({
      status: "success",
      changed_files: [42],
      tests: [{ command: 7, status: "unknown", detail: 9 }],
      blockers: [false],
      next_action: 11,
    }),
  );

  assert.deepEqual(normalized, {
    status: "completed",
    summary: "done",
    changed_files: ["42"],
    tests: [{ command: "7", status: "unknown", detail: "9" }],
    blockers: ["false"],
    next_action: "11",
  });
});

test("extracts and normalizes a complete direct JSON report", () => {
  const directReport = report({ status: "success" });
  const text = JSON.stringify(directReport);

  assert.deepEqual(extractExecutionReportObject(text), directReport);
  assert.deepEqual(JSON.parse(normalizeExecutionReportText(text)), {
    ...directReport,
    status: "completed",
  });
});

test("preserves unrelated direct JSON instead of inventing a completed report", () => {
  const unrelated = '{"note":"not an execution report"}';
  assert.equal(extractExecutionReportObject(unrelated), null);
  assert.equal(normalizeExecutionReportText(unrelated), unrelated);
});

test("does not interpret incomplete direct report envelopes as reports", () => {
  const incompleteReports = [
    { status: "completed" },
    { status: "completed", summary: "done" },
    { ...report(), tests: null },
    { ...report(), next_action: 7 },
    { ...report(), status: "unknown" },
  ];
  for (const value of incompleteReports) {
    const text = JSON.stringify(value);
    assert.equal(extractExecutionReportObject(text), null, text);
    assert.equal(normalizeExecutionReportText(text), text);
  }
});

test("preserves JSON arrays and primitives without report objects", () => {
  for (const text of [
    '[{"note":"not a report"}]',
    "[]",
    "null",
    "42",
    '"done"',
    "true",
  ]) {
    assert.equal(extractExecutionReportObject(text), null, text);
    assert.equal(normalizeExecutionReportText(text), text);
  }
});

test("extracts the final structured report from mixed provider output", () => {
  const finalReport = report({
    summary: "Wrote {one} file with an escaped quote: \"ok\"",
  });
  const mixed = [
    "I verified the task.",
    '{"note":"not a report"}',
    JSON.stringify(finalReport),
    "Finished.",
  ].join("\n");

  assert.deepEqual(extractExecutionReportObject(mixed), finalReport);
  assert.deepEqual(JSON.parse(normalizeExecutionReportText(mixed)), finalReport);
});

test("extracts a fenced structured report", () => {
  const fenced = `Explanation before.\n\`\`\`json\n${JSON.stringify(report())}\n\`\`\`\nAfter.`;
  assert.deepEqual(
    JSON.parse(normalizeExecutionReportText(fenced)),
    report(),
  );
});

test("does not mistake unrelated mixed JSON for an execution report", () => {
  const mixed = 'Explanation with {"status":"completed"} but no report.';
  assert.equal(extractExecutionReportObject(mixed), null);
  assert.equal(normalizeExecutionReportText(mixed), mixed);
});

test("preserves failure statuses and string test evidence", () => {
  const normalized = normalizeExecutionReportObject(report({
    tests: [
      { command: "unit", status: "Error", detail: "Compilation failed" },
      { command: "lint", status: "blocked", detail: "waiting" },
      { command: "live", status: "skipped", detail: "Not executed" },
      { command: "unit", status: "passed", detail: "3 passed" },
      { command: "live", status: "not_run", detail: "Previous: 4 failed" },
      { command: "missing-status", detail: "Not executed" },
      "npm test failed",
      "npm test passed (0 failed)",
    ],
  }));
  assert.deepEqual(normalized.tests, [
    { command: "unit", status: "error", detail: "Compilation failed" },
    { command: "lint", status: "blocked", detail: "waiting" },
    { command: "live", status: "skipped", detail: "Not executed" },
    { command: "unit", status: "passed", detail: "3 passed" },
    { command: "live", status: "not_run", detail: "Previous: 4 failed" },
    { command: "missing-status", status: "not_run", detail: "Not executed" },
    "npm test failed",
    "npm test passed (0 failed)",
  ]);
});

test("maps error status to failed and supplies normalized defaults", () => {
  assert.deepEqual(
    normalizeExecutionReportObject({ status: "error", summary: "failed" }),
    {
      status: "failed",
      summary: "failed",
      changed_files: [],
      tests: [],
      blockers: [],
      next_action: null,
    },
  );
  assert.equal(normalizeExecutionReportText("  "), "{}");
});

test("normalization never invents completed for missing or unknown status", () => {
  for (const input of [null, {}, { note: "unrelated" }, report({ status: "unknown" })]) {
    assert.equal(normalizeExecutionReportObject(input).status, "failed");
  }
});

test("recovers non-success reports without accepting incomplete success envelopes", () => {
  for (const status of ["failed", "blocked", "error", "partial", "cancelled"]) {
    const input = { status, summary: "Stopped", blockers: ["Access denied"] };
    const text = `Before.\n${JSON.stringify(input)}\nAfter.`;
    assert.deepEqual(extractExecutionReportObject(text), input);
    const normalized = JSON.parse(normalizeExecutionReportText(text));
    assert.equal(normalized.status, status === "error" ? "failed" : status);
    assert.deepEqual(normalized.blockers, ["Access denied"]);
    assert.equal(normalized.next_action, null);
  }
});

test("does not extract example reports nested inside unrelated direct JSON", () => {
  for (const text of [JSON.stringify({ example: report() }), JSON.stringify([report()])]) {
    assert.equal(extractExecutionReportObject(text), null);
    assert.equal(normalizeExecutionReportText(text), text);
  }
});

test("does not substitute an earlier success for a rejected final report", () => {
  for (const rejected of [
    JSON.stringify(report({ status: "unknown" })),
    JSON.stringify({ status: "completed", summary: "Incomplete" }),
    '{"status":"blocked","summary":"Denied",}',
  ]) {
    const text = `Before.\n${JSON.stringify(report())}\n${rejected}`;
    assert.equal(extractExecutionReportObject(text), null);
    assert.equal(normalizeExecutionReportText(text), text);
  }
});

test("does not extract nested examples from mixed arrays or wrappers", () => {
  for (const example of [{ example: report() }, [report()]]) {
    const text = `Example only: ${JSON.stringify(example)}`;
    assert.equal(extractExecutionReportObject(text), null);
    assert.equal(normalizeExecutionReportText(text), text);
  }
});

test("rejects whole malformed JSON containers regardless of their first key", () => {
  for (const text of [
    `${JSON.stringify(report())}\n{"provider":"x","status":"blocked","summary":"Denied",}`,
    `Note: {"example":${JSON.stringify(report())},} End.`,
  ]) {
    assert.equal(extractExecutionReportObject(text), null);
    assert.equal(normalizeExecutionReportText(text), text);
  }
});
