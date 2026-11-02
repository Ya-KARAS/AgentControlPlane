# Acceptance, dated report and active-view archive

This increment follows PR29 shared messages and PR30 integration of existing PR23
trusted delivery evidence. It implements local bookkeeping, not a new human
identity, PR approval/merge action, task queue, vendor transport or cloud runner.

## Configuration and authority

Default optional configuration:

```json
{"workflow":{"enabled":false,"timeZone":"UTC"}}
```

Use an IANA time zone chosen in local operator configuration; caller JSON cannot
select report dates, approvers or clocks. The dated report uses the acceptance day
in that zone, including retries after midnight. No Notion or paid API dependency.

Only the existing PR23 host service can supply the current exact repository/PR/HEAD
user decision. Required: authenticated policy-supported approval, passed provider
checks, fresh observation, unchanged task binding and healthy audit/store. No manual
report, sender label, model review, client human flag or green CI alone qualifies.
The host-only decision accessor stays out of HTTP/MCP; raw user/event identifiers
are not projected into workflow summaries or reports. Their bounded digest binds
the protected receipt to the existing private evidence journal.

Real user credential enrollment, approver policy/origin and live provider access
are STILL unconfigured/unaccepted here. Tests inject controlled adapters/policy;
that is not actual human authentication or production acceptance.

## Ordered persistence and retry

1. Refresh the already configured read-only evidence adapter; validate retained
   audit chain, task inactivity, exact HEAD and verified user decision.
2. Persist the bound acceptance snapshot. Audit and state use the existing writer
   lock; no competing workflow lock/database is added.
3. Write a bounded local Markdown daily report under private state `reports/`.
   Its visible table contains safe task/logical IDs, repository/PR/HEAD, outcome
   and acceptance time; no prompts, result text, arbitrary output, paths, user IDs
   or credentials. A strict machine-readable block permits exact idempotent retry.
   File is synced and atomically renamed/read back before proceeding.
4. Persist report receipt, recheck source decision/task binding, verify report row,
   then commit archive metadata. A synced archive-intent audit entry precedes that
   state commit; it never falsely declares a failed state write completed. Only now exclude the task from the active view.

A failed report write keeps the task active and can retry without a duplicate row.
A state/audit failure faults the existing writer and retains its lock/evidence;
operator inspection/clean restart is needed, not a retry loop or stale-lock deletion.
Source HEAD/revocation/expiry races cannot complete archive. Verified revocation or
changes requested persistently invalidates the receipt, so expiry/restart cannot
resurrect it. A fresh reapproval requires a new acceptance/report transition. A report already
written during a later failure remains a historical snapshot, not new approval.

Reports are <=1MiB and <=2048 unique rows per day; histories per task <=64 prior
receipts. Capacity/malformed reports block instead of truncating history. Report
paths are server-derived dates; symlink/directory/file and size guards reject
arbitrary reads/writes. Linux syncs the directory after rename; Windows uses the
existing atomic-rename/file-sync model. No power-loss/distributed transaction
certification is claimed.

A protected historical archive receipt survives restart and keeps its report
readable; current `delivery.review_state` remains unknown until the original host
policy re-verifies it. Historical receipts never authorize new approvals, model
execution or merging. Changed task/HEAD or a fresh verified revocation reopens
active view; missing/tampered reports likewise do not hide the task.

## One queue, retained history

The active worklist is a filtered VIEW of existing TaskStore records, not another
execution queue. Task status, lineage, continuation, node fencing and usage are
unchanged. Completed/partial tasks can bookkeep only when their runtime entry is
inactive; managed nodes also require a measured completed stop state.

Enabling workflow persists retention protection before scheduler startup. Pending,
accepted and archived records are not silently pruned under capacity pressure,
including unaccepted completed work. Message operation pins and unresolved node
reservations remain protected. The bounded task store can therefore fill; it
rejects new tasks rather than losing history/idempotency. No unbounded archive
warehouse/offload/retention policy is invented. Disabling this feature does not
silently undo the persisted retention guard. A future offload policy needs its
own reviewed implementation; do not manually delete records to make room.

## Compatible interfaces

Existing bearer/Origin/rate/body boundaries apply. Default disabled; no new public
listener, credential or account operation. The PR25 test entry remains two tools.

- `POST /v1/tasks/:id/archive` with empty object: bookkeeping after trusted user
  decision only. Extra approval/human/date fields are rejected. No merge/execute.
- `GET /v1/tasks?view=active`: active view when workflow enabled; normal query/status
  filters retained. Without that view, existing historical list behavior stays.
- MCP `archive_task({task_id})`: same gated bookkeeping. It may refresh the
  configured passive evidence source, never a model call or merge endpoint.
- MCP `list_active_tasks({limit?,query?,status?})`: read-only derived worklist.
- `GET /v1/reports/YYYY-MM-DD` / MCP `daily_report({date})`: bounded structured report
  reads; the same private Markdown file is the standalone daily artifact.
- Existing get/list/search history stays available; generic patches cannot write
  protected workflow records or fabricate historical acceptance.

When enabled, the existing read-only dashboard requests active view. It remains
read-only and makes no archive approval decision. API/Markdown report delivery is
implemented; a full foreground group-chat UI/vendor integration remains separate.

## Dependencies, scope and rollback

PR21+PR26→PR27→PR28→PR29; PR23+PR29→PR30→this increment. All predecessors remain
draft/unmerged. Obtain specific user approval before each main merge/retarget;
resolve compatibility on ordinary tested commits, never force push.

Disable admission/bookkeeping actions and stop active work before reviewed revert;
preserve state, report artifacts, protected history and audit. Older code cannot
honor new retention flags: never point it at these records and allow automatic
pruning. No destructive migration/cleanup, deploy or credential revocation occurs.

See [stage reconciliation](ACP-V1-STAGE-STATUS.md) for actual completion limits.
Offline tests are not real user approval, ordinary Chat document return or the
required actual persistent runner/home-PC-off acceptance.
