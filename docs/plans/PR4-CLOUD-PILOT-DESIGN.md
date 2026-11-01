# PR4 cloud pilot — separate design, not implementation

Prepared 2026-11-01 from original design Sections5/7/11. No runner was created,
configured, contacted or paid for. Current saved Codex Cloud development is not
proof of an authorized persistent subscription runner.

## Minimum actual runner

One user-owned persistent machine, single ACP scheduler, Node>=22, Git, a locked
checkout, private state outside workspace, a compatible locally installed CLI
with the user's supported authentication, and a dedicated allowlisted project
workspace/feature branch. Home desktop may be off while this node is online.
No shared state.json across computers. Model login persistence/usage terms must
be verified for the chosen CLI; GitHub Actions is CI, not assumed login storage.

Use existing owned capacity if available; none has been established in this
task. Cloud provider, node identity, OS/resources, region, retention and maximum
cost are therefore unresolved inputs, not invented deployment facts. Default
network is loopback inbound, outbound source/required executor access only.
User access via an existing approved secure channel is preferred. A new tunnel,
public MCP endpoint or AsterRoute deployment is not implicitly authorized.

## Recovery protocol design before runtime changes

Checkpoint task logical lineage, source branch/head, test evidence, executor
session and modified-file inventory. Preserve uncommitted user edits; do not put
secrets/runtime state into GitHub. Source-controlled transfer uses ordinary
commits and branches, never force push or automatic main merge.

Explicitly stop/confirm release of the old active workspace turn before acquiring
new execution ownership. The PR1 controller lease is NOT an execution-node lease.
A crashed/offline writer is uncertain, not safe to duplicate; default blocked.
A later implementation needs its own durable node-generation fencing and proven
single owner. Existing local file locks/relay worker must not be labeled a proven
distributed lock. Keep one logical queue and no second executor against a live
workspace. If no authorized node is online, report queued/blocked honestly.

## Implementation/testing plan after design approval

1. Failing tests for node registry/capabilities/heartbeat: absent, stale and
   incompatible nodes are unavailable; no silent paid route.
2. Failing state-machine tests for checkpoint, explicit release, acquire,
   generation fencing, duplicate requests and uncertain crash blocked.
3. Narrow existing TaskStore/orchestrator integration and continuation package;
   tests preserve lineage, user edits, sessions, tokens and one execution count.
4. Offline simulated two-node tests before any real task; verify failure injection
   never produces two writers or loses edits. Full npm run verify.
5. Separately authorized actual-runner acceptance below; record exact node/HEAD,
   timestamps and evidence. Failure remains failure, not a simulated pass.

## Individual actions needing user approval

- Select an existing owned node OR approve creating a specific host with explicit
  spending limit; no purchase until selected/approved.
- Install/start a persistent ACP/CLI service, choose service account, allowed paths,
  restart policy and private state retention on that node.
- Provision supported CLI login locally and repository-scoped Git credentials;
  approve any new persistent credential/permission separately, never extract or
  copy desktop/browser credentials through chat.
- Approve any new network/tunnel/firewall configuration; no public raw MCP.
- Approve the specific live executor test and its subscription/API consumption.
- Authorize the controlled desktop-off/transfer test after checkpointing user work.

## Actual acceptance

With home PC off and an identified compatible runner online: dispatch exactly one
bounded task, prove it actually executes there and produces branch/PR/test evidence.
Test desktop return, network loss, runner restart, duplicate dispatch and blocked
uncertain takeover; no split-brain or lost user edits. Demonstrate no node online
leaves queued/blocked. Report measured cost/usage, not assumed free capacity.
Rollback: pause admission, stop runner safely, preserve checkpoint/state/audit and
revoke only newly authorized runner credentials as separately directed. No PR4
code/deployment or live quota test is part of this document.
