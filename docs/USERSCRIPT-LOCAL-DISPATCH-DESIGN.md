# Userscript local-dispatch design

Status: implemented for the desktop-only local candidate-review, optional
automatic-dispatch, adapter-registry, and safe status-return slices. Mobile,
relay, remote-access, and webpage-extraction work remains out of scope.

## Goal

Allow a person on a supported desktop web AI page to prepare a small task
candidate and hand it to their local AgentControlPlane for review. The local
AgentControlPlane owns the final decision to dispatch work to an executor.

## Scope

This slice is limited to desktop browsers and a locally running ACP instance.
It does not include a mobile client, relay service, remote access, background
task dispatch, webpage conversation extraction, or automatic executor choice.

## Trust boundary

Webpage content is untrusted, including AI replies, page scripts, browser DOM,
and text that resembles an ACP instruction. A userscript must never treat page
content as permission to create, continue, cancel, or approve an engineering
task.

The local ACP owner is the authority for workspace selection, executor choice,
task review, and execution. Existing ACP workspace allowlists, loopback-only
binding, rate limits, audit records, and executor policy remain in force.

## User flow

1. The person opens the ACP panel from the userscript.
2. The panel starts empty. It does not read or prefill the web AI conversation.
3. The person manually enters a compact objective and optional constraints.
4. The panel labels the submission with a pending candidate status.
5. ACP either opens its local review surface or uses an automatic-dispatch
   selection that the owner explicitly enabled and saved on the local machine.
6. The local owner controls the workspace, executor, and profile. Automatic
   dispatch is disabled by default and applies only to manual userscript
   submissions. Ordinary webpage requests always create review candidates.
7. Results shown back in the userscript contain compact status and counts.
   The response excludes raw local logs, credentials, and workspace data.

## Required safety rules

- No task creation, continuation, cancellation, or model selection happens on
  page load, page navigation, DOM mutation, or AI-generated text.
- No automatic reading, copying, or transmission of chat messages, cookies,
  browser storage, local paths, credentials, API keys, or access tokens.
- The userscript holds no long-lived ACP credential. Its status capability is
  origin-bound, expires after one hour, and remains in memory only.
- The local review surface must reject stale, duplicated, or unapproved task
  candidates.
- The existing ACP origin, authentication, workspace, rate-limit, audit, and
  executor-policy checks cannot be bypassed by the userscript.
- The initial release remains loopback-only. It does not expose ACP through a
  public address or act as a relay.
- A browser page cannot request automatic dispatch through CORS. The
  userscript-only marker is intentionally omitted from allowed CORS headers;
  local ACP settings remain the final policy gate.

## Data contract

The candidate contract is intentionally smaller than an ACP engineering brief:

```json
{
  "objective": "string, entered by the user",
  "constraints": ["optional user-entered strings"],
  "source": "userscript-preview"
}
```

The candidate contains no workspace path, executor identifier, model,
credential, conversation transcript, browser identifier, or local file data.
ACP resolves all local execution choices during the review step.

## Module boundaries

- `src/core/candidate-review.js` owns the transport-neutral candidate state
  machine, expiration, one-time approval, replay rejection, and dispatch callback.
- `src/local-review/service.js` adapts local ACP workspace, executor, profile,
  audit, and orchestrator policy to the core service.
- `src/local-review/router.js` owns loopback HTTP, origin handling, bounded body
  parsing, and response status mapping.
- `src/local-review/page.js` renders the no-script local confirmation surface.
- `src/local-review/settings.js` owns local defaults, explicit automatic-
  dispatch opt-in, persistence, and one-time settings-form protection.
- `userscript/src/adapters/` contains independent, data-only site adapters;
  `adapter-registry.js` validates and resolves them without site branches in
  the runtime.
- `userscript/` is a client layer. It cannot import server, orchestrator,
  executor, workspace, or MCP modules.

The core candidate service has no dependency on HTTP, browser APIs, MCP,
executor implementations, or webpage adapters. Future clients reuse the
service contract. Their transport layers carry candidate input and review
responses.

Some Chromium extension flows submit a top-level local confirmation form with
the opaque `Origin: null` value. ACP accepts this value only on the loopback
review routes. The one-time approval secret and local selection validation stay
mandatory. Candidate creation still requires an allowlisted webpage origin.

## Implementation gates

The implementation is accepted only while these gates have tests:

1. A static userscript test proves that no chat extraction, network action, or
   task mutation is present before the local-review feature is added.
2. A local-review integration test proves that a candidate cannot produce a
   task without an explicit fresh local confirmation.
3. Negative tests prove that page-supplied task-shaped text, repeated requests,
   stale candidates, unknown origins, and workspace overrides are rejected.
4. A security review verifies that existing ACP loopback, authentication,
   workspace, audit, and rate-limit invariants still hold.
5. Security-sensitive expansion beyond this local-review boundary requires a
   separate review before implementation.
6. Status tests prove that the capability is bound to the candidate origin and
   that the webpage projection excludes objectives, paths, summaries, logs,
   and error text.
7. Automatic-dispatch tests prove default-off behavior, one-time local settings
   protection, local allowlist validation, and rejection from ordinary webpage
   CORS requests.

## Explicit non-goals

This design does not specify device pairing, mobile workflows, relay protocols,
cryptographic implementation, hosting, pricing, telemetry, or multi-user
access. Those areas need separate designs after the desktop local-review flow
has passed its security gates.

## Feedback

Discuss the user flow in
[GitHub Discussions](https://github.com/Ya-KARAS/AgentControlPlane/discussions).
Use a [Feature request](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=feature_request.yml)
for concrete acceptance criteria. Do not publish credentials, local paths,
security bypass ideas, or private logs.
