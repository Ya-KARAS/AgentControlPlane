# GitHub Delivery State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task with test-driven-development.

**Goal:** Record safe PR delivery observations independently of task execution and enforce a closed human-approval boundary.
**Architecture:** Pure strict delivery transitions; additive optional TaskStore metadata and offline local import; read-only MCP/HTTP and existing task dashboard display. No GitHub write client or approval automation.
**Tech Stack:** Existing Node >=22, ESM, node:test, MCP SDK; no dependencies.
**Spec:** PR0#20 design Sections8/11, original SHA256 `7942d94be736dfc55dcfce66096dba0bcbe1bf08bbc1b58a534e9e7f15f8ff1a` (read from PR0 branch).

## Scope and decisions

- Independent `main@638e6d7ba89f621c7163ce97c14071a43bcc1004`; no PR1/PR2 commits, no retarget dependency. Preserve old tasks, lineage, task.status, usage, audit and execution.
- Manual observations are explicitly unverified, not fetched GitHub truth. Unobserved fields stay null/unknown. Whitelist repository, base_branch, branch, pull_request_number, head_sha, checks, review_state, observed_at. No freeform messages, test output, paths, credentials or URLs accepted.
- Approved/merged states are recognized but cannot be admitted: there is no verified human approval/merge observation channel today. Fail closed with human_approval_unavailable; model/CI/shared bearer/TTY/--human assertions cannot substitute. No approved transition will be fabricated to satisfy a test. A future independently authenticated user-event adapter is a separate design; approval must bind repository/PR/head and invalidate on change.
- Offline CLI requires --offline operator assertion and stop/import/restart. No process-shutdown detection or new credential is claimed. Inputs capped64KiB; errors never echo file contents.
- Existing JSON state/writer lock/drift guard and audit reused, no new queue. Equal observation retry idempotent; older or same-time conflicting updates rejected; task repository/PR cannot silently switch once attached. New head clears old checks and resets review to pending_review unless draft/closed/not_requested observation; changes_requested can be followed by same-task revision.
- Generic updates may retain equal delivery fields but cannot overwrite them. Safe read normalization drops malformed/untrusted persisted delivery. No transport mutation/approve/merge/deploy endpoint.
- No real model/quota tests, GitHub calls/token changes, relay edits, main merge/force/auto-merge, PR4+ or local fallback.

## Review focus

1. Green CI, model recommendation and arbitrary human:true must never imply approved (Task1/2 tests).
2. New commit must not retain old checks/review; changed repository or PR must not transplant a decision (Task1).
3. Rejected PR remains recoverable with task status/lineage intact, including restart (Task2).
4. Concurrent/stale writer and conflicting timestamps must not overwrite current metadata or partially persist (Task2).
5. Output must not expose prompts/paths/secret extras, and UI must escape imported labels (Task3).

## Task1: Pure metadata and transitions

Files: `src/core/delivery.js`, `tests/delivery.test.js`.
Interfaces: normalizeDelivery(input,{nowMs}); transitionDelivery(current,input,{nowMs}); safeDelivery(input) -> normalized metadata or null. Reported checks unknown|pending|passed|failed; effective checks/review always unknown (no live verification); separate reported_checks/reported_review_state; all observations source=manual/verification=unverified and approval_supported=false; UTC ISO timestamp canonical; 40hex SHA or null; bounded Git-safe relative branch names, owner/repo slug, PR positive integer or null.
- [x] Write literal tests for defaults, invalid refs/SHA/time/unknown keys, every nonprivileged state, CI doesn't approve, forged human/approved/merged rejection, stale/conflict/idempotency, new-head resets, identity pinning and rejected revision.
- [x] Run `node --test tests/delivery.test.js`, expect missing module; retain RED.
- [x] Implement pure bounded validation/transitions, no I/O.
- [x] Run targeted GREEN and full `npm run verify`; commit.

## Task2: Persistence and operator-local import

Files: `src/core/store.js`, `scripts/import-delivery.js`, `tests/delivery-store.test.js`.
Interfaces: store.recordDelivery(taskId,input), store.getDelivery(taskId); CLI `node scripts/import-delivery.js --offline TASK_ID FILE` using existing loadConfig stateDir, no executor construction.
- [x] Test legacy null defaults, cold restart, status/lineage unchanged across rejection/revision, stale instance drift, generic-patch bypass, no partial invalid update, audit chain, CLI safety and approval rejection.
- [x] Run tests expect missing methods/script RED.
- [x] Add synchronous checked persistence/audit using existing primitives; offline script strict size/arguments/generic errors. No approval capability manufactured.
- [x] Run GREEN and full verify; commit.

## Task3: Safe read surfaces

Files: `src/server.js`, `src/mcp/server.js`, `src/dashboard.js`, `tests/delivery-surfaces.test.js`.
Interfaces: GET `/v1/tasks/:id/delivery`; MCP `delivery_status(task_id)` readOnlyHint; dashboard uses existing task delivery records, no extra network mutation.
- [x] Test real HTTP auth/GET and unsupported POST; MCP registration/call/safe-null data/no mutation or executor calls; VM-execute escaped delivery renderer including hostile labels.
- [x] Run RED, implement minimal surfaces, run GREEN/full verify; commit.

## Task4: Contracts and delivery

Files: docs/DELIVERY.md, bilingual architecture/protocol, docs index/scripts README/package command.
- [x] Document observation sample, unknown/unverified meaning, unsupported authenticated approval, stop/import/restart, no authority inferred from CI, recoverable refusal, additive-state rollback and no merge/deploy.
- [x] Verify full suite and diff; commit.
- [ ] Parent independently reviews immutable head; fix findings with RED/GREEN, final verify. No push by implementer; parent handles ordinary feature push/coordinator draft PR.
