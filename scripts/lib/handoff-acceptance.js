import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { TaskStore } from "../../src/core/store.js";
import { estimateCost, latencyStats } from "../../src/core/cost-latency.js";
import { RecordingExecutor } from "../../tests/fixtures/recording-executor.js";

const CHECKPOINT = "CHECKPOINT_A_IMPLEMENTED";
const CONVERSATION = "PRIVATE_A_CONVERSATION";
const SUMMARY_TAIL = "UNBOUNDED_SUMMARY_TAIL";
const MODEL = "fake-model";
const TERMINAL = new Set(["completed", "partial", "failed", "blocked", "cancelled", "interrupted"]);

function configFor(root) {
  return {
    workspaceRoots: [root],
    executor: {
      provider: "fake-a",
      routing: { order: ["fake-a", "fake-b"] },
      reroute: { enabled: true, max_reroutes: 2,
        allowed_reasons: ["quota_exhausted", "executor_unavailable"] },
    },
    codex: { approvalPolicy: "never", sandbox: "workspace-write", networkAccess: false },
    profiles: { economy: { model: MODEL, effort: "low", maxSubagents: 0,
      tokenBudget: 30000, summary: "concise" } },
    limits: { maxBriefCharacters: 24000, maxConcurrentTasks: 1, maxQueuedTasks: 10,
      maxTokenBudget: 250000, maxStoredEventsPerTask: 50,
      maxTaskRuntimeMinutes: 1, discoveryRefreshMs: 0 },
  };
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await delay(5);
  }
}

function constructRuntime(env) {
  env.store = new TaskStore(env.stateDir, 50);
  env.orchestrator = new Orchestrator({ config: env.config, store: env.store,
    executors: new Map([[env.a.id, env.a], [env.b.id, env.b]]), defaultProvider: env.a.id });
}

async function settle(env, task) {
  await waitFor(() => TERMINAL.has(env.store.getTask(task.id)?.status), `terminal task ${task.id}`);
  await waitFor(() => env.orchestrator.running.size === 0, `idle task ${task.id}`);
  const completed = env.store.getTask(task.id, true);
  assert.equal(completed.status, "completed", JSON.stringify(completed.error));
  return completed;
}

async function handoff(env, source, executor, extra = {}) {
  const task = env.orchestrator.handoffTask(source.id, {
    executor, objective: "Review the checkpoint and continue", profile: "economy", model: MODEL,
    ...extra,
  });
  const completed = await settle(env, task);
  assert.equal(completed.parentTaskId, source.id);
  assert.equal(completed.logical_task_id, source.logical_task_id);
  assert.equal(completed.handoff, true);
  return completed;
}

function prompt(executor) {
  return executor.turnStarts.at(-1).input[0].text;
}

function assertSession(task, session) {
  assert.equal(task.threadId, session);
  // The recording fixture uses its thread id as the native session id.
  assert.equal(task.executorSessionId, session);
  assert.equal(task.executor_history.at(-1).thread_id, session);
}

async function setup(env) {
  fs.mkdirSync(env.workspace);
  constructRuntime(env);
  await env.orchestrator.start();
  env.baselineB = await settle(env, env.orchestrator.dispatch({
    workspace: env.workspace, objective: "B baseline", executor: env.b.id,
    profile: "economy", model: MODEL,
  }));
  env.a.report = {
    status: "completed", summary: `${CHECKPOINT}: ${"bounded evidence ".repeat(400)}${SUMMARY_TAIL}`,
    changed_files: ["implementation.txt"],
    tests: [{ command: "fixture unit checks", status: "passed", detail: "checkpoint verified" }],
    blockers: [], next_action: "Review implementation.txt from the saved checkpoint",
  };
  env.a.transcript = `${CONVERSATION}: ${"private dialogue ".repeat(2000)}`;
  env.source = await settle(env, env.orchestrator.dispatch({
    workspace: env.workspace, objective: "A implements the feature", executor: env.a.id,
    context: [`${CONVERSATION}: ${"old dialogue ".repeat(800)}`],
    profile: "economy", model: MODEL,
  }));
  env.canonical = env.source.workspace;
}

async function compactHandoff(env) {
  const child = await handoff(env, env.source, env.b.id);
  const text = prompt(env.b);
  const pack = child.continuation;
  assert.equal(pack.purpose, "handoff");
  assert.equal(pack.current_state, "completed");
  assert.equal(pack.previous_executor, env.a.id);
  assert.equal(pack.summary, env.source.result.summary.slice(0, 4000));
  assert.equal(pack.next_action, env.source.result.next_action);
  assert.deepEqual(pack.changed_files, ["implementation.txt"]);
  assert.equal(pack.test_evidence[0].status, "passed");
  assert.equal(pack.test_evidence[0].output, "checkpoint verified");
  assert.ok(env.source.events.some((event) => event.item?.text?.includes(CONVERSATION)),
    "source must actually contain conversation evidence");
  assert.match(text, /Execute the following compact engineering brief/);
  assert.ok(text.includes(CHECKPOINT));
  for (const excluded of [CONVERSATION, SUMMARY_TAIL, env.source.threadId, env.source.executorSessionId]) {
    assert.ok(!text.includes(excluded), `handoff leaked ${excluded}`);
  }
  assert.ok(text.length <= env.config.limits.maxBriefCharacters);
  assert.ok(text.length < env.source.result.summary.length + env.a.transcript.length);
  const serialized = text.split("Continuation package (structured):\n")[1];
  assert.deepEqual(JSON.parse(serialized), pack);
  assertSession(child, env.baselineB.threadId);
  assert.notEqual(child.threadId, env.source.threadId);
  return child;
}

const scenarios = [
  { id: "a", name: "A to B: compact checkpoint on B's own session", run: compactHandoff },
  { id: "b", name: "Default session reuse versus fresh_session", async run(env) {
    const resumed = await handoff(env, env.source, env.b.id);
    assert.equal(resumed.fresh_session, false);
    assertSession(resumed, env.baselineB.threadId);
    const fresh = await handoff(env, env.source, env.b.id, { fresh_session: true });
    assert.equal(fresh.fresh_session, true);
    assert.notEqual(fresh.threadId, resumed.threadId);
    assertSession(fresh, env.b.startedThreads.at(-1));
    assert.equal(env.b.startedThreads.length, 2);
    assert.deepEqual(env.b.resumedThreads, [env.baselineB.threadId]);
    assert.equal(env.store.getProject(env.canonical, env.b.id).threadId, resumed.threadId);
    const again = await handoff(env, env.source, env.b.id);
    assertSession(again, resumed.threadId);
  } },
  { id: "c", name: "B returns to A's original session", async run(env) {
    const reviewed = await handoff(env, env.source, env.b.id);
    const returned = await handoff(env, reviewed, env.a.id);
    assertSession(returned, env.source.threadId);
    assert.equal(env.a.startedThreads.length, 1);
    assert.deepEqual(env.a.resumedThreads, [env.source.threadId]);
    assert.deepEqual(returned.executor_history.map((entry) => entry.executor), [env.a.id, env.b.id, env.a.id]);
  } },
  { id: "d", name: "Thread, session and executor-history isolation", async run(env) {
    const original = env.store.getTask(env.source.id, true);
    const reviewed = await compactHandoff(env);
    const reviewSnapshot = structuredClone(reviewed);
    const returned = await handoff(env, reviewed, env.a.id);
    assert.deepEqual(env.store.getTask(env.source.id, true), original);
    assert.deepEqual(env.store.getTask(reviewed.id, true), reviewSnapshot);
    for (const executor of [env.a, env.b]) {
      for (const id of [...executor.startedThreads, ...executor.resumedThreads,
        ...executor.turnStarts.map((turn) => turn.threadId)]) {
        assert.ok(id.startsWith(`${executor.id}-thread-`), `foreign session ${id}`);
      }
      assert.equal(env.store.getProject(env.canonical, executor.id).threadId, executor.startedThreads[0]);
    }
    assertSession(returned, env.source.threadId);
    for (const task of [env.source, reviewed, returned]) {
      for (const entry of task.executor_history) {
        assert.ok(entry.thread_id.startsWith(`${entry.executor}-thread-`));
      }
    }
    assert.ok(!prompt(env.b).includes(env.a.transcript));
  } },
  { id: "e", name: "Store/orchestrator restart preserves checkpoints and resumes", async run(env) {
    const reviewed = await compactHandoff(env);
    const before = fs.readFileSync(env.store.statePath, "utf8");
    await stopRuntime(env);
    // Mock executor sessions survive the control-plane restart, like external sessions.
    constructRuntime(env);
    assert.equal(fs.readFileSync(env.store.statePath, "utf8"), before);
    assert.deepEqual(env.store.getTask(env.source.id, true), env.source);
    assert.deepEqual(env.store.getTask(reviewed.id, true), reviewed);
    assert.equal(env.store.getProject(env.canonical, env.a.id).threadId, env.source.threadId);
    assert.equal(env.store.getProject(env.canonical, env.b.id).threadId, reviewed.threadId);
    await env.orchestrator.start();
    const returned = await handoff(env, reviewed, env.a.id);
    assertSession(returned, env.source.threadId);
    const continued = await settle(env, env.orchestrator.continueTask(returned.id, {
      objective: "Resume after restart", profile: "economy", model: MODEL,
    }));
    assertSession(continued, env.source.threadId);
    assert.equal(continued.parentTaskId, returned.id);
    assert.equal(continued.logical_task_id, env.source.logical_task_id);
    const next = await handoff(env, continued, env.b.id);
    assertSession(next, reviewed.threadId);
    assert.equal(env.store.getTask(reviewed.id).continuation.summary, reviewed.continuation.summary);
  } },
  ...["quota_exhausted", "executor_unavailable"].map((reason) => ({
    id: `f-${reason}`, name: `Automatic reroute preserves checkpoint: ${reason}`,
    async run(env) {
      if (reason === "executor_unavailable") {
        // Explicit targets already known unavailable reject before staging a task.
        env.orchestrator.executorDiscovery[env.b.id].available = false;
        assert.throws(() => env.orchestrator.handoffTask(env.source.id, {
          executor: env.b.id, objective: "Unavailable review", profile: "economy",
        }), { code: "executor_unavailable" });
        assert.deepEqual(env.store.getTask(env.source.id, true), env.source);
        env.orchestrator.executorDiscovery[env.b.id].available = true;
      }
      const error = new Error(reason === "quota_exhausted" ? "insufficient balance" : "executor unavailable");
      error.code = reason;
      if (reason === "quota_exhausted") error.status = 402;
      env.b.failNext = error;
      const recovered = await handoff(env, env.source, env.b.id);
      assert.equal(recovered.executor, env.a.id);
      assert.equal(recovered.reroute_reason, reason);
      assert.notEqual(recovered.threadId, env.source.threadId);
      assertSession(recovered, env.a.startedThreads.at(-1));
      assert.deepEqual(env.a.resumedThreads, []);
      const history = recovered.executor_history;
      assert.deepEqual(history.map((entry) => entry.executor), [env.a.id, env.b.id, env.a.id]);
      assert.equal(history[0].thread_id, env.source.threadId);
      assert.equal(history[1].thread_id, env.baselineB.threadId);
      assert.equal(history[1].ended_reason, reason);
      assert.equal(history[2].ended_reason, "completed");
      assert.equal(env.store.getProject(env.canonical, env.b.id).threadId, env.baselineB.threadId);
      assert.ok(recovered.events.some((event) => event.type === "task.rerouted" && event.reason === reason));
      assert.deepEqual(env.store.getTask(env.source.id, true), env.source);
      assert.equal(recovered.continuation.summary, env.source.result.summary.slice(0, 4000));
      assert.deepEqual(recovered.continuation.changed_files, env.source.result.changed_files);
      assert.equal(recovered.continuation.test_evidence[0].output, "checkpoint verified");
      assert.equal(recovered.continuation.next_action, env.source.result.next_action);
      assert.equal(recovered.continuation.previous_executor, env.b.id);
      assert.equal(recovered.continuation.reroute_reason, reason);
      assert.ok(prompt(env.a).includes("implementation.txt"), "fallback lost source checkpoint files");
      assert.ok(prompt(env.a).includes(env.source.result.next_action), "fallback lost source checkpoint next action");
      assert.ok(!prompt(env.a).includes(CONVERSATION));
    },
  })),
  { id: "f-async", name: "Failed turn notification preserves the checkpoint through reroute and restart", async run(env) {
    const error = new Error("insufficient balance");
    error.status = 402;
    env.b.failNextCompletion = error;
    const recovered = await handoff(env, env.source, env.b.id);
    assert.equal(recovered.executor, env.a.id);
    assert.equal(recovered.reroute_reason, "quota_exhausted");
    const pack = recovered.continuation;
    assert.equal(pack.summary, env.source.result.summary.slice(0, 4000));
    assert.deepEqual(pack.changed_files, env.source.result.changed_files);
    assert.equal(pack.test_evidence[0].output, "checkpoint verified");
    assert.equal(pack.next_action, env.source.result.next_action);
    assert.equal(pack.previous_executor, env.b.id);
    assert.equal(pack.reroute_reason, "quota_exhausted");
    assert.deepEqual(JSON.parse(prompt(env.a).split("Continuation package (structured):\n")[1]), pack);
    assert.deepEqual(recovered.executor_history.map((entry) => entry.executor), [env.a.id, env.b.id, env.a.id]);
    assert.notEqual(recovered.threadId, env.source.threadId);
    assert.deepEqual(env.store.getTask(env.source.id, true), env.source);

    await stopRuntime(env);
    constructRuntime(env);
    assert.deepEqual(env.store.getTask(recovered.id, true), recovered);
    assert.deepEqual(env.store.getTask(recovered.id).continuation, pack);
    await env.orchestrator.start();
    assert.deepEqual(env.store.getTask(recovered.id).continuation, pack);
    const reviewed = await handoff(env, env.store.getTask(recovered.id), env.b.id);
    assert.equal(reviewed.continuation.summary, pack.summary);
    assert.deepEqual(reviewed.continuation.changed_files, pack.changed_files);
    assert.deepEqual(reviewed.continuation.test_evidence, pack.test_evidence);
    assert.equal(reviewed.continuation.next_action, pack.next_action);
  } },
  ...["sync", "async"].map((mode) => ({
    id: `f-budget-${mode}`, name: `Reroute refits a near-budget checkpoint after ${mode} failure`,
    async run(env) {
      await compactHandoff(env);
      // Set the limit to exactly the initial prompt size, leaving no room for
      // the failure reason or the longer follow-up prefix on the fallback.
      const budget = prompt(env.b).length;
      env.config.limits.maxBriefCharacters = budget;
      const error = new Error("insufficient balance");
      error.status = 402;
      if (mode === "sync") env.b.failNext = error;
      else env.b.failNextCompletion = error;
      const recovered = await handoff(env, env.source, env.b.id);
      assert.equal(prompt(env.b).length, budget);
      assert.equal(recovered.executor, env.a.id);
      assert.equal(recovered.reroute_reason, "quota_exhausted");
      const text = prompt(env.a);
      assert.match(text, /Continue the existing engineering task/);
      assert.ok(text.includes(CHECKPOINT), "fallback lost the source summary");
      assert.ok(text.length <= budget, `fallback prompt length ${text.length} exceeds ${budget}`);
      assert.deepEqual(JSON.parse(text.split("Continuation package (structured):\n")[1]), recovered.continuation);
    },
  })),
  { id: "g", name: "Cost estimate and latency statistics are read-only", async run(env) {
    await compactHandoff(env);
    const before = fs.readFileSync(env.store.statePath, "utf8");
    // Fail even on probes/catalog/goal calls, not only execution calls.
    for (const executor of [env.a, env.b]) {
      for (const name of Object.getOwnPropertyNames(RecordingExecutor.prototype)) {
        if (name !== "constructor" && name !== "stop") executor[name] = () => {
          throw new Error(`Read-only query called executor.${name}`);
        };
      }
    }
    const estimate = estimateCost({ profile: "economy" }, { model: MODEL,
      pricing: { input: 3, cached_input: 1, output: 15, reasoning: 15 } }, env.config);
    assert.equal(estimate.inputs.model, MODEL);
    assert.deepEqual(estimate.missing_rates, []);
    assert.ok(estimate.range.expected_microusd > 0);
    assert.ok(estimate.range.low_microusd <= estimate.range.expected_microusd);
    assert.ok(estimate.range.expected_microusd <= estimate.range.high_microusd);
    assert.equal(estimateCost({}, { model: MODEL }).range, null);
    const stats = latencyStats(env.store.listTaskTimings(), MODEL, "7d");
    assert.equal(stats.count, 3);
    assert.ok(Number.isFinite(stats.p50_ms) && stats.p50_ms >= 0);
    assert.ok(Number.isFinite(stats.p95_ms) && stats.p95_ms >= stats.p50_ms);
    assert.equal(fs.readFileSync(env.store.statePath, "utf8"), before);
  } },
];

export const HANDOFF_SCENARIOS = Object.freeze(scenarios.map(({ id, name }) => Object.freeze({ id, name })));

async function stopRuntime(env) {
  if (env.orchestrator) {
    for (const task of env.store.listByStatus(["queued", "running"])) await env.orchestrator.cancel(task.id);
    await waitFor(() => env.orchestrator.running.size === 0, "runtime cleanup");
    clearInterval(env.orchestrator.discoveryTimer);
    clearInterval(env.orchestrator.reconcileTimer);
  }
  for (const executor of [env.a, env.b]) {
    await executor.stop();
    executor.removeAllListeners();
  }
}

export async function runHandoffScenario(id) {
  const scenario = scenarios.find((entry) => entry.id === id);
  assert.ok(scenario, `Unknown handoff scenario: ${id}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-handoff-acceptance-"));
  const env = { root, workspace: path.join(root, "workspace"), stateDir: path.join(root, "state"),
    config: configFor(root), a: new RecordingExecutor("fake-a"), b: new RecordingExecutor("fake-b") };
  try {
    await setup(env);
    await scenario.run(env);
  } finally {
    try { await stopRuntime(env); }
    finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  }
}

export async function runHandoffAcceptance({ onScenario = () => {}, runScenario = runHandoffScenario } = {}) {
  const results = [];
  for (const scenario of HANDOFF_SCENARIOS) {
    let result;
    try {
      await runScenario(scenario.id);
      result = { ...scenario, passed: true };
    } catch (error) {
      result = { ...scenario, passed: false, error: error.message };
    }
    results.push(result);
    onScenario(result);
  }
  return { passed: results.every((entry) => entry.passed), scenarios: results };
}
