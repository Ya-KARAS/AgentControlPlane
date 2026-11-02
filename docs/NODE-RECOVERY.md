# Offline execution-node recovery (PR4b)

Implements ACP V1 §7 checkpoint/release/admit in the existing TaskStore and
Orchestrator queue. Requires the integration of PR21 controller ownership and
PR26 node preflight; see [stack order](#stack-order). This stage executes tests
with the actual scheduler/store and fake executors only. No persistent runner,
network transport, real execution adapter or source-file copy is configured.

## Host composition and authority

`NodeRecoveryCoordinator` is an in-process host API. Its constructor takes the
existing store, enabled node registry, fixed source/target node IDs and
`inspectSource(task)` / `inspectTarget(task)` adapters. The default application
creates none. It has no MCP/HTTP mutation, CLI importer, new credential, polling
loop or client-controlled trusted setter. A prompt/caller_id/controller_id or
`stopped:true` request cannot provide a branded store command or queue admission.
Adapter exceptions become fixed unavailable errors, not raw output.

The adapters must measure facts at the chosen execution nodes. Tests inject
controlled observations; they prove protocol behavior, not that any actual
source stopped. Each observation binds exact task ID, node ID and expected
execution generation; observations are server-clock checked with lifetime <=60s.
Source requires measured `stopped:true`. Target requires ready/idle, persistence
for cloud, and matching branch, HEAD and all dirty relative-file SHA256 entries.
No missing/changed user edit is overwritten. If project registry relinking is
needed, a different target path is blocked until that separate registry change
is verified. Target paths are canonicalized with the existing workspace allowlist before
admission/reservation; matching physical workspaces cannot bypass exclusion through
trailing slashes or symlink aliases. Supply explicit trusted `workspaceRoots` for
a new allowed location; omission permits only the original task workspace. This
offline coordinator requires locally visible directories, not guessed remote
canonical paths. No arbitrary paths, URLs, tokens or commands enter telemetry.

Source checkpoint has bounded branch/HEAD, <=256 unique relative file/hash
entries and <=16 allowlisted npm test/check summaries; serialized package <=8KiB.
A digest binds lineage, original brief/policy, project revision, executor/history,
session, usage, result and existing continuation without copying those into the
recovery record or audit. Source executor usage, session IDs and stopped end reason
are snapshotted in the existing history before the target history is appended. Existing continuation is preserved; target prompt gets
the bounded checkpoint too. No raw file contents or credentials are transferred.

## Durable protocol

1. `bind(taskId)` assigns source node and generation1 to a quiescing task. It does
   not stop or start an executor. Another task's live/reserved workspace blocks it.
2. `checkpoint(taskId,generation)` requires measured source stop, fresh exact
   binding, bounded inventory/evidence. Task becomes blocked/checkpointed.
3. `release(taskId,generation)` verifies checkpoint still matches the task and
   persists released state. Expired controller leases never imply execution stop.
4. `resume(taskId,generation,resumeKey,targetOrchestrator)` validates target facts,
   persists admission with generation+1, appends target executor history and
   starts a fresh target session through the **same** queue/task. Old sessions
   remain in historical evidence, never resumed across nodes. No child task or
   shadow queue is created. Resume keys are bounded and bound to current target.
5. Admission receipt is in-memory branded and matched to the runtime's explicitly
   constructed `executionNodeId`. Repeating a resume key returns current task
   without enqueuing another turn. The target runtime must be explicitly supplied;
   no normal startup gains this binding from a client argument. Conflicting older
   runtime entries reject admission instead of silently swallowing it; only an
   identical active receipt is deduplicated.
6. Terminal task status alone does not release a workspace. Managed completion,
   cancellation, timeout or failure enters `awaiting_stop`; failed/unknown
   interruption retains the reservation. Host `complete(taskId,generation,
   orchestrator?)` requires a fresh measured stopped observation from the current
   owner before releasing that reservation. No client completion flag can do it.

TaskStore reuses its existing executor-checkpoint writer lock, disk-drift check,
atomic rename and audit chain. Changed ownership fields are rejected by ordinary
`updateTask`; managed result writes also require current node/generation. The
scheduler captures the fence on its active entry and checks before asynchronous
execution side effects and late notification association. Controller lease
changes are independent and cannot authorize a node transfer. Existing legacy
records have null defaults and retain old behavior.

Existing executor-native recovery/checkpoint modes (including retained native
checkpoint records) are explicitly unsupported for this node transfer and fail
closed before admission. Their existing unmanaged local behavior is unchanged; a
future node-bound native-checkpoint adapter needs separate tests.

## Failure/restart behavior

- Write failure restores prior in-memory ownership, faults writer and retains the
  existing lock. Audit failure after durable write admits **no executor** and
  faults the writer. State/audit remain separate files with their existing crash
  window; this is not a distributed transaction guarantee.
- Persist-before-enqueue or enqueue failure becomes uncertain/blocked. A cold
  scheduler restart quarantines queued/running managed tasks before replay;
  it never adopts a persisted admission as a fresh executable receipt.
- No time-based automatic execution takeover. Uncertain state needs a new measured
  stopped checkpoint/release and a later generation. Old receipts cannot renew,
  release, overwrite result/owner or start another execution after that transition.
- The source host must remain stopped after it attests stop. These offline fences
  protect the single authoritative store/scheduler, not arbitrary filesystem writes
  by a disconnected old machine. A real runner must enforce fencing at its write
  boundary before distributed/cloud acceptance can pass. Never share state.json
  or treat controller leases/GitHub comments/local locks as distributed fencing.
- Crash-retained writer locks are not auto-deleted. Operator inspection/recovery of
  the original process and safe lock ownership remains required.

## Stack order

- PR21: `feat/acp-v1-controller-queue` (main based).
- PR26: `feat/acp-v1-execution-node-preflight` (main based).
- PR27: `integration/acp-v1-controller-nodes`, normal merge retaining both ancestors,
  base PR26; additive config/docs/clone fixture resolutions; combined verify passes.
- This PR4b: `feat/acp-v1-node-recovery`, based on PR27; diff contains only recovery.

After **specific user merge approvals**, integrate PR21 and PR26 in reviewed order,
retarget PR27 onto main to review remaining resolutions (or close if all are
already incorporated), then retarget recovery after its prerequisite is accepted.
Use new ordinary commits for any integration changes, never force-push or copy
all prerequisites into another independent main-based implementation. PR22/23/24/25
remain separate preserved work; they are not implicitly integrated by this stack.
Run combined verification again after any eventual conflict resolution.

## Actual-runner inputs still needed

Specify one existing user-owned persistent node (host/OS; do not buy one), its
allowed workspace and private state directory, compatible installed CLI and
supported login availability. Select the one authoritative scheduler location
and the approved means of reaching it; no new public MCP endpoint is proposed.
Authorize service install/start/lifecycle and any genuinely missing credential
or network change individually. Then authorize one bounded subscribed live task
and controlled desktop-off/return test. No such host/configuration was selected
or provisioned here; current Codex Cloud development is not that runner.
The real adapters must prove source stop, exact inventory and target write fence,
not just return the fixture booleans in these tests.

## Verification and rollback

`node --test tests/node-recovery.test.js` covers real persistence/scheduler with
fake executors, repeated resume, stale writers, restart, races, inventory failures,
controller separation and late asynchronous readiness. No live model or quota call.
Full `npm run verify` includes both prerequisites and legacy ACP regressions.

Pause host admission and stop/verify all managed execution before rollback.
Preserve task/checkpoint/history/audit and source edits. Mark every managed queued
or running record safely blocked before using older code that cannot enforce
these fences; never simply revert and let an old scheduler replay those tasks.
No destructive cleanup, credential removal or main merge is automatic.

## Bounded local inventory adapter

`createWorkspaceInventory` is an explicit default-off host capability, paired with
`createWorkspaceRecoveryInspector` and the existing coordinator. It does not scan
on normal startup or expose a network/CLI tool. Hosts choose canonical workspace
roots; tests use only temporary repositories. Only ordinary in-root `.git`
directories are supported: worktree/gitfile/external metadata, submodules,
symlinks/hardlinks, sparse/assume-unchanged index flags, configuration includes
and filter commands fail closed.
Partial-clone/promisor layouts are rejected before Git runs, with lazy-fetch
suppression as defense ([Git documentation](https://git-scm.com/docs/git)).
Global/system Git configuration is excluded; fsmonitor, hooks and external diff
are disabled. Git-ignore rules remain effective; ignored runtime material stays
node-local and is never copied. This is source-controlled handoff evidence, not a
complete disk backup.

Capture returns branch/HEAD and bounded dirty/untracked relative paths with
SHA256; missing files have `{path,sha256:null,deleted:true}`. Old hash-only entries
remain valid. Unsupported names, sensitive paths, conflicts, detached HEAD,
metadata/output/file/time limits and detected changes return one fixed error,
never partial evidence or raw command/file contents. Defaults: 256 manifest files,
8MiB per file, 32MiB total inspected tracked or dirty content, 10,000 metadata
entries/64MiB, 256KiB command output, 5s deadline and 8KiB recovery package. Normal
checkouts larger than these bounds require an independently reviewed adapter or a
smaller task workspace; no silent truncation. Reads do not refresh the Git index.

Matching repeated metadata/index/HEAD/status observations and descriptor-checked
hash passes reject ordinary concurrent changes. This is not an atomic OS snapshot
or protection against a hostile filesystem administrator/Git executable. Paths
and hashes are local operational evidence, never external telemetry. No source
bytes, secrets or remote credentials are returned or transmitted.

The inspector requires separate fresh, task/node/generation-bound measured source
stop or target ready/idle/persistence observations before and after capture. Each
proof is checked for freshness independently, so a new inventory timestamp cannot
refresh an old stop proof. Evidence validity is their intersection, capped by the
inventory's one-second window. Inventory alone cannot prove a remote writer has
stopped, authorize takeover or start an executor. Real runner write fencing and
controlled offline/return acceptance remain outstanding.

Rollback: disable this host capability and retain all checkpoints/audit/user edits;
restore a proven inspector before resuming managed tasks. Older code cannot read
explicit deletion entries safely; do not admit such records with an older adapter.
