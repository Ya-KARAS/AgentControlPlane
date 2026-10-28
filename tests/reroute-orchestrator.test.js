import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";

const REPORTED_INFRASTRUCTURE_FAILURES = {
  "quota-with-benign-tests": {
    error: { status: 402, code: "insufficient_balance", message: "quota exhausted" },
    summary: "Stopped before the task could finish",
    tests: [
      { command: "unit", status: "passed", detail: "3 passed" },
      { command: "live", status: "not_run", detail: "Not executed" },
    ],
  },
  "rate-limit-with-benign-tests": {
    error: { status: 429, code: "rate_limit", message: "rate limit exceeded" },
    summary: "Stopped before the task could finish",
    tests: [
      { command: "unit", status: "passed", detail: "3 passed" },
      { command: "live", status: "not_run", detail: "Not executed" },
    ],
  },
  "quota-with-failed-tests": {
    error: { status: 402, code: "insufficient_balance", message: "quota exhausted" },
    summary: "quota exhausted",
    tests: [{ command: "unit", status: "failed", detail: "1 failed" }],
  },
};

class RerouteExecutor extends EventEmitter {
  constructor(id, behavior = "success") {
    super();
    this.id = id;
    this.behavior = behavior;
    this.kind = "cli";
    this.ready = false;
    this.capabilities = { persistentThreads: true, tokenUsage: true };
    this.discovery = { available: null, status: "unknown" };
    this.turnStarts = [];
  }

  async probe() {
    return { available: true, status: "available", reason: null };
  }

  setDiscovery(result) {
    this.discovery = result;
    return result;
  }

  async start() {
    this.ready = true;
  }

  async stop() {}
  respond() {}
  async listModels() { return { data: [] }; }
  async getSandboxReadiness() { return { status: "ready" }; }
  async resumeThread({ threadId }) { return { thread: { id: threadId } }; }
  async setGoal() { return {}; }
  async getGoal() { return { goal: null }; }
  async interruptTurn() { return {}; }

  async startThread() {
    return { thread: { id: `${this.id}-thread-${this.turnStarts.length + 1}` } };
  }

  async startTurn(params) {
    this.turnStarts.push(params);
    if (this.behavior === "quota") {
      const error = new Error("insufficient balance");
      error.status = 402;
      error.code = "insufficient_balance";
      throw error;
    }
    const reported = this.behavior === "reported"
      ? this.reported
      : REPORTED_INFRASTRUCTURE_FAILURES[this.behavior];
    if (reported) {
      const turnId = `${this.id}-turn-${this.turnStarts.length}`;
      queueMicrotask(() => {
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: params.threadId,
            turn: {
              id: turnId,
              status: "failed",
              error: reported.error,
              items: [
                {
                  type: "agentMessage",
                  phase: "final_answer",
                  text: JSON.stringify({
                    status: "failed",
                    summary: reported.summary,
                    changed_files: [],
                    tests: reported.tests,
                    blockers: [],
                    next_action: null,
                  }),
                },
              ],
            },
          },
        });
      });
      return { turn: { id: turnId } };
    }
    const turnId = `${this.id}-turn-${this.turnStarts.length}`;
    queueMicrotask(() => {
      const taskFailure = this.behavior === "task-failure";
      this.emit("notification", {
        method: "turn/completed",
        params: {
          threadId: params.threadId,
          turn: {
            id: turnId,
            status: taskFailure ? "failed" : "completed",
            error: taskFailure
              ? { code: "implementation_failed", message: "build failed" }
              : null,
            items: [
              {
                type: "agentMessage",
                phase: "final_answer",
                text: JSON.stringify({
                  status: taskFailure ? "failed" : "completed",
                  summary: taskFailure ? "Implementation failed" : `${this.id} done`,
                  changed_files: [],
                  tests: this.resultTests ?? (taskFailure ? ["npm test failed"] : ["npm test passed"]),
                  blockers: taskFailure ? ["build failed"] : [],
                  next_action: null,
                }),
              },
            ],
          },
        },
      });
    });
    return { turn: { id: turnId } };
  }
}

function configFor(workspace, order, reroute = {}) {
  return {
    workspaceRoots: [path.dirname(workspace)],
    executor: {
      provider: "auto",
      routing: { order },
      reroute: {
        enabled: true,
        max_reroutes: 2,
        allowed_reasons: [
          "quota_exhausted",
          "rate_limited",
          "executor_unavailable",
          "authentication_unavailable",
          "provider_unavailable",
        ],
        ...reroute,
      },
    },
    codex: {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      networkAccess: false,
      defaultModel: null,
    },
    profiles: {
      economy: {
        model: "fake-model",
        effort: "low",
        maxSubagents: 0,
        tokenBudget: 30000,
        summary: "concise",
      },
    },
    limits: {
      maxBriefCharacters: 24000,
      maxConcurrentTasks: 1,
      maxQueuedTasks: 10,
      maxTokenBudget: 250000,
      maxStoredEventsPerTask: 20,
      maxTaskRuntimeMinutes: 1,
    },
  };
}

function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("Timed out"));
      setTimeout(check, 5);
    };
    check();
  });
}

async function setup(behaviors, reroute = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-reroute-ws-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-reroute-state-")),
    50,
  );
  const executors = new Map(
    Object.entries(behaviors).map(([id, behavior]) => [
      id,
      new RerouteExecutor(id, behavior),
    ]),
  );
  const orchestrator = new Orchestrator({
    config: configFor(workspace, [...executors.keys()], reroute),
    store,
    executors,
    defaultProvider: "auto",
  });
  await orchestrator.start();
  return { workspace, store, executors, orchestrator };
}

test("quota failure reroutes to a compatible executor on the same logical task", async () => {
  const { workspace, store, orchestrator } = await setup({ a: "quota", b: "success" });
  const task = orchestrator.dispatch({
    workspace,
    executor: "a",
    objective: "Create a file",
    profile: "economy",
  });
  await waitFor(() => store.getTask(task.id)?.status === "completed");
  const completed = store.getTask(task.id, true);
  assert.equal(completed.id, task.id);
  assert.equal(completed.logical_task_id, task.id);
  assert.equal(completed.executor, "b");
  assert.equal(completed.reroute_reason, "quota_exhausted");
  assert.equal(completed.continuation.previous_executor, "a");
  assert.deepEqual(completed.executor_history.map((entry) => entry.executor), ["a", "b"]);
  assert.ok(completed.events.some((entry) => entry.type === "task.rerouted"));
});

test("reroutable failure blocks when no compatible candidate exists", async () => {
  const { workspace, store, orchestrator } = await setup({ a: "quota" });
  const task = orchestrator.dispatch({ workspace, executor: "a", objective: "x", profile: "economy" });
  await waitFor(() => store.getTask(task.id)?.status === "blocked");
  assert.equal(store.getTask(task.id).error.code, "no_compatible_executor");
});

test("reroute cap blocks without acquiring another executor", async () => {
  const { workspace, store, orchestrator } = await setup(
    { a: "quota", b: "success" },
    { max_reroutes: 0 },
  );
  const task = orchestrator.dispatch({ workspace, executor: "a", objective: "x", profile: "economy" });
  await waitFor(() => store.getTask(task.id)?.status === "blocked");
  const blocked = store.getTask(task.id);
  assert.equal(blocked.error.code, "reroute_limit_reached");
  assert.equal(blocked.executor_history.length, 1);
});

test("implementation failures never switch executors", async () => {
  const { workspace, store, orchestrator } = await setup({ a: "task-failure", b: "success" });
  const task = orchestrator.dispatch({ workspace, executor: "a", objective: "x", profile: "economy" });
  await waitFor(() => store.getTask(task.id)?.status === "failed");
  const failed = store.getTask(task.id);
  assert.equal(failed.executor, "a");
  assert.equal(failed.executor_history.length, 1);
});

for (const scenario of [
  {
    name: "quota exhaustion",
    behavior: "quota-with-benign-tests",
    reason: "quota_exhausted",
  },
  {
    name: "rate limiting",
    behavior: "rate-limit-with-benign-tests",
    reason: "rate_limited",
  },
]) {
  test(`${scenario.name} with only passed or not_run tests reroutes when enabled`, async (t) => {
    const { workspace, store, executors, orchestrator } = await setup({
      a: scenario.behavior,
      b: "success",
    });
    t.after(() => {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(store.stateDir, { recursive: true, force: true });
    });
    const task = orchestrator.dispatch({
      workspace,
      executor: "a",
      objective: "Continue after an infrastructure failure",
      profile: "economy",
    });
    await waitFor(() => store.getTask(task.id)?.status === "completed");
    const completed = store.getTask(task.id, true);
    assert.equal(completed.executor, "b");
    assert.equal(completed.reroute_reason, scenario.reason);
    assert.equal(completed.logical_task_id, task.id);
    assert.deepEqual(
      completed.executor_history.map((entry) => entry.executor),
      ["a", "b"],
    );
    assert.ok(completed.events.some((entry) => entry.type === "task.rerouted"));
    assert.equal(executors.get("b").turnStarts.length, 1);
  });
}

test("quota hint with a failed test does not reroute", async (t) => {
  const { workspace, store, executors, orchestrator } = await setup({
    a: "quota-with-failed-tests",
    b: "success",
  });
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(store.stateDir, { recursive: true, force: true });
  });
  const task = orchestrator.dispatch({
    workspace,
    executor: "a",
    objective: "Keep a real test failure on the original executor",
    profile: "economy",
  });
  await waitFor(() => store.getTask(task.id)?.status === "failed");
  const failed = store.getTask(task.id, true);
  assert.equal(failed.executor, "a");
  assert.equal(failed.executor_history.length, 1);
  assert.equal(failed.reroute_reason ?? null, null);
  assert.equal(executors.get("b").turnStarts.length, 0);
  assert.equal(
    failed.events.some((entry) => entry.type === "task.rerouted"),
    false,
  );
});

for (const evidence of [
  {
    name: "an error status",
    tests: [{ command: "unit", status: "error", detail: "Compilation failed" }],
  },
  {
    name: "a blocked status",
    tests: [{ command: "lint", status: "blocked", detail: "waiting" }],
  },
  {
    name: "an unknown skipped status",
    tests: [{ command: "live", status: "skipped", detail: "Not executed" }],
  },
  {
    name: "a failed string entry",
    tests: ["npm test failed"],
  },
  {
    name: "not_run detail that names a failure",
    tests: [{ command: "live", status: "not_run", detail: "Previous: 4 failed" }],
  },
  {
    name: "an exit-code string",
    tests: ["npm test exited with code 1"],
  },
  {
    name: "a not-ok string",
    tests: ["not ok 1 - expected 200, got 500"],
  },
  {
    name: "a cross-mark summary string",
    tests: ["✖ 3 of 10 tests"],
  },
  {
    name: "a bare npm test string",
    tests: ["npm test"],
  },
  {
    name: "a test object with no status",
    tests: [{ command: "npm test", detail: "exit code 1" }],
    stored: [{ command: "npm test", status: "unknown", detail: "exit code 1" }],
  },
  {
    name: "a passed status whose detail has a nonzero exit code",
    tests: [{ command: "unit", status: "passed", detail: "exit code 1" }],
  },
]) {
  for (const infra of [
    {
      name: "quota exhaustion",
      error: { status: 402, code: "insufficient_balance", message: "quota exhausted" },
    },
    {
      name: "rate limiting",
      error: { status: 429, code: "rate_limit", message: "rate limit exceeded" },
    },
  ]) {
    test(`${infra.name} with ${evidence.name} does not reroute after normalization`, async (t) => {
      const { workspace, store, executors, orchestrator } = await setup({
        a: "reported",
        b: "success",
      });
      t.after(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(store.stateDir, { recursive: true, force: true });
      });
      executors.get("a").reported = {
        error: infra.error,
        summary: "Stopped before the task could finish",
        tests: evidence.tests,
      };
      const task = orchestrator.dispatch({
        workspace,
        executor: "a",
        objective: "Keep real test evidence on the original executor",
        profile: "economy",
      });
      await waitFor(() => store.getTask(task.id)?.status === "failed");
      const failed = store.getTask(task.id, true);
      assert.equal(failed.executor, "a");
      assert.equal(failed.executor_history.length, 1);
      assert.equal(failed.reroute_reason ?? null, null);
      assert.deepEqual(failed.result.tests, evidence.stored ?? evidence.tests);
      assert.equal(executors.get("b").turnStarts.length, 0);
      assert.equal(failed.events.some((entry) => entry.type === "task.rerouted"), false);
    });
  }
}

for (const infra of [
  {
    name: "quota exhaustion",
    error: { status: 402, code: "insufficient_balance", message: "quota exhausted" },
    reason: "quota_exhausted",
  },
  {
    name: "rate limiting",
    error: { status: 429, code: "rate_limit", message: "rate limit exceeded" },
    reason: "rate_limited",
  },
]) {
  test(`${infra.name} with a zero failure count still reroutes after normalization`, async (t) => {
    const { workspace, store, executors, orchestrator } = await setup({
      a: "reported",
      b: "success",
    });
    t.after(() => {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(store.stateDir, { recursive: true, force: true });
    });
    executors.get("a").reported = {
      error: infra.error,
      summary: "Stopped before the task could finish",
      tests: ["npm test passed (0 failed)"],
    };
    const task = orchestrator.dispatch({
      workspace,
      executor: "a",
      objective: "Continue after a zero failure count",
      profile: "economy",
    });
    await waitFor(() => store.getTask(task.id)?.status === "completed");
    const completed = store.getTask(task.id, true);
    assert.equal(completed.executor, "b");
    assert.equal(completed.reroute_reason, infra.reason);
    assert.equal(executors.get("b").turnStarts.length, 1);
  });
}

test("benign tests with quota exhaustion do not reroute while reroute is disabled", async (t) => {
  const { workspace, store, executors, orchestrator } = await setup(
    { a: "quota-with-benign-tests", b: "success" },
    { enabled: false },
  );
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(store.stateDir, { recursive: true, force: true });
  });
  const task = orchestrator.dispatch({
    workspace,
    executor: "a",
    objective: "Stay put while reroute is disabled",
    profile: "economy",
  });
  await waitFor(() => store.getTask(task.id)?.status === "failed");
  const failed = store.getTask(task.id);
  assert.equal(failed.executor, "a");
  assert.equal(failed.executor_history.length, 1);
  assert.equal(executors.get("b").turnStarts.length, 0);
});

test("continue_project can start a compatible executor on the same lineage", async () => {
  const { workspace, store, orchestrator } = await setup({ a: "success", b: "success" });
  const root = orchestrator.dispatch({ workspace, executor: "a", objective: "root", profile: "economy" });
  await waitFor(() => store.getTask(root.id)?.status === "completed");
  const child = orchestrator.continueTask(root.id, {
    objective: "continue",
    executor: "b",
    profile: "economy",
  });
  await waitFor(() => store.getTask(child.id)?.status === "completed");
  const completed = store.getTask(child.id);
  assert.equal(completed.logical_task_id, root.id);
  assert.equal(completed.parentTaskId, root.id);
  assert.equal(completed.executor, "b");
  assert.deepEqual(completed.executor_history.map((entry) => entry.executor), ["a", "b"]);
  assert.match(completed.threadId, /^b-thread-/);
});

for (const field of ["acceptance_criteria", "acceptanceCriteria"]) {
  test(`reroute retains normalized acceptance criteria from ${field}`, async (t) => {
    const { workspace, store, executors, orchestrator } = await setup({
      a: "quota",
      b: "success",
    });
    t.after(() => {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(store.stateDir, { recursive: true, force: true });
    });
    const criteria = ["The file exists", "The regression tests pass"];
    const task = orchestrator.dispatch({
      workspace,
      executor: "a",
      objective: "Create a file",
      profile: "economy",
      [field]: criteria,
    });
    assert.deepEqual(task.brief.acceptanceCriteria, criteria);
    assert.equal(task.brief.acceptance_criteria, undefined);

    await waitFor(() => store.getTask(task.id)?.status === "completed");
    const completed = store.getTask(task.id);
    assert.deepEqual(completed.continuation.remaining_steps, criteria);
    const prompt = executors.get("b").turnStarts[0].input[0].text;
    const continuation = JSON.parse(
      prompt.split("\n\nContinuation package (structured):\n")[1],
    );
    assert.deepEqual(continuation.remaining_steps, criteria);
  });
}

for (const scenario of [
  {
    name: "falls back to normalized acceptance criteria",
    expected: ["Keep the original behavior", "Pass regression tests"],
  },
  {
    name: "supports legacy snake-case acceptance criteria",
    brief: { acceptanceCriteria: undefined, acceptance_criteria: ["Legacy criterion"] },
    expected: ["Legacy criterion"],
  },
  {
    name: "prefers normalized criteria over legacy criteria",
    brief: { acceptance_criteria: ["Stale legacy criterion"] },
    expected: ["Keep the original behavior", "Pass regression tests"],
  },
  {
    name: "preserves an empty normalized criteria list",
    brief: { acceptanceCriteria: [], acceptance_criteria: ["Stale legacy criterion"] },
    expected: [],
  },
  {
    name: "defaults to empty when neither criteria field exists",
    brief: { acceptanceCriteria: undefined },
    expected: [],
  },
  {
    name: "preserves explicit remaining steps instead of criteria",
    result: { remaining_steps: ["Finish only the outstanding step"] },
    expected: ["Finish only the outstanding step"],
  },
  {
    name: "preserves explicitly empty remaining steps",
    result: { remaining_steps: [] },
    expected: [],
  },
  {
    name: "falls back when remaining steps are not an array",
    result: { remaining_steps: null },
    expected: ["Keep the original behavior", "Pass regression tests"],
  },
]) {
  test(`cross-executor continuation ${scenario.name}`, async (t) => {
    const { workspace, store, executors, orchestrator } = await setup({
      a: "success",
      b: "success",
    });
    t.after(() => {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(store.stateDir, { recursive: true, force: true });
    });
    const root = orchestrator.dispatch({
      workspace,
      executor: "a",
      objective: "Preserve acceptance criteria across executor switches",
      acceptance_criteria: ["Keep the original behavior", "Pass regression tests"],
      profile: "economy",
    });
    await waitFor(() => store.getTask(root.id)?.status === "completed");
    const parent = store.getTask(root.id);
    // Exercise persisted legacy briefs and explicit continuation progress.
    store.updateTask(root.id, {
      brief: { ...parent.brief, ...scenario.brief },
      result: { ...parent.result, ...scenario.result },
    });

    const child = orchestrator.continueTask(root.id, {
      executor: "b",
      objective: "Continue the original work",
      profile: "economy",
    });
    await waitFor(() => store.getTask(child.id)?.status === "completed");
    const completed = store.getTask(child.id);
    assert.equal(completed.logical_task_id, root.id);
    assert.equal(completed.parentTaskId, root.id);
    assert.deepEqual(completed.continuation.remaining_steps, scenario.expected);
    const prompt = executors.get("b").turnStarts[0].input[0].text;
    const continuation = JSON.parse(
      prompt.split("\n\nContinuation package (structured):\n")[1],
    );
    assert.deepEqual(continuation.remaining_steps, scenario.expected);
  });
}

for (const scenario of [
  {
    name: "preserves not_run from the execution report",
    status: "not_run",
    stored: "not_run",
    continued: "not_run",
  },
  {
    name: "keeps an unknown test status instead of marking it not_run",
    status: "unknown",
    stored: "unknown",
    continued: "failed",
  },
  {
    name: "keeps a skipped test as not_run in the continuation package",
    status: "skipped",
    stored: "skipped",
    continued: "not_run",
  },
  {
    name: "records a missing test status as unknown",
    stored: "unknown",
    continued: "failed",
  },
]) {
  test(`cross-executor continuation ${scenario.name}`, async (t) => {
    const { workspace, store, executors, orchestrator } = await setup({
      a: "success",
      b: "success",
    });
    t.after(() => {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(store.stateDir, { recursive: true, force: true });
    });
    executors.get("a").resultTests = [
      { command: "unit", status: "passed", detail: "3 passed" },
      { command: "integration", status: "failed", detail: "1 failed" },
      { command: "live", status: scenario.status, detail: "Not executed" },
    ];
    const root = orchestrator.dispatch({
      workspace,
      executor: "a",
      objective: "Preserve reported test evidence across executor switches",
      profile: "economy",
    });
    await waitFor(() => store.getTask(root.id)?.status === "completed");
    const parentTests = store.getTask(root.id).result.tests;
    assert.deepEqual(parentTests.map((entry) => entry.status), [
      "passed", "failed", scenario.stored,
    ]);
    const expected = [
      { command: "unit", status: "passed" },
      { command: "integration", status: "failed" },
      { command: "live", status: scenario.continued },
    ];

    const child = orchestrator.continueTask(root.id, {
      executor: "b",
      objective: "Continue without claiming unrun tests passed or failed",
      profile: "economy",
    });
    await waitFor(() => store.getTask(child.id)?.status === "completed");
    const completed = store.getTask(child.id);
    assert.equal(completed.logical_task_id, root.id);
    assert.equal(completed.parentTaskId, root.id);
    assert.deepEqual(completed.continuation.test_evidence, expected);
    const prompt = executors.get("b").turnStarts[0].input[0].text;
    const continuation = JSON.parse(
      prompt.split("\n\nContinuation package (structured):\n")[1],
    );
    assert.deepEqual(continuation.test_evidence, expected);
    assert.deepEqual(store.getTask(root.id).result.tests, parentTests);
  });
}

test("handoff labels a skipped test as not_run", async (t) => {
  const { workspace, store, orchestrator, executors } = await setup({
    a: "success",
    b: "success",
  });
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(store.stateDir, { recursive: true, force: true });
  });
  executors.get("a").resultTests = [
    { command: "live", status: "skipped", detail: "Not executed" },
  ];
  const root = orchestrator.dispatch({
    workspace,
    executor: "a",
    objective: "Record a skipped test",
    profile: "economy",
  });
  await waitFor(() => store.getTask(root.id)?.status === "completed");
  assert.equal(store.getTask(root.id).result.tests[0].status, "skipped");
  const child = orchestrator.handoffTask(root.id, {
    executor: "b",
    objective: "Review the skipped test",
    profile: "economy",
  });
  await waitFor(() => store.getTask(child.id)?.status === "completed");
  assert.deepEqual(store.getTask(child.id).continuation.test_evidence, [
    { command: "live", status: "not_run", output: "Not executed" },
  ]);
});
