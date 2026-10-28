# Architecture

> [中文文档](ARCHITECTURE.zh-CN.md)

## Product boundary

AgentControlPlane separates work into two layers:

1. **Control plane** — an MCP-capable web AI clarifies intent, compares
   approaches, sends a compact brief, and evaluates the result.
2. **Execution plane** — a selected local engineering agent edits code, runs
   tools, verifies results, and optionally delegates independent work.

This reduces repeated context and manual translation between conversations. It
does not bypass provider limits; the chosen executor still consumes its own
allowance or API usage.

## Data flow

```text
User
  -> web AI: broad request and discussion
  -> dispatch_project: compact EngineeringBrief
  -> Orchestrator: workspace, policy, and route validation
  -> TaskStore: queued task with resolved executor id
  -> executor adapter: thread/goal/turn lifecycle
  -> local engineering agent and optional subagents
  -> normalized result, evidence, events, and usage
  -> TaskStore + append-only audit log
  -> task_status: compact structured result
  -> web AI: accept, correct automatically, or request user input
```

## Two-sided adapter boundary

The northbound boundary is MCP. Any web AI that can invoke the published MCP
tools can act as the controller. Product-specific connection and permission
steps live outside the core task protocol.

The southbound boundary is the semantic lifecycle contract in
`src/executors/lifecycle.js`: model listing, readiness, persistent project
identity, goals, turns, cancellation, events, and usage.

Implementations currently include:

- `CodexExecutor` for Codex app-server RPC;
- `OpenCodeExecutor` for OpenCode's JSON event stream;
- `ClaudeCodeExecutor` for Claude Code's stream-json output;
- `OpenAICompatibleExecutor` for responses/chat endpoints and its bounded local
  `read_file`, `write_file`, and `shell` tool loop.

## Discovery and routing

At startup every adapter performs a read-only probe. CLI probes only resolve the
executable and do not launch it; local compatible endpoints expose `/models`;
remote compatible providers must have a configured credential. Discovery does
not send an engineering prompt or consume a model turn.

With `executor.provider: "auto"`, routing follows
`executor.routing.order`. Healthy entries are preferred over degraded entries.
The resolved id is persisted on the task, so continuation, cancellation, audit,
and reporting use the same executor. An explicit per-task `executor` overrides
automatic routing.

## Feedback loop and token efficiency

- `EngineeringBrief` includes only objective, constraints, acceptance criteria,
  known context, and requested evidence.
- A project identity is reused where the executor supports persistent sessions.
  Threads are stored per executor, so one executor never resumes another's id.
- `handoff_project` carries a compact continuation package to a terminal
  review on another executor. It does not replay the web conversation.
- Final output is normalized to compact summary, files, tests, blockers, next
  action, and usage.
- The web controller polls the task and can turn a structured blocker into a
  corrected `continue_project` call without the user copying text.
- Raw events stay local and are returned only when explicitly requested.

Usage precision depends on the executor. Codex exposes live goal usage; CLI
agents may report cumulative usage only when their process finishes.

## Profiles

| Profile | Use | Effort | Subagents | Default budget |
|---|---|---:|---:|---:|
| economy | Small, well-defined edits | low | 0 | 30k |
| balanced | Normal feature/fix work | high | up to 2 | 90k |
| deep | Architecture, broad refactors, hard debugging | ultra | up to 4 | 220k |

Profiles are policy defaults; a task may override model, effort, concurrency,
and budget within configured limits.

## Persistence and trust

Task state and project associations are stored outside workspaces. Audit entries
form an append-only integrity chain. The local HTTP service binds only to
loopback.

Codex has an explicit workspace-write sandbox path. CLI and compatible endpoint
adapters execute with the host user's privileges and are therefore restricted
to allowlisted, trusted workspaces. A hosted relay requires a separate
multi-tenant authentication and device-trust design; the local server must not
be exposed directly to the public Internet.
