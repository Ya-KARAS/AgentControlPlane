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

## Authorized follow-up: adapter contract and offline evidence preview

No actual approval channel has been chosen. Add a host-injected evaluator only;
never wire it to application/store/CLI/MCP and never add a trusted setter.

- [x] Write tests in `tests/delivery-evidence.test.js` before adding
  `src/core/delivery-evidence.js`: unconfigured unknown, explicit test-only host
  adapter/policy, exact repo/PR/head/user/event binding, incomplete pages,
  expiration/future time, 403, pre/post head races, replay/conflicting event IDs,
  revocation and new-head invalidation; public manual paths remain closed.
- [x] Observe missing-module RED; implement `createDeliveryEvidenceEvaluator({
  adapter, authorizeUser, clock })` returning `evaluate(target)` with preview-only
  candidate fields, never effective approval. Default policy denies every user.
  Adapter callbacks are trusted host code, never request/config JSON. All fake
  adapters exist only in tests. In-memory replay map is evaluator-local and
  bounded; no cached approval survives missing/expired evidence.
- [x] Run targeted GREEN and full verify, commit implementation/tests.
- [x] Document the contract and limits, final verify, commit; parent performs
  independent review before ordinary push on this same PR3 branch.

Review focus: a valid-looking GitHub User account is not a human policy decision;
403/incomplete/head-race never reuses a prior candidate; replay must not restore a
revoked decision; simulation must not reach a production setter. Replay memory
is not a durable replay ledger and this evaluator is not production acceptance.

## Host-only persistence follow-up (authorized, no credentials/live wiring)

Architecture: existing evaluator exports/restores bounded replay history, not authority. A host service can refresh a task only through injected authenticated adapter and explicit user policy. Its fresh decision is held in process only; persisted per-task history is private bookkeeping. Restart has no approval until fresh validation. Default application injects nothing; no HTTP/MCP/CLI mutation path exists.

- [x] Write evaluator history/restart revocation RED; implement strict bounded history restore/export, run existing16+new tests GREEN.
- [x] Write real TaskStore host-service RED for default denial, explicit simulated policy approval, expiry, new-head invalidation, cold restart replay/revocation, forged persisted flags, generic mutation, writer drift and persist/audit failure. Implement private capability commit callback under existing lock/audit, host-only DI service; read projection never trusts disk approval.
- [x] Write createApplication host injection RED and no-adapter/JSON config denial; wire only overrides.deliveryEvidence (not config/body), no network mutation route. Preserve legacy record updates and task lineage.
- [x] Run targeted suites and npm run verify, document durable-memory bounds, trusted-host threat boundary, exact still-unconfigured real adapter/user binding, rollback; commit. Parent independent review and ordinary feature push.

## Follow-up: verified merged fact (read only)

- [x] RED tests for optional provider merge evidence bound to exact observation target,
  explicit true/false/unknown, merge commit/event/source/time, mismatches and head races.
- [x] GREEN evaluator validation and durable merge high-water history; true cannot regress
  under replay/restart. History remains bounded and old histories load safely.
- [x] RED/GREEN host persistence/projection and safe audit, with no human policy needed
  for provider facts and no automatic approved decision. Manual merged stays rejected.
- [x] Verify targeted + full suite; document fact observation versus executing merge.
No actual GitHub client, merge action, credentials, network or default approver added.

## Read-only GitHub adapter (cloud-code follow-up)

No new authorization, credentials or live calls during implementation. The host
injects the network client; there is no default fetch, environment token lookup
or automatic application wiring. Cloud-only acceptance supersedes the earlier
local-node test proposal; no Windows/local fallback is authorized.

- [x] RED fixtures for exact GET endpoint/repo/head, malformed/403/429/redirect,
  bounded pagination/bytes/records, check context completeness and head races.
- [x] Implement createGitHubDeliveryAdapter({request,repository,requiredChecks,
  clock,ttlMs,maxPages,maxRecords,maxBytes,timeoutMs}) with readHead/readObservation.
  Only api.github.com PR and head check-run GETs; transport must disable redirects.
  Missing check policy produces unknown, never green from one workflow. No GitHub
  review is mapped to human acceptance; decisions remain empty.
- [x] GREEN targeted and full verify; document contract, cloud-only configuration,
  precise WebAuthn dependency blocker. No hand-written ceremony crypto or new deps.
- [x] Commit immutable head for parent independent review, no push by implementer.
