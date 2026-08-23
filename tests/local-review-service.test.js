import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  localRouteHealth,
  publicTaskStatus,
  validateLocalSelection,
} from "../src/local-review/service.js";

test("public task status excludes raw task content, paths, logs, and errors", () => {
  const projected = publicTaskStatus({
    id: "task-1",
    status: "completed",
    workspace: "C:\\secret\\workspace",
    brief: { objective: "private objective" },
    executor: "opencode",
    policy: {
      name: "economy",
      model: "opencode-go/deepseek-v4-pro",
      effort: "high",
    },
    updatedAt: "2026-08-23T12:00:00.000Z",
    completedAt: "2026-08-23T12:01:00.000Z",
    result: {
      status: "completed",
      summary: "secret summary",
      changed_files: ["C:\\secret\\workspace\\one.txt", "two.txt"],
      tests: [{ status: "passed" }, { status: "failed" }],
      blockers: [],
    },
    error: { code: "secret", message: "private error" },
    events: [{ output: "private log" }],
  });
  assert.deepEqual(projected, {
    id: "task-1",
    status: "completed",
    result_status: "completed",
    changed_files_count: 2,
    tests: { total: 2, passed: 1, failed: 1 },
    test_commands: { total: 2, passed: 1, failed: 1 },
    test_cases: null,
    blocker_count: 0,
    execution: {
      workspace: "workspace",
      executor: "opencode",
      profile: "economy",
      model: "opencode-go/deepseek-v4-pro",
      reasoning_effort: "high",
    },
    has_error: true,
    failure_category: "task_failed",
    updated_at: "2026-08-23T12:00:00.000Z",
    completed_at: "2026-08-23T12:01:00.000Z",
  });
  assert.doesNotMatch(
    JSON.stringify(projected),
    /C:\\\\secret|private objective|secret summary|private error|private log/,
  );
});

test("public status separates test commands from parsed test cases and classifies safe failures", () => {
  const completed = publicTaskStatus({
    id: "task-tests",
    status: "completed",
    executor: "opencode",
    policy: { name: "economy", model: "deepseek/deepseek-v4-flash", effort: "low" },
    result: {
      status: "completed",
      changed_files: [],
      tests: [{
        command: "python -m unittest -v test_calculator",
        status: "passed",
        detail: "Ran 8 tests in 0.001s\n\nOK",
      }],
      blockers: [],
    },
  });
  assert.deepEqual(completed.test_commands, { total: 1, passed: 1, failed: 0 });
  assert.deepEqual(completed.test_cases, { total: 8, passed: 8, failed: 0 });
  assert.equal(completed.failure_category, null);

  const failed = publicTaskStatus({
    id: "task-failed",
    status: "failed",
    executor: "opencode",
    policy: { name: "economy", model: "opencode-go/ox-alpha-free", effort: "low" },
    updatedAt: "2026-08-23T12:00:00.000Z",
    error: { message: "AI_APICallError: Insufficient balance" },
    result: null,
  });
  assert.equal(failed.failure_category, "insufficient_balance");
  assert.doesNotMatch(JSON.stringify(failed), /AI_APICallError|private error/i);
});

test("recent provider failures produce bounded provider cooldowns", () => {
  const health = localRouteHealth({
    listTasks: () => [{
      status: "failed",
      updatedAt: "2026-08-23T12:00:00.000Z",
      policy: { model: "opencode-go/ox-alpha-free" },
      error: { message: "Insufficient balance" },
    }],
  }, Date.parse("2026-08-23T12:01:00.000Z"));
  assert.equal(health.providers["opencode-go"].status, "cooldown");
  assert.equal(
    health.providers["opencode-go"].failure_category,
    "insufficient_balance",
  );

  const recovered = localRouteHealth({
    listTasks: () => [
      {
        status: "completed",
        updatedAt: "2026-08-23T12:02:00.000Z",
        policy: { model: "opencode-go/ox-alpha-free" },
        result: { status: "completed" },
      },
      {
        status: "failed",
        updatedAt: "2026-08-23T12:00:00.000Z",
        policy: { model: "opencode-go/ox-alpha-free" },
        error: { message: "Insufficient balance" },
      },
    ],
  }, Date.parse("2026-08-23T12:03:00.000Z"));
  assert.deepEqual(recovered.providers, {});
});

test("natural-language workspace paths and route choices stay inside local capabilities", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-selection-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "project-a");
  fs.mkdirSync(workspace);
  const orchestrator = {
    getExecutors: () => [{ id: "opencode", ready: true }],
    getModels: () => [{
      id: "provider/model-a",
      supportedReasoningEfforts: [{ reasoningEffort: "high" }],
    }],
  };
  const config = {
    workspaceRoots: [root],
    profiles: { economy: { effort: "low" } },
  };
  assert.deepEqual(
    validateLocalSelection(config, orchestrator, {
      workspace,
      executor: "opencode",
      profile: "economy",
      model: "provider/model-a",
      reasoning_effort: "high",
    }),
    {
      workspace,
      executor: "opencode",
      profile: "economy",
      model: "provider/model-a",
      reasoning_effort: "high",
    },
  );
  assert.throws(
    () => validateLocalSelection(config, orchestrator, {
      workspace: path.join(os.tmpdir(), "outside"),
      executor: "opencode",
      profile: "economy",
    }),
    (error) => error.code === "candidate_workspace_denied",
  );
  assert.throws(
    () => validateLocalSelection(config, orchestrator, {
      workspace,
      executor: "opencode",
      profile: "economy",
      model: "provider/model-a",
      reasoning_effort: "ultra",
    }),
    (error) => error.code === "candidate_reasoning_effort_denied",
  );
});
