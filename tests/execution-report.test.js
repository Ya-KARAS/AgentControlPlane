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
    tests: [{ command: "7", status: "not_run", detail: "9" }],
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
