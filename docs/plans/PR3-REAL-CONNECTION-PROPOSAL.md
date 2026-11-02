# PR3 real connection proposal — approval required, not deployed

Prepared 2026-11-01. This is a concrete next connection proposal, not a claim
that PR3 live acceptance has passed. It adds no runtime configuration or authority.
The governing design is PR0#20 Sections8/11. Existing code is host-only and off by
default. There is no model-operated approve/merge/deploy endpoint.

## Current acceptance location (supersedes the original local proposal)

The user subsequently required cloud-computer acceptance. All current testing
stays in the original saved Cloud environment with isolated loopback fixtures;
Windows/local fallback is not authorized. No persistent cloud runner is inferred
from that environment. The original local-node proposal below is a future
alternative only, not an approved action or a reason to wait for Windows access.
A real user-verifying browser flow still requires an approved reachable origin,
actual user participation and credential enrollment; none occurred in Cloud.

Cloud checks: anonymous api.github.com repository GET failed with DNS EAI_AGAIN
before visibility or real adapter behavior could be established. Chromium exists
but failed with an incorrectly configured SUID sandbox, and namespace mode
reported No usable sandbox. No --no-sandbox workaround or system permission
change was used. No actual browser UI or human WebAuthn acceptance is claimed.

## Original future deployment proposal (not authorized)

Run one ACP process and its GitHub read adapter on the user's existing ACP
computer, with private local state and loopback UI. The exact computer and
workspace paths must be confirmed by the user before any local execution; this
Cloud task does not switch to it. Home-PC-off execution is a separate PR4 pilot.
Do not make this ephemeral Codex Cloud session a permanent service.

The adapter makes outbound HTTPS GETs only to api.github.com. No webhook,
public listener, central author-operated relay or inbound firewall change is
needed. Reuse an already authorized repository-scoped read integration ONLY if
its host can expose authenticated responses directly to ACP. Conversation-tool
JSON is not such a transport; no connector token is extracted or copied.

For public resources, the documented unauthenticated read endpoints may avoid a
new credential; confirm repository visibility and rate-limit sufficiency first.
For private access or inadequate public limits, the precise fallback is a GitHub
App installed only on Ya-KARAS/AgentControlPlane with read-only permissions below.
App creation/installation/private-key storage is NOT authorized by this proposal
and must be individually approved before doing it. Never request contents-write,
pull-requests-write, administration, deployments, workflow writes or org-wide
access for observation.

## Read endpoint allowlist

All paths below are HTTPS api.github.com, owner=Ya-KARAS, repo=AgentControlPlane;
PR numbers and SHA must match the existing task binding. No logs/bodies/diffs are
published or stored. Follow all relevant pagination; incomplete data is unknown.

| Purpose | GET path | GitHub App permission if authenticated |
|---|---|---|
| PR identity, current head, merged flag/merge commit | /repos/{owner}/{repo}/pulls/{number} | Pull requests:read |
| Review event metadata | /repos/{owner}/{repo}/pulls/{number}/reviews?per_page=100 | Pull requests:read |
| Actual merged check (optional corroboration) | /repos/{owner}/{repo}/pulls/{number}/merge | Pull requests:read |
| Checks bound to head | /repos/{owner}/{repo}/commits/{sha}/check-runs?per_page=100 | Checks:read |
| Legacy commit status contexts, only if repository uses them | /repos/{owner}/{repo}/commits/{sha}/status?per_page=100 | Commit statuses:read |
| Workflow metadata, optional and not a substitute for all checks | /repos/{owner}/{repo}/actions/runs?head_sha={sha}&per_page=100 | Actions:read |

Metadata read is implicit for a GitHub App. Request optional permission rows only
when that input is actually used. Never infer required-check completeness from a
single successful workflow; unsupported rule/required-context discovery remains
unknown. Fetch PR identity again after reviews/checks. A changed head invalidates
the observation. A non-null merge_commit_sha alone does not prove merged: require
an affirmative merged observation and exact PR/head binding. Merge/squash/rebase
result SHA semantics must follow the provider response, not be guessed.

Official endpoint/permission references (checked 2026-11-01):
[PR](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request),
[reviews](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request),
[checks](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference),
[statuses](https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference),
[workflow runs](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository).

## User decision: local verified confirmation, not model text

Recommended next implementation is a loopback review screen reusing the local
review page's CSP/CSRF/form structure, but with a NEW explicit user-verification
step. The old page/approval secret alone is not independent human authentication.
Use a user-verifying authenticator (WebAuthn userVerification=required) with a
user-enrolled credential; verify challenge, signature, RP ID, origin and UV flag
server-side. Credential identity and accepted principal policy are pinned during
explicit user enrollment, never from account type=User, username text, a model
message or a CLI flag. No default approver is selected here.

This is a proposed integration, not tested browser/platform compatibility. See
[WebAuthn](https://www.w3.org/TR/webauthn-3/). Registration creates a new credential
and trust binding: user authorization is required even though no model API or
paid resource is involved. Store public credential data and bounded replay state;
the private credential stays with the authenticator, not in ACP prompts or git.

User flow: open ACP locally; inspect repository, PR URL, full head SHA, test
summary and unresolved blockers; click accept/reject; personally complete the
OS/authenticator verification. Challenge binds exact repo/PR/head/decision and
expires; no replay across heads/restarts. User can inspect the same PR in GitHub
UI, and manually merge there if they separately choose. ACP never submits merge.
A GitHub self-review is not assumed possible for an author. Comments or reviews
created using a credential available to the model cannot establish this independent
user confirmation. Third-party GitHub reviews remain review evidence, not the
user's acceptance unless an explicit accepted policy says so.

## Exact on-site approvals/actions — not performed

1. Confirm the existing user-owned ACP computer, allowed workspace and local
   review origin. Approve running/testing this adapter there; no local fallback
   occurs merely because the code exists in Cloud.
2. Confirm public read suffices OR authorize the one-repository read-only App
   installation and secure local key provisioning. Never paste keys into chat.
3. Authorize registering one user-verifying credential and binding it to the
   selected acceptance principal. Verify the displayed origin and credential
   registration personally; no default principal or automated enrollment.
4. Approve live read-only verification against specified PR/head and the local
   accept/reject/revoke test. Do not merge as part of this test.

These decisions are actionable configuration approvals, not a request to restate
the already settled design goal. No paid host or public network is proposed.
If the current browser/authenticator/origin fails compatibility, report that
specific result before proposing another channel.

## Completion gate

Implement the two real adapters against existing host contracts, then verify
real GET identity/freshness/pagination, personal user confirmation, persisted
replay/revoke/restart, new-head invalidation, failure-to-unknown and audit/privacy.
Only then mark PR3 live acceptance passed. Existing simulations prove contract
behavior, not authentication deployment. All PRs remain drafts until separately
reviewed; green CI never authorizes merging.
