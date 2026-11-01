# Subscription Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Show honest manually imported subscription availability separately from task tokens and cash, with read-only route advice.
**Architecture:** Pure bounded snapshot normalization/freshness/advice; optional snapshots in existing TaskStore state; operator-local import; existing authenticated HTTP/MCP and dashboard read views. No provider probes or routing mutations.
**Tech Stack:** Node >=22, ESM, node:test, existing MCP SDK. No dependencies.
**Spec:** PR0 #20, `docs/ACP_V1_ENGINEERING_DESIGN.md` Section6, read from PR0 branch; original SHA256 `7942d94be736dfc55dcfce66096dba0bcbe1bf08bbc1b58a534e9e7f15f8ff1a`.

## Decisions and constraints

- Independent main-based PR2: controller ownership is not needed. Base main638e6d7; PR0/PR1 remain unmerged; no retarget dependency. Merge/retarget only after user approval.
- Manual-only admission now; source=manual, confidence=user_reported. Other documented source/confidence enum values normalize but cannot be asserted by manual import. No official-adapter claim.
- Scope identity includes provider/surface/account_alias/plan/model_family/quota_window. No sum across scopes. Slug aliases only, not real account identifiers.
- Validity must be explicit, after observation and within24hours. Future observations rejected. Expired or malformed records are unknown/unavailable for advice; null percentage stays null. Reset is explicit or null, never inferred.
- Snapshots include overage_status=unknown|disabled|enabled (default unknown). Advice warns/requests approval for unknown/enabled overage; never claims a free route.
- Optional trusted local config `subscriptions.routes` maps exact snapshot scope to executor plus compatible/previously_verified booleans. These are operator assessments, not automatic capability checks. Unset capability fails closed. No provider-name guessing. Read view never changes dispatch/reroute. All manual candidates require operator approval.
- Reuse existing TaskStore lock/drift/persistence/audit; cap256 scopes. Older observations and conflicting same-time snapshots rejected. No second task DB or migration; old state remains readable.
- No API keys, model calls, subprocess polling, cookies/session extraction, private billing APIs, new auth, resources, relay changes, main merge or PR3+.

## Review Focus

1. Expiry at exact valid_until clears green/percentage/reset without rewriting historical observation.
2. Different plan/model/window/account must never be merged or mapped to the wrong route.
3. Manual input cannot self-assert official provenance or store arbitrary credential/output fields.
4. Older/stale concurrent writer cannot overwrite newer state; existing tokens/audit remain intact.
5. UI renders untrusted strings safely and an unavailable endpoint cannot retain stale green state.

## Task1: Pure schema, freshness and advisory

Files: create `src/core/subscriptions.js`, `tests/subscriptions.test.js`.
Interfaces: normalizeSubscriptionSnapshot(input,{nowMs}); subscriptionScope(snapshot); effectiveSubscription(snapshot,nowMs); subscriptionAdvisory(routes,snapshots,nowMs).
- [ ] Write literal-fixture tests: null vs0; invalid enum/percent/time/unknown keys; exact expiry unknown; reset not guessed; scope separation; incompatible first; exhausted skip; warning/unknown approval; overage risk; available-first order; no mutation.
- [ ] Run `node --test tests/subscriptions.test.js`, expect missing module failure; retain RED log.
- [ ] Implement pure functions with no I/O; slug IDs and bounded plan labels, strict safe schema.
- [ ] Run targeted tests expect all pass, then `npm run verify`; retain GREEN output.
- [ ] Commit pure module/tests.

## Task2: Existing-store persistence and local manual import

Files: modify `src/core/store.js`; create `scripts/import-subscription.js`, `tests/subscription-store.test.js`; update package script/docs later.
Interfaces: TaskStore.recordManualSubscription(input); TaskStore.listSubscriptionSnapshots(nowMs=Date.now()); CLI `node scripts/import-subscription.js FILE` uses loadConfig stateDir, max64KiB input, no executor construction, safe generic errors.
- [ ] Test legacy state, cold restart, stale/same-time conflict, bounded records, no official provenance, secret field rejection, unchanged tasks/usage/audit integrity, stale writer drift; execute CLI with isolated config/state.
- [ ] Run targeted command expect missing store methods/script RED.
- [ ] Add minimal checked synchronous existing-store transaction; whitelist manual admission and audit safe scope/action only; generic CLI errors do not echo input/path/secrets.
- [ ] Run targeted GREEN + full verify, fix real compatibility issues; commit.

## Task3: Read-only HTTP/MCP/dashboard

Files: modify `src/server.js`, `src/mcp/server.js`, `src/dashboard.js`; create `tests/subscriptions-surfaces.test.js`.
Interface: subscriptionStatus(store,config,nowMs) returns snapshots + advisory only. GET `/v1/subscriptions`, MCP `subscription_status` (readOnlyHint=true), dashboard separate section using same-origin GET and text escaping. No mutation tool/route.
- [ ] Test HTTP auth/no POST, MCP registration/call, no writes or executor calls, empty unknown-safe view, safe UI renderer evaluated in VM (not source-text assertions), endpoint failure clears displayed data.
- [ ] Run targeted RED, implement minimal read-only surfaces, run targeted GREEN.
- [ ] Run `npm run verify`, commit.

## Task4: Contract, rollback and delivery

Files: docs/SUBSCRIPTIONS.md; bilingual protocol/architecture focused additions; scripts/README.md and package.json operator command.
- [ ] Document manual import sample, scope/freshness/provenance, trusted capability assessments, no auto-routing, missing observation unknown, overage approval, no polling/adapters yet, rollback preserves state/audit.
- [ ] Run `npm run verify`, inspect diff/no secrets; commit docs.
- [ ] Parent dispatches independent read-only review, resolve important findings with RED/GREEN, final verify. Parent handles ordinary push and coordinator creates draft PR; never merge.
