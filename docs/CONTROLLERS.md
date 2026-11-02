# Controller ownership: PR1 contract

This optional feature is single-user and single-process. The design source is
[PR0 #20](https://github.com/Ya-KARAS/AgentControlPlane/pull/20); PR1 is independently
based on main and does not duplicate the design import.

## Configuration and identity

Defaults in `config/default.json`:

```json
{
  "controllers": {
    "enabled": false,
    "mode": "single",
    "leaseTtlSeconds": 120,
    "agents": []
  }
}
```

The flag must be boolean; mode must be `single`, `cooperative` or `failover`;
TTL must be an integer from 30 to 600 seconds. Local overrides still use the
existing config merge. Invalid registry or policy fails config validation even
when disabled. No dependency, subscription credential or model call is added.

Agent configuration has `id` (1–64 ASCII letters/digits/dot/underscore/hyphen,
starting with a letter/digit), optional `kind` (`mcp` default, `api`, `browser`),
`display_name` (1–80 characters), and optional private `principal_id` (1–200
characters). Display/principal strings cannot have surrounding whitespace or
control characters. There are at most 128 entries; IDs and principal bindings
are unique. `local-operator` is reserved. Entries without principal bindings are
public registration only. Arbitrary extra fields are not included in public
registry descriptors; do not use this registry to store credentials.

`normalizeAgentRegistry` returns frozen public descriptors. The binding map stays
private to the registry instance. `resolveControllerActor` accepts a principal
from a verified transport or trusted operator integration, never request content;
unknown/absent principals resolve untrusted. An actor's provenance is checked in
process; copying a trusted-looking object does not authenticate it.

Current ACP transport handlers have no verified per-agent principal. Enabling
this feature therefore attributes new dispatch/continue/handoff tasks only to
`local-operator`. A shared bearer authorizes the existing operator surface, not
a particular personal agent. Registry entries do not grant network mutation
privileges. No mutating takeover MCP tool or HTTP route exists, and there is no
automatic renewal/heartbeat or takeover scheduler. Do not infer working personal
agent failover from the registry/status view alone.

## Store and fencing

The existing `TaskStore` remains the sole task store. Legacy records normalize
optional `controller` and `control_lease` fields to `null` without rewriting audit
history. The executor checkpoint lease is distinct from the controller lease.

Trusted in-process integrations use `updateControlLease(taskId, options)` with
`actor`, `action` (`claim`, `renew`, `release`), expected `generation`, and optional
`ttlMs` (30,000–600,000; default 120,000). The store supplies `Date.now()`; no
request-supplied clock is accepted. First claim expects generation 0 and creates
1. A repeated live-owner claim is idempotent and does not extend expiration.
Renew/release require the current owner, generation and an unexpired lease.

At the exact expiration instant the lease is expired. Claims after expiration
or release increment generation; release retains a tombstone with `owner: null`
and the last generation, even across restart. Stale claims, renewals, releases
and controller-context amendments cannot change a newer generation. Another
actor's takeover after expiry is allowed only in `failover` mode; `single` and
`cooperative` retain the selected owner until explicit release. Cooperative
proposal/review coordination is outside this storage primitive. No second queue
or simultaneous writer is introduced.

Each transition compares and persists synchronously without an async yield,
using the existing writer lock/state-hash drift detection. A stale store instance
cannot overwrite a newer persisted owner. A persistence/audit failure quarantines
the writer; it is an operational recovery case, not permission to start another
process or delete a lock. State and audit use existing separate persistence
primitives, not a distributed transaction; a crash between them needs operator
inspection. Do not share `state.json` between computers or steal a crashed
writer's lock automatically.

Generic `updateTask` cannot change controller/lease fields. For compatibility it
accepts unchanged fields from a full-record patch but never assigns them. Its
optional third argument `{ actor, generation }` fences controller-authored
amendments against live ownership. This is a trusted in-process API: executor and
other internal calls without that context keep their existing privileges and are
not retroactively authenticated as separate personal agents. Transports must not
forward arbitrary request objects as controller contexts.

Transitions append safe `task.control_lease` events to the existing audit chain
(task ID, action, owner, generation; no private principal or request text). They
do not start an executor, change task status/lineage, reroute or enqueue a turn.
Existing user cancellation remains available.

## Read view, tests and rollback

[Protocol](PROTOCOL.md#optional-controller-ownership-pr1) specifies the bounded
read-only `list_controllers` tool and its safe anonymous-loopback view. Task owner
status uses server time and reports expired leases truthfully without renewal.
No dashboard change is needed for this PR.

Test-first coverage is in `controllers-config.test.js`,
`controller-registry.test.js`, `controller-lease.test.js`,
`controller-task-ownership.test.js` and `controllers-mcp.test.js` under `tests/`.
It includes defaults/invalid config, forged metadata, duplicate bindings, expiry,
stale owner/generation, released-generation ABA, restart, concurrent contenders,
idempotency/conflicts, legacy full-record writes, unchanged running-executor
invocation count and read-only MCP output. Run `npm run verify`; no live model
calls are part of these tests.

To stop new controller attribution, set `controllers.enabled` to `false` and
restart the single service after preserving active work. Existing records remain
readable and their ownership evidence is retained. To roll back code, stop the
service safely, preserve state/audit evidence and revert the PR commits through a
reviewed feature branch; no destructive Git cleanup or schema rewrite is needed.
There is no new mandatory database or migration. An older binary will not enforce
these new controller fences; do not continue controller ownership operations on
it. PR2 subscriptions, PR3 delivery automation and cloud/distributed failover
remain deferred. Successful tests never authorize a main merge.
