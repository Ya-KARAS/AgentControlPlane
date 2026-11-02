# Private credentials and verified decisions implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task.

**Goal:** Complete the default-off host-only read/insert/CAS credential store and verified-ceremony decision journal/adapter composition.

**Architecture:** Reuse the one TaskStore/state file/writer lock/audit. A bounded private root holds RP-bound public-key credentials, counters/revisions and immutable decision records. Only in-process verifier-branded results can create decisions. A host factory joins fresh provider facts with that private journal through existing delivery evaluation; no HTTP/MCP/CLI setter, production registration or default caller identity.

**Tech Stack:** Existing Node>=22/ESM/node:test/Zod/standard WebAuthn dependency. No new package.

**Spec:** Original engineering design §§4/5/8/10/11; docs/ACP-V1-ACCEPTANCE-GAPS.md; explicit authorized host-only implementation, fake ceremonies/temp storage, no real enrollment or network approval route.

## Global constraints

One task queue/store/writer. Default closed, no provider/model call unless injected by trusted host. No real credentials/identities, network route, deployment, fee or main merge. Credentials/decisions private; no raw crypto/user/event data in audit/errors/logs. Keep existing verifier/caller APIs compatible.

## Review focus

- Crash or audit/state rollback must not resurrect approval or counters; uncertain persistence blocks, never retries as success.
- Counterless authenticators still need CAS revision fencing; concurrent zero counters cannot both win one revision.
- Copied/JSON/registration/other-RP/stale-host ceremony results cannot append decisions.
- Expiry/revoke/new HEAD/policy or provider failure must clear current effective approval; historical workflow revocation must persist.
- Old HTTP/MCP/CLI/manual setters gain no authority; private state never enters task/public projections.

## Tasks

- [x] Task1: Add failing real TaskStore credential tests for defaults, RP binding, insert uniqueness, binary restart, CAS/counterless race, malformed/capacity/state/audit failures and retained-audit rollback. Implement pure bounded identity model plus same-lock pending→audit-sync→committed transaction, private file mode and fixed errors. Run GREEN and commit.
- [x] Task2: Add failing verifier provenance/decision tests for copied receipt, idempotent object replay, exact target/time/user binding, expiry/revocation/restart and failures. Brand actual verifier results, persist decisions with no public setter, revision CAS compatibility. Run GREEN and commit.
- [x] Task3: Add failing host-composition tests using real evaluator/store plus fake provider/standard-library seam: default off, verified decision producer, fresh provider HEAD, changed head/policy/failure, revoke/expiry invalidation, no duplicated executor/public authority. Implement bounded host factory only; document remaining review UI/real identity/node gaps. Run GREEN and commit.
- [x] Independent review once; fix Important RED→GREEN, final npm run verify, ordinary push, independent draft based on PR33 and exact-head CI. Keep source branches/main untouched.

Final review: two Important ordering flaws reproduced RED and fixed GREEN: delayed cross-credential approval now fails a target-wide decision high-water fence, and same-timestamp conflicts are incomplete/unknown in either order. No Critical/minor/deferred findings. Real identity/surface/deployment and trusted filesystem/whole-backup boundaries remain unvalidated. Final suite and remote receipts are recorded in this PR.

Final Cloud npm run verify exit0:1049tests/1048passed/0failed/1Windows-onlyskip; checkPASS. Delivery targeted67/67, new24/24. Both review Important findings fixed RED→GREEN; no deferred/declined code findings. No real ceremony/provider/model/runner performed. Exact remote HEAD/CI are recorded in the draft PR.
