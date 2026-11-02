# Project conversation UI implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task. Steps use checkboxes.

**Goal:** An offline project conversation page for shared foreground/background history, explicit target mentions, task results and operator intervention.

**Architecture:** Stack on PR31. Derive project scope from existing tasks, reuse MessageHub and TaskStore, add strict protected conversation routes and an isolated page linked from Dashboard. No new queue or vendor adapter. Shared application authorization represents the local operator, never a named personal agent or human delivery approval.

**Tech Stack:** Node >=22, ESM, node:test, existing Zod and plain DOM; no new runtime package.

**Spec:** Original design PR20 §§1/4/5/8/9/12, docs/MESSAGES.md, docs/WORKFLOW-ARCHIVE.md, and parent-authorized project conversations/@target/history/progress/results/modify/stop increment.

## Global constraints

Preserve original Dashboard/HTTP/MCP, single logical queue and controller/node fences. Default-off messages controls this page. No real executors, credentials, deployment, main merge, paid calls or vendor transport. Discussion and mentions never execute. New actions require existing auth/Origin and explicit confirmation. No claim of user delivery approval.

## Review focus

- Late fetch/action responses after project switch must not replace selected history or clear another draft.
- Interrupted transport must retry the same message ID, never dispatch twice.
- Stop failure or pre-turn race must keep executor reservation and show unknown/pending rather than stopped.
- Untrusted task/message/target content renders as text with no script/HTML/navigation execution.
- Back/refresh/new background messages must be reads, preserve scope, never replay mutations.

## Task 1 — protected conversation contracts and safe stop

- [x] Add real TaskStore/Orchestrator HTTP tests for scope isolation, mention validation, auth/Origin, strict inputs, idempotent continuation and non-executing discussion; run RED.
- [x] Add stop tests: queued removal, no-turn fail-closed, interrupt failure retry, concurrent duplicate interrupt, acknowledgement without completion keeps workspace reserved, actual terminal result wins; run RED.
- [x] Add minimal conversation service/projection and routes; reuse MessageHub; existing terminal same-session continuation only. Add requestStop without changing legacy cancel semantics.
- [x] Add bounded before_sequence pagination to shared message query; test two pages and scope.
- [x] Run targeted GREEN and commit.

## Task 2 — page and asynchronous interaction

- [x] Test real client controller using controlled transport: double submit/retry, delayed refresh, draft protection, project switch/back, read-only refresh, safe failure. Run RED.
- [x] Build responsive semantic page with project list, shared history/channel tags, registered @target not-connected labels, task progress/results, discussion composer, explicit terminal follow-up and stop confirmations. Token only in memory; no storage/URL/log. No auto mutation on navigation.
- [x] Serve only fixed assets, link Dashboard; run targeted GREEN and commit.
- [x] Attempt installed Chromium with supported sandbox for real DOM interactions; if unavailable record exact platform error and retain automated controller/HTTP coverage, never disable sandbox.

## Task 3 — documentation and acceptance

- [x] Document capability/limits, complete original-stage matrix, concrete pending real configurations and rollback.
- [x] Independent whole-branch review; fix important issues RED→GREEN; final npm run verify.
- [x] Push feature branch, create independent draft based on PR31, verify exact remote SHA and Ubuntu/Windows CI. Do not merge.

Browser outcome: supported sandbox attempt blocked by misconfigured SUID helper; actual browser acceptance remains unpassed, never replaced by DOM harness. Independent review and final verify/remote receipt recorded in PR evidence once complete.

Independent whole-branch review found three Important issues: actual registry scope syntax, lifecycle callbacks after reconnect/pagehide, and uncertain follow-up task switching. All reproduced RED and fixed GREEN. No Critical, minor or deferred findings. Browser/live/vendor boundaries remain unpassed as documented.

Final Cloud verification: npm run verify exit0,964tests/963passed/0failed/1Windows-onlyskip; checkPASS. New targeted coverage23/23. No new package or live execution. Remote exact-head CI is recorded in the draft PR after push.
