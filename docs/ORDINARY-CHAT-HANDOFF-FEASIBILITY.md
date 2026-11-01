# Ordinary Chat handoff: workflow and minimum feasibility

Checked 2026-11-01 against `main@638e6d7ba89f621c7163ce97c14071a43bcc1004`.
This independent branch preserves the unmerged PR0–PR3 branches and changes no
runtime dispatch, companion, userscript, identity, queue or credential behavior.
The earlier PR5 preparation is on PR23 at `docs/plans/PR5-CHAT-FEASIBILITY.md`;
this document carries forward its manual-path boundary without copying PR23 commits.

## 最终工作流 / agreed workflow

私人 Agent 整理需求 → 用户确认交接包并在普通 ChatGPT Chat 发送 → 普通 Chat
编写工程文档 → 用户人工导回文档 → 私人 Agent 审阅并调度实际可用执行器 →
代码、测试、审核及 draft PR → 私人 Agent 与用户验收。

验收不通过：回到同一逻辑任务的文档修订，保留旧版本、原因、执行与 PR 证据；
不得复制成一个无关联的新任务。验收通过：仍必须由用户明确确认 main 合并，
AI 推荐、绿色 CI 或文档确认都不等于合并授权。先写当天日报并持久记录成功，
再移出活动队列；历史任务、消息、版本、验收与 PR 记录保留，不删除。

GitHub + ACP 是必需平台，Notion 不是依赖。前台群聊和后台 Agent 协作应使用
统一消息语义，均引用同一逻辑任务和文档版本；这些消息不创建第二工程队列。

**Implemented here:** offline packet validation and compatibility tests only.
Unified messaging, daily-report-before-archive and this end-to-end lifecycle are
requirements for later implementation/acceptance, not existing delivered services.
`task.status=completed` remains an executor outcome, not user acceptance or archive.

## Capability and evidence matrix

| Step/capability | Repository or official evidence | Result for this round |
|---|---|---|
| ChatGPT invokes ACP MCP | `src/mcp/server.js:99` dispatch; `:205` continue; `:247` handoff; official plugin connection guide | Reusable northbound interface; no logged-in ordinary Chat connection tested |
| Private Agent starts a new ordinary Chat turn | No supported channel established by repository or cited connection guide | Unverified; do not promise unattended triggering |
| Secure MCP Tunnel | `docs/CHATGPT-CONNECTION.md`, official endpoint preparation | Tool-request transport, not permission or API for initiating ordinary Chat; no tunnel created |
| MCP Events | Official guide explicitly scopes availability to Work chats/dots | Not substituted for ordinary Chat; no event subscription created |
| Companion task parsing/settings | `browser-companion/src/protocol.js:8`, `:54`; background dispatch at `src/background.js:188` | Code reuse candidate after a separate supported-surface gate, not a transport exercised here |
| Companion result formatting/fingerprints | `browser-companion/src/protocol.js:115`, `:198` | Existing formatter may include broader task data; not a safe export allowlist or cryptographic provenance. Do not dump raw results into Chat |
| Userscript conversation return | `userscript/README.md` conversation flow; `userscript/src/runtime.user.js:946` | Existing DOM/auto-insert/send code is present; NOT used or authorized for this workflow |
| Compact local result status | `src/local-review/service.js:145` publicTaskStatus | Reuse safe summaries after review; never raw prompts, paths, logs or auth material |
| Single queue and retries | `src/core/orchestrator.js:414`, `:976`; `src/core/store.js:673` | Real offline tests verify one dispatch on replay, conflict on changed payload |
| Logical continuation | `src/core/store.js:72`, `:486`; existing continueTask | Real offline test preserves ACP lineage with a fake executor, not a live model |
| Executor availability | `src/executors/lifecycle.js`, existing discovery/capability gates | Only actually configured compatible executors; names such as Gemini/Cursor are candidates, not this test's verified availability |
| Group/background messages, daily report/archive | New user workflow above | Design/checklist only; no new message service or archive API |

Official references checked 2026-11-01:
[Connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
describes endpoint, discovery/auth and ChatGPT tool selection. It does not
establish a private-Agent API to initiate ordinary Chat turns.
[MCP Events](https://developers.openai.com/plugins/build/mcp-events) describes
availability in Work web/desktop Cloud chats and dots; that is a different surface.
[EU terms](https://openai.com/policies/eu-terms-of-use/) restrict automatic or
programmatic extraction of outputs; this document is not a legal certification.
No DOM/OCR reply collection, cookies/tokens, private API or hidden auto-send is
used. API, Codex and Work tests are not ordinary Chat connectivity tests.

## Manual fallback that can be used without new account permissions

1. Private Agent prepares an explicit bounded packet and reviewable body file.
   The user removes secrets, absolute local paths and unnecessary source/logs.
2. Run the offline checker below. It checks schema, expected lineage and exact
   bytes; it never opens a page, sends, imports, dispatches or authorizes anything.
3. User opens ordinary Chat themselves, reviews the body and manually sends it.
   A future one-click action may package/open only; it must not click Send or read
   replies. No such launcher is implemented here.
4. User requests an engineering document, reads the reply, then manually saves or
   copies the complete document. User checks completeness and records a new
   returned-document packet; preserve the exact bytes, not a silent truncation.
5. Validate that packet against the expected parent revision and logical task.
   The private Agent reviews its test plan/scope. User separately confirms any
   engineering dispatch; no packet boolean constitutes authenticated human identity.
6. Existing ACP dispatch/continue executes the reviewed compact brief. Record the
   returned ACP IDs, tests and PR; do not send the entire Chat transcript.
7. On rejection, revise the document. On acceptance, user separately confirms any
   merge; write the dated report before moving out of active view, retaining history.
   Steps involving integrated reporting/archive remain proposed, not implemented.

The next exact offline action is:

```sh
node scripts/check-chat-handoff.js docs/examples/ordinary-chat-handoff.json --expected-parent 0 --logical-task intent-acp-example
```

Expected output contains `valid:true`, `offline_only:true` and
`confirmation:pending_user_review`. The example is synthetic; do not send it as
though it were the user's actual requirements. For a real packet, prepare the
reviewed body, compute its UTF-8 SHA256, fill the fields below and rerun the checker.
The next actual ordinary Chat step is the user's manual review/send and return;
no login, installation or transmission was performed by this development round.

## Packet contract (offline v1)

[Example](examples/ordinary-chat-handoff.json),
[validator](../scripts/lib/chat-handoff.js),
[checker](../scripts/check-chat-handoff.js).

| Field | Contract |
|---|---|
| schema_version | Exactly1 |
| logical_task_id | Stable intent correlation ID, 1–64 safe characters |
| handoff_id | Distinct transfer-attempt ID, 1–64 safe characters |
| direction | requirements_to_chat or document_from_chat |
| version / parent_version | Positive sequential handoff revision, version=parent+1; initial parent0. Caller must supply expected parent |
| source | private_agent for requirements; ordinary_chat_manual for user-returned document; self-reported provenance only |
| summary | Reviewable nonempty summary, maximum1000 characters |
| body | Exact reviewed UTF-8 text, nonempty, maximum65536 bytes |
| body_sha256 | Lowercase SHA256 of exact body bytes, no normalization or lossy trim |
| idempotency_key | chat-handoff:{logical_task_id}:{direction}:{version}:{body_sha256} |
| confirmation | Always pending_user_review; no approved/merge/authenticated-human field accepted |

The CLI additionally caps the complete serialized JSON file at **262144 bytes
(256 KiB)** before parsing. This is separate from the decoded UTF-8 body limit
of **65536 bytes (64 KiB)**. Excessive JSON escaping can exceed the file cap even
when the decoded body is valid; save a compact UTF-8 JSON representation instead.
The CLI rejects such files with a generic error and never prints their content.

The packet's `logical_task_id` is the intent correlation ID before ACP dispatch,
not permission to overwrite ACP's server-generated `logical_task_id`. Keep a
mapping from intent ID to the first returned ACP logical ID and each execution
task ID. Continuation uses ACP's actual parentTaskId/logical lineage. Packet
versions describe handoff artifacts, not native executor session IDs. The checker
neither persists that mapping nor offers a second task store.

A different handoff attempt ID with the same content/revision yields the same
operation key. Different content needs a new sequential revision and key; a same
key with changed execution content still triggers ACP's existing conflict.
SHA256 checks bytes, not document authorship, user identity or content truth.
A packet's self-reported source cannot establish a trusted user approval event.
Unknown keys and approval assertions are rejected. Free text cannot be certified
secret-free by a schema: manual content review is mandatory before export.

## Acceptance checklist and honest current evidence

- [x] Offline exact-byte contract validation; tamper, stale parent, wrong logical
  task, invalid source, oversized body and claimed approval rejected.
- [x] Equivalent retry uses the same operation key.
- [x] Real TaskStore/Orchestrator with RecordingExecutor: replay creates one task/
  turn; conflicting content rejects; continuation retains logical ID and parent.
- [x] CLI emits bounded metadata, not the body; missing parent context fails.
- [ ] Actual ordinary Chat personal-account plugin/tool permission verified by user.
- [ ] User manual sends a real reviewed packet and returns a complete document;
  expected hash, lineage, version and acceptance reviewed without automatic extraction.
- [ ] Real executor availability and separately authorized live engineering test.
- [ ] Unified messages reference one logical task without duplicate queue entries.
- [ ] User acceptance, dated report persistence, then active-view removal; failure
  writing report must leave task active; history remains recoverable after restart.
- [ ] Authenticated merge approval and real live connection gates from PR3.

No browser/account session, model quota or prohibited network retry was used.
Full `npm run verify` remains the handoff gate. Offline passing tests do not prove
ordinary Chat connectivity, model quality, user approval or platform permission.

## Rollback and next implementation boundary

Revert this independent documentation/checker commit through review if unwanted.
No migration, task-store schema, default config, dependency, runtime route or
account setting changed. Existing unmerged feature branches are untouched.
The future message/lifecycle/import UI should have its own reviewed plan and tests;
this preparation is not permission to implement scraping, auto-send or archive
services. Preserve the explicit manual path if no supported channel is verified.
