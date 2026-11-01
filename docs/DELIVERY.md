# Delivery observations and the approval boundary (PR3)

Delivery metadata describes a proposed code review independently of execution.
`task.status=completed` does not mean accepted, approved or merged. The V1 design
source is [PR0#20](https://github.com/Ya-KARAS/AgentControlPlane/pull/20), Sections8/11.
This implementation is independently based on main, without PR1/PR2 commits.

## What is implemented

The existing TaskStore accepts a strict, bounded manual observation attached to
one existing task. Old records expose `delivery: null`. Updating delivery does
not change task status, logical ID, parent relationships, executor sessions,
continuation, usage or queued execution. A reported rejection stays recoverable;
recording a new revision on the same task does not destroy prior task evidence.
Existing continuation creates the usual child lineage; delivery is task-specific
and is not automatically copied to a child as though it reviewed new work.

Public delivery records contain:

| Field | Meaning |
|---|---|
| `repository` | Required `owner/repo`, each slug bounded to100 characters |
| `base_branch` | Explicit base ref or null; never guess main |
| `branch` | Required relative Git-safe ref, max200 characters |
| `pull_request_number` | Positive safe integer or null |
| `head_sha` |40 hexadecimal characters normalized lowercase, or null |
| `checks`, `review_state` | Always `unknown`: no live verification channel exists |
| `reported_checks` | Manual `unknown`, `pending`, `passed`, `failed` observation |
| `reported_review_state` | Manual `not_requested`, `draft_pr`, `pending_review`, `changes_requested`, `closed` observation |
| `observed_at` | Explicit canonical UTC ISO time, no future observations |
| `source`, `verification` | Always `manual`, `unverified` |
| `approval_supported` | Always false |

`checks`/`review_state` input aliases are accepted for convenience but become
**reported** fields; they never become verified live GitHub facts. Arbitrary
extra keys, freeform comments, raw test output, URLs, absolute paths, credentials,
actor identity assertions and prompt text are rejected. Do not place sensitive
information in Git refs or repository names. A schema cannot authenticate the
truth of even a syntactically valid alias.

Every observation is a complete bounded record, not an arbitrary patch. Missing
optional PR/head/checks/review fields become null/unknown/not_requested rather
than inheriting an unsupported assertion. A repeated identical observation is
idempotent; a conflicting observation at the same timestamp or an older
observation is refused. Once attached, repository and a non-null PR number cannot
silently change. A changed head/base/branch clears reported checks and returns
review to pending_review except explicit draft/not_requested/closed observations.
An internal replay fingerprint of the original validated observation is retained
before conservative new-head resets, so an identical retry remains idempotent
after restart without restoring stale checks. It is not caller-supplied, is not
authentication evidence, and is omitted from all public views. Conflicting
equal-time observations remain refused.
No accepted approval is transferable to another head because approval is never
admitted in this implementation.

## Human approval is unsupported, not inferred

There is currently no separately authenticated human-origin channel connected to
this metadata store. Therefore neither `approved` nor `merged` is ingestible,
including as reported states or on persisted-record reads. They fail closed with
`human_approval_unavailable` (malformed persisted metadata reads as null).

A model recommendation, green CI, a shared bearer credential, `human: true`,
`approved_by`, a terminal/TTY or a local `--human` option is **not** a verified user
decision. No such override is implemented. The shared bearer authenticates the
existing operator surface, not an independent human review event.

To support actual approval ingestion later, a separately reviewed adapter must
verify the user-originated event and bind it to exact repository, PR and head;
new heads, reopened/changed reviews and mismatched identity must invalidate that
binding. Adding this adapter requires its own security design and acceptance.
Do not read this PR as delivery of authenticated approval recording. The user
continues to review and merge directly in GitHub; ACP does not perform it.

There is no GitHub API client, polling, permission change, approve/merge/deploy
command, mutating MCP tool or HTTP delivery route. No new token is required.
Existing endpoint authentication remains in effect. Branch protection is not
asserted or modified. No shell commands or arbitrary output are published.

## Offline manual import

Preserve active work and stop the single ACP service before importing. Use the
existing local configuration and state directory. `--offline` is an operator
assertion, not an automatic service-shutdown test. Do not import into state owned
by a live process: existing disk drift protection may quarantine that writer.

Example observation file (all fields are operator reports, not verified facts):

```json
{
  "repository": "owner/repository",
  "base_branch": "main",
  "branch": "feat/task-123",
  "pull_request_number": 123,
  "head_sha": "0123456789abcdef0123456789abcdef01234567",
  "checks": "passed",
  "review_state": "pending_review",
  "observed_at": "2026-11-01T00:00:00Z"
}
```

```sh
npm run delivery:import -- --offline TASK_ID observation.json
```

Input files must be at most64KiB; unexpected arguments and approval assertions are
refused. Errors are generic and do not echo the payload or file path. The command
constructs no executor and makes no GitHub/model requests. Restart ACP after a
successful import. Read-only views do not ingest or refresh observations.

## Reads and persistence

- GET `/v1/tasks/:id/delivery` and read-only MCP `delivery_status(task_id)` return
  `{delivery, approval_supported:false}`. Delivery is null if absent/malformed.
- MCP accepts an unambiguous existing task prefix; HTTP uses the existing task
  ID. No prompts, raw output, workspace paths or credentials appear in these
  focused views. Ordinary task views retain their existing broader contract.
- The dashboard adds an escaped delivery summary to existing task rows, clearly
  separating unverified reports and unknown verified checks/review.

Store changes use the existing exclusive writer lock, disk-hash drift checks,
synchronous persistence and append-only audit chain. New audit events contain
only task ID, repository, PR number and head SHA. Generic `updateTask` accepts
unchanged delivery from legacy full-record writes but cannot replace metadata.
These are trusted local storage boundaries, not protection against code running
with the host user's ability to edit files. State and audit retain separate
existing write primitives; a crash between them needs operator inspection.
No distributed ownership or transactional journal is claimed.

## Verification and rollback

`tests/delivery.test.js`, `tests/delivery-store.test.js` and
`tests/delivery-surfaces.test.js` cover simulated PR states, forged approval,
new-head invalidation, rejection/revision/restart, legacy nulls, drift, audit,
CLI behavior, authenticated read-only endpoints and executed UI escaping. Run
`npm run verify`; no real model or GitHub operations are required.

Rollback by safely stopping ACP, preserving state/audit evidence and reverting
these feature commits through review. The new task field is additive, requires
no migration and can be ignored by older code, but older code does not enforce
this metadata validation boundary. Do not continue approval/delivery mutation on
an old binary. No destructive Git cleanup, credential removal or schema rewrite
is needed. PR4 cloud execution and PR5 chat research remain separate stages.

## Host adapter interface: offline preview only

`src/core/delivery-evidence.js` provides
`createDeliveryEvidenceEvaluator({adapter, authorizeUser, clock})`. This is an
isolated interface, **not connected** to application bootstrap, TaskStore,
HTTP, MCP or manual CLI. No config JSON can instantiate a trusted adapter or
approval setter. All simulated implementations live in tests. Existing public
views remain unknown and production `recordDelivery` still rejects approved and
merged; this addition does not connect a real user or GitHub channel.

A future trusted host adapter supplies two asynchronous methods:

- `readObservation(target)` returns exact repository/PR/head, `checks`,
  `complete`, `observed_at`, `valid_until`, and `decisions`.
- `readHead(target)` returns repository/PR/head after evidence collection and
  potentially asynchronous policy evaluation, detecting a revision race.

The target is `{repository, pull_request_number, head_sha}`. Observation times
are canonical UTC ISO; lifetime is at most ten minutes and never future-dated.
`complete: true` means the trusted adapter has fetched all relevant pages and
required evidence; the evaluator cannot prove that an adapter actually did so.
The adapter must authenticate its source and enforce allowlisted repositories
outside this module. Returning a caller-supplied JSON object is not source
verification. HTTP errors (including403), incomplete data, invalid clocks,
expired evidence, conflicting event IDs and head mismatch yield no candidate.
No arbitrary adapter error text is returned.

Each immutable decision event contains `event_id`, stable `user_id`, `head_sha`,
`state` (`approved`, `changes_requested`, `revoked`) and `occurred_at`. Events are
bound through the observation's repository/PR/head; event time cannot exceed its
observation. A revocation must have its own immutable event/revision ID. The
latest event per user supersedes their older event, so an old approval cannot
win over a newer revocation. Equal-time contradictory decisions fail closed.

`authorizeUser(userId,target)` is an explicit trusted host policy callback. With
no callback, no user is authorized. This PR supplies **no production policy or
list of approvers**. Account type `User`, shared bearer, `human:true`, local TTY
and model recommendations do not establish policy. The future authenticated
human channel and policy must still be chosen and accepted by the user; testing
with a fixture callback does not settle that choice.

Evaluation returns `preview_only:true`, `approval_supported:false`,
`effective:{checks:"unknown",review_state:"unknown"}` and either a bound
`candidate` preview or null. The candidate may contain a simulated decision and
its user/event IDs; it is never a task update, user approval grant, merge
permission or live GitHub fact. Do not wire this preview directly to a privileged
setter. A future production integration needs separate provenance, persistence,
user-policy and revocation acceptance before changing effective states.

An evaluator keeps bounded in-memory event fingerprints (256) and observation
high-water marks (128 PR scopes). Identical event replay is idempotent; changed
content under an event ID, regressed observations and conflicting equal-time
observations are rejected. Capacity exhaustion fails closed without eviction.
A later failed evaluation does not reuse a cached candidate. Concurrent older
reads cannot replace newer revocations. The evaluator also remembers the latest
event per revision/user; a later response that omits or regresses that event is
rejected, even if the adapter incorrectly claims complete pagination. This
latest-event memory is bounded by the existing event limit and is not evicted. This cache is **not a durable replay
ledger**; evaluator recreation/restart loses it and no restart safety is claimed.
A real approval store would require durable event/revocation handling.

The new tests cover default unknown, an explicitly injected test host policy,
repo/PR/head/event binding, missing pages, freshness, head race,403, replay,
revocation/new head, concurrent revocation and invalid final clock. All fixtures
are offline and the production import rejection remains tested. No new token,
permission, network call, deployment or official approval capability is added.
