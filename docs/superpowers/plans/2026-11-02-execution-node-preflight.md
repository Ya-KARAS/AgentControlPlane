# PR4a — execution-node preflight, not cloud execution acceptance

Authority: uploaded ACP V1 design §§5/7/11, preserved in PR20; SHA256
7942d94be736dfc55dcfce66096dba0bcbe1bf08bbc1b58a534e9e7f15f8ff1a.
Continuation authorized 2026-11-02. Base main
638e6d7ba89f621c7163ce97c14071a43bcc1004. Independent branch; no copied PR20–25 commits.

## Scope and decisions

Implement the first independent offline part of PR4: bounded optional node
registry, host-injected cached observations, local-first read-only planning
advice. Disabled by default. No node assignment, scheduler changes, distributed
lock, credentials, remote transport, polling or executor starts. An eligible
planning candidate is never execution permission. Missing/stale/invalid facts
fail closed. Runtime must still block switching an active/uncertain workspace.
Existing PR4 design is in PR23 docs/plans/PR4-CLOUD-PILOT-DESIGN.md; its real-runner
and recovery gates remain required, not replaced by these tests.

Node config: enabled boolean false by default, nodes [] (max64); each strict
{id,kind:local|cloud,authorized:boolean=false,executor_ids:string[]} (max16).
No paths, URLs, commands, secrets or identities. Observation input is host-only
cached data, not an MCP request: strict node_id/observed_at/valid_until plus
online/runtime_ready/workspace_ready/authentication_ready/persistent booleans.
TTL max60s; clock server supplied. Persistence is required for cloud planning.
No subscription-balance inference and no readiness imported from task prompts.

## Task 1 — pure node contract and config (TDD)

- [x] Add tests for defaults/duplicates/bounds/unknown fields; real config loading.
- [x] Observe RED before implementing strict normalization and config validation.
- [x] Add pure view tests: missing/offline/stale/future/incompatible/unapproved,
  explicit cloud no fallback, ephemeral cloud blocked, local first, invalid host
  data, sanitized public fields, fresh expiry and no input mutation.
- [x] GREEN targeted tests, record outputs; commit.

## Task 2 — read-only MCP host composition (TDD)

- [x] RED tests through actual MCP protocol: tool annotation/schema, disabled
  legacy config, no caller-supplied observation/approval accepted, host data only,
  no store writes/dispatch/executor start, no secret/error reflection.
- [x] Add execution_nodes read tool to existing production MCP boundary and
  optional in-process host observation injection in createApplication. Default
  has no observer, so configured nodes remain unknown. No new endpoint or setter.
- [x] GREEN targeted tests; commit.

## Task 3 — evidence and review

- [x] Record PR20–25 head/CI/dependency/completion matrix and exact live blockers.
- [x] Document config, host trust, advisory-only limits, rollback and PR4b gates;
  preserve English/Chinese architecture/protocol parity.
- [ ] Run npm run verify; independent whole-branch read-only review; fix important
  issues RED→GREEN then final verification. Push feature branch, read remote SHA,
  create draft PR and check exact-head CI. Do not merge.

Review focus: caller cannot supply host observations; arbitrary extra fields do
not leak; clock/TTL boundaries; explicit unavailable cloud never silently routes;
no second queue, task or executor; this feature does not claim execution fencing,
cloud acceptance, subscriptions or ordinary Chat automation.
