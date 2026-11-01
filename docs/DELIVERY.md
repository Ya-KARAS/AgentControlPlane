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
