# Offline cross-executor handoff acceptance

[中文](HANDOFF-ACCEPTANCE.zh-CN.md)

With Node.js 22+ and dependencies installed, run:

```text
npm run accept:handoff
npm run --silent accept:handoff -- --json
node --test tests/handoff-e2e.test.js
```

The command prints PASS/FAIL for each of eight scenarios and exits nonzero if
any fails. `--json` emits one report with overall `passed` and per-scenario
`id`, `name`, `passed`, and an `error` on failure. All scenarios run even when
one fails. `--help` lists options.

Coverage includes compact A-to-B checkpoint transfer (bounded summary and
positive exclusion of an actual conversation sentinel), default target-session
reuse versus `fresh_session`, return to A's original session, thread/session
and executor-history isolation, store/orchestrator reconstruction from the
same state directory followed by handoff/resume, and automatic reroute after
quota or runtime availability failures. Reroute checks preserve source
checkpoint files, test evidence, summary and next action. An explicitly selected
target already known unavailable is rejected before a task is created;
runtime infrastructure failures exercise automatic reroute to a fresh fallback
session. Cost estimates and recorded latency statistics are also checked for
reasonable read-only results without executor calls.

The [shared scenarios](../scripts/lib/handoff-acceptance.js) drive the real
orchestrator and store APIs using the same in-process recording executor as
the existing handoff tests. They do not exercise the HTTP/MCP transport or a
real executor adapter. No executor CLI, subprocess, network request, model
quota, key, `.env`, or local configuration is used. Each scenario creates and
cleans its own workspace/state under the OS temporary directory using portable
Node.js filesystem APIs; the mock executor sessions survive the simulated
control-plane restart.

The [test entry](../tests/handoff-e2e.test.js) runs these same scenarios in
`npm test`, including the existing Ubuntu/Windows CI matrix. Run
`npm run verify` for the full test and check gate.
