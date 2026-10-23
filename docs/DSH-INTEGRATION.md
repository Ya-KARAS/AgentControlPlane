# Optional native DSH CLI executor

`dsh` launches the installed DeepSeek Harness headless Agent. The existing
`deepseek` ID remains an OpenAI-compatible model endpoint with its historical
DeepSeek Harness display label; it is a different execution path.

The adapter is disabled unless `executor.dsh.enabled` is exactly `true`.
`config/default.json`, old IDs/labels and old routing remain unchanged.
DSH requires explicit selection; automatic selection/reroute excludes it.
The disabled example in [example.local.json](../config/example.local.json)
contains no active client contract or credential. No dependency, API-key
model call, tunnel, browser permission or provider requirement is added.

## Current scope and readiness

This first verified profile mode is for a fixed-command acceptance test.
It is not a certified general development profile. Authentication, model cost
and a real webpage-to-native-Agent task still need separate approval and
acceptance. An offline profile/config check is not a model/authentication test.

Discovery, `start()` and model catalog listing do not execute the client or
probe authentication. They validate local files only. An accepted profile
reports `configured`, `source:native-config-preflight`, authentication
`unverified`, and `runtimeVerified:false`; it never claims that an operator
string alone proved a ready sandbox. Transport `ready` means initialized.

## Isolated client profile evidence

`clientContract` must reference immutable artifacts from a no-credential
native config/schema preflight. It includes:

- `reviewReference`, `profile`, `runRoot`, `workspace`, `clientHome`,
  `agentsHome`, `patchPath`, `guardPath`, `proofPath` and `proofSha256`.
- `provider`, `model`, `effort`, `authentication:client-owned-route`,
  `credentialFallback:not-used-by-selected-route`, `fileEffects:read-only`,
  `readIsolation:not-enforced`, `networkIsolation:not-enforced`,
  `toolPolicy:fixed-command`, `maxSubagents:0`, `approvalPolicy:never`.
- `route` containing entry IDs, exact Messages base URL, platform/inference
  origins and `maxOutputTokens` (at most 256 for this acceptance mode).

The proof binds the installed runtime fingerprint, native schema/config exit
codes, original credential absence, profile file inventory/hashes, guard/patch
hashes, effective fields, route and expected fixed tool command/marker.
Directories must be distinct children of an explicitly allowlisted run root;
control files must stay inside it. Changes, reparse escapes, added profile
files, unexpected `.env` or home patches, and stale runtime/proof hashes block
execution. JSON patch lists are a deliberate YAML subset: no expressions,
anchors or hidden merges. These checks protect operator-owned local evidence
against drift; they are not cryptographic attestation against a malicious local
operator who can replace both config and proof.

The preflight uses the installed CLI's `--dump-config-schema` and
`--dump-config` in a new empty home/cwd with a scrubbed environment, without
mounting Agent/authentication services. Validate the effective tree against
the generated schema and compare critical fields before recording proof.
Do not dump a real private user profile: it can contain secret configuration.
No real credential file is read or copied by this adapter/preflight.

The installed base composition defaults to `deepseek-official`,
`deepseek-flash`, and `workspace-write`; it also supplies native retries,
title LLM/background surfaces. ACP policy objects do not configure these.
The reviewed patch must actually override read-only mode, fixed provider/model
and effort, output caps, foreground-only pwsh, and disable retries, title LLM,
search/web, subagent entries, telemetry and other model providers. A fixed native
`tools.guard` rejects every other command/tool and permissions/background
request before dispatch; it allows the exact marker command at most once.

This guard and account route are acceptance-profile data, not a dependency of
ACP's core or other executors. No regular DSH policy/profile is silently created.

## Authentication boundary

Headless 0.2.1-rc.2 disables the managed credential store, authorization and
DeepSeek account consumer by default. It does not automatically reuse GUI login.
Key routes can use launch env, cwd `.env`, then home `.env`. The account route
`deepseek-account` instead resolves its client-owned grant, checks destination
eligibility and never falls back to an API key. This is a possible reviewed
acceptance route, not evidence that the user's account is signed in or has quota.

Only the DSH client should handle sign-in/grants. Confirm the Account/Models
state through the native UI without sharing secrets. Client migration, issuer
mismatch or a rejected 401 can mutate a managed store. Any real test therefore
needs explicit handling approval; an opaque private store copy can protect the
original, but creating that secret-bearing copy is a separate action. The
adapter neither performs it nor reads credentials. A clean isolated home avoids
inheriting unrelated private profile settings/headers. No ACP keys, provider
credential variables, `NODE_OPTIONS` or ambient DSH homes are forwarded.

## Native invocation and process ownership

The inspector supports the exact public installed Windows launcher and pins
the 0.2.1-rc.2 Job/ABI, profile and guard-API module hashes. The fingerprint also
binds the archive, executable and launcher. Updates fail closed until reviewed.
No client source is copied into this repository and no native dependency is
installed. The CLI target is equivalent to:

```text
dsh --profile <reviewed-profile> --patch <reviewed-json-patch> --json -
```

Task text goes through stdin; there is no shell command concatenation or guessed
`--model`/`--effort`/`--sandbox` flag. Explicit dispatch/continuation model and
effort must match the reviewed native selection. ACP's legacy non-Codex route
clears an omitted model, so this adapter requires explicit model selection.

`dsh-process-owner.js` reuses the installed exported subprocess Job runner:
IPC is fd3 and target stdin/stdout/stderr use fd4/fd5/fd6. The runner creates the
target suspended, assigns it to an ordinary current-user kill-on-close Job and
resumes only after assignment. This controls lifetime; it does not replace or
weaken the native tool sandbox. No administrator or ACL/network change is used.

`target-exit` is distinct from entire-range settlement. A successful range
requires the pinned runner's normal completion after Job ActiveProcesses=0.
Cancellation/timeout sends one Job terminate and waits for settlement. If grace
expires, closing the owner requests kernel cleanup but the result remains
unknown; no PID-tree fallback, weak-mode launch, replay or permission retry occurs.
Unconfirmed ranges quarantine new execution through that adapter instance.
`hardInterrupt:false` remains honest for abnormal/unknown settlement paths.

The compatibility protocol is version-pinned; an exported runner entry does not
promise a permanent private IPC ABI. The normal-user Windows component tests
must prove descendant cleanup before activating a real profile.

## Sandbox and result truth

Windows ACL read-only restricts write/delete effects. It does not confine reads,
network or process visibility. The native sandbox policy has no network control
knob. `executionPolicy` exposes these partial-enforcement facts rather than a
false OS network=false claim. This acceptance mode uses a fixed-command guard,
not general network isolation; unsupported broader policy requests stay blocked.

The bounded NDJSON projection checks session/cwd, turn/step order, duplicate
terminal/step events, UTF-8/JSON, limits and native exit. Success also requires a
matching native pwsh call/result for the exact marker, and whole-Job quiescence.
A model's final text cannot substitute for execution evidence. Only a boolean
receipt and command hash are retained; raw tool data, thinking/text deltas,
stderr, headers and native errors are not logged. Unexpected or missing tool
results fail, never trigger another charged attempt.

`DshExecutor` extends the shared `ExecutorAdapter`/lifecycle, not Codex app-server
or API-executor transports. Same-process handles map to observed native session
IDs; continuation uses `--session-id`. Unknown native identity/cwd/policy blocks
resume rather than starting fresh. `persistentThreads:false` remains explicit:
Opt-in TaskStore checkpoint adoption is implemented, but native restart
continuation is not live-certified; see [recovery contract](DSH-RECOVERY-DESIGN.md). Native
headless supports saved IDs but rejects preset/subagent/fork or mismatched-cwd
adoption. Preserve logical task/parent/history even when recovery is unavailable.

Missing usage is null/unknown, partial usage retains known lower bounds, and
complete aggregate input/output totals are kept only with complete terminal
evidence. Cache/reasoning dimensions stay null until their native semantics are
certified. Interrupted runs keep already observed counts. Native aggregate
steps are not fabricated HTTP-request/billing records. The per-request output
cap and ACP observational budget are not a total provider-side cost cap; local
Job termination does not prove in-flight provider billing stopped.

## Verification and remaining acceptance

Run `npm run verify`. Protocol/profile/process-owner tests use synthetic files
and in-memory boundaries; real zero-model component checks separately use the
installed Job runner with self-owned Node parent/child/grandchild fixtures,
config/schema-only native modes in an empty home, and guard tests. These checks
do not use a model or real credential, and do not certify live DSH connectivity.

The unmodified native pwsh wrapper previously **failed** the local zero-model check. With
the installed client's own executable resolver and encoding preamble, read-only
execution printed the marker and exited 0, but both UTF8Encoding constructor
calls reported `Only core types are supported in this language mode` on stderr.
Job settlement was confirmed and workspace/temp ACLs did not change. A bare
marker command passing without that preamble does not resolve this finding.
The resolver selected pwsh from the current launcher's PATH; that location is
an observation, not an ACP dependency or a portable shell selection guarantee.
Do not suppress these errors, relax sandbox/ACL policy or spend model quota to
work around them. Resolve the installed client's read-only wrapper compatibility
through the bounded optional compatibility contract before live acceptance.
The implemented sandbox subclass and pinned ASCII marker passed a subsequent
zero-model native backend check; actual Cordis registration/config-cell checks
also passed with inert providers. General Unicode, Agent/session and webpage
behavior remain unverified; see [implementation and recovery limits](DSH-RECOVERY-DESIGN.md).

After separately approving authentication handling, exact model/destination and
cost unknowns, verify the original ChatGPT/DeepSeek webpage → existing Browser
Companion/Tampermonkey Bridge → local ACP → real DSH → original-chat ACP_RESULT.
Check staging without dispatch, explicit confirmation, exactly-once native work,
actual delivery, errors/retry/refresh and duplicates. Composer fill is not chat
delivery. Cross-restart continuation has an optional durable checkpoint implementation but still needs native
acceptance; current fixtures do not claim it. Do not alter original private
configuration, browser permissions, relay projects or the control-plane architecture.
