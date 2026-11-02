# Verified acceptance → daily report → active-view archive

Authority: ACP V1 §§5/8/10/11 and user workflow recorded in PR24 / delegated
2026-11-02 continuation. Base integration PR30 ec85dd27669220a496940bc230ae7f30b73f6c77,
combining PR23 trusted evidence with PR29 messages and all PR27→28 prerequisites.
No new queue, model/vendor connection, human policy, credential or deployment.

## Contract

A completed/partial inactive task can archive only with a current PR23 host
projection: authenticated user-originated decision approved, exact repo/PR/head,
checks passed, unexpired, healthy store. Message/manual/human flags never qualify.
PR3 private host capability supplies bounded decision identity; no new approve
setter or network acceptance endpoint. Default-off workflow configuration.

Persist bound acceptance first; write/sync a dated bounded local report second;
only after verifying both mark archived. Reports contain safe IDs/PR/head/status,
no raw prompts/output/paths/credentials. Report failure keeps task active and can
retry idempotently. State/audit failure faults writer. New head or changed task
binding reopens the active view; old acceptance/report history remains factual.

Active work is a filtered VIEW of the existing TaskStore, not another queue.
Execution scheduling/status remain unchanged. Keep existing historical APIs and
add active/report views. Pin lifecycle/message records rather than deleting
history at capacity; bounded store full is explicit until a separately reviewed
history retention/offload policy exists. No infinite or silent eviction promise.

## Task 1 — trusted acceptance/report persistence (TDD)

- RED actual TaskStore + PR23 host evaluator fixtures: manual/anonymous/green CI
  unsupported; fresh exact trusted approval accepted. Source principal/event are
  private/hashed, never task-visible credentials or caller-controlled authority.
- RED ordering, report IO failure/retry/no duplicate rows, audit/state failures,
  cold restart, head/revocation/expiry races and checkpoint-active task rejection.
- Implement minimal report store and checked TaskStore workflow transitions using
  existing writer lock and protected private fields. No raw trusted setter.

## Task 2 — public worklist/report integration (TDD)

- RED default-off HTTP/MCP, strict schemas/auth/Origin, active exclusion only after
  committed report/acceptance, ordinary list/get history retained, report privacy.
- Existing dashboard can request active view when enabled; original list_tasks and
  default /v1/tasks remain history for compatibility. No execution on read.
- Lifecycle actions only bookkeeping after real user approval; no merge/API call.

## Task 3 — acceptance and delivery

- Update original-stage matrix honestly (complete offline / partial / live pending).
- Full verify, one independent review, important fixes RED→GREEN, final verify,
  normal push, independent stacked draft PR, exact-head CI and remote readback.
- Actual trusted user registration, real runner and ordinary Chat document loop
  remain live gates; mock ceremonies/fixtures never count as real acceptance.

Review focus: approved is never inferred from prose/CI; decisions exact-head
bound and race checked; acceptance/report precede archive; failed/replayed/restarted
attempts don't lose active work/history or duplicate reports; node fences and
single queue preserved; no sensitive report/response fields; default-off behavior.
