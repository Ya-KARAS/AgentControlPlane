# ACP V1 PR0 baseline and compatibility matrix

Recorded on 2026-11-01 for [the V1 engineering design](ACP_V1_ENGINEERING_DESIGN.md).
This is a documentation baseline, not a claim that the proposed V1 features
already exist. PR1 implementation has not started.

## Source and environment

| Item | Observed value |
|---|---|
| Repository / origin | `https://github.com/Ya-KARAS/AgentControlPlane.git` |
| Base branch | `main` |
| Verified remote main HEAD | `638e6d7ba89f621c7163ce97c14071a43bcc1004` |
| Baseline checkout HEAD | Same as remote main HEAD |
| Package version / license | `0.9.3` / `AGPL-3.0` |
| Execution environment | Existing saved Codex Cloud environment; no local-computer fallback |
| Node / package contract | `v24.19.0` / Node `>=22`, ESM |
| Initial tracked working tree | Clean; `git status` and `git diff` inspected before edits |
| PR0 branch | `docs/acp-v1-pr0-baseline` |

`git fetch origin main` and `git ls-remote origin refs/heads/main` confirmed the
base SHA. This is a dated snapshot; recheck main before implementing PR1.
Read the repository instructions in `AGENTS.md` and the architecture, protocol
and development documents before preparing this baseline. No repository-local
`.agents/skills` or `SKILL.md` files were present.

The uploaded design is preserved byte for byte at
[`ACP_V1_ENGINEERING_DESIGN.md`](ACP_V1_ENGINEERING_DESIGN.md):

- Original filename: `ACP_V1_Codex_Engineering_Design_2026-11-01(1).md`.
- Size: **31,945 bytes**; UTF-8, LF, final newline.
- SHA-256: `7942d94be736dfc55dcfce66096dba0bcbe1bf08bbc1b58a534e9e7f15f8ff1a`.
- The supported Library transfer failed twice. The coordinator subsequently
  transmitted the complete original text within the authorized development
  session. The resulting cloud-container file matched both the original byte
  count and SHA-256 before being copied into the repository. No guessed download
  URL, alternate execution environment or new credentials were used.

## Verification evidence

| Run | Exit | Result |
|---|---|---|
| Initial `npm run verify`, before dependency setup | `1` | 619 tests: 606 passed, 12 failed, 1 skipped; SDK package missing; `check` did not run |
| Dependency setup with `npm ci --cache /tmp/acp-npm-cache --ignore-scripts --no-audit --no-fund` | `0` | 95 packages installed from the existing lockfile; tracked manifests unchanged |
| Baseline `npm run verify`, after setup | `0` | 650 tests: 649 passed, 0 failed, 1 skipped; `check` passed |
| PR0 documentation `npm run verify` | `0` | 650 tests: 649 passed, 0 failed, 1 skipped; `check` passed |

The first dependency-install attempt failed because npm's default home cache
could not be created. A writable temporary cache resolved setup without changing
credentials or dependencies. The missing-dependency test run is retained as a
setup failure, not a source regression. `verify` is `npm test && npm run check`,
including server syntax, userscript consistency, Markdown links and browser
companion validation (8 scripts).

These are offline test-suite results. No live executor readiness, subscription
availability, cloud failover, relay connectivity or real model quota was tested.
`doctor`, live demos and quota-consuming acceptance commands were not run.
The grounded-copy operator lint is separate from `verify`; no `copy_lint.py`
was supplied by the repository, so that optional operator check was not run.

## Compatibility matrix

The evidence column names existing implementation and test files inspected for
planning. Passing the baseline suite establishes the starting point; the PR1
requirements below still need their own failing tests and implementation.

| Surface | Existing evidence | PR0 / PR1 compatibility requirement |
|---|---|---|
| MCP dispatch and status | `src/mcp/server.js`; `tests/mcp-discover.test.js`, `tests/mcp-input-limits.test.js` | PR0 changes no tool. PR1 preserves legacy callers and responses; adds only read-only controller status. |
| Controller metadata and identity | `src/controllers/controller.js`; bearer check in `src/server.js` | Preserve legacy `id`, `kind`, `model` normalization. Metadata alone is not authentication. PR1 must not infer separate personal-agent identity from shared bearer access or a caller-supplied ID. |
| Task persistence and audit | `src/core/store.js`; `tests/store.test.js`, `tests/audit-integrity.test.js` | Retain the bounded JSON store, existing records and audit chain. PR1 adds safe optional controller fields without a second store or distributed-state claim. |
| Queue, retries and lineage | `src/core/orchestrator.js`; `tests/orchestrator.test.js`, `tests/cross-executor-handoff.test.js` | Keep the existing logical queue, idempotency conflict semantics, logical IDs and parent relationships. PR1 takeover must not enqueue or start another executor turn. |
| Executor boundary and recovery | `src/executors/lifecycle.js`; `tests/executor-adapter.test.js`, `tests/executor-checkpoint.test.js` | Preserve adapters and checkpoint/recovery behavior. A new controller lease is separate from the existing executor checkpoint lease. |
| Continuation and explicit handoff | `docs/PROTOCOL.md`; `tests/handoff-preservation.test.js`, `tests/handoff-e2e.test.js` | Preserve executor sessions, compact evidence, continuation and fresh-session semantics. Changing the controller must not duplicate execution or erase lineage. |
| Optional automatic reroute | `src/core/orchestrator.js`; `tests/reroute-orchestrator.test.js` | Remains disabled by default and experimental. PR0 enables nothing; PR1 must not turn a controller timeout into executor reroute. |
| Config and local overrides | `config/default.json`, `src/core/config.js`; `tests/config-security.test.js` | Preserve loopback default, workspace policy and existing overrides. PR1 controller defaults must be safe for callers without controller config. |
| Usage and optional providers | `src/core/usage-events.js`, `src/core/usage-dimensions.js`; `tests/usage-events-v2.test.js`, `tests/relay-executors.test.js` | Preserve accounting and provider neutrality. Subscription snapshots are deferred to PR2; task tokens must not be relabeled as plan quota. |
| Browser companion and userscript | `browser-companion/`, `userscript/`; existing `npm run check` consistency gates | PR0 makes no runtime changes. PR1 must not treat browser metadata as verified controller authority or add unattended ordinary-chat automation. |
| Optional remote relay | `src/remote-relay/worker.js`, `docs/REMOTE-DEVICE-RELAY.md` | Preserve existing ACP support as optional; do not modify AsterRoute site/relay deployment. Multi-node ownership and cloud recovery are deferred. |
| GitHub delivery and human approval | `docs/DEVELOPMENT.md`, V1 design Section 8 | Separate feature branches and draft PRs. Passing checks do not authorize merging, auto-merge, force pushes or protection changes. Runtime delivery metadata is deferred to PR3. |

## PR1 review constraints and known risks

The design's Section 13 remains the PR1 test-first plan. Its five tasks are not
part of PR0. Before implementation, map the current config, store update,
serialization, error and audit APIs rather than assuming the proposed signatures
already exist.

The current HTTP bearer gate does not by itself establish separate identities
for Grok, Dot or Muse. PR1 must document that limitation, retain an explicit
local-operator fallback where appropriate, never trust `caller_id` or
`controller_id` as authentication, and expose no mutating takeover MCP tool
without a verified per-controller principal.

Lease review must include stale generation writes, expiration, release/reclaim
and restart persistence; an old generation must never clear or overwrite a new
owner. Controller takeover must leave any running executor invocation count
unchanged. Existing executor checkpoint fencing is not proof of controller
ownership fencing. Single-process ownership is the PR1 boundary; sharing
`state.json` across machines remains unsupported by this design.

## Delivery and rollback

PR0 adds only Markdown documentation and index links. There is no runtime,
configuration, storage-schema, dependency or credential change, and no migration.
Rollback is an ordinary revert of the documentation commit on a feature branch,
submitted for review. No destructive working-tree command is needed.

The coordinator confirmed the open-PR query returned no candidates before PR0
publication. This container's GitHub API queries returned `Forbidden`; the
coordinator handles draft PR creation through its existing connected GitHub
access. This is not evidence of a branch-protection setting. No protection or
account permission was changed or asserted.

Keep PR0 and PR1 independently reviewable even if PR0 remains unmerged: create
`feat/acp-v1-controller-queue` from freshly fetched `origin/main`, not the PR0
branch, and reference the PR0 document PR as the design source. Do not cherry-pick
the PR0 documentation commit into PR1. If PR0 has already merged, its docs will
naturally be present in main and must not appear as PR1 changes. Pause after PR0
handoff until the coordinator sends the PR1 instruction. PR2 and later remain
outside the authorized implementation scope.
