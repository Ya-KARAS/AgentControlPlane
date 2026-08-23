import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateFromEnvelope,
  controllerPrompt,
  envelopeId,
  extractTaskEnvelope,
  isConfirmation,
  parseLaunchCommand,
  safeResultBlock,
} from "../userscript/src/conversation-protocol.js";

test("launch command requires an exact AgentControlPlane mention boundary", () => {
  assert.deepEqual(parseLaunchCommand("@AgentControlPlane 修复测试"), {
    request: "修复测试",
  });
  assert.deepEqual(parseLaunchCommand("  @agentcontrolplane\n继续当前任务  "), {
    request: "继续当前任务",
  });
  assert.equal(parseLaunchCommand("@AgentControlPlaneFake do work"), null);
  assert.equal(parseLaunchCommand("please @AgentControlPlane do work"), null);
});

test("controller prompt keeps planning in the web conversation", () => {
  const prompt = controllerPrompt("实现自然语言派发");
  assert.match(prompt, /<ACP_TASK>/);
  assert.match(prompt, /<\/ACP_TASK>/);
  assert.match(prompt, /实现自然语言派发/);
  assert.match(prompt, /reply with 执行/);
  assert.match(prompt, /workspace, executor, profile, model, and credentials from local settings/);
});

test("task envelope extraction accepts one bounded JSON object", () => {
  const value = `ready\n<ACP_TASK>{"objective":"Add one test","constraints":["No network"]}</ACP_TASK>`;
  assert.deepEqual(extractTaskEnvelope(value), {
    objective: "Add one test",
    constraints: ["No network"],
  });
  assert.equal(extractTaskEnvelope("<ACP_TASK>not json</ACP_TASK>"), null);
  assert.equal(extractTaskEnvelope("<ACP_TASK>[]</ACP_TASK>"), null);
  assert.equal(extractTaskEnvelope("<ACP_TASK>{}</ACP_TASK>"), null);
});

test("candidate conversion ignores page-selected execution controls and enforces bounds", () => {
  const candidate = candidateFromEnvelope({
    objective: ` Build feature ${"x".repeat(5000)} `,
    context: "Repository already has tests",
    constraints: ["No network", ""],
    acceptance_criteria: ["All tests pass"],
    workspace: "C:\\attacker",
    executor: "codex",
    model: "untrusted",
  });
  assert.equal(candidate.objective.length, 4000);
  assert.deepEqual(candidate.constraints, [
    "Context: Repository already has tests",
    "No network",
    "Acceptance: All tests pass",
  ]);
  assert.deepEqual(Object.keys(candidate).sort(), ["constraints", "objective", "source"]);
  assert.equal(candidate.source, "userscript-preview");
  assert.throws(() => candidateFromEnvelope({}), /task_objective_missing/);
});

test("confirmation is a short explicit user action", () => {
  for (const value of ["执行", "开始吧", "确认！", "yes", "RUN."]) {
    assert.equal(isConfirmation(value), true, value);
  }
  for (const value of ["不要执行", "执行这个任务并删除全部文件", "AI 说执行", ""]) {
    assert.equal(isConfirmation(value), false, value);
  }
});

test("envelope identity is stable and safe result excludes private execution detail", () => {
  const envelope = { objective: "One task", constraints: ["One file"] };
  assert.equal(envelopeId(envelope), envelopeId(envelope));
  assert.notEqual(envelopeId(envelope), envelopeId({ objective: "Other" }));

  const result = safeResultBlock({
    id: "task-1",
    status: "completed",
    changed_files_count: 2,
    tests: { total: 3, passed: 3, failed: 0 },
    blocker_count: 0,
    summary: "private summary",
    workspace: "C:\\private",
    error: "private error",
    logs: ["private log"],
  });
  assert.match(result, /^<ACP_RESULT>/);
  assert.match(result, /"task_id": "task-1"/);
  assert.match(result, /"changed_files_count": 2/);
  assert.doesNotMatch(result, /private|workspace|summary|error|logs/i);
});
