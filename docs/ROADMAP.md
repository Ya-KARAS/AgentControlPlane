# Roadmap: interfaces for later phases

AgentControlPlane provides execution infrastructure; providers supply model
infrastructure. This document fixes the interface shapes for Phases 2-4 so
later work plugs into stable contracts. Phase 1 ships the provider-agnostic
capability layer these phases build on.

## Phase 2 — task-aware model routing (recommendation only)

Inputs: the task requirements (profile, objective difficulty, required
capabilities), the executor model catalogs with capabilities, and per-model
statistics from Phase 3.

```json
{
  "recommend": [
    {
      "executor": "asterroute",
      "model": "deepseek-v4-pro-official",
      "profile": "balanced",
      "reasons": ["tools_verified", "reasoning_high", "within_budget"],
      "estimated_cost": 0.012,
      "estimated_minutes": 5
    }
  ],
  "selected": null
}
```

Rules:

- Recommendation never changes the model on its own. The user or the web AI
  picks a model explicitly; dispatch records the real model id in the task.
- `reasons` reference checkable facts: probed capabilities, measured
  token costs, recorded durations.
- Profile semantics: economy favors the cheapest model that satisfies the
  required capabilities; balanced weighs capability, reliability, price, and
  latency; deep favors reasoning strength.
- MCP surface: `recommend_models` (read-only) plus an optional `models` field
  on `dispatch_project` that must match one of the recommended entries.

## Phase 3 — usage intelligence

Task records already carry executor, model, workspace, usage, status, and
timestamps. The aggregation layer adds dimensions over that data:

```json
{
  "by": "model",
  "since": "2026-08-01",
  "rows": [
    {
      "executor": "asterroute",
      "model": "deepseek-v4-pro-official",
      "workspace": "C:\\work\\acp",
      "tasks": 12,
      "succeeded": 10,
      "input_tokens": 420000,
      "cached_input_tokens": 90000,
      "output_tokens": 61000,
      "reasoning_output_tokens": 18000,
      "estimated_cost": 0.41,
      "minutes": 34.2
    }
  ]
}
```

Contracts:

- `usage_report` keeps its current aggregate shape; a new
  `usage_report_dimensions` (or `by`/`since` parameters on the same tool)
  returns the dimensional rows.
- `estimated_cost` is an estimate computed from provider-advertised prices
  when the catalog carries them; the provider's bill stays the billing truth.
  ACP stores the price metadata it used alongside the estimate.
- Success/failure and duration come from stored task records; no new
  persistence is required for the aggregation itself.

## Phase 4 — cost-aware model picker

Interface only for now. The picker presents candidates with facts:

```text
Task: Refactor authentication
Recommended models:
  Model A — est. $0.02 · tools verified · reasoning high · recent p95 45s
  Model B — est. $0.01 · tools verified · reasoning low  · recent p95 30s
[Cheapest] [Balanced] [Best]
```

Contracts:

- `estimate_cost(task_requirements, model)` returns the formula together
  with its inputs.
- `latency_stats(model, window)` returns count, p50, p95 from recorded task
  durations.
- Every label in the picker states a measurable fact; the picker never
  switches the model silently.

## Phase 5 — cross-executor continuation (implemented)

Status: implemented on `main`, with automatic reroute disabled by default.

Phase numbers record when an interface shape was designed. Phase 5 is the
next core runtime milestone and takes priority over later historical or
cost-aware routing work.

Goal: when an executor becomes unavailable (quota, rate limit, auth
failure, outage, model, or local environment issue), a compatible
executor continues the same logical development task from the persisted
handoff, reusing the recorded state.

Continuation package shape:

```json
{
  "logical_task_id": "...",
  "objective": "...",
  "current_state": "...",
  "completed_steps": [],
  "remaining_steps": [],
  "changed_files": [],
  "test_evidence": [],
  "decisions": [],
  "constraints": [],
  "known_failures": [],
  "previous_executor": "...",
  "next_action": "..."
}
```

Runtime constraints:

- Automatic reroute preserves the same task id and `logical_task_id` while
  starting a new executor session. Explicit `continue_project executor=...`
  creates a child task with the same logical id.
- `continue_project` without an executor preserves the original executor and
  persistent session for backward compatibility.
- Persistent project threads are isolated per executor. `handoff_project`
  passes a compact terminal package to another executor in the same logical
  lineage and does not reuse the source thread.
- Tasks record an append-only executor history and the latest continuation
  package.
- Capability matching (task requirements ∩ executor capabilities) gates
  any re-route.
- Reroute is limited to infrastructure failures, capped, and blocked when no
  compatible candidate exists. Test/build/implementation/validation failures
  never switch automatically.
- Later phases (historical routing, cost-aware routing) build on the data this
  phase records.

## Phase 5.1 — production acceptance and recovery (implemented)

Status: implemented and verified on `main`.

- Persisted running tasks can reroute after startup recovery classifies an
  approved infrastructure failure.
- Persisted queued continuations retain their continuation prompt after a
  process restart.
- Dispatch idempotency prevents duplicate engineering tasks across HTTP, MCP,
  and browser-companion retries.
- The local dashboard displays the logical task id, executor path, and reroute
  reason.
- `npm run accept:reroute` performs an isolated, real-executor acceptance test
  with a controlled infrastructure failure and an exact marker assertion.
- Dogfooding Round 04 verified `acceptance-fault → opencode` with the stable task
  and logical id, `quota_exhausted`, and exact marker content.
