# PR4b — durable offline node recovery on integrated controller + node contracts

Authority: ACP V1 §§5/7/11. Base integration/acp-v1-controller-nodes merges PR21
and PR26 without copying commits or modifying either source branch/main.
Integration baseline verify:742 tests,741passed,1Windows-onlyskip.

## Invariants and scope

Single authoritative TaskStore, existing executor-checkpoint writer lock and
existing Orchestrator.queue. No second queue/store/remote lock. Controller lease
and execution generation are distinct. No new HTTP/MCP mutation or setter.
Default applications have no recovery coordinator/node binding. Trusted host
adapters are injected, no production adapter configured or live runner started.

Protocol: bind source → capture measured stopped checkpoint → release → validate
matching target inventory → durably admit exactly once → enqueue same task through
existing orchestrator. Generation increases on admission; old generations cannot
amend result or ownership. Source stop cannot be asserted by client flags. Branch,
HEAD, changed relative-file/hash inventory, tests, continuation/session digest and
logical lineage bound to checkpoint. No raw file content/secret transfer.
Uncommitted edits must already exist identically at target; never overwrite them.
Uncertain crash/restart blocks replay, including persist-before-enqueue window.
No expiry-based execution takeover; no claim of distributed fencing without actual
runner write enforcement. This is executable offline recovery, not live acceptance.

## Tasks

1. RED real-store tests for legacy defaults, checkpoint/release/acquire, stale
   generations, missing source stop, dirty/head mismatch, persistence/restart,
   concurrent requests, drift and write/audit failure. Implement minimal pure
   checkpoint protocol and host-only branded command + checked store transaction.
2. RED actual Orchestrator + fake executor tests: same queue/task/lineage, one
   admitted execution on repeated resume, fresh target session, unknown restart
   blocked, workspace reservation, stale writes and old controller independence.
   Integrate narrowly; preserve legacy behavior and no model tests.
3. Document trust/deployment limits, dependency/merge order and rollback; full
   verify, one independent review, fix important findings RED→GREEN; ordinary push,
   independent draft PR and exact-head CI. Never merge main or deploy.

Review focus: no self-asserted stop/approval; unknown/partial state fails closed;
checkpoint ownership fields cannot be patched; target dirty edits preserved;
no concurrent workspace writer; duplicate/restart never starts a second turn;
source task and usage/continuation/controller remain intact; no distributed/live
claim; injected adapters are host trust, not a network identity mechanism.
