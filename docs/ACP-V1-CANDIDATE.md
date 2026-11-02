# ACP V1 complete offline candidate

Integration base: PR32 at `2e093d4cb000ca49498547667f64cfc4aa88ad4d`.
This branch ordinarily merges PR22, PR0, PR24 and PR25 into that existing stack;
no cherry-picked duplicate implementation, main merge, deployment or live setup.
Original main is still `638e6d7ba89f621c7163ce97c14071a43bcc1004`.

## Preserved ancestors and composition roots

Every exact source head below passed `git merge-base --is-ancestor <head> HEAD`.

| PR | Preserved source branch | Source HEAD | Ancestor |
|---|---|---|---|
| #20 | `docs/acp-v1-pr0-baseline` | `6b3166fc452c2454d807b1e9be65ce38b915a1ef` | yes |
| #21 | `feat/acp-v1-controller-queue` | `4c8632ff1cda180b4278ac16246228bd5b46b355` | yes |
| #22 | `feat/acp-v1-subscription-status` | `83ddaf4d3ce39d162755e7bde16fa3013ac8ba7c` | yes |
| #23 | `feat/acp-v1-delivery-state` | `32496c839dd047f3953039571f1053b19a274d6e` | yes |
| #24 | `docs/ordinary-chat-handoff-feasibility` | `cf8a8e9d728a4705ff97bfd9b3ce76275593fa4a` | yes |
| #25 | `feat/readonly-mcp-test-entry` | `cd73cff6c24e45a4db9e193ee896862bf029e103` | yes |
| #26 | `feat/acp-v1-execution-node-preflight` | `e2f637db7b3b86544a36a7d03497fffeb6ab042a` | yes |
| #27 | `integration/acp-v1-controller-nodes` | `bf9e00d014512a1332016489c244cf259c93f8a3` | yes |
| #28 | `feat/acp-v1-node-recovery` | `b6805107e0977659414d8c4cff455f04b5e94c59` | yes |
| #29 | `feat/acp-v1-unified-messages` | `c68245ac89e80895bb4bafde2d76ad85e0710140` | yes |
| #30 | `integration/acp-v1-messages-delivery` | `ec85dd27669220a496940bc230ae7f30b73f6c77` | yes |
| #31 | `feat/acp-v1-report-archive` | `7fbc9e5ec2801977184091006ad7ffe80b20d89e` | yes |
| #32 | `feat/acp-v1-conversation-ui` | `2e093d4cb000ca49498547667f64cfc4aa88ad4d` | yes |

Production remains `npm start` / `src/server.js`, with original optional/default-off
contracts. PR22 snapshots/read-only advice now coexist with controller/node recovery,
messages, trusted delivery and report/archive on one TaskStore/queue. Merge conflicts
were additive imports, scripts, dashboard helpers and documentation; original private
field normalization, node fencing and active-view behavior remain. No mandatory new
package, automatic subscription polling, estimated quota or routing activation.

PR0 original design is **31,945 bytes**, SHA256
`7942d94be736dfc55dcfce66096dba0bcbe1bf08bbc1b58a534e9e7f15f8ff1a`.
A per-file Git `-text` attribute prevents Windows autocrlf from changing this
archived upload; the regression exercises actual Git checkout filtering.
[Baseline](ACP_V1_BASELINE.md) describes its historical main, not this newer candidate.

Separate preparation roots are intentionally retained:

- [PR24 handoff](ORDINARY-CHAT-HANDOFF-FEASIBILITY.md):
  `node scripts/check-chat-handoff.js docs/examples/ordinary-chat-handoff.json --expected-parent 0 --logical-task intent-acp-example` validates only local bytes and lineage; it is not an API/automatic Chat channel. Hash proves
  integrity, never user identity or approval.
- [PR25 isolated MCP entry](READONLY-MCP-TEST-ENTRY.md):
  `npm run readonly:test-entry -- --port 4328`; only `get_requirements` and
  `read_capabilities`, never production dispatch/state or credential setup.
- [Conversation browser fixture](CONVERSATION-FIXTURE.md):
  `node scripts/serve-conversation-fixture.js --port 18889`; no credentials,
  only synthetic memory state, not production ACP or ordinary Chat.

Installing or running this candidate does not mean configuring any of these test
roots as a production account/plugin. Production MCP does not gain synthetic
`get_requirements` or fake conversations from their mere presence in the tree.

## Full plan status

| Requirement | Code/offline evidence in candidate | Unverified or incomplete |
|---|---|---|
| PR0 | Exact original design, baseline, compatibility matrix | User acceptance/main integration |
| PR1 | Trusted registry, single-process lease/fencing/audit, read-only status | Distinct real agent transport identities; no distributed claim |
| PR2 | Bounded manual snapshots, unknown/expired/null-safe projection, passive advisory and UI/MCP | Supported official account observation collectors not connected; no live quota calls |
| PR3 | Delivery metadata, strict read adapter, private persisted decision/replay/expiry/revocation, WebAuthn verifier | Real origin/RP/policy/user enrollment and real authenticated decision channel |
| PR4 | Node registry, checkpoint/admission/recovery and stop/fencing tests | Actual persistent runner, measured adapters/physical write fence, desktop-off/return trial |
| PR5 | Research matrix, versioned local handoff checker, isolated two-tool readiness; coordinator reports two earlier synthetic reads | Supported automatic ordinary Chat trigger/real document return and recovery remain absent |
| Shared messages/UI | One journal/queue, foreground/background history, unconnected @target, progress/results and explicit modify/stop; coordinator-reported synthetic browser pass at244ac31 | Real vendor replies, real backend/executor browser acceptance and independent sandbox-configuration verification |
| Acceptance/report/archive | Bound acceptance→synced report→archive, retries/restart/revocation protection | Real human decision input and operational acceptance; bounded history offload not provided |
| Composition | All PR20–32 heads are ancestors; combined verify/CI evidence belongs to this PR | Main approval/retargeting/combined release acceptance and deployment |

Tests cannot upgrade any right-hand column into a live claim. Subscription task
usage remains distinct; expired evidence is unknown, null is not 0%, reset is not
guessed, existing experimental automatic reroute stays default-off. A model,
shared bearer, user-like label, fixture or green CI cannot approve a PR.

## Browser environment and minimum real inputs

Current CI has only Node22 `ubuntu-latest`/`windows-latest` matrix jobs. No existing
Playwright dependency, explicit browser installation or browser job is configured
in the project. Hosted images may include browsers, but these Node jobs do not
establish their sandbox or interaction readiness. No new
browser/dependency workflow is silently introduced. The developer container's
prior Chromium attempt had a SUID sandbox blocker. A separate coordinator cloud
desktop later completed synthetic fixture browser interactions without changing
sandbox settings; independent sandbox-configuration verification is not claimed. See the credential-free fixture
command, manual checklist and necessary existing browser resources in
[CONVERSATION-FIXTURE.md](CONVERSATION-FIXTURE.md).

Real gates need specific existing host/OS, allowlisted workspace/private state and
one authoritative scheduler; supported installed subscribed executor; actual
origin/RP/principal approval policy and the user personally enrolling; individually
supported agent transports and a separately approved ordinary Chat test window.
No credential/bearer, user identity, runner, service account, tunnel or paid resource
was provisioned here. Existing Cloud development is not a persistent production runner.

Rollback: preserve all source branches and state/audit/report/message history;
disable optional features and stop active work safely before reviewed reverts.
Do not let old code prune records whose safety depends on newer retention/fences.
A later approved merge sequence must account for this branch already containing all
source histories: review/retarget predecessors or close superseded integration PRs
only with explicit approval; do not blindly merge them all again. No auto-merge.

## Later independent browser evidence and precise remaining development

Coordinator dot reports the same-machine synthetic fixture acceptance passed on
2026-11-02 11:04–11:12UTC at runtime244ac31, with matching ZIP/checksums and
confirmed shutdown/no listener. This supersedes only the earlier unpassed
synthetic-page interaction status, not real ACP/user/runner/vendor acceptance.
See [the exact evidence, code gaps versus configuration, and minimum real pilot
checklist](ACP-V1-ACCEPTANCE-GAPS.md). PR3 production credential storage/decision
composition and PR4 measured adapters/write enforcement remain development gaps;
they must not be called configuration-only. Original §9 permits manual ordinary
Chat participation and does not make unattended automation a shipping blocker.

## Follow-on private decision code

See [private delivery decisions](PRIVATE-DELIVERY-DECISIONS.md): bounded existing-store credential read/insert/revision-CAS, branded decision journal and explicit host composition are now implemented in the next stacked increment. Default off, no network approval surface/real user enrollment; PR4 production measurement/write fencing and real acceptance remain incomplete. Earlier gap rows describe their historical candidate.
