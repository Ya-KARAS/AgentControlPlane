# Unified messages — first offline workflow increment

Authority: ACP V1 single logical queue / explicit approval / local data boundaries,
PR24 workflow requirements and user continuation instruction 2026-11-02. Base
PR28 b6805107e0977659414d8c4cff455f04b5e94c59; no copied prerequisite commits.

Order: shared foreground/background message persistence + explicit idempotent
execution bridge first; then integrate PR23 trusted approval and implement report
before archive as a separate PR. A discussion is data, never automatic dispatch.
No Notion/vendor account, remote send, browser session or live executor required.

## Task 1 — shared journal and bridge (TDD)

- RED bounded strict envelope, channel replay merges one shared record, content/
  parent conflicts, capacities, restart and write failure using real TaskStore.
- Reuse TaskStore state/writer/audit and actual Orchestrator idempotency; stable
  message operation key independent of foreground/background. Explicit execution
  bridge uses dispatch or existing continuation based on task reference.
- RED crash between dispatch and mapping; retry same task/turn. Pin message-owned
  tasks until durable archival exists; never prune unresolved node reservations.
- GREEN targeted suite, ledger and commit.

## Task 2 — compatible surfaces (TDD)

- Default-off config; protected HTTP post/list/dispatch and MCP post/list over the
  same hub. No vendor transport or scheduled reader. Existing dispatch remains.
- RED actual HTTP/MCP tests for shared messages, feature-off, auth/Origin, readonly
  annotations, no execution on post/read, fixed errors and untrusted claimed actor.
- GREEN targeted suite; docs describe remaining frontend/vendor/approval gates.

## Task 3 — verification/delivery

- Full npm run verify; one independent whole-branch review, important fixes
  RED→GREEN, final suite. Push branch, create stacked draft PR and exact-head CI.
- Next archive phase must use actual trusted PR23 projection and persist acceptance
  then dated report before excluding from active view; no model-provided approval.

Review focus: same message on two channels is one operation; ambiguous restart
cannot create a second task; arbitrary prose/actor/human fields confer no powers;
no new task queue/lock; bounded local data, no raw text in audit/errors; preserve
node fences, task lineage/history and all existing clients.


## Recorded verification and review

Core and surfaces have RED→GREEN evidence, including channel replay, actual
HTTP/MCP, prototype-like unknown tool names, node reservation pruning and queue
insertion gap. Pre-review full verify791tests/790passed/0failed/1Windows-onlyskip.
One final-review P2: creation audit failure must fault the store before retry can
repair queue membership. Reproduced plus corrupt-audit negative control, then
fixed: immediate fault, no automatic queued-message replay after restart, explicit
recovery verifies retained audit chain and syncs recovery event before admission.
Targeted17/17. No deferred findings. No live model/vendor/account operation.
Final verification: npm run verify exit0,792tests/791passed/0failed/1Windows-onlyskip;
check passed. Message/retry/HTTP/MCP suite17/17. Exact remote CI recorded in PR.
