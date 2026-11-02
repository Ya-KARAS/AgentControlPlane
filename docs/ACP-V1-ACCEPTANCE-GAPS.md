# ACP V1 acceptance evidence and remaining work — 2026-11-02

This audit rereads the unchanged original [engineering design](ACP_V1_ENGINEERING_DESIGN.md)
against candidate `244ac31ed4d95758c6a0db91bee146ae29e47a3c` and its existing source
modules. It records evidence and gaps only; it adds no runtime feature, identity,
credential, service or deployment. CI1025tests and a browser fixture do not mean
that the whole design has been delivered or accepted. Main remains unmerged.

## Independent synthetic browser receipt

Source: coordinator dot's independently operated cloud desktop, reported back to
this developer task. This developer did not operate that browser or inspect its
configuration. Time window: **2026-11-02 11:04–11:12 UTC**.

- Candidate: `244ac31ed4d95758c6a0db91bee146ae29e47a3c`; source runtime modules
  matched the internal Library fixture bundle. ZIP SHA256:
  `4a1b88a5f5714c0cac4eab2b85df4bf7f3b8f38d073380e90afba15d05192157`.
  All605 manifested file hashes were reported verified.
- Existing same-machine cloud terminal, absolute Node executable (Node24.22.1),
  platform CDP Chromium, loopback18889, empty token. No real ACP/executor/account.
- A/B scope isolation, unconnected-target labels, literal injection string with
  **zero img nodes**, and double-click discussion producing one message passed.
- Synthetic stop stayed pending real terminal confirmation, without claiming
  physical stop/releasing the displayed reservation. Completed-task continuation
  produced one message record plus one synthetic queued child.
- Refresh/back/reconnect caused no automatic replay. Per-scope memory drafts were
  isolated; reload/exit cleared drafts. These are actual fixture browser actions,
  separate from earlier Node HTTP and DOM contract tests.
- At11:12 UTC Ctrl+C stopped the fixture; the coordinator used `ss` to confirm no
  listener remained on18889.
- No sandbox setting was modified. An attempted internal browser configuration
  page inspection was policy-denied and not bypassed; its exact page identifier
  was not supplied to this task. Therefore **independent verification of sandbox
  configuration is not claimed**. A working platform browser is not such proof.

This closes the earlier *synthetic page interaction* acceptance gap only. It does
not validate real application authentication, TaskStore persistence, physical stop,
executor behavior, live WebAuthn/user approval, vendors, quota, cloud recovery or
ordinary Chat. No screenshot containing personal content is stored here. The
fixture runtime is unchanged by this subsequent documentation-only update.

## Actual development versus configuration/acceptance

| Design contract | Already implemented | Actual code/integration still missing | Configuration/live evidence still needed |
|---|---|---|---|
| PR0 §§11/12 | Exact design/baseline/compatibility and combined candidate tests | No identified PR0 implementation gap | Specific review/merge decision |
| PR1 §§4/5/13 | Registry, local-operator admission, pure lease and persistent fencing; one owner/queue; read-only status | Distinct per-agent authenticated channel/admission and any automatic controller heartbeat/failover coordination are absent. These exceed the explicitly limited PR1 minimum; do not count named descriptors as working agents | Select supported actual channel/principal policy before transport-specific wiring; cooperative/failover tests then need real actors. Current shared bearer never differentiates them |
| PR2 §§6/11 | Manual bounded normalized snapshots, expiry/unknown/null behavior, HTTP/MCP/dashboard and routing advice | Automatic official collectors are absent. Manual input and unknown are explicitly allowed by §6, so all-provider collection is not an invented V1 ship gate; add a collector only for a selected supported observable source | Consent/current diagnostic/export format and freshness/reset provenance. Never poll with a model call, infer plan balance from task tokens, or scrape credentials |
| PR3 §§8/11 | Metadata, read-only GitHub observation component, host evaluator/private replay history, standard WebAuthn verifier, revoke/new-head tests | **Real decision producer and host composition are not implemented.** The verifier's credential storage is injected only; there is no production read/insert/CAS implementation, ceremony-to-immutable-decision journal/adapter join, or user-facing authenticated review ceremony. GitHub adapter returns `decisions:[]`; ordinary startup supplies no evidence override | Exact review origin/RP, authorized user/principal and enrollment policy, checks name/App-ID policy, supported existing read transport. User personally enrolls/verifies after approval. Merely filling these values cannot create the missing code |
| PR4 §§7/11 | Registry/preflight, host-only checkpoint/admission coordinator, same-task recovery, generations and fake-executor crash/restart tests | **Measured production source/target adapters and cross-node host composition/transport are absent.** No production physical remote-write fence or durable runner service is supplied by these pure transitions | Select existing persistent owned host, scheduler location, access/stop authority and path layout before final transport/write-enforcement implementation; then actual home-PC-off/return/no-split-brain acceptance |
| PR5 §§9/11 | Feasibility matrix, local version/hash/parent checker and manual fallback, isolated two synthetic MCP tools | Actual supported automatic document trigger/return is not implemented; unsupported ordinary Chat APIs must not be invented. Optional approved adapters remain conditional | Personal-account supported capability/terms and specific bounded test window. §9 explicitly allows user-initiated/manual delivery and says ordinary Chat automation is not a control-center shipping blocker |
| Shared conversation extension | Actual page, shared foreground/background journal, @target data, progress/results, explicit modification/safe-stop, independent synthetic browser pass | Real vendor transports/replies and verified sender identity are absent; unknown targets must stay unconnected. No universal executor pause/resume exists or is claimed | One selected supported Agent channel plus existing application authorization; actual backend/real-executor browser test is distinct from canned fixture responses |
| Acceptance/report/archive extension | Core ordering/retry/restart/revocation and retention tests | Core is present; its production eligibility is blocked by the missing PR3 decision producer/wiring above, not repaired by manually marking a task approved | Real authenticated user decision and actual operational test. History offload is a documented capacity limitation, not a new mandatory database/feature |

Concrete source evidence:

- `src/server.js` calls `store.createDeliveryHost(overrides.deliveryEvidence ?? {})`;
  the ordinary executable supplies no trusted adapter/policy override.
- `src/core/github-delivery-adapter.js::readObservation` returns `decisions:[]`.
  It observes PR/check/merged facts; it neither approves nor executes a merge.
- `src/core/delivery-webauthn.js::createDeliveryWebAuthnVerifier` requires host
  `readCredentials`, `insertCredential`, `compareAndSwapCounter` callbacks and
  returns ceremony verification only. No production callers of this factory
  exist under `src/`/`scripts/`. A unit-test callback is not a deployed storage or
  decision source. WebAuthn is the currently chosen implementation path, not a
  technology mandated by the original §8; the user-originated decision is mandatory.
- `src/core/node-recovery.js::NodeRecoveryCoordinator` requires `inspectSource`
  and `inspectTarget`; it states no execution/credential/network adapter is
  installed. No production caller under `src/`/`scripts/` composes the coordinator.
- `src/core/orchestrator.js::#controllerTaskOptions` uses `local-operator`, never
  caller-controlled identity. `src/core/conversations.js` marks every descriptor
  `not_connected`; a mention does not select a real executor/vendor.

Thus these missing integration pieces must not be relabeled as merely waiting
for a user to type configuration. Conversely, conditional collectors, universal
pause, history offload and unattended ordinary Chat must not be silently added to
or substituted for the original required scope.

## Deterministic next offline work (not started by this evidence round)

**Yes, one bounded next PR has a definite code-only deliverable:** complete the
chosen PR3 host decision path's private credential-storage implementation and
verified-ceremony-to-decision journal/adapter composition. Consume the existing
verifier's read/insert/CAS interface, exact repo/PR/head/user/event bindings and
existing replay/revoke/store primitives; use host-injected paths/policy, default
closed. Test concurrent counters, restart/write failures, duplicate/revoked events,
wrong head/user and caller-forged results with local fake ceremonies/temporary
storage. Do not enroll a real credential, choose a real approver, expose an
approval route, enable production or treat mocks as user presence. This can be
implemented without new external permission; it still needs real configuration
and a separately reviewed authenticated surface before live use.

A subsequent bounded PR can implement **local Git/workspace inventory collection**
for the PR4 inspection contract with allowlisted temporary-repo tests. Real stopped
proof must come from measured executor/process authority, never `running:false`
JSON, elapsed TTL or missing heartbeat. Actual remote transport/write fencing
cannot be finalized honestly until the existing runner/access architecture is
identified; do not invent a second shared task database or distributed lock.

Transport-specific Agent admission and official quota collectors are not currently
fully specified independent tasks: first identify an actually supported channel
and observation format. Research/manual paths can remain as the design allows.
No new runtime work is begun or implied by this audit. Keep each later code
increment independently reviewable; no endless speculative framework expansion.

## Minimum real acceptance preparation

Provide **identifiers and paths, not secret values**, for the first narrow pilot:

1. Existing owned host/OS and whether it is persistent; where the **one** scheduler
   runs. Do not count the temporary Cloud development task or GitHub CI as that runner.
2. Exact allowlisted repository/workspace and private ACP state directories, their
   existing owner/service account, current branch/HEAD, dirty-file checkpoint and
   backup/recovery policy. Do not overwrite unpublished changes or share state.json
   directly between machines.
3. One installed supported executor name/version, whether its existing client is
   already signed in to a subscription, allowed execution/sandbox policy and
   passive diagnostics permitted. Keep login material on that host; do not send
   token/cookie/key contents here or purchase API capacity.
4. Review endpoint's actual origin/RP and user/principal policy, who may enroll,
   existing protected access method, repository/PR/head and required check App IDs.
   Actual persistent identity registration or a new exposed approval endpoint
   requires the specific live authorization and user participation, after the
   missing host/storage/decision code is delivered. A session GitHub connector
   is not automatically persistent ACP authorization.
5. For a two-node trial: identify source and target, existing approved access and
   stop/write-isolation authority, Git branch/checkpoint transfer route and how
   the old writer is physically prevented from writing. If none exists, remain
   queued/blocked; selecting a host alone is not a fence.
6. One supported private-Agent transport/account and verified identity if actual
   multi-Agent behavior is to be tested. Keep unconnected vendor names as labels
   until then. Separately identify ordinary Chat account capabilities if testing
   it; API/Codex/Work must not substitute for ordinary Chat.
7. A specific bounded live-test window, single task, subscription/cost limit,
   expected branch/PR evidence, stop/rollback and acceptance criteria. Every real
   model test still requires explicit approval; simulation cannot satisfy it.

No merge, credential, service install, network exposure or fee is authorized by
this checklist. Specific PR/main merge approvals remain separate from successful
CI, this synthetic browser receipt and development recommendations.

Documentation-round verification: npm run verify exit0,1025tests/1024passed/0failed/1Windows-onlyskip; checkPASS. No runtime code changed. Exact documentation HEAD/CI receipt is retained in PR33.

## Follow-on implementation: private decisions

The next stacked [private decision increment](PRIVATE-DELIVERY-DECISIONS.md) now
implements the previously identified read/insert/revision-CAS storage, branded
ceremony decision journal and host composition. The tables above are the original
audit at244ac31, not a claim that these components remain missing after this
follow-on. No actual enrollment or network review surface is installed. The
remaining authenticated user-facing ceremony/host entry surface and real pilot
are still absent, not merely filled by choosing config. PR4 measured adapters and
physical write enforcement remain code gaps. No new ordinary Chat shipping gate.
