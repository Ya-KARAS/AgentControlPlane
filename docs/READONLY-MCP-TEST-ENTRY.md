# Isolated read-only MCP test entry / 隔离只读测试入口

This independent main-based entry is a narrow protocol test for the ordinary Chat
feasibility work. It is not a health-only flag on normal ACP. The existing
`src/server.js` startup loads configuration/state and constructs execution,
pairing and relay components; `startCodex:false` does not isolate all of these.
The new entry therefore reuses the installed MCP SDK directly and never imports
that production composition root. `npm start` and production defaults are unchanged.

## Run and stop

```sh
npm run readonly:test-entry -- --port 4328
```

The default is `127.0.0.1:4328`, deliberately separate from production4318. Choose
an available temporary port explicitly; tests use `--port 0` and read the assigned
address from stdout. Port conflicts fail; no existing process is stopped. Only
`--port` is accepted. Production environment overrides are ignored: no
`AGENT_CONTROL_CONFIG`, `config/local.json`, `.env`, existing state directory,
paired-client or remote credential is read. No directory is created and no
application state is persisted. Stop this entry with Ctrl-C/SIGINT or SIGTERM.

GET `/health` is real server liveness for this entry only. It explicitly returns
`mode:read-only`, `executors_started:false`, `ordinary_chat_connected:false`,
`production_state_loaded:false` and a limited-liveness scope. This is not normal
ACP readiness, executor authentication/model availability or ordinary Chat
connectivity. A successful HTTP200 must not be reported as the entire project
working.

## Real MCP boundary

POST `/mcp` uses the installed `McpServer` and `StreamableHTTPServerTransport` in
stateless JSON-response mode. `initialize`, `tools/list` and `tools/call` are
exercised against the actual SDK over loopback HTTP. No fake MCP response server
or custom dispatch framework is used. Only two tools exist:

| Tool | Returned data |
|---|---|
| `get_requirements` | Built-in bounded synthetic fixture, clearly labeled synthetic |
| `read_capabilities` | This entry's fixed read-only limits, not discovered executors |

They accept empty argument objects. Tool-call params and arguments are strictly
validated before SDK invocation so validation errors cannot echo arbitrary keys
or values. Unknown fields and argument types are rejected generically; no file path,
production task ID or remote URL can be read. Dispatch, approve, merge, import
and file-writing tools are absent and direct calls are rejected. There is no
`/v1/tasks` write route, browser automation, queue recovery, executor construction,
model discovery, pairing, relay worker, outbound connection or polling timer.
The HTTP server/SDK have their own protocol connection lifecycle, not ACP's
background scheduler.

No credentials or account setup is required or performed. Binding is restricted
to literal127.0.0.1. Host must match the actual loopback port; an Origin, if
present, must match that same loopback origin. Cross-origin requests, null origins
and DNS-rebinding hostnames are refused. No CORS or public/tunnel listener is
provided. These checks are not user authentication: all local processes able to
connect can read the fixture. Never put private data into this test entry.

## Fixture and resource limits

The CLI serves synthetic text only; it accepts no fixture/file path. A trusted
in-process caller can pass `createReadOnlyTestEntry({fixture})` after reviewing
and redacting its text. The strict schema permits only `id`, `summary`, `body`:
id1–64 safe ASCII characters, summary1–512 characters and body1–16KiB UTF-8.
Host-supplied fixtures are labeled `host_supplied_fixture`; that label does not
authenticate their author or prove review. The entry never searches for, loads
or imports a handoff package. It does not duplicate or depend on PR24's offline
handoff validator; any later integration must declare that dependency separately.

Requests are capped32KiB, concurrent requests at8 and sockets at16; overflow is
refused. No session registry is retained between requests. Absolute connection
and active-request deadlines are5s, with1s keepalive. A stalled header/body/socket
is destroyed when its deadline fires, aborting pending reads and releasing
request capacity once. This does not rely on Node's slower timeout sweep. Each
active connection/request has only its own cleared-on-close deadline timer;
there is no idle polling registry, model/relay timer or scheduled ACP work.
Trusted in-process tests may shorten `deadlineMs` to50–5000ms; neither CLI nor
remote input can change it. Even successful keepalive sockets close by the
absolute connection deadline; clients reconnect for later stateless requests.
Responses contain only fixed capability fields or the bounded fixture (MCP text
and structured representations both remain bounded). Parser/unknown-tool errors
are generic and do not reflect arbitrary submitted payloads. This is a controlled
single-user loopback test, not a public multi-tenant service.

## What was actually verified

`tests/readonly-entry.test.js` exercises real initialize/list/call and health,
write-tool absence/direct rejection, schema and binding errors, oversized and
malformed requests, and concurrent request limits. A guarded child CLI runs with
poisoned production config/state environment variables. The guard blocks
production module imports, protected file access, process creation, runtime file
writes, outbound fetch and polling. Negative controls establish that forbidden
config reads/imports/process creation really trip those guards. The isolated
entry still starts and completes real MCP requests with no production access or
state writes. Existing production tests remain part of `npm run verify`.

These are Cloud offline protocol tests. No browser sandbox bypass, account login,
ordinary Chat tool connection, tunnel, model call, Cookie/token extraction or live
GitHub request is involved. No ordinary Chat round-trip has passed. PR24's
workflow and capability matrix remain separate documentation; private Agent
triggering ordinary Chat or receiving its output automatically is still unverified.

## Next exact acceptance action and rollback

After the user separately confirms an existing permitted ordinary Chat connection,
its client may read only these two fixture tools; verify exact tool discovery and
synthetic text before any engineering dispatch is considered. Account/plugin
availability and transport must be checked then; this entry neither installs a
plugin nor creates a tunnel or permission. Until that gate passes, use the
already documented manual fallback without claiming automatic connectivity.

Rollback: stop this test process, then revert its independent feature commits
through review. It has no persisted application state, schema migration or
credentials to clean up. Do not stop or modify normal ACP, discard user work or
merge main as part of this test. Existing branches and draft PRs remain intact.
