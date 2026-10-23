# Native DSH encoding compatibility and checkpoint recovery

This is the implemented optional contract accompanying [DSH integration](DSH-INTEGRATION.md).
Both the adapter and recovery are default-off. No original config, installed
client, account, ACL, language mode or network policy is changed.
`persistentThreads:false` and `hardInterrupt:false` remain accurate: native
Agent restart continuation and abnormal process settlement are not live-certified.

## Bounded encoding compatibility

The installed 0.2.1-rc.2 local pwsh executor prepends two UTF8Encoding constructors
before sandbox confinement. In the original zero-model check both constructors
reported unsupported types while the later marker printed and exit0 was returned.
This is consistent with CLM's type restrictions, but that check did not query
LanguageMode or establish which policy source selected it. Preserve the boundary;
see Microsoft's [language modes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes?view=powershell-7.6).
Modern PowerShell's [encoding defaults](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-7.6)
support a bounded ASCII-only compatibility path, not a general Unicode guarantee.

`dsh-pwsh-compat.js` creates a subclass of the installed **sandbox** executor.
Only `argv` changes: omit the exact native encoding preamble for one reviewed
`Write-Output 'ACP_…'` ASCII marker under read-only/foreground/kill-on-expiry.
The native `resolve`, `execute`, `confine`, subprocess, cancellation and output
methods remain inherited. The plugin registers this subclass through installed
Cordis, reusing its inherited Config schema and volatile cells. It is not a raw
shell replacement and does not override the confinement or error path.

An optional profile `compatibility` object binds modulePath/moduleSha256,
pwshPath/pwshSha256/pwshVersion, cliEntry and command. The patch must disable the
original `pwsh-sandbox` row and insert exactly one enabled `acp-pwsh-compat`
module with that path and reviewed config, alongside the existing guard.
Native patch names are selectors, not replacements. The module stays under the isolated runRoot; CLI root is the pinned
installation; pwsh must be version 7 and its regular-file bytes must match.
Shell drift, native argv ABI drift, another command/mode, background promotion,
5.1 or missing evidence fails closed. No PATH fallback is used by this mode.
The plugin retains native stderr/errors; it never changes CLM/lockdown/trust.

Zero-model component evidence separately verifies the installed exported argv/
confinement seam against the real ACL read-only backend, and actual Cordis
registration/config cells against inert providers. These are not a headless
Agent task, account validation, Unicode certification or webpage acceptance.
Synthetic profile contract tests bind the module, shell, command and runtime.

## Opt-in TaskStore recovery

Set `executor.dsh.recovery.enabled:true` only for a reviewed isolated profile;
`retentionMs` is an integer from 1 second to 24 hours (default 24 hours).
No default config is edited. Orchestration attaches its existing TaskStore to
the optional adapter; there is no second authoritative session-map file.

On start, recovery acquires `executor-checkpoint.lock` in stateDir with exclusive
creation and a random owner token. Cooperating TaskStore state writers refuse
a foreign/missing lease. The owner detects state-file drift and faults on failed
checkpoint persistence. A normal quiescent stop releases its own lease. A stale
lease, unknown process range or write fault is never silently cleared, stolen or
treated as a missing installation. Crash recovery can therefore require an
operator to establish prior-owner/process quiescence and review the stale lock;
this batch does not automate that decision or promise transparent crash resume.
Readiness/discovery does not acquire a lease; opt-in start does write this scoped
state lock, without starting a client or probing authentication.

The task's version-1 `executor_checkpoint` contains only metadata: task/logical/
parent identity, ACP handle/turn, native ID, unique attempt, monotonic sequence,
runtime/profile fingerprints, canonical workspace/client-home reference, model/
effort, retained idempotency key/fingerprint, phase/range, retainUntil and result
hash. The report already stored on the task remains the authoritative result;
checkpoint metadata does not duplicate prompts, credentials or native bodies.

| Durable phase/range | Restart behavior |
|---|---|
| absent | Existing strict refusal; no fresh-session fallback |
| intent / unknown | Spawn might have happened; refuse adoption/replay |
| session-observed / unknown | Preserve native ID; refuse adoption/replay |
| unknown / unknown | Failed/interrupted/unconfirmed execution; refuse |
| terminal-confirmed / empty | Revalidate result, identity, bindings and retention before adoption |
| malformed/drifted/expired | Refuse, preserving evidence |

Persist intent before spawning. Persist observed session identity while parsing
the native stream. After completed protocol, matching tool receipt and whole-Job
emptiness, commit normalized report/usage/outcome/native ID and confirmed
checkpoint in one TaskStore update. Write failure quarantines the adapter and
does not synthesize a completed result or reroute. A newer unknown attempt on
the same handle prevents falling back to an older confirmed checkpoint.

`resumeThread` validates the latest checkpoint and hydrates the same native ID;
lookup performs no CLI launch. Only a new explicit turn/continuation can invoke
`--session-id`. Unknown/mismatched state never creates a fresh native session.
Runtime/profile/cwd/client-home/model/effort, ACP task/turn/lineage, stored result
hash, retained request identity and expiry must match. Native saved-session
preset/subagent/fork/cwd limitations still require actual native acceptance.

## Result idempotency and retention

Recovery-mode dispatch and continuation require explicit idempotency keys.
Identical retained requests return the original record; a changed request with
the same key conflicts. Continuation fingerprint binds its original parent.
Retained continuation lookup precedes executor discovery, so returning a saved
result does not require a healthy live executor. No lookup launches work.

Tasks with an unexpired checkpoint are protected from capacity pruning. After
retention expires adoption refuses; terminal tasks/keys may then be pruned.
This is bounded record-retained duplicate protection, not permanent exactly-once
execution or a provider billing guarantee. Legacy executors/continuations that
do not opt into recovery retain their existing behavior.

## Verification and limits

Tests use TaskStore files, independent Node readers/lease owners, fresh adapter
instances and synthetic native streams. They cover cold adoption/explicit same-ID
continuation, retained result lookup, duplicates, conflicts, missing keys,
unknown attempts, drift, expiry/pruning, malformed/truncated state, foreign/lost/
stale leases, injected write failures and partial usage. Existing fail-closed
restart characterization remains valid when recovery is disabled.

Leased state writes fsync their temporary file before same-directory rename;
directory flushing and full power-loss recovery are not certified. The lease
coordinates compliant TaskStore writers, not hostile programs that can replace
both state and evidence. Native process quiescence cannot be inferred from PID
absence or a metadata file. Never weaken sandbox/CLM to close a test gap.

Run `npm run verify`. Then separately certify real native saved-session
continuation under an approved credential/model/cost envelope and the original
webpage staging → explicit dispatch → native DSH work → original-chat ACP_RESULT
path, including errors, retries, refresh and duplicates. Unit/component success
does not close that acceptance gate or change persistentThreads to true.
