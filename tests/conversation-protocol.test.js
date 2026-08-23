import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateFromEnvelope,
  controllerPrompt,
  envelopeId,
  executionSummary,
  extractTaskEnvelope,
  isChangeConfirmation,
  isConfirmation,
  parseLaunchCommand,
  safeResultBlock,
  taskEnvelopeChanges,
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
  const prompt = controllerPrompt("使用 acp-live-test、OpenCode 和 high", {
    current: {
      workspace: "acp-live-test",
      executor: "opencode",
      profile: "economy",
      model: null,
      reasoning_effort: "low",
    },
    workspaces: ["acp-live-test"],
    executors: [{ id: "opencode", display_name: "OpenCode" }],
    profiles: { economy: { reasoning_effort: "low" } },
    models: {
      opencode: [{
        id: "opencode-go/deepseek-v4-pro",
        reasoning_efforts: ["high", "max"],
      }],
    },
  });
  assert.match(prompt, /<ACP_TASK>/);
  assert.match(prompt, /<\/ACP_TASK>/);
  assert.match(prompt, /使用 acp-live-test、OpenCode 和 high/);
  assert.match(prompt, /reply with 执行/);
  assert.match(prompt, /opencode-go\/deepseek-v4-pro/);
  assert.match(prompt, /user may choose workspace, executor, profile, model, and reasoning effort/i);
  assert.match(prompt, /credentials always remain local/i);
  assert.match(prompt, /Never replace the requested engineering task with a smoke test/i);
  assert.match(prompt, /status is cooldown/i);
  assert.match(prompt, /reply with 确认变更/);
  assert.match(prompt, /Do not claim that execution started/i);
});

test("task changes require a distinct confirmation from execution", () => {
  const previous = {
    objective: "Build calculator",
    execution: { workspace: "acp-live-test", model: "model-a" },
  };
  const next = {
    objective: "Build smoke test",
    execution: { workspace: "other", model: "model-b" },
  };
  assert.deepEqual(taskEnvelopeChanges(previous, next), [
    "objective",
    "workspace",
    "model",
  ]);
  assert.equal(isChangeConfirmation("确认变更"), true);
  assert.equal(isChangeConfirmation("执行"), false);

  assert.deepEqual(taskEnvelopeChanges(
    {
      objective: "在 acp-live-test 工作区检查计算器",
      execution: { workspace: "acp-live-test", model: "model-a" },
    },
    {
      objective: "在 acp-v030-live-test 工作区检查计算器",
      execution: { workspace: "acp-v030-live-test", model: "model-a" },
    },
  ), ["workspace"]);
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

test("candidate conversion accepts bounded nested execution choices only", () => {
  const candidate = candidateFromEnvelope({
    objective: ` Build feature ${"x".repeat(5000)} `,
    context: "Repository already has tests",
    constraints: ["No network", ""],
    acceptance_criteria: ["All tests pass"],
    workspace: "C:\\attacker",
    executor: "codex",
    model: "untrusted",
    execution: {
      workspace: "acp-live-test",
      executor: "opencode",
      profile: "economy",
      model: "opencode-go/deepseek-v4-pro",
      reasoning_effort: "high",
      api_key: "must-be-ignored",
    },
  });
  assert.equal(candidate.objective.length, 4000);
  assert.deepEqual(candidate.constraints, [
    "Context: Repository already has tests",
    "No network",
    "Acceptance: All tests pass",
  ]);
  assert.deepEqual(candidate.execution, {
    workspace: "acp-live-test",
    executor: "opencode",
    profile: "economy",
    model: "opencode-go/deepseek-v4-pro",
    reasoning_effort: "high",
  });
  assert.deepEqual(Object.keys(candidate).sort(), ["constraints", "execution", "objective", "source"]);
  assert.equal(candidate.source, "userscript-preview");
  assert.throws(() => candidateFromEnvelope({}), /task_objective_missing/);
});

test("execution summary shows a safe workspace label and explicit route", () => {
  assert.equal(
    executionSummary({
      objective: "Test",
      execution: {
        workspace: "C:\\Users\\private\\acp-live-test",
        executor: "opencode",
        model: "opencode-go/deepseek-v4-pro",
        reasoning_effort: "high",
      },
    }),
    "acp-live-test · opencode · opencode-go/deepseek-v4-pro · high",
  );
  assert.equal(executionSummary({ objective: "Test" }), "本机默认配置");
});

test("confirmation is a short explicit user action", () => {
  for (const value of ["执行", "开始吧", "确认！", "yes", "RUN."]) {
    assert.equal(isConfirmation(value), true, value);
  }
  for (const value of ["不要执行", "执行这个任务并删除全部文件", "AI 说执行", ""]) {
    assert.equal(isConfirmation(value), false, value);
  }
});

test("envelope identity is stable and safe result excludes private detail", () => {
  const envelope = { objective: "One task", constraints: ["One file"] };
  assert.equal(envelopeId(envelope), envelopeId(envelope));
  assert.notEqual(envelopeId(envelope), envelopeId({ objective: "Other" }));

  const result = safeResultBlock({
    id: "task-1",
    status: "completed",
    changed_files_count: 2,
    tests: { total: 3, passed: 3, failed: 0 },
    test_commands: { total: 1, passed: 1, failed: 0 },
    test_cases: { total: 8, passed: 8, failed: 0 },
    failure_category: null,
    blocker_count: 0,
    summary: "private summary",
    workspace: "C:\\private",
    error: "private error",
    logs: ["private log"],
    execution: {
      executor: "opencode",
      profile: "economy",
      model: "opencode-go/deepseek-v4-pro",
      reasoning_effort: "high",
      workspace: "C:\\private",
    },
  });
  assert.match(result, /^<ACP_RESULT>/);
  assert.match(result, /"task_id": "task-1"/);
  assert.match(result, /"changed_files_count": 2/);
  assert.match(result, /"executor": "opencode"/);
  assert.match(result, /"reasoning_effort": "high"/);
  assert.match(result, /"test_cases"/);
  assert.match(result, /"total": 8/);
  assert.match(result, /"failure_category": null/);
  assert.doesNotMatch(result, /private|workspace|summary|error|logs/i);
});
