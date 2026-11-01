# Passive subscription status (PR2)

PR2 implements the subscription milestone from [design PR0 #20](https://github.com/Ya-KARAS/AgentControlPlane/pull/20).
It is independent of controller PR1 #21; neither PR is merged by this work.
This is a manual observation ledger and advisory view, not a quota detector or
subscription authentication service. No provider CLI, model prompt, browser,
cookie, session file or private billing API is queried. No new credentials,
dependencies, paid resources or automatic top-up/overage mechanism are added.

## Manual operator import

Preserve any active work, stop the single ACP service, then run:

```sh
npm run subscription:import -- --offline snapshot.json
```

Restart ACP after import. `--offline` is a required operator assertion, not an
automated proof that every service is stopped. Do not import while ACP is live:
its existing in-memory TaskStore would become stale, and the writer drift guard
would reject subsequent writes. Never bypass the guard or steal a checkpoint
lock. Config and state directory resolution use the existing `loadConfig` and
`AGENT_CONTROL_STATE_DIR` behavior. The command reads one local JSON file up to
64KiB, constructs no executor and reports generic errors without echoing input.

Example (replace the observation/validity times with the actual observation):

```json
{
  "schema_version": 1,
  "provider": "anthropic",
  "surface": "claude_code",
  "account_alias": "personal",
  "plan": null,
  "model_family": null,
  "quota_window": null,
  "availability": "warning",
  "remaining_percent": null,
  "reset_at": null,
  "observed_at": "2026-11-01T12:00:00.000Z",
  "valid_until": "2026-11-01T12:10:00.000Z",
  "source": "manual",
  "confidence": "user_reported",
  "overage_status": "unknown"
}
```

Only `manual`/`user_reported` may enter through this command. The normalized
schema reserves the design's `official_diagnostic`, `official_ui`,
`local_telemetry`, `executor_error` sources and `observed`/`inferred` confidence
values for future verified adapters; importing a JSON file cannot assert them.
Use nonidentifying local aliases, not emails/account IDs. Never paste credentials,
raw CLI/chat output, prompts or cookies into fields. Unknown fields are rejected.
Provider, surface and alias are 1–64 ASCII letters/digits/dot/underscore/hyphen,
starting with a letter/digit. Optional plan/model-family/window labels are bounded
at80 characters without control characters.

Observation time must not be in the future. `valid_until` is explicit, after
observation and at most24hours later; no freshness or reset is guessed.
`availability` is `available|warning|exhausted|unknown`; percentage is finite0–100
or `null`. Null is unknown and never becomes0. A supplied reset must be a valid
ISO UTC timestamp, otherwise leave it null. Overage is `unknown|disabled|enabled`
(default unknown), an operator report rather than ACP changing provider settings.

## Persistence, freshness and scopes

The existing TaskStore keeps at most256 latest scoped records in optional
`state.subscription_snapshots`, using its existing synchronous writer lock,
drift detection, safe persist and append-only audit chain. There is no second
queue/database or change to task/token accounting. Scope includes provider,
surface, account_alias, plan, model_family and quota_window. Different accounts,
plans, models or five-hour/daily windows are not aggregated or silently replaced.
An identical import is a no-op; older observations and conflicting observations
at the same time fail instead of overwriting newer evidence. A new observation
must have a later observed_at. Reads never persist, renew or collect evidence.

At the exact validity deadline, the read view reports `freshness: expired`,
`availability: unknown`, percentage/reset null and overage unknown. The original
observation remains in local state as history of the last report. Malformed
persisted evidence is omitted, never shown green. No observation means unknown,
not exhausted or0%. Reset passing alone does not turn exhausted into available.
`task_usage`, `subscription_status` and `cash_spend` remain separate metrics.

State and audit retain the existing separate durability primitives: a crash
between state persistence and audit append is not a distributed transaction.
Persistence/audit failure quarantines the writer; retain evidence and inspect
before recovery. Do not run multiple writers against this JSON state.

## Read-only views and advice

GET `/v1/subscriptions` and MCP `subscription_status` return
`{ snapshots, advisory, advisory_only: true }`. The normal bearer/loopback access
rules still apply. There is no mutation endpoint or import MCP tool. Dashboard
shows a separate bilingual section and escapes every observation field; failed
refresh first clears the previous report to unknown. Polling only reads local
records and never issues a model request.

Optional operator-owned config maps an exact scope to a route:

```json
{
  "subscriptions": {
    "routes": [{
      "executor": "claude",
      "provider": "anthropic",
      "surface": "claude_code",
      "account_alias": "personal",
      "compatible": true,
      "previously_verified": true
    }]
  }
}
```

Omitted plan/model/window mean null and match only null scopes. Max128 routes,
unique executor IDs; malformed route config fails the read rather than enabling a
route. No provider-to-executor guess is made. Capability and prior verification
booleans are trusted local operator assessments for the contemplated task, not
new dynamic capability probes. Absent/false compatibility blocks advice before
considering quota. Known exhausted routes are skipped. A route not previously
verified is blocked. Other manual/unknown/warning candidates request operator
approval; unknown/enabled billable overage specifically requires confirmation.
Reported available candidates sort before warning, unknown and exhausted, but
nothing auto-dispatches them and no route is claimed to be free. These assessments
must be refreshed for different tasks; this view is not a capability authority.

Existing actual routing, task dispatch and automatic reroute remain unchanged;
auto-reroute is still disabled by default. The operator must separately approve
and dispatch work. Future verified passive adapters need their own evidence and
acceptance; none are shipped by PR2.

## Verification and rollback

Run `npm run verify`. Offline coverage includes schema/expiry/scope/advice,
persistence/restart/conflicts/bounds/drift, unchanged usage/audit, executable CLI,
real local HTTP/MCP authentication and no writes, and executable escaped UI
rendering/failure clearing. No live quota-consuming acceptance is implied.

To roll back, preserve active work and state/audit, stop ACP, revert PR2 through a
reviewed branch and restart. No migration or schema rewrite is needed; old code
ignores the optional snapshot field. Remove optional subscription route config if
desired. Do not delete task state or audit history. main merging, extra costs,
PR3 human-approval delivery, PR4 runner work and PR5 research are separate stages.
