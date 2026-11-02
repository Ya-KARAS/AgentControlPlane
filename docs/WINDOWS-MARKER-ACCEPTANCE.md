# Isolated Windows single-Codex acceptance

This default-off entry is for the explicitly authorized first Windows pilot.
It uses the **actual CodexExecutor/AppServerClient and existing Orchestrator queue**,
not a separate `codex exec` shortcut. Cloud tests replace only the external
app-server with a child speaking its protocol; those receipts say offline-fixture.
No live Windows/model pass is claimed by this PR.

## What it does and does not load

`npm run accept:windows-marker -- --run-marker --model <advertised-model>` is an
explicit subscribed live operation. Without the flag/model it exits before any
runtime files or executor process. Ordinary `npm start` is unchanged.

It creates a fresh private `%TEMP%\acp-marker-*` root, empty ACP state and a tiny
new Git repository (README/AGENTS baseline). It never accepts an existing workspace,
state directory, prompt, task ID, production config or queue. No loadConfig,
createApplication, RemoteRelayWorker, Companion or old ACP state is started/read.
AGENT_CONTROL_CONFIG/STATE_DIR/HOST/PORT do not configure this entry. Only one
Codex executor is constructed; periodic discovery/reconciliation are disabled.
One fixed task, one queue and idempotent run promise; no automatic live retry.

Codex starts in that new workspace using its installed native executable and
existing CLI-owned login. ACP does **not** copy/read auth files or tokens. The
Codex client necessarily owns and reads its existing authentication/configuration;
this is not a blank CODEX_HOME or a new OS read-isolation container. No claim that
workspace-write alone forbids every OS read. Fixed brief forbids outside reads;
workspace-write, no command network, no escalation and temp-root exclusions are
requested without changing system sandbox configuration. Native sandbox readiness
must pass the original adapter/orchestrator check. No setup/install is automatic.

Acceptance-only launch uses documented stdio transport, disables multi-agent,
apps/plugins/browser/computer/image/hooks/memories, hosted search and notifications,
forces ChatGPT login and built-in OpenAI provider. The existing ordinary launch is
unchanged. Passive account/config/rate-limit RPCs run before dispatch. API login,
non-OpenAI provider, enabled MCP, inline hooks or disabled-feature overrides block.
Missing/unknown credit policy, funded/unlimited credits and unknown/exhausted
subscription windows block instead of silently using a paid route. No credit
purchase/reset/login API is called. These signals are not a billing audit or a
cash-spend measurement: receipt cash_spend stays unknown. The Windows operator
must verify automatic paid usage/top-up remains off; no paid setting is changed.
If a client omits required credit/config fields, stop with its fixed reason and
report the compatibility gap; do not bypass the guard or invent quota.

The requested model must be advertised by that actual app-server and support low
reasoning. Use a current subscribed inexpensive model already available; this
entry does not guess a product/model name. The task has no subagents and a4000
requested token budget monitored by existing ACP; this is not an atomic billable
hard ceiling. Active wall deadline is <=120s (plus bounded process/cleanup RPCs).
Only acceptance-marker.txt may be added, exact UTF-8 LF bytes. Windows sandbox
failure or unavailable protocol returns blocked/failed, no fallback to unsandboxed
execution, another executor or a paid API.

## Windows run and stop

Preserve the original ACP checkout and its uncommitted local/default config. Update the **isolated acceptance worktree only** to the exact PR head after
review; verify `git status --short` and `git rev-parse HEAD`. Do not reset/clean the
original repo or merge main. Node25.2.1/Git2.55.0.windows.5/Codex0.165.0 were reported
by the Windows preflight, not independently executed by Cloud.

In PowerShell at that isolated checkout (with existing locked dependencies):

```powershell
node .\scripts\accept-windows-marker.js --run-marker --model <advertised-model> --codex-command '<existing-native-codex.exe>' --port 18891 --timeout-seconds 120
```

Replace the model/executable placeholders with the prechecked actual values.
A native .exe is required; do not invent a new wrapper/login or copy credentials.
If only a npm shim is resolved, report native_codex_executable_required and locate
the existing official executable by passive inspection before running again.
No repeated live attempt is automatic. Do not run `npm start`, doctor, demo or an
independent Codex CLI task to substitute for this chain.

It prints the loopback status address before starting. In another terminal,
`Invoke-RestMethod http://127.0.0.1:18891/status` reads fixed operational fields.
Only GET /health and /status exist; POST dispatch/start/cancel/approve is404.
No token, session identity or approval route is created. Health means this isolated
host only, not the production ACP/ChatGPT/relay chain. Host/Origin and socket/time
limits remain enforced. A port conflict stops before execution; use an explicit
unused test port if needed, never stop the old service to free its production port.

Press **Ctrl+C once in the owning terminal** to request cancellation. No fake
cancelled status clears execution: it first requests the original interrupt,
then observes/terminates its own process tree, verifies disappearance and only
then settles the owned queue entry. It never launches a second executor/turn.
Do not use a wildcard process kill against all Codex/Node/PowerShell processes.

## Evidence, cleanup and failure meaning

Windows uses Get-CimInstance Win32_Process (only PID/parent/creation metadata),
using only the three selected properties (bounded30s first provider probe before
app-server spawn;15s steady queries), then taskkill /PID <own-root> /T /F and a new census of the observed identities.
No command lines, users or credentials are collected. PID creation identity is
checked before termination; denied/changed/unknown identity never authorizes a
kill based on a guessed PID. This is **observed-tree disappearance**, not a Windows
Job Object, hostile OS/reparenting guarantee, cross-node stop proof or remote
write fencing. POSIX process groups exist only for offline child fixtures.

Only after confirmed observed-tree disappearance does it validate exact marker
bytes, bounded inventory, unchanged HEAD, sole expected untracked path and an
actual bounded Git diff. A task terminal state alone cannot make that pass.
Receipt contains actual task/result status, bound task-usage counts (null when
unobserved), marker hash/diff, process evidence, elapsed time and fixed failure
reason. No model summary, thread/account IDs, raw errors/headers or personal paths
are exported over status. CLI prints only its own local receipt path and compact
receipt; do not paste unrelated/private state into GitHub.

On confirmed cleanup, only this run's workspace/state are removed. A compact
private receipt.json remains at the printed path for Windows verification.
Normal completion or cancellation closes the listener. Verify no listener on the
test port, and inspect the reported **own** PID(s) if required. Do not infer that
all system Codex processes were stopped. Remove that exact owned receipt directory
only after review, e.g. `Remove-Item -LiteralPath '<printed acp-marker root>' -Recurse`.

Any unconfirmed process/census/permissions result retains runtime files, returns
cleanup_unconfirmed and includes known spawned PID, failed operation and fixed
reason/known-denied classification. It does not claim stopped or retry a denied
census. Retained private state may contain raw executor diagnostics: keep it local.
A lost response/denied kill needs operator inspection/explicit recovery; do not
silently delete/reuse state or declare the port/process clean. Receipt write or
file cleanup failure is also not a pass. Record exact action/target/status,
completed steps and uncertain outcome before deciding another authorized action.

## Separate human-session decision

The marker host supplies **no** resolveSession/approval identity. A Windows account
name, shared bearer, TTY, fixed principal, ChatGPT CLI login and a successful
marker do not prove a human approved a PR.

Smallest proposed path: user-approved real WebAuthn enrollment on one exact local
RP/origin, then a separate session-authentication ceremony. Credential ID is only
an untrusted lookup key into private registered records; verify challenge/origin/
RP/UV/signature and counter CAS before deriving its principal and issuing a short
HttpOnly/SameSite session. resolveSession validates that issued server session.
Every PR decision still requires its own exact repo/PR/head ceremony; login does
not set approved. Reuse the standard verifier library/storage primitives, with a
distinct login purpose; do not invent a fake PR target to log in. First enrollment
requires the user's explicit identity mapping/enrollment approval and personal
verification; this code is not implemented or enabled by the marker entry.

Proposed alternative only if already deployed: a Windows-authenticated loopback
SSPI/IIS/HTTP.sys host can supply a verified Windows principal/session, followed
by the same separate WebAuthn decision checks. Username/header/account type is
not SSPI verification. No Windows role/service/native dependency is installed
here. Enabling such components/permissions would need a specific approval.

The exact choice still needed: actual trusted origin/port, user/credential mapping
and enrollment policy, and whether to use WebAuthn-gated sessions or an **existing**
Windows authenticated host. A candidate separate origin could be localhost:18892
only after confirming it is free and the user approves it; it is not configured.
Windows Hello/security-key/browser compatibility on this machine remains to be
personally tested; platform capability alone is not enrollment acceptance.
See [Microsoft WebAuthn APIs](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/webauthn-apis).

Official protocol/config references:
[Codex app-server](https://developers.openai.com/codex/app-server/),
[configuration](https://developers.openai.com/codex/config-reference/).
No real credential, permission, paid service, VPS, public endpoint or main merge
is created by this PR. A local marker pass is not cross-machine/cloud acceptance.
