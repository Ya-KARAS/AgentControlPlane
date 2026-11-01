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

## Host-only durable integration (pure code implemented, default off)

The earlier preview boundary remains: `createDeliveryEvidenceEvaluator` itself
never grants effective approval. The host integration now adds the missing
persistence and fresh projection contract, without supplying an authenticated
adapter or choosing any real approver.

An embedding host may explicitly supply `createApplication({ deliveryEvidence:
{ adapter, authorizeUser, clock } })`. This is a JavaScript composition override,
**not** `config.deliveryEvidence`, an environment variable, CLI option, HTTP body
or MCP argument. It returns `app.deliveryHost` with `refresh(taskId)` and
`status(taskId)`. Only trusted host code can invoke refresh; there is no network
refresh/approval route and no automatic polling. The standard executable passes
no override. It therefore remains unsupported/unknown without new configuration.

The adapter must authenticate its source, verify complete pagination and real
current head, and obtain user-originated immutable decisions. `authorizeUser`
must implement the explicitly accepted user policy; it has no default. An
account's `User` type, bearer token, terminal or JSON assertion is not that
policy. Injecting a test callback merely simulates the trusted host boundary;
no test policy is installed in production. Code with the host user's ability to
replace JavaScript/files is outside this boundary, as with the existing executor
and local store trust model.

`TaskStore.createDeliveryHost(options)` constructs the same host service. The
private commit callback cannot be called with request JSON or a public
`trusted:true` token. It persists bounded evaluator history as private per-task
`_delivery_evidence` bookkeeping, using the existing writer lock/drift checks,
synchronous persist and safe audit chain. Generic task patches cannot alter that
field. Normal task/HTTP/MCP views never expose the journal or user/event IDs.
The journal contains event fingerprints, observation high-water marks and latest
per-revision/user events. Limits remain256 events and128 PR scopes with fail-closed
capacity handling; no silent eviction. Changed event content, omitted known
revocation and old observation replay remain rejected after cold restart.

Persisted history is **not approval authority**. Restart, host replacement,
refresh failure, expired evidence or a changed manual delivery binding yields
unknown until the currently injected adapter/policy freshly validates the exact
repo/PR/head and commits its updated replay history. Failed persist/audit clears
prior process approval, quarantines further writes and retains existing lock
recovery rules. There is no cross-file state/audit transaction or automatic lock
stealing; uncertain disk evidence requires operator inspection. Stale instances
cannot overwrite another writer. A refresh must never start another executor.

A valid fresh host projection can return `source: verified_host`,
`verification: verified`, `approval_supported:true`, effective checks and
`review_state:approved|changes_requested|pending_review|unknown`, plus
`verified_until`. It is held in process, not restored from a disk approval flag.
Read-only HTTP/MCP and task views reflect it; dashboard display rechecks its
expiry. Manual imports remain manual/unverified and still reject approved/merged.
Neither host path nor projection performs or authorizes approve/merge/deploy.
Merged-state ingestion is still not implemented.

### Remaining external connection and acceptance

All above pure-code interfaces, persistence and default-off wiring are implemented
and tested with injected fixtures. **No real authenticated adapter, real user
policy, credentials, network access, deployment or user identity was configured.**
PR3's design§8 user-originated decision acceptance is therefore still incomplete
in the running default product; passing simulated tests is not live acceptance.

The smallest next connection is an authenticated host adapter using an already
owned read authorization if it can provide stable user/event IDs, complete
reviews/checks and exact current head, together with an explicitly user-approved
principal policy. The existing conversation connector is not automatically a
credential or trusted transport available inside ACP. A copied JSON or model
message cannot substitute for that missing authenticated handoff. First establish
whether the existing host/platform can supply that channel without new scopes.
If it cannot, propose the exact enrollment/credential, principal binding and
runtime origin/transport needed for the user's on-site authorization; do not
create them under general development permission. No new permissions were needed
for the pure code shipped here. Live source validation and explicit user policy
acceptance remain the concrete external blockers, not an undefined redesign goal.

Rollback stops the service safely, retains state/audit, and reverts code through
review. Removing the host override immediately disables effective approval;
retained journals must not be interpreted as grants by an older binary. Old task
records require no migration, and model/executor updates remain compatible while
ownership/approval fields are protected.

### Verified merged facts are not merge commands or user approval

A host observation may optionally include `merge` with an explicit boolean
`merged`, `merge_commit_sha`, provider `event_id`, `source: "github"` and
`occurred_at`. A true fact requires a 40-hex merge commit, bounded event ID and
canonical timestamp no later than observation. False requires null fact details;
absent evidence is unknown. The envelope binds exact repository, PR and reviewed
head, followed by a fresh head check. No actual GitHub client or merge operation
is added. A future adapter must obtain authentic provider facts; caller-supplied
JSON and a source label do not authenticate anything.

Merged observation is independent of human review policy. A configured read
adapter can project `merged: true|false|null`, `merge_commit_sha`, `merge_source`
and `merge_event_id` without an approver policy, while `review_state` stays
unknown and `approval_supported` stays false. Without a read adapter, all facts
remain unknown. The field does not set approved, perform merge or imply that the
user approved the merged code. Existing manual approved/merged imports remain
refused. The dashboard shows a fresh merged fact separately from checks/review.

The private bounded journal remembers a verified true fact per revision and
fingerprints its event against repo/PR/head. Omission, false regression, changed
merge commit or transplanting that event to another head is rejected across
restart. Its event counts share the existing 256 event limit; at most 128 merged
revision records are retained with fail-closed capacity handling. Restart still
requires fresh provider evidence; disk history alone never restores merged=true.
Audit includes only task/repo/PR/head, merged boolean, merge commit, bounded
provider event and source. Expiration, failed refresh or revision change clears
the projection; task lifecycle/lineage is unchanged.
