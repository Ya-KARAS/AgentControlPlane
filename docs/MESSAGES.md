# Unified local messages

First workflow increment after PR28. Foreground HTTP and background MCP use one
private TaskStore journal and the existing engineering task queue. This implements
shared local communication contracts; it is not a vendor personal-agent adapter,
ordinary Chat automation, a multi-user chat service or a finished group-chat UI.

## Defaults and envelopes

Optional configuration defaults to:

```json
{"messages":{"enabled":false,"maxStoredMessages":1024}}
```

Capacity is 1–4096 messages. Envelopes have strict `message_id`, `conversation_id`
(1–64 safe identifier characters), `channel` (`foreground` or `background`),
`kind` (`discussion` or `execution_request`), nonempty `text` (<=4096 characters
and <=8192 UTF-8 bytes), and optional existing `task_id`. Unknown keys, claimed
human/approval/sender identities and invalid task references are rejected.

The same conversation/message identity and content shared on both channels is
one record with both channel tags. Channel is presentation, never authentication
or a separate queue. Changed text/kind/task reference with that identity conflicts.
Server metadata always says `sender_verified:false`, `source:local_unverified`.
Message hashes verify content only, not authorship, user acceptance or truth.

Text remains bounded local private operational data alongside existing tasks.
No text is written into audit records, error messages, usage, PR bodies or remote
logs by this feature. A schema cannot certify free text secret-free: review it
before any authorized export. No vendor messages are sent and no files/URLs,
credentials, cookies or production config are read from message contents.

## Common surfaces

Existing application auth, Origin policy, request bounds and rate limiting apply.
No network binding is changed. The isolated PR25 test entry remains two tools.

- `POST /v1/messages`: post the envelope as data; never execute it.
- `GET /v1/messages?conversation_id=...&channel=...&limit=20`: read shared messages;
  limit1–50. Omitted filters see the bounded local journal; default disabled returns
  an empty disabled view without leaking saved data.
- MCP `post_message`: same envelope/journal, idempotent write annotation; no task.
- MCP `list_messages`: same filters/view, read-only annotation. Text is untrusted.
- `POST /v1/messages/dispatch`: explicit authenticated execution request with
  `{message,request}`. Message kind must be `execution_request`. Request follows
  the existing dispatch contract; its caller idempotency key is replaced by a
  server-derived message key. This is the only new execution bridge, not an
  automatic message consumer. Existing direct MCP/HTTP dispatch remains available.

A `task_id` on the execution envelope selects existing `continueTask`, preserving
server logical lineage and parent edge. Without it, normal `dispatch` creates the
initial task. Discussion references can point at a task but confer no mutation or
approval authority. No arbitrary prose is parsed into commands or auto-approved.

## Exactly one task under retry

The server derives a stable `message:<SHA256>` operation key from conversation and
message ID, independent of channel. Original Orchestrator request fingerprinting
still rejects conflicting execution content, and its single queue/workspace checks
remain authoritative. The journal binds resulting task/logical IDs durably.

Crash after dispatch persistence but before message mapping: replay uses the same
operation key and returns the existing task. If creation persisted before queue
insertion, audit failure faults the original store and immediate retry cannot run.
After clean restart, queued message-owned tasks stay staged; an explicit retry
checks retained audit segments, persists/syncs a recovery event and only then
re-enqueues the same bound task after mapping succeeds. Corrupt audit history
blocks recovery and requires operator inspection, never silent reconstruction. It never resumes managed-node tasks without their separately
branded node admission. Discussion/read operations cannot trigger this repair.

Messages and operation-owned tasks are not silently evicted. Until the subsequent
verified archive lifecycle persists history, task pressure fails closed instead
of removing message idempotency evidence. Unresolved execution-node reservations
are also excluded from pruning. Message capacity rejects new IDs while preserving
existing records. This stage does not pretend acceptance/report/archive is done.

Persistence reuses the existing writer lock, drift detection, atomic state rename
and append-only audit; no new queue/database/lock or background worker. Write/audit
failure faults the store and preserves evidence; separate state/audit crash windows
remain. Unexpected storage errors have fixed public messages, not private details.

## Remaining lifecycle and integration

Stack: PR21+PR26→PR27→PR28→this message increment. Future archive must integrate
PR23's trusted delivery projection: no caller flags, message text, model review,
manual observation or green CI can grant acceptance. Persist bound user acceptance
and a dated daily report first, then mark absent from active view. Failure must
keep it active/retryable and history retrievable. Implement that as a separate PR.
PR24 document-handoff validation remains its existing separate artifact; this
short-message journal does not replace or copy its version/hash/parent checker.

Real foreground group UI and vendor transports/identities remain unimplemented.
The shared API is runnable offline with real MCP/HTTP and fake executors; that
proves neither a callable Grok/Dot/Muse service nor automatic ordinary Chat return.
No new paid API, Notion, credential, permission or account installation is needed.

Rollback: disable messages; retain journal/task/audit and pinned idempotency data.
Stop active work before reviewed revert. Never delete messages or revert away
pins and let old code prune operation-owned tasks while retries can still arrive.
No main merge or auto-merge is part of this implementation.
