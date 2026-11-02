# Default-off private delivery decisions

This increment stacks on the unified candidate, completing the identified private
credential read/insert/CAS storage and verified-ceremony→decision journal→delivery
host composition. It is a trusted in-process component, **not an authenticated
network review surface**, real enrollment, ordinary Chat workflow or merge grant.

## Composition and explicit boundary

`createDeliveryApprovalHost` in `src/core/delivery-approval-host.js` is default off.
The ordinary `npm start` executable never selects it. Neither config JSON,
environment, HTTP/MCP/CLI arguments, caller/controller ID nor `human:true` can
provide its callbacks or enable it. No new network tool/route/listener is added.
Construction does not read provider facts, register a credential or start a task.
A trusted embedding host may compose it **after** application/store construction:

```js
const approvals = createDeliveryApprovalHost({
  enabled: true, store: app.store,
  providerAdapter, authorize, authorizeUser,
  rpID, expectedOrigin, rpName,
});
```

These names are host-supplied capabilities/approved policy, not defaults chosen by
this implementation. `providerAdapter` uses the existing bounded read-only GitHub
adapter contract. Its decisions must be empty; only this private store supplies
ceremony-derived decisions. `authorize` covers registration/authentication/decision
purposes; `authorizeUser` is the exact existing repository/head user policy.
An upstream authenticated host must bind the principal before invoking methods;
a principal string passed by an untrusted request is not proof. No such upstream
network identity surface is implemented here. The example is not a deployment.

The returned host supplies begin/finishRegistration, begin/finishAuthentication,
refresh(taskId), status(taskId) and close(). Real registration requires the user,
actual permitted RP/origin and separately authorized enrollment. Tests inject a
fake library **only from trusted test code**; production defaults to the existing
standard WebAuthn verifier/library. JSON cannot select a fake implementation.
`finishAuthentication` invokes the verifier itself; it does not accept a result
JSON as trusted evidence. It stores a bounded decision after policy rechecks and
(for approval) a fresh exact provider HEAD check. A verified negative decision
can be recorded without provider availability, preventing an outage from reviving
old consent. No decision starts an executor, approves GitHub, merges or deploys.

After host close/replacement, outstanding storage/ceremony capabilities are stale
and current approval projections are cleared. close() preserves history; it is
not a user revocation. Reopening explicitly may re-evaluate an unexpired decision
against fresh provider/policy. Call close/stop host admission before disable or
reviewed rollback; constructing an off object does not revoke another host process.

## Same TaskStore, private bounded data

`TaskStore.createDeliveryIdentityStorage` defaults off and performs no write until
a verified operation. The enabled host capability implements the existing
readCredentials, insertCredential and compareAndSwapCounter interface. It also
provides storage-bound recordDecision and exact-revision decisionSnapshot to the
trusted composition. No second task store, queue, database or writer lock exists.

Private root `_delivery_identity` holds only RP/origin binding, public-key credential
ID/key/counter plus server revision, bounded decision events and expiry metadata.
It contains **no authenticator private key**, raw authenticator response/signature,
challenge, prompt, cookie or provider login. The RP-bound metadata remains private
operational data and must not be exported as task/telemetry output. Limits:32 users,
16 credentials/user,128 total credentials,256 decision records,1MiB identity JSON.
No silent eviction or fabricated credential revocation is performed.

Credential IDs are globally unique. Returned binary keys are copied Uint8Array;
stored keys use validated canonical base64. CAS checks expected counter **and**
expected server revision, increments revision even for zero→zero authenticators,
and rejects stale/decreasing updates. The verifier includes expectedRevision only
when the storage supplied it, retaining legacy injected-storage compatibility;
the private revision is removed from the standard library credential wire object.

Private data uses the original state file and exclusive writer/drift checks.
New state-file writes use owner-only0600 on POSIX. Windows requires the operator's
real private-directory/file ACL policy; mode bits do not prove ACL isolation.
State/audit symlinks are refused by the identity capability. Existing task views
strip/reject `_delivery_identity` just as they do other protected bookkeeping.
No token, bearer, principal policy or real credential is provisioned by this code.

## Failure, replay and rollback

Each private write persists pending state, appends/syncs a safe audit commitment,
then persists committed state. Errors fault the original writer and keep its lock;
no automatic lock stealing, repair or retry-as-success. Restart refuses pending
state, malformed schema, missing audit anchor, retained-audit/state rollback,
RP mismatch, clock rollback or disk drift. Audit/error text has fixed operation
labels and hashes, never raw user/credential/event identifiers or arbitrary errors.

Private state is hash-bound to its latest retained audit commitment. Ordinary task
writes preserve it. If audit rotation removes that anchor, identity use fails
closed until reviewed recovery; capacity can also block this shared writer. These
are explicit bounded-store availability costs, not distributed database guarantees.
Restoring an entire mutually consistent state+audit backup cannot be detected
without an independent external monotonic authority; trusted filesystem/backup
administration remains outside this local anti-rollback claim. Preserve both files.

Only live in-process authentication receipts branded by the actual verifier may
be appended, bound to their storage instance/RP/origin/user/credential/target and
challenge lifetime. Copied JSON, registration results, stale counter revision,
other storage/RP and expired receipts fail. A positive ceremony also captures an exact-revision decision high-water fence
before returning options; any intervening decision (including another credential
or user) rejects delayed positive admission without changing that newer event.
Negative consent stays deny-safe even if delayed; fresh approval must begin after
the latest known decision. Duplicate use of the same accepted
object returns the old event and never replaces a later revocation. Event identity
is server-derived from the verified ceremony; raw challenge material is not stored.

Decision TTL defaults120seconds, bounded30–600seconds. Expired approvals get a
persisted tombstone; negative decisions remain deny-safe across expiry/restart.
Latest user decisions are exact repo/PR/head scoped. Same-millisecond contradictory
events remain fail-closed/unknown under the existing evaluator instead of invented
future timestamps; a later fresh ceremony can resolve the conflict. Cached approval
expiry is capped by decision expiry. Identity revision guards run at final evidence
commit and cached reads, so an async old observation cannot install authority
after a newer counter/decision/expiry/host change. Known revoke/changes_requested
persistently reopens matching archived task views in the same identity transaction;
no executor starts and historical reports remain intact.

Provider failures, missing/expired decision, unknown user or changed HEAD yield
unknown through the existing evaluator. State success never substitutes for fresh
provider facts or user policy. A restarted host has no current approval until
explicit fresh refresh; automatic polling and network approval remain absent.

## Verification and remaining scope

Tests use temporary real TaskStore files, fake ceremony/provider seams and the
existing real evaluator/ArchiveService. They cover CAS concurrency including zero
counters, stale writers, exact binding, invalid/copy receipts, duplicates, private
fields/errors/audit, pending state/audit failure/restart, rollback, expiry and revoke,
provider/policy/head failure, archived-task invalidation and async evidence races.
No real credential, user, API, model, runner or network approval is exercised.

The storage/decision factory code gap is now implemented offline. Remaining PR3
work is the actual authenticated user-facing ceremony/host entry surface, its
explicit origin/RP/principal/check policy and real user enrollment/acceptance;
ordinary startup is intentionally unconfigured. It is wrong to call that absent
surface merely a configuration toggle. Next definite independent offline work can
measure allowlisted local Git/workspace inventory for the PR4 host contract.
Actual stopped proof, remote transport and write fencing still need the identified
existing runner/access architecture before a real pilot. Ordinary Chat unattended
behavior remains conditional research under original§9, not a new shipping gate.

Rollback: close host admissions, stop managed work under existing procedure,
preserve state/audit/decision/report/checkpoint history, then review code revert.
Do not run old code that silently ignores these credentials/counters/decisions and
later treat the resulting state as verified. No destructive cleanup or main merge.
