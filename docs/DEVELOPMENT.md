# Development

This document describes how to develop AgentControlPlane with any supported
executor (Codex, Claude Code, Kimi Code, ZCode, OpenCode, an OpenAI-compatible model
endpoint, or a future executor). It defines the shared development flow, the
handoff contract, the verification gate, executor-switch procedures, and
working-tree safety rules.

## Repository orientation

- `src/server.js` — the HTTP/MCP entry point; `src/mcp/server.js` registers
  the MCP tools.
- `src/core/` — task lifecycle, persistence, usage, policy, protocol, and
  orchestration. This layer stays executor-neutral.
- `src/executors/` — executor adapters (`CodexExecutor`,
  `OpenCodeExecutor`, `ClaudeCodeExecutor`, `KimiCodeExecutor`, `ZCodeExecutor`,
  `OpenAICompatibleExecutor`) and
  the lifecycle contract in `src/executors/lifecycle.js`.
- `contracts/` — shared wire schemas (for example the usage/reconciliation
  contract).
- `config/` — defaults (`default.json`) and machine-specific overrides
  (`local.json`, gitignored).
- `tests/` — node:test suites, one file per module.
- `docs/` — architecture, protocol, provider, and onboarding documents.

## Commands

Every executor uses the same commands:

| Command | Purpose |
|---|---|
| `npm ci` | install from the lockfile (CI and first clone) |
| `npm test` | run the full node:test suite |
| `npm run check` | syntax check plus browser-companion consistency check |
| `npm run verify` | `npm test && npm run check` — the single pre-handoff gate |
| `npm run doctor` | list discovered executors and the automatic default |
| `npm run check:relay` | run the live relay connectivity check; requires relay keys in the environment |
| `npm run accept:reroute -- --to opencode --model <model>` | inject an isolated infrastructure failure and verify a real executor continuation |
| `npm start` | run the local service on 127.0.0.1:4318 |

`npm run verify` mirrors the CI pipeline (`npm ci`, `npm test`,
`npm run check`). The grounded-copy lint (`copy_lint.py` from the
operator's skills directory) is an additional operator/docs gate; it is
not part of `verify`.

The reroute acceptance command creates its workspace and state under the
system temporary directory, injects one allowed failure, and verifies the task
id, logical id, executor path, reroute reason, terminal status, and exact marker
content. It removes the temporary directory at the end. Add `--keep` to retain
the evidence directory for inspection.

## Development handoff contract

At the end of every development round, output a handoff in the exact format
below. The handoff is the durable record the next executor reads; store
decisions in the repository, where the next executor finds them.

```text
DEVELOPMENT HANDOFF

Task:
<this round's goal>

Status:
completed / partial / blocked

Changed files:
- ...

What was implemented:
- ...

What remains:
- ...

Tests run:
- command
- result

Build:
PASS/FAIL

Known issues:
- ...

Decisions made:
- ...

Do not change:
- ...

Recommended next action:
- ...

Git:
branch:
commit:
working tree:

Blockers:
- ...
```

## Continuity across executor switches

The runtime supports native cross-executor continuation. Every lineage has a
stable `logical_task_id`, an append-only `executor_history`, and an optional
structured continuation package. Automatic reroute remains disabled by
default. `continue_project` without `executor` preserves the original
executor/session; an explicit `executor` is capability-gated and starts a new
session in the same logical lineage.

Repository-level handoffs remain required when the development executor itself
changes outside ACP. In either path:

- preserve original task references
- preserve `parentTaskId` / continuation relationships where applicable
- preserve evidence / attempts / decisions / working-tree state
- record the executor handoff when a development round stops
- do not treat an executor switch as an unrelated fresh development task

## Executor switching procedure

1. Detect that the current executor is unavailable (quota, rate limit,
   auth failure, outage, model, or local environment issue).
2. Persist the DEVELOPMENT HANDOFF for the current state.
3. Run `git status` and `git diff`; keep uncommitted work in place.
4. Select the next executor that is available and capable of the task
   (filesystem, shell, git, network, tests, long-running process, tool
   calling, context capacity).
5. Feed the same task contract plus the handoff to the new executor.
6. Inspect the existing diff before implementing; do not re-implement
   work that already exists.
7. Run the relevant tests and `npm run verify` before another handoff.

## Working-tree safety

Run `git reset --hard`, `git checkout .`, or `git clean -fd` only with
explicit user authorization.

Before taking over existing work, run:

```text
git status
git diff
```

Do not modify or remove uncommitted changes that belong to the user or to
another executor when those changes are not part of the current task. An
uncommitted `config/default.json` change, for example, is user-owned and
stays untouched.

## Where decisions must live

Any decision that affects later development — protocol contract, security
invariant, storage schema, executor interface, backward compatibility,
provider-neutral requirement, API contract, safety rule — belongs in at
least one durable place: code, tests, docs, or the architecture/roadmap
documents in this repository. A decision that exists only in a chat log
blocks a clean handoff.
