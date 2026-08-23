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

ACP owns workspace roots, executor readiness, model capabilities, credentials,
rate limits, audit records, and executor policy. The webpage may request a
workspace, executor, profile, advertised model, and advertised reasoning effort.
ACP validates every requested value locally. Credentials and unsupported fields
are never accepted.

## User flow

1. The person sends `@ACP` followed by an engineering request. The parser also
   accepts `@acp` and `@AgentControlPlane`.
2. The bridge reads a bounded local capability summary, then replaces that
   command with a controller prompt sent to the web AI.
3. The web AI discusses the task and asks for missing information.
4. When ready, the web AI emits one JSON object between `<ACP_TASK>` tags.
5. The bridge validates and stages the envelope, then reports that it is waiting
   for `执行`.
   A ten-minute extension-isolated record restores this stage after a refresh.
   If a replacement envelope changes the objective or route, the user must send
   `确认变更` before dispatch confirmation is accepted.
   The floating pill shows the current action. Its hover text carries the full
   execution route and changed-field list.
   A new ACP mention request writes a conversation-scoped planning
   barrier. Confirmation and dispatch re-read the latest task and persisted
   revision under a browser-wide lock; a stale tab fails closed.
6. The person sends a short confirmation from the page composer.
7. ACP creates a candidate and validates any requested execution choices. A
   local setting either dispatches it with validated choices or opens the
   one-time local review page. Omitted fields use saved defaults.
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
  "acceptance_criteria": ["Observable completion criteria"],
  "execution": {
    "workspace": "registered-project-alias",
    "executor": "opencode",
    "profile": "economy",
    "model": "opencode-go/deepseek-v4-pro",
    "reasoning_effort": "high"
  }
}
```

The bridge converts it to the existing candidate contract:

```json
{
  "objective": "string",
  "constraints": ["bounded strings"],
  "execution": {
    "workspace": "bounded string",
    "executor": "bounded string",
    "profile": "bounded string",
    "model": "bounded string",
    "reasoning_effort": "bounded string"
  },
  "source": "userscript-preview"
}
```

The execution object is optional. The bridge copies only its five named fields,
and ACP validates them against local configuration. The candidate contains no
credential, conversation transcript, browser identifier, or local file content.

Before planning, `GET /v1/local-review/capabilities` returns workspace basenames,
ready executor ids, profile ids, model ids, and reasoning effort ids. It does
not return configured workspace roots, credentials, logs, or file contents.

## ACP-to-page contract

The optional result projection contains only:

```json
{
  "task_id": "string",
  "status": "completed",
  "changed_files_count": 0,
  "tests": { "total": 0, "passed": 0, "failed": 0 },
  "test_commands": { "total": 0, "passed": 0, "failed": 0 },
  "test_cases": null,
  "blocker_count": 0,
  "failure_category": null,
  "execution": {
    "workspace": "registered-project-alias",
    "executor": "opencode",
    "profile": "economy",
    "model": "opencode-go/deepseek-v4-pro",
    "reasoning_effort": "high"
  }
}
```

`tests` remains the backward-compatible test-command count.
`test_commands` names that count explicitly. `test_cases` is populated only
when ACP can parse a supported test-runner summary. `failure_category` is a
bounded provider-neutral classification derived from executor failure data.
The workspace value is a basename-only alias already exposed by local
capabilities, never a configured root. The projection excludes objectives,
summaries, full paths, changed-file names, logs, credentials, executor output,
and raw errors.

## Module boundaries

- `userscript/src/conversation-protocol.js` parses the launch command, task
  envelope, explicit confirmation, and safe result projection.
- `userscript/src/stage-state.js` owns the versioned conversation scope,
  planning barrier, revision matching, expiry, and stale-observation rules.
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
   confirmation words, bounded execution choices, stable envelope ids, and
   result redaction.
   Stage-state tests cover scope isolation, expiry, revision mismatch, planning
   barriers, and stale-tab observations.
2. Static userscript tests require native-conversation markers and reject task
   forms, page storage, credentials, raw task APIs, and HTML injection.
   Extension-isolated storage is limited to a bounded, expiring staged envelope.
3. Local integration tests prove automatic dispatch and result return are
   default-off settings protected by a one-time local form secret.
4. Candidate tests reject unknown fields, origins, choices outside local
   allowlists, replay, stale capabilities, and missing approval.
5. The full `npm run verify` gate must pass without live model calls.

## Feedback

Discuss the flow in
[GitHub Discussions](https://github.com/Ya-KARAS/AgentControlPlane/discussions).
Submit reproducible requirements through the
[feature request form](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=feature_request.yml).
Do not publish credentials, local paths, private logs, or security bypass
instructions.
