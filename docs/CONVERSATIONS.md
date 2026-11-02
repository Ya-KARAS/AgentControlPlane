# Offline project conversations

This increment stacks on PR31, preserving the single TaskStore, MessageHub,
controller ownership, execution-node reservations and delivery approval boundary.
It adds `/conversations`, linked from the original read-only Dashboard. That
Dashboard remains read-only; conversation actions are on a separate page.

## What works

Enable existing `messages.enabled` and configure the existing application bearer
before using this page. This change creates neither a token nor a new identity.
The page keeps an entered token only in memory, clears its input, uses same-origin
requests without cookies, and clears private content on page exit. No local/session
storage, credential URL, telemetry, external assets or vendor calls are added.
Application auth, Origin policy, body limits and rate limiting remain in force.
The new API fails closed when no application bearer is configured, including on
loopback; legacy endpoint defaults remain unchanged. Shared bearer authorization
is the local operator boundary, not proof of a named agent or human PR acceptance.

The project list derives from the most recent 100 existing tasks. A registered
`project_id` (`project:<registry UUID>`) shares one `project-<registry UUID>` conversation; otherwise tasks share their
`task-<logical_task_id>` conversation. No workspace path is exposed by this view,
no project is created, and an empty project has no conversation until a task exists.
Both foreground and background messages use the original journal. Registered
public agent descriptors populate `@target`; all say **not connected**. A mention
is a text prefix, never authentication, delivery, executor routing or a reply.
The service never invents a vendor agent or claims it has responded.

- Send discussion: persist one data-only message, optionally tied to a task.
- Confirm modification and continue: an explicit confirmation creates a child of
  a terminal task with an existing session through the original continuation and
  MessageHub idempotency contracts. This can enqueue work on already configured
  executors. It does not edit a running prompt, execute a discussion, switch its
  executor based on a mention, or set delivery approval. Runtime-active tasks are
  rejected even if their stored status has already become terminal.
- Request stop: a queued entry is actually removed through existing cancellation.
  A running turn is interrupted via its actual executor. The UI keeps showing its
  real task status and "awaiting terminal confirmation"; acknowledgement does not
  release the running workspace reservation. Only the existing terminal handling
  releases it. Missing turn identity, unknown runtime or interrupt failure cannot
  claim stopped; refresh and explicit retry are available. The legacy `/cancel`
  contract is preserved; the page exclusively uses the safer stop request.

There is no independent pause/resume feature: no supported executor-wide pause
contract exists. Save a modification as discussion while work is running; use
stop and wait for terminal state before an explicitly confirmed continuation.
An executor may finish successfully while the stop request races it; its actual
terminal result wins. If no terminal notification arrives, the task remains under
existing runtime supervision; physical process termination is not asserted.

## History and concurrent interaction

History reads show both channels and unverified-source labels. Each page is at
most 50 records; `before_sequence` loads older records from the same shared
journal. This optional bounded positive integer is also supported by the existing
HTTP/MCP message query. The browser retains at most 1024 messages per loaded
conversation, while server retention/capacity remains unchanged. Task objectives
and result summaries are bounded text; raw task events, workspace paths, auth
principals and private delivery evidence are omitted. This local page still
contains private user-supplied text: it is not a safe public export.

A request freezes its message identity and content across double click/transport
retry; changing a failed payload requires restoring that original request first.
Successful server receipt ends the mutation even if the subsequent refresh fails.
Navigation, browser back, reconnect and periodic refresh are reads only. Connection
generations invalidate old callbacks and abort outstanding requests on reconnect/exit;
old results cannot repopulate private DOM or use a newer connection's token. Drafts
and uncertain-operation envelopes live only in memory: reloading loses them and
never automatically replays a write. Inspect persisted history/tasks before
manually creating another request after an uncertain reload. Late responses cannot
replace the selected project or clear a newer draft; new background messages merge
with loaded history. Refresh every five seconds runs only while the page is visible.

## Protected endpoints

- `GET /v1/conversations`: bounded available conversation scopes.
- `GET /v1/conversations/view?conversation_id=...&before_sequence=...`: safe task,
  result, public target and common-message projection.
- `POST /v1/conversations/post`: strict `{conversation_id,message_id,text,target?,task_id?}`.
- `POST /v1/conversations/follow-up`: same envelope, existing terminal `task_id`
  required; uses original continuation, no caller-supplied execution policy.
- `POST /v1/conversations/stop`: strict `{conversation_id,task_id}`.

Unknown fields, cross-scope tasks and unknown targets are rejected. Target text
is not parsed for commands. Protected routes expose no new MCP tool and do not
change the isolated PR25 two-tool entry. Default-off messages and existing
controller/node/delivery gates are preserved. No approve, merge, deploy, credential
registration, import or automatic new-task dispatcher is added.

## Validation and remaining acceptance

Node tests run actual TaskStore/Orchestrator, HTTP and the page's serialized script
in a small DOM contract harness. Coverage includes unauthorized/cross-Origin and
no-token rejection, strict schemas, data-only discussions, same-message retries,
lineage continuation, paging, double clicks, failures, navigation, draft races,
background messages, safe text sinks, stop confirmation and actual fake-executor
terminal notification before the next same-workspace turn. No real executor runs.

The installed Chromium was attempted with its default sandbox. A profile-directory
technical failure was retried once with an isolated `/tmp` profile; Chromium then
aborted because its SUID sandbox helper was not correctly configured (root-owned
mode4755 required). No sandbox was disabled or permissions changed. Consequently
**real browser interaction/visual acceptance remains platform-blocked**. The DOM
harness and HTTP tests are offline evidence, not browser, vendor or ordinary Chat
end-to-end acceptance.

Minimum next real configuration: an existing authorized ACP host and workspace,
its private state directory and authoritative scheduler, existing application
access policy, configured public agent descriptors and separately verified vendor
transports if actual replies are desired. Those transports need individually
supported identity/capability tests; this page does not provision them. Real
execution needs an already authorized installed logged-in executor plus a separate
bounded live-test window. Real PR acceptance still requires the PR23 origin/RP,
trusted principal policy and personal authenticator enrollment. No such setup is
performed here. Cloud browser acceptance needs the platform's supported sandbox
configuration, not disabling its protection.

Rollback: disable messages to close these APIs, stop active work under the existing
host procedure before a reviewed revert, and preserve task/message/audit/report
history and all controller/node fences. No main merge, original-branch rewrite,
deployment or new account/resource is part of this increment.
