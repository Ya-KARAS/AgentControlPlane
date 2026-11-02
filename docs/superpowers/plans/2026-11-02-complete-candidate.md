# Complete offline candidate integration plan

> **For agentic workers:** Use superpowers:executing-plans task by task.

**Goal:** Compose the preserved PR22/0/24/25 ancestors into the PR32 chain and provide credential-free browser fixture readiness.

**Architecture:** Ordinary merges preserve all feature histories. Resolve additive imports/tools/scripts/docs without replacing existing controller/node/delivery/message/workflow contracts. Production startup stays unchanged; a separate synthetic loopback page server imports only the pure page and fixed fixture data.

**Tech Stack:** Node >=22, ESM, node:test, existing Zod/MCP; no new dependency.

**Spec:** docs/ACP_V1_ENGINEERING_DESIGN.md; docs/CONVERSATIONS.md; parent-authorized complete offline candidate integration and credential-free fixture preparation.

## Global constraints

No main merge/force push, no real ACP deployment, credentials, user enrollment, vendor/model/runner execution or paid resources. Unknown/expired subscription observations are not zero quota. Auto-reroute stays off. Synthetic fixtures never represent production/ordinary Chat acceptance. No sandbox disabling or permission change.

## Review focus

- Merges must retain all old tool/config/task/private evidence/fencing behavior.
- Subscription imports must preserve message/workflow state, audit and task usage separation after restart.
- Original uploaded document byte hash and all planned artifacts must survive in one candidate tree.
- Fixture must not load production config/state/credentials/executors or forward requests.
- Fixture startup/HTTP bounds/exit must be safe on both supported CI platforms; browser acceptance remains distinct.

## Tasks

- [x] Compare remote feature SHAs and merge PR22, PR0, PR24 and PR25 in ordinary commits; resolve additive conflicts; run existing targeted tests.
- [ ] Add regression tests for subscription/message/workflow coexistence and combined HTTP/MCP surfaces; verify original design hash and ancestor inventory.
- [ ] Inspect existing CI browser support. If absent, add minimal credential-free loopback fixture launcher and contract tests RED→GREEN plus exact manual browser steps/resources. Do not invent a Playwright-ready CI environment.
- [ ] Independent whole-candidate review, important fixes RED→GREEN, final npm run verify, normal push, independent draft based on PR32 and exact-head CI readback.
