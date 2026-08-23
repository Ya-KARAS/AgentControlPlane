# Userscript natural-language dispatch design

Status: implemented for desktop ChatGPT and DeepSeek adapters, staged task
envelopes, user-confirmed dispatch, local execution settings, origin-bound
status polling, and optional safe result return.

## Goal

Let a person plan and control engineering work through a normal web AI
conversation. The web AI clarifies the request and creates a compact task
envelope. AgentControlPlane applies locally owned execution choices and policy,
then sends a bounded result projection back to the same conversation when the
owner enables that behavior.

## Scope

This slice supports desktop browsers connected to ACP on `127.0.0.1:4318`.
ChatGPT and DeepSeek are separate adapter modules. Mobile access, pairing,
relay transport, and unknown-page auto-detection are outside this slice.

## Trust and confirmation boundary

The webpage, AI reply, page scripts, and DOM are untrusted. An `<ACP_TASK>`
block is data to stage; it is never authority to dispatch.

Dispatch requires a fresh user interaction with the supported page composer:
the person enters a recognized short confirmation and presses Send. DOM
mutation, page load, navigation, AI-generated text, or an older user message
cannot satisfy this confirmation. When automatic dispatch is disabled, ACP
also opens its local one-time review page.

ACP owns workspace, executor, profile, model routing, credentials, allowlists,
rate limits, audit records, and executor policy. Fields that attempt to select
those controls in a webpage task envelope are discarded.

## User flow

1. The person sends `@AgentControlPlane` followed by an engineering request.
2. The bridge replaces that command with a controller prompt sent to the web AI.
3. The web AI discusses the task and asks for missing information.
4. When ready, the web AI emits one JSON object between `<ACP_TASK>` tags.
5. The bridge validates and stages the envelope, then reports that it is waiting
   for `执行`.
6. The person sends a short confirmation from the page composer.
7. ACP creates a candidate. A local setting either dispatches it with saved
   choices or opens the one-time local review page.
8. The bridge polls task status with a short-lived, origin-bound capability.
9. If the local result-return setting is enabled, a terminal `<ACP_RESULT>`
   projection is sent to the same conversation.

## Page-to-ACP contract

The webpage envelope can contain:

```json
{
  "objective": "A concrete engineering objective",
  "context": "Execution context needed by the engineering agent",
  "constraints": ["Important implementation constraints"],
  "acceptance_criteria": ["Observable completion criteria"]
}
```

The bridge converts it to the existing candidate contract:

```json
{
  "objective": "string",
  "constraints": ["bounded strings"],
  "source": "userscript-preview"
}
```

The candidate contains no workspace path, executor, profile, model, credential,
conversation transcript, browser identifier, or local file content.

## ACP-to-page contract

The optional result projection contains only:

```json
{
  "task_id": "string",
  "status": "completed",
  "changed_files_count": 0,
  "tests": { "total": 0, "passed": 0, "failed": 0 },
  "blocker_count": 0
}
```

It excludes objectives, summaries, paths, changed-file names, logs, credentials,
executor output, and raw errors. The bridge waits for an empty composer before
sending the result and abandons the attempt after a bounded interval.

## Module boundaries

- `userscript/src/conversation-protocol.js` parses the launch command, task
  envelope, explicit confirmation, and safe result projection.
- `userscript/src/adapters/` contains data-only page adapters.
- `userscript/src/adapter-registry.js` validates adapter metadata and selectors.
- `userscript/src/runtime.user.js` owns page interaction and local HTTP calls.
- `src/core/candidate-review.js` owns candidate state, expiration, one-time
  approval, replay rejection, and dispatch callbacks.
- `src/local-review/settings.js` owns local execution choices and the two
  independent opt-ins for automatic dispatch and result return.
- `src/local-review/router.js` owns loopback HTTP, origin checks, bounded request
  parsing, and response projection.

The userscript cannot import server, orchestrator, executor, workspace, or MCP
modules. The candidate service has no browser or adapter dependency.

## Required gates

1. Protocol tests cover exact mention parsing, bounded task extraction,
   confirmation words, ignored page execution controls, stable envelope ids,
   and result redaction.
2. Static userscript tests require native-conversation markers and reject task
   forms, browser storage, credentials, raw task APIs, and HTML injection.
3. Local integration tests prove automatic dispatch and result return are
   default-off settings protected by a one-time local form secret.
4. Candidate tests reject unknown fields, origins, workspace overrides, replay,
   stale capabilities, and missing approval.
5. The full `npm run verify` gate must pass without live model calls.

## Feedback

Discuss the flow in
[GitHub Discussions](https://github.com/Ya-KARAS/AgentControlPlane/discussions).
Submit reproducible requirements through the
[feature request form](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=feature_request.yml).
Do not publish credentials, local paths, private logs, or security bypass
instructions.
