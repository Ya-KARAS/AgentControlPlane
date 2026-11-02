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
