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
- Shared foreground group chat/background messages and daily-report-before-archive
  are later workflow requirements recorded in PR24, not implemented by a controller
  registry, nor by this node registry. They must reuse one task lineage/queue and
  need their own bounded plan/tests; no vendor personal-agent callable integration
  has been verified.
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
