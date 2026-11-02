# Control-plane protocol

> [中文文档](PROTOCOL.zh-CN.md)

## Engineering brief

```json
{
  "workspace": "D:\\Projects\\example",
  "idempotency_key": "web:conversation-123:task-4",
  "executor": "auto",
  "objective": "Add a tested GET /hello endpoint.",
  "constraints": ["Do not add a framework dependency."],
  "acceptance_criteria": [
    "GET /hello returns HTTP 200",
    "Response JSON equals {\"message\":\"hello\"}",
    "Automated tests pass"
  ],
  "context": ["The project already uses node:test."],
  "evidence_required": ["test command and result", "changed file list"],
  "profile": "balanced",
  "model": null,
  "reasoning_effort": null,
  "max_subagents": null,
  "token_budget": null
}
```

`executor` may be `auto`, `opencode`, `codex`, `claude`,
`openai-compatible`, or `deepseek`. `auto` resolves to an actual executor before
the task is persisted, so status and audit records always show where work ran.

Persistent project threads are stored per executor. The same workspace can keep
an independent Codex thread and an independent OpenCode session. A task resumes
only the thread owned by its own executor. Project state written before executor
ownership existed is treated as Codex state. Relinking a project invalidates
saved threads from the previous location, so the next run starts a new session
instead of resuming a thread recorded at the old path.

`idempotency_key` is optional and accepts 8–200 letters, digits, dots,
underscores, colons, or hyphens. A replay carrying the same key and normalized
dispatch content returns the original task. Reusing the key with different
content returns `idempotency_conflict`. The key is scoped to one operation:
reusing it across dispatch, continue, and handoff also returns
`idempotency_conflict`. The browser companion generates this key from the page
URL and normalized request.

## Compact result

```json
{
  "status": "completed",
  "summary": "Implemented and tested the endpoint.",
  "changed_files": ["server.js", "server.test.js"],
  "tests": [{"command": "npm test", "status": "passed"}],
  "blockers": [],
  "next_action": null,
  "usage": {
    "input_tokens": 0,
    "cached_input_tokens": 0,
    "output_tokens": 0,
    "reasoning_output_tokens": 0,
    "total_tokens": 0
  },
  "subagents": []
}
```

The web controller should poll until terminal status. When the result is
`blocked`, `partial`, or `failed`, it should use the structured blocker and
evidence to correct the brief or explain why user input is required. This is the
automatic feedback loop that replaces copying output between two conversations.

Two follow-up tools keep that loop compact:

- `continue_project` keeps the same executor and persistent session unless
  `executor` is set. An explicit executor starts a capability-gated fresh
  session in the same logical lineage.
- `handoff_project` requires a terminal source task. It queues a child in the
  same logical lineage on the selected executor and passes only a compact
  continuation package: source status, summary, changed files, test evidence,
  blockers, and error text. The package omits the web conversation and the
  source executor thread id. By default the child resumes the target
  executor's own saved project thread. `fresh_session: true` starts a new
  session for an independent review and does not replace that saved thread.
  Every text field in the package is length-bounded, and the serialized package
  is capped so the handoff prompt stays within `limits.maxBriefCharacters`.

## MCP tools

- `dispatch_project` — create an asynchronous task with auto or explicit route.
- `dispatch_opencode` — backwards-compatible OpenCode shortcut.
- `task_status` — read compact state, result, usage, executor history, latest
  continuation package, reroute reason, and optional recent events.
- `continue_project` — send a correction or follow-up to the same project.
  Optional `executor` starts a capability-gated continuation on that executor;
  omitting it preserves the existing executor and persistent session.
- `handoff_project` — after the source task is terminal, send compact source
  evidence to a selected executor for review or continuation. Optional
  `fresh_session: true` starts a new target session instead of resuming that
  executor's saved project thread. `POST /v1/tasks/:id/handoff` accepts the
  same body, including `fresh_session`.
- `cancel_task` — interrupt queued or active work.
- `list_tasks` — list recent tasks.
- `list_executors` — inspect discovery, capabilities, and current default.
- `list_profiles` — inspect model/budget policies.
- `list_models` — inspect the cached catalog for one executor.
- `usage_report` — aggregate measured engineering usage.

## Cross-executor continuation

Every task exposes a stable `logical_task_id`. Child continuations preserve that
id and keep `parentTaskId` as the direct edge. `executor_history` is append-only
and records each acquired executor session. When an allowed infrastructure
failure occurs, ACP stores a compact `continuation` package and may select the
next compatible executor.

Automatic reroute is disabled by default. It is enabled only through
`executor.reroute.enabled=true`, bounded by `max_reroutes`, and limited to
`quota_exhausted`, `rate_limited`, `executor_unavailable`,
`authentication_unavailable`, and `provider_unavailable`. Test, build,
implementation, and validation failures stay on the current executor. If no
compatible executor exists, the task becomes `blocked`; it never silently runs
on an incompatible backend.

At startup, ACP examines persisted `queued` and `running` tasks. Queued
continuations retain their follow-up prompt. A queued handoff keeps the fresh
brief prompt and does not resume the source thread. A recovered terminal turn
updates its executor history; an approved infrastructure failure can enter the
same capability-gated reroute path.

`handoff_project` is not automatic reroute. Infrastructure reroute still
follows `executor.reroute` and starts a fresh session. A handoff is an
explicit request to reuse compact terminal evidence. The default resumes only
the target executor's saved project thread. `fresh_session: true` forces a
new session and leaves the saved project thread in place for later work. If
infrastructure reroute later moves that handoff, the fallback executor starts
a fresh session and does not resume its saved project thread.

## Token budgets

Usage measurement and interruption precision depend on executor telemetry.
Codex exposes a live thread goal and can be polled while running. CLI adapters
may report cumulative usage only in their final event, so their budget is also
sent as policy guidance but cannot always be enforced at the same granularity.
Providers can consume additional tokens between measurements.

## Execution-node planning (optional)

`execution_nodes({requested_node_id?,executor_id?})` reads registered local/cloud
nodes and fresh host-cached preconditions. Default disabled; missing observations
are unknown. Explicit unavailable nodes never silently fall back. The response
always has `advisory_only:true` and `execution_authorized:false`; it does not
assign a task or authorize execution. No client-supplied observations/approvals.
See [configuration, trust and PR4 gates](EXECUTION-NODES.md).

## Optional controller ownership (PR1)

`controllers.enabled` defaults to `false`. Existing dispatch/continue/handoff
requests require no new arguments. With the feature enabled, those operations
attribute new tasks to the explicit `local-operator`; current shared-bearer and
local transports do not authenticate separate personal agents. Client-supplied
`caller_id`, `controller_id`, `controller` or prompt text never establishes an
identity. Existing transport authorization and user cancellation remain in place.

`list_controllers` is a read-only MCP tool. Its optional `limit` is an integer
from 1 to 100 (default 20), selecting the most recent tasks to inspect. It returns
`enabled`, `mode`, `lease_ttl_seconds`, `identity_scope: "local_operator"`, public
`controllers` (`id`, `kind`, `display_name`) and `task_owners` for leases among
those tasks. Each lease summary contains only `task_id`, `owner`, `generation`,
`expires_at` and `lease_state` (`active`, `expired`, `released`). No principal
bindings, credentials, workspace paths, prompts, events or executor data appear
in this tool. It does not renew leases. Ordinary endpoint authentication still
applies; a loopback endpoint configured without a token can read the same safe
view. No mutating controller claim/renew/release/takeover tool or route is added.

Task records expose optional `controller` (`id`, `kind`, `mode`) and
`control_lease` (`owner`, `generation`, `expires_at`); legacy/feature-off new tasks
normalize both to `null`. Release retains `owner: null` and the last generation,
so a reclaim increments rather than resetting the fence. `controller.id` after
release identifies the last actor, not an active owner. Only the lease establishes
current control. See [controller configuration and invariants](CONTROLLERS.md).

## Host-only node recovery

Managed tasks add optional `execution_node_id` / `node_recovery` with legacy null
defaults. Recovery mutators and admission receipts are host-only; no MCP mutation
is registered. Client claims cannot provide measured stop or grant a new owner.
See [state transitions, failure handling and stack order](NODE-RECOVERY.md).

## Unified local messages (optional)

`post_message` / `list_messages` and protected `/v1/messages` share one local
journal. Explicit `POST /v1/messages/dispatch` uses a server message key for
original dispatch/continuation, so cross-channel replay does not duplicate work.
See [bounds, identity, retry and lifecycle limits](MESSAGES.md). No auto-consumer.

## Delivery observations (PR3)

Read-only `delivery_status(task_id)` and GET `/v1/tasks/:id/delivery` expose
optional task-specific metadata, separately from execution `status`. Missing or
malformed delivery returns null. Manual reports use `reported_checks` and
`reported_review_state`; verified `checks`/`review_state` remain `unknown`.
`approval_supported` is false: approved/merged cannot be asserted by a client,
CI or model. Existing authentication is unchanged; no mutating delivery tool or
route exists. See [delivery contract and offline operations](DELIVERY.md).

## Verified report/archive lifecycle (optional)

`archive_task` and protected `POST /v1/tasks/:id/archive` accept only task identity;
existing trusted user decision, passed checks and inactive runtime are required.
`list_active_tasks` / `GET /v1/tasks?view=active` filter committed report/archive
receipts; original task lists stay historical. `daily_report` / dated report GET
read safe local report rows. [Ordering, retry, retention and live gates](WORKFLOW-ARCHIVE.md).

## Offline conversation routes

See [offline project conversations](CONVERSATIONS.md) for protected scoped message,
continuation and safe stop interfaces, default-off authorization and browser limits.
The original single queue and human approval boundary remain authoritative.
