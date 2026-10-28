# P1 — Native Cross-Executor Continuation: design

Status: implemented on `main`; automatic reroute remains disabled by default.

Goal: one logical task continues across multiple executor sessions. The
runtime does not require the same executor thread or session id; a
compatible executor resumes the same logical task from a persisted
continuation package and the working tree.

Reroute candidates in the first version are limited to:
`quota_exhausted`, `rate_limited`, `executor_unavailable`,
`authentication_unavailable`, `provider_unavailable`.

These failures never trigger an automatic executor switch: test failure,
build failure, bad implementation, validation failure. They surface as
task blockers on the current executor.

## Current task schema

The task record (src/core/store.js createTask/updateTask) stores:

| Field | Meaning |
|---|---|
| id | task id; also the logical identity for roots today |
| parentTaskId | continuation lineage (continue_project children) |
| workspace, brief | brief: objective, constraints, acceptance_criteria, context, evidence_required |
| policy | name, model, effort, maxSubagents, tokenBudget, timeLimitMinutes, summary |
| executor | single executor id |
| kind | production / certification / benchmark / maintenance |
| status | queued / running / completed / partial / blocked / failed / cancelled |
| threadId, turnId, executorSessionId | executor session coordinates |
| result | status, summary, changed_files, tests, blockers, next_action, usage, subagents |
| usage | measured tokens |
| recommendation | advisory snapshot (selected_model, strategies, catalog_hash) |
| retries | int |
| createdAt, updatedAt, startedAt, completedAt | timestamps |
| events | task.* event log |

continuation today: `continue_project` creates a child task with
parentTaskId and reuses the parent's executor and threadId
(src/core/orchestrator.js continueTask). A different executor cannot
resume the lineage.

## Proposed logical task model

- Add `logical_task_id`: a stable identity for the whole lineage. The
  root task sets `logical_task_id = id`; every continuation copies it
  from the parent. Read paths that need the lineage query by
  `logical_task_id`; `parentTaskId` remains available for direct edges.
- Keep `parentTaskId` for direct lineage edges.
- Task record gains optional fields: `executor_history[]`,
  `continuation`, `reroute_reason`, `capability_requirements`,
  `executor_capabilities`.
- Executor sessions form a sequence attached to one logical task,
  replacing the single pinned pair.

## Continuation package schema

Snapshot produced when a handoff happens; it is structured and compact,
never the full chat history.

```json
{
  "version": 1,
  "logical_task_id": "...",
  "objective": "...",
  "current_state": "running | partial | blocked",
  "completed_steps": [],
  "remaining_steps": [],
  "changed_files": [],
  "test_evidence": [{ "command": "...", "status": "passed | failed | not_run" }],
  "decisions": [],
  "constraints": [],
  "known_failures": [],
  "previous_executor": "codex",
  "reroute_reason": "quota_exhausted",
  "next_action": "..."
}
```

Sources: objective/constraints from the brief; current_state and
next_action from the executor's result or a handoff payload;
completed_steps/decisions/known_failures from structured handoff text;
test_evidence from result.tests; changed_files from result.changed_files
plus the working-tree diff at handoff time. Stored on the task record
field `continuation` and exposed via task_status.

Structured test evidence preserves `passed`, `failed`, and `not_run` from the
normalized execution report. `not_run` is neither a pass nor an execution
failure; the public test-case summary ignores counts quoted in its detail.
These statuses are executor-reported evidence, not independent verification or
an acceptance decision. Version 1 consumers must tolerate `not_run` in addition
to the previously documented `passed` and `failed` values.

## Executor history schema

```json
{
  "executor_history": [
    {
      "executor": "codex",
      "started_at": "...",
      "ended_at": "...",
      "ended_reason": "quota_exhausted",
      "thread_id": "...",
      "turn_id": "...",
      "attempts": 1,
      "usage": { "input_tokens": 0, "output_tokens": 0, "total_tokens": 0 }
    }
  ]
}
```

Append-only: each executor acquisition adds an entry; the previous entry
is never overwritten. The current executor is the last entry.

## Capability model

- Executor adapter capabilities (src/executors/executor.js): persistentThreads, tokenUsage, hardInterrupt, subagents. Model-endpoint executors add per-model capabilities from the catalog and the protocol probe: chat, responses, tools, reasoning, vision — three-state true/false/unknown.
- Task capability requirements are derived at dispatch from the brief and profile via extractTaskRequirements (src/core/recommend.js): tools_required, vision_required, reasoning_level, minimum_context_tokens, latency_preference, cost_preference, required_protocols.
- Compatibility gate for a reroute candidate:
  - tools_required=true requires a verified tool loop (probed chat/responses toolLoop, or a CLI executor with tooling).
  - vision_required=true requires model capabilities.vision=true.
  - minimum_context_tokens must fit the candidate model context; unknown
    context raises a warning and allows the candidate.
  - CLI executors satisfy filesystem/shell/git by nature; model-endpoint executors only through their bounded tool loop.
- No compatible candidate → status blocked with the reroute reason; no silent switch.

## Reroute state machine

```text
queued -> running (executor A)
running + allowed failure -> persist continuation package
      -> append executor_history
      -> select next compatible executor (routing order ∩ capabilities)
      -> running (executor B, same logical_task_id, new session)
running + disallowed failure -> blocked | failed on the current executor
running + no compatible candidate -> blocked with reroute_reason
terminal: completed | partial | blocked | failed | cancelled
```

- Allowed reasons: quota_exhausted, rate_limited, executor_unavailable, authentication_unavailable, provider_unavailable.
- Disallowed: test/build/implementation/validation failures (surface as blockers).
- Guards: `max_reroutes` per logical task (config default 2); each attempt increments attempts; loops terminate at the cap with blocked.

## Failure classification

`classifyExecutorFailure(error, context) -> reroute_reason | "task_failure"`:

| Signal | Classification |
|---|---|
| HTTP 429 / rate_limit_exceeded / retry-after exhausted | rate_limited |
| HTTP 401/403 / invalid_api_key / authentication error | authentication_unavailable |
| HTTP 402 / insufficient_balance / quota message | quota_exhausted |
| 5xx / provider_unavailable / upstream error / do_request_failed | provider_unavailable |
| executor process spawn failure, timeouts, app-server exited, unauthenticated local CLI | executor_unavailable |
| result.status failed/blocked with test or validation evidence | task_failure (no reroute) |

Classification is deterministic from structured error codes already present in executor error payloads and relay error envelopes.

## Storage / migration impact

- Persistence is append-only JSONL (usage.jsonl task records); no schema migration or DB rewrite.
- New fields are optional; old records read with defaults: logical_task_id = id, executor_history = single entry from createdAt, continuation = null, reroute_reason = null.
- Backfill applies read-time defaults and requires no data migration.
- Wire contracts (usage/reconciliation v2) are untouched.

## API / MCP impact

- `task_status`: additive fields — logical_task_id, executor_history, continuation (latest), reroute_reason when set.
- `dispatch_project`: unchanged; root tasks create logical_task_id. Optional `reroute` policy parameter later (allow/deny, max).
- `continue_project`: gains an optional `executor` parameter; when provided and gated by capability compatibility, the continuation starts a new session on that executor and records the reroute reason; default behavior (same executor + thread) is preserved.
- `list_executors` already exposes discovery and capabilities; no change.
- No new MCP tool in the minimal slice; the surface change is additive fields plus the optional continue_project parameter.

`handoff_project` was added after this slice. It is an explicit terminal
review tool, not a replacement for `continue_project` or automatic reroute.
The child keeps `logical_task_id`, receives a bounded continuation package,
and may resume only the target executor's project thread.

## Backward compatibility

- All new fields optional; existing tools, records, and dispatch flows behave exactly as today.
- Default-off policy: config key `executor.reroute.enabled=false` until a release opts in; `max_reroutes` and `allowed_reasons` configurable.
- `continue_project` without the new parameter keeps current semantics.
- No change to contracts, executors, or the provider-neutral requirement.

## Test plan

- classifyExecutorFailure: one test per signal mapping and one per disallowed category.
- Capability gate: requirements ∩ capabilities → compatible / incompatible cases; unknown context warns; vision/tools gating.
- Reroute state machine: allowed reason reroutes; disallowed reason stays; no-candidate → blocked; max_reroutes cap terminates.
- Store: new fields persist; old records read with defaults; executor_history appends; logical_task_id inherits through continue.
- Orchestrator: continuation package snapshot at handoff; task_status exposure; continue_project with executor parameter and gate.
- Integration (mock executor): simulate quota_exhausted on executor A; assert the task continues on executor B with the same logical_task_id, preserved evidence, and a two-entry history.

## Minimal P1 implementation slices

1. Schema + store: logical_task_id, executor_history, continuation, reroute_reason, capability_requirements, executor_capabilities; read-time defaults; tests.
2. Failure classification: classifyExecutorFailure + `executor.reroute` config (default off); tests.
3. Capability gate: requirements extraction at dispatch (reuse extractTaskRequirements), executor capability snapshot, compatibility check; tests.
4. Reroute execution: orchestrator reroute path (persist package → next executor → new session on the same logical_task_id; cap; blocked fallback); continue_project executor override; tests.
5. Exposure + docs: task_status additive fields; PROTOCOL/ROADMAP/DEVELOPMENT updates; planned dogfood round with a mocked reroute.

Each slice ships independently with reroute disabled by default; no wire-contract change.
