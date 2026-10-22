import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";
import { normalizeExecutionReportText } from "../src/core/execution-report.js";

function report(overrides = {}) {
  return {
    status: "completed",
    summary: "Finished the task.",
    changed_files: [],
    tests: [],
    blockers: [],
    next_action: null,
    ...overrides,
  };
}

// Exercise the real completion path without a provider, subprocess or model call.
class ReportExecutor extends EventEmitter {
  constructor(text) {
    super();
    this.text = text;
    this.ready = false;
  }
  async start() { this.ready = true; }
  async listModels() {
    return { data: [{ id: "fake-model", model: "fake-model", isDefault: true }] };
  }
  async getSandboxReadiness() { return { status: "ready" }; }
  async startThread() { return { thread: { id: "thread-1" } }; }
  async setGoal() { return {}; }
  async getGoal() { return {}; }
  async startTurn() {
    setImmediate(() => this.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "completed",
          items: [{ type: "agentMessage", phase: "final_answer", text: this.text }],
        },
      },
    }));
    return { turn: { id: "turn-1" } };
  }
  respond() {}
}

async function completeReport(t, text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const store = new TaskStore(path.join(root, "state"), 20);
  const config = {
    workspaceRoots: [root],
    codex: {
      approvalPolicy: "never", sandbox: "workspace-write",
      networkAccess: false, defaultModel: null,
    },
    profiles: {
      economy: {
        model: "fake-model", effort: "medium", maxSubagents: 0,
        tokenBudget: 30000, summary: "concise",
      },
    },
    limits: {
      maxBriefCharacters: 24000, maxConcurrentTasks: 1, maxQueuedTasks: 10,
      maxTokenBudget: 250000, maxStoredEventsPerTask: 20, maxTaskRuntimeMinutes: 1,
    },
    reroute: { enabled: false },
  };
  const orchestrator = new Orchestrator({ config, store, codex: new ReportExecutor(text) });
  await orchestrator.start();
  const task = orchestrator.dispatch({ workspace, objective: "Read-only report fixture", profile: "economy" });
  const deadline = Date.now() + 2000;
  while (["queued", "running"].includes(store.getTask(task.id)?.status)) {
    assert.ok(Date.now() < deadline, "report completion timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return store.getTask(task.id);
}

for (const status of ["failed", "blocked", "error", "partial", "cancelled"]) {
  for (const omitted of [null, "next_action", "summary", "changed_files", "tests", "blockers"]) {
    test(`completion preserves ${status} with ${omitted ? `missing ${omitted}` : "all fields"}`, async (t) => {
      const input = report({ status, summary: "Permission denied", blockers: ["Permission denied"] });
      if (omitted) delete input[omitted];
      const task = await completeReport(t, JSON.stringify(input));
      const expected = status === "error" ? "failed" : status;
      assert.equal(task.status, expected);
      assert.equal(task.result.status, expected);
      assert.deepEqual(task.result.blockers, input.blockers ?? []);
      assert.equal(task.result.summary, input.summary ?? "");
      assert.equal(task.result.next_action, null);
    });
  }
}

for (const status of ["failed", "blocked", "error", "partial", "cancelled"]) {
  test(`adapter-normalized minimal ${status} report preserves failure evidence`, async (t) => {
    const text = `Verification note.\n${JSON.stringify({ status, summary: "Stopped", blockers: ["Access denied"] })}\nEnd.`;
    const task = await completeReport(t, normalizeExecutionReportText(text));
    assert.equal(task.status, status === "error" ? "failed" : status);
    assert.deepEqual(task.result.blockers, ["Access denied"]);
  });
}

for (const [name, text] of [
  ["incomplete completed report", JSON.stringify({ status: "completed", summary: "Done" })],
  ["incomplete success report", JSON.stringify({ status: "success", summary: "Done" })],
  ["unknown status", JSON.stringify(report({ status: "unknown" }))],
  ["missing status", JSON.stringify({ summary: "Done", changed_files: [], tests: [], blockers: [], next_action: null })],
  ["invalid field type", JSON.stringify(report({ tests: null }))],
  ["truncated JSON", '{"status":"completed","summary":"Done"'],
  ["malformed failure JSON", '{"status":"blocked","summary":"Denied","blockers":["Denied"],}'],
  ["mixed malformed JSON", 'Stopped.\n{"status":"completed","summary":"Done",}\nEnd.'],
  ["unrelated JSON", '{"note":"not an execution report"}'],
  ["mixed unrelated JSON", 'A note: {"note":"not an execution report"}.'],
  ["fenced unrelated JSON", '```json\n{"note":"not an execution report"}\n```'],
  ["JSON array", '[{"note":"not an execution report"}]'],
  ["JSON primitive", 'null'],
  ["unrelated JSON containing an example report", JSON.stringify({ note: "example only", example: report() })],
  ["array containing an example report", JSON.stringify([report()])],
  ["invalid final report after earlier success", `Before.\n${JSON.stringify(report())}\n${JSON.stringify(report({ status: "unknown" }))}`],
  ["malformed final report after earlier success", `Before.\n${JSON.stringify(report())}\n{"status":"blocked","summary":"Denied",}`],
  ["status-only final report after earlier success", `Before.\n${JSON.stringify(report())}\nFinal result: {"status":"blocked"}`],
  ["truncated final report after earlier success", `Before.\n${JSON.stringify(report())}\n{"status":"failed","summary":`],
  ["mixed bare-key malformed report", 'Final status: {status:"failed"}'],
  ["mixed single-quoted malformed report", "Final status: {'status':'failed'}"],
  ["mixed wrapper containing an example report", `Example only: ${JSON.stringify({ example: report() })}`],
  ["mixed array containing an example report", `Examples only: ${JSON.stringify([report()])}`],
  ["malformed report with metadata before status", `Before.\n${JSON.stringify(report())}\n{"provider":"x","status":"blocked","summary":"Denied",}`],
  ["malformed mixed wrapper containing nested success", `Note: {"example":${JSON.stringify(report())},} End.`],
  ["mixed truncated quoted key", 'Final: {"status"'],
  ["mixed unrelated JSON array", "Output: [1, 2, 3]"],
]) {
  test(`completed transport does not promote ${name} to completed task`, async (t) => {
    const task = await completeReport(t, text);
    assert.equal(task.status, "failed");
    assert.equal(task.result.status, "failed");
    assert.equal(task.result.summary, text);
  });
}

for (const status of ["completed", "success"]) {
  test(`valid ${status} report still completes through adapter normalization`, async (t) => {
    const input = report({
      status,
      summary: 'Wrote {one} file with an escaped quote: "ok"',
      tests: [{ command: "node --test", status: "passed", detail: null }],
    });
    const text = `Verified.\n\`\`\`json\n${JSON.stringify(input)}\n\`\`\`\nFinished.`;
    const task = await completeReport(t, normalizeExecutionReportText(text));
    assert.equal(task.status, "completed");
    assert.deepEqual(task.result, { ...input, status: "completed" });
  });
}

for (const [text, status] of [
  ["Finished the requested change.", "completed"],
  ["Status: blocked. Waiting for access.", "blocked"],
  ["Status: failed. Tests did not pass.", "failed"],
  ["Status: partial. One step remains.", "partial"],
  ["Finished {example} file [verified].", "completed"],
  ["{example} file [verified].", "completed"],
  ["[verified] Finished the requested change.", "completed"],
]) {
  test(`natural-language ${status} response remains compatible`, async (t) => {
    const task = await completeReport(t, text);
    assert.equal(task.status, status);
    assert.equal(task.result.summary, text);
  });
}
