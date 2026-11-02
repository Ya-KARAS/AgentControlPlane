# Execution-node preflight (PR4a)

This is the first offline portion of ACP V1 design §7, not a working cloud runner
or execution transfer. Local executors and the existing task queue are unchanged.

## Configuration

The optional local operator configuration defaults to:

```json
{"executionNodes":{"enabled":false,"nodes":[]}}
```

An explicitly configured example (not an installed/verified node):

```json
{"executionNodes":{"enabled":true,"nodes":[
  {"id":"desktop","kind":"local","authorized":true,"executor_ids":["codex"]},
  {"id":"owned-cloud","kind":"cloud","authorized":false,"executor_ids":["claude"]}
]}}
```

At most 64 unique node IDs and 16 unique executor IDs per node; IDs are bounded
identifiers. Unknown properties, paths, URLs, tokens and commands are rejected.
`authorized` is the local operator's permission for planning, not an account
identity, approval to spend, or execution ownership. No node is inferred from the
Cloud environment running this development task. Omitted config stays disabled.

## Host cache boundary

`createApplication({executionNodeObserver})` optionally accepts a synchronous,
trusted in-process function returning already cached observations. It must not
perform network/probe/model operations. There is no configured provider, cache
collector, timer, persistent observation store or remote setter in this PR.
Async/throwing observers degrade to unknown. No observer is called when disabled.
No client input, prompt, CLI import or MCP call can provide host observations.

Each strict observation has `node_id`, ISO UTC `observed_at` and `valid_until`,
and boolean `online`, `runtime_ready`, `workspace_ready`, `authentication_ready`,
`persistent`. Freshness uses server time: observation is not in the future,
expiry is strictly after now, and lifetime is at most 60 seconds. Invalid,
duplicate, expired or absent entries are unknown; arbitrary raw fields are not
projected. No absolute paths, account details, errors, output or secrets belong
in this cache. Callbacks are host code with host privileges, not an untrusted
plugin sandbox or a source of human authentication.

## Read-only MCP

`execution_nodes({requested_node_id?,executor_id?})` returns bounded registered
public descriptors, fresh observation times, fixed availability/reason codes,
and `selected_node_id` or null. Unknown arguments are rejected with a fixed error
before SDK parsing; the normal application transport authentication remains.
No extra read tool is added to the separate PR25 two-tool test entry.

Default advice prefers eligible local candidates; explicitly requested nodes
never fall back. Unapproved/incompatible/offline/runtime/workspace/authentication
failures block candidates. A cloud node additionally needs observed persistence;
ephemeral CI/Codex Cloud development is not an assumed persistent runner.
`advisory_only:true` and `execution_authorized:false` always hold, even for an
available candidate. Availability describes these cached preconditions only;
it does not prove subscription availability, no active writer, recovery safety,
or that an executor has started. No budget/quota is inferred.

Dispatch does not consume this advice, store a node ID or switch nodes. There is
one existing TaskStore and logical queue; this PR adds no task or execution lock.
The PR1 controller lease must never be used as an execution-node fence.

## Remaining PR4 gates

1. Choose an actual existing user-owned persistent node, allowed workspaces and
   supported executor. Approve install/start/service account, private state and
   lifecycle there; no paid host or credentials are provisioned by this PR.
2. Separately authorize any missing supported login/repository permission/network
   configuration and the bounded live executor test. Do not copy desktop tokens.
3. Review and implement a transfer protocol before enabling execution: exact task
   lineage, branch/head, modified-file inventory, evidence and continuation;
   preserve uncommitted edits; explicit old-writer stop/release and durable new
   execution fencing. Uncertain crashes block takeover. No shared state.json or
   GitHub-comment lock, no independent second task queue.
4. Offline real-store/fake-executor tests for crash/restart/duplicate/late writes,
   then separately authorized actual desktop-off/return/network-loss test with
   no split-brain. Simulations never satisfy actual-runner acceptance.

Those deployment/authentication/live actions need specific user authorization;
the pure implementation and its review do not provide it. All source-controlled
handoffs use tested feature branches/PRs; main merges remain individually approved.

## Verification and rollback

`node --test tests/execution-nodes.test.js tests/execution-nodes-mcp.test.js`
exercises real normalization/config and MCP, with controlled host observations
and fake execution dependencies. No actual remote node, model or ordinary Chat
session is used. `npm run verify` is the handoff gate.

Disable `executionNodes.enabled` and stop supplying the optional host callback to
roll back the feature; no state migration or remote service exists. Revert the
feature commits through review when desired. Preserve all older branches and
active work; never reset or clean user work.
