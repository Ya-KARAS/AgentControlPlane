# ACP V1 stage reconciliation — 2026-11-02

Checked against the original 31,945-byte design (PR20), SHA256
7942d94be736dfc55dcfce66096dba0bcbe1bf08bbc1b58a534e9e7f15f8ff1a.
Actual GitHub main is still 638e6d7ba89f621c7163ce97c14071a43bcc1004.
All six PRs below were read from GitHub as open, draft, unmerged. Each is based
independently on that main, not on a merged or copied earlier feature. Current
head CI was read through the authorized connector, not assumed from old logs.

| Design stage / PR | Actual head | Exact-head CI (success) | Implemented / remaining |
|---|---|---|---|
| PR0 / [#20](https://github.com/Ya-KARAS/AgentControlPlane/pull/20) | 6b3166fc452c2454d807b1e9be65ce38b915a1ef | 41299182454 | Original design, baseline and compatibility matrix; docs ready for review |
| PR1 / [#21](https://github.com/Ya-KARAS/AgentControlPlane/pull/21) | 4c8632ff1cda180b4278ac16246228bd5b46b355 | 41303930884 | Optional registered controllers, local ownership/fencing, store/audit, read-only status; no per-agent network auth or distributed lock claimed |
| PR2 / [#22](https://github.com/Ya-KARAS/AgentControlPlane/pull/22) | 83ddaf4d3ce39d162755e7bde16fa3013ac8ba7c | 41314977065 | Manual bounded subscription snapshots/read views/advice; no automatic official collectors or quota calls |
| PR3 / [#23](https://github.com/Ya-KARAS/AgentControlPlane/pull/23) | 32496c839dd047f3953039571f1053b19a274d6e | 41320965497 | Delivery metadata, fail-closed host evidence, GitHub GET adapter, WebAuthn verifier; real origin/RP/user policy/enrollment and authenticated live acceptance incomplete |
| PR5 research / [#24](https://github.com/Ya-KARAS/AgentControlPlane/pull/24) | cf8a8e9d728a4705ff97bfd9b3ce76275593fa4a | 41329338938 | Capability/workflow matrix, versioned offline handoff checker and manual fallback; automatic ordinary Chat trigger/return not implemented |
| PR5 isolated test / [#25](https://github.com/Ya-KARAS/AgentControlPlane/pull/25) | cd73cff6c24e45a4db9e193ee896862bf029e103 | 41360969498 | Isolated two-tool MCP entry, memory-only diagnostics, bounded standard metadata fix; coordinator reports both synthetic read tools passed in ordinary Chat, not a real document round trip |

Code/tests for these heads were inspected via the saved branches. Their test
counts/RED-GREEN detail remain in their individual PR evidence; this audit does
not rerun six unchanged full suites or claim a combined installed ACP build.
The independent branches overlap store/config/MCP/docs and will need reviewed
integration and combined tests. Green per-PR CI is not user acceptance or merge
permission. None of the feature commits is currently in main.

## Next independent part: PR4a

The unimplemented PR4 already has a separate design in PR23
`docs/plans/PR4-CLOUD-PILOT-DESIGN.md`. PR4a builds only its first safe offline
step: [execution-node preflight](EXECUTION-NODES.md), disabled by default, no node
assignment/executor startup/ownership transfer. It starts independently on main;
no PR1 controller lease or PR3 approval is needed for read-only planning. A later
runtime transfer depends on those accepted boundaries and its own execution fence.

PR4 is still incomplete until a real user-owned persistent runner and safe
local/cloud recovery pass the original actual desktop-off acceptance. The saved
Cloud development container is not proof of such a runner. A model login, new
service account, new credential/permission/network exposure or live task requires
the corresponding specific authorization. None is configured by this stage.

## Other outstanding completion gates

- PR3: user-reachable exact origin/RP, explicit trusted principal policy and
  personal authenticator registration/verification; live read-only provider
  identity/freshness plus reject/revoke/replay/restart/new-head tests. No model
  message, CLI human flag, shared bearer or green CI substitutes user approval.
- Ordinary Chat: preserve the desired supported automatic bidirectional workflow.
  Synthetic reads prove a narrow transport/tool path only. Actual document
  submission/return, idempotent version/lineage validation, session/failure and
  permission gates remain. Manual confirmation/import is the current fallback.
  No private API, DOM/OCR extraction, cookie/session collection or unattended
  capability is promised. New live account tests need a separately active window.
- At the initial six-PR baseline, shared foreground group chat/background messages
  and daily-report-before-archive were outstanding. Subsequent stacked increments
  below implement their offline contracts and UI on one lineage/queue; no vendor
  personal-agent callable integration has been verified.
- Main integration/deployment is not done. Prepare specific PR/dependency/test
  evidence for individual user approval before any main merge. Do not auto-merge.

## Subsequent integrated offline increments

The earlier table is the PR20–25 audit snapshot, not a claim all stages shipped.
Subsequent preserved stack:

- PR26 node preflight: e2f637db, CI41409139573success; offline advice only.
- PR27 controller/node integration: bf9e00d0, CI41411408780success.
- PR28 checkpoint/fencing/recovery: b6805107, CI41413557360success; actual scheduler
  and fake executors, no actual remote write enforcement or desktop-off test.
- PR29 shared foreground HTTP/background MCP messages: c68245ac,
  CI41417983992success; explicit idempotent dispatch, no vendor identity/group UI.
- PR30 normal integration of PR23 into PR29: ec85dd27, CI41419609761success.
- Current report/archive branch builds on PR30; exact tests/review/HEAD CI are
  recorded in its own PR, without copying prerequisites or changing main.

| Original stage / extension | Current honest state | Remaining acceptance |
|---|---|---|
| PR0 baseline/design | Documentation/offline verification complete; unmerged | Individual user merge decision |
| PR1 controller ownership | Planned single-process minimum complete offline; unmerged | Distinct real per-agent auth/automatic cooperation not claimed |
| PR2 subscriptions | Bounded manual observation/read/advice minimum implemented | Real supported vendor observations/collectors not verified; unknown stays unknown |
| PR3 GitHub/user approval | Code + mock contracts implemented, partial overall | Real origin/RP/principal policy/enrollment and authenticated live acceptance |
| PR4 local/cloud | Preflight and offline fenced recovery implemented, partial overall | Existing actual persistent runner, enforced remote writes, desktop-off/return recovery |
| PR5 ordinary Chat | Research/contracts and two synthetic read tools verified; partial workflow | Supported actual trigger/document return, complete document integrity/permission/failure gates |
| Shared messages | Common local HTTP/MCP API and retry-safe task bridge implemented | Full foreground group UI and actual callable private agents/transports |
| Acceptance/report/archive | Offline implementation in current branch; evidence in PR | Actual trusted user channel/config remains required; no fabricated production approval |

No branch has been silently deployed or merged. Real user/personal-agent identity,
cloud availability and ordinary Chat two-way automation cannot be inferred from
these isolated tests. An archived historical receipt is not current approval or
merge permission. Persistent history stays local and capacity failures preserve
active work; no Notion/API purchase or new account permission is introduced.

## Latest offline conversation increment (stacked after PR31)

The initial six independent PRs above remain unmerged. Later additive integration
branches preserve their histories: PR21+PR26→PR27→PR28→PR29, plus PR23→PR30→PR31
→the conversation page. PR22 subscription and PR24/25 isolated handoff branches
are not silently included in this stack. Combined main integration is still pending.

| Original requirement | Implemented code / offline evidence | Actual acceptance still missing |
|---|---|---|
| PR0 baseline/design | Original exact design, baseline, compatibility documents | User final acceptance/main integration |
| PR1 controllers | Registry, local trusted operator, single-process lease/fencing/audit | No distinct vendor-agent authenticated transport or distributed claim |
| PR2 subscriptions | Manual safe snapshots, expiry/unknown/exhausted views/advice on PR22 | Passive official account collectors not connected; no live quota calls |
| PR3 GitHub approval | Metadata, strict provider adapter, user-verifier contracts, persistent evidence and invalidation | Exact origin/RP, principal policy, personal enrollment and real authenticated decisions |
| PR4 local/cloud | Node preflight, checkpoint/fencing/recovery, fake-executor crash/restart tests | Existing persistent user-owned runner, actual write fencing, offline-home-machine trial |
| PR5 ordinary Chat | Feasibility/handoff contracts and two reported successful synthetic read tools | Automatic document trigger/return, real content/version/recovery validation |
| Unified messages | Common foreground/background journal and idempotent task bridge | Real vendor transports/replies and independent agent identity |
| Group conversation UI | Offline project scope, @target labels, history paging, task progress/results, explicit modify/stop | Real Chromium visual/interaction test blocked by platform sandbox; actual vendor round trip absent |
| User intervention | Authenticated explicit same-session continuation; stop retains reservation until terminal; no display-only cancellation | Each real executor's interruption/terminal behavior needs bounded live acceptance; no universal pause/resume contract |
| Daily report/archive | Persist trusted acceptance→synced report→archive, revocation/restart/retry tests | Real user decision channel plus actual operational acceptance; bounded history offload remains separate |
| Delivery/main | All feature work remains independently reviewable draft PRs | Specific merge approvals, final combined verification and deployment |

Current conversation code does not finish the overall plan or automate ordinary
Chat. It creates no token, account, permission, persistent runner or model request.
Exact minimal real configurations and browser failure evidence are documented in
[CONVERSATIONS.md](CONVERSATIONS.md).

## Unified candidate after PR32

The follow-on [complete offline candidate](ACP-V1-CANDIDATE.md) now includes all
PR20–32 heads as ancestors, including the formerly separate PR22/24/25 artifacts.
Earlier rows describe their historical branch boundaries. This supersedes any
statement that subscription/handoff/isolated-entry artifacts are absent from the
latest candidate; it does not turn their synthetic/offline tests into production
or ordinary Chat acceptance. The full current matrix and merge caveats are there.

## Independent synthetic browser receipt and remaining code gaps

Coordinator cloud fixture browser acceptance at244ac31 passed 2026-11-02
11:04–11:12UTC; this supersedes older statements that synthetic page interaction
remains unpassed. No sandbox settings changed, but independent sandbox
configuration inspection was not permitted and is not claimed. Real ACP auth,
persistence, execution, vendors and ordinary Chat remain separate.
The [acceptance/gap audit](ACP-V1-ACCEPTANCE-GAPS.md) distinguishes actual missing
PR3 host/storage/decision composition and PR4 measured adapters/write enforcement
from real configuration/acceptance, and gives one definite bounded offline next PR.
No code feature or main merge is initiated by this documentation update.

## Follow-on private decision code

See [private delivery decisions](PRIVATE-DELIVERY-DECISIONS.md): bounded existing-store credential read/insert/revision-CAS, branded decision journal and explicit host composition are now implemented in the next stacked increment. Default off, no network approval surface/real user enrollment; PR4 production measurement/write fencing and real acceptance remain incomplete. Earlier gap rows describe their historical candidate.

## Subsequent bounded inventory increment

The PR34 stack now adds default-off local Git/workspace inventory and composition
with independent measured source/target facts; see [limits](NODE-RECOVERY.md#bounded-local-inventory-adapter).
Temporary-repository tests cover deletion, dirty/untracked files, scope/links,
concurrent changes and stale proofs. This closes the inventory collector code gap,
not the actual runner stop/write-fence or distributed recovery acceptance gap.
The protected review surface is the next offline increment; real identity
registration, configured trust and live acceptance remain separate gates.

## Subsequent protected review surface increment

The PR35-based protected review handler/page now composes the real persistent
approval host behind explicit host-only capabilities. Node loopback/temporary-
store tests and exact page-script DOM seams cover binding/replay/CSRF/policy races.
See [host and actual acceptance boundary](PROTECTED-DELIVERY-REVIEW.md). Ordinary
startup remains off; no actual authenticated session service or user enrollment
is claimed. Production source-specific session adapter/mounting, runner stop and
write-fence adapters and real pilot tests remain unfinished where not selected.

## Windows first marker pilot preparation

The PR36-based [isolated single-Codex marker host](WINDOWS-MARKER-ACCEPTANCE.md)
now reuses actual adapter/queue/store with an empty private temp repository/state,
bounded one-shot task, loopback read-only status and measured own-process cleanup.
Cloud evidence is a protocol-speaking child fixture, not a live Windows/model run.
The separate authorized Windows task must verify exact head, subscription-only
settings, actual native client/sandbox/protocol and receipt/port/process lifecycle.
Human resolveSession/enrollment is still separate and unselected. No production
config/oldqueue/worker is loaded; no real cloud/remote fencing acceptance follows
from this local pilot. Original checkout edits and all draft PRs remain preserved.
