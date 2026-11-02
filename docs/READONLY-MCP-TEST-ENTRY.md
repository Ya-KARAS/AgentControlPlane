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

## Cross-platform subprocess teardown

The guarded CLI test waits for the child `close` event, not merely signal delivery.
After the test deliberately sends SIGTERM, POSIX must close normally with code0;
Windows must report the exact SIGTERM termination tuple. Windows does not run the
POSIX JavaScript signal handler for `child.kill('SIGTERM')`; this follows
[Node child-process semantics](https://nodejs.org/api/child_process.html#subprocesskillsignal).
No other exit code or signal is accepted. The test first proves the announced
port is occupied (EADDRINUSE negative control), then proves the same port can be
bound after close. A bounded close wait and teardown guard detect a stuck child;
`child.killed` alone is never treated as proof of exit. Windows execution remains
a CI result, not something reproduced by the Linux Cloud container.

## Memory-only diagnostic snapshot (not an MCP tool)

`GET http://127.0.0.1:PORT/diagnostics` reads fixed aggregate counters from this
isolated process only. It uses the same exact Host/Origin checks, loopback bind,
8 active-request and16 connection caps, and absolute HTTP lifecycle deadlines.
A diagnostic GET accepts no body (nonzero Content-Length or Transfer-Encoding is
rejected); queries and all other diagnostic routes are unsupported. There is no
reset/import/write endpoint or new MCP tool. Do not publish this endpoint through
an additional tunnel: the operator reads it directly on the permitted loopback.
It does not load production configuration, state, identity or credentials.

The fixed response contains:

- `requests_total`: completed-header HTTP requests reaching this handler, including
  health and diagnostics themselves and rejected requests.
- `statuses`: fixed200/202/400/403/404/405/406/413/415/429/500/503 buckets, `other`
  for another response status, and `closed` when a response did not finish.
- `rejections`: fixed host_origin/capacity/route/content_type/invalid_json/
  invalid_rpc/tool_call/body_size/diagnostic_body/deadline/handler reasons.
- `methods`: initialize/list/call/other/invalid categories. The first three mean
  parsed initialize/tools-list/tools-call requests, not successful operations.
  No caller-provided method/tool string becomes a label.
- `transport`: fixed connection_deadline and invalid_http event counts. These
  include socket events without a complete HTTP request and do not count as
  `requests_total`. Idle keepalive expiry can also increment connection_deadline.

All values saturate at `counter_limit=Number.MAX_SAFE_INTEGER`; object keys and
storage cardinality never grow with traffic. No headers or Host/Origin values,
IP addresses, query/path values, bodies, identifiers, keys, timestamps, user data
or arbitrary error text are retained. There is no request logging or disk
persistence. Process exit discards counters. Rejection/transport counts are not
mutually exclusive, so they must not be summed as a request total.

A snapshot increments requests_total for its own GET before serializing; that
GET's status200 is counted only after its response finishes, so statuses normally
lag the snapshot by that response. Health probes, SDK notifications and unrelated
local probes also affect counts. Compare fixed MCP method and rejection deltas,
not raw total alone. Standard JSON-RPC correlation IDs are still returned by the
protocol; this is not a universal redaction layer for secrets supplied as valid
IDs or deliberate fixture content. Never put secrets in those fields. Tests use
sensitive markers in rejected headers/query/unknown argument fields and prove
those markers absent from health/diagnostics/fixed errors/CLI stdout and stderr.

## Interpreting the ordinary Chat setup failure

The reported official tunnel-client0.0.19 test had successful local entry health,
client healthz and readyz, but two ordinary Chat custom-MCP creation attempts near
22:08/22:10UTC showed a generic rate-limit/client-connection message. No tool
discovery or installed plugin was confirmed. The authorized20-minute test ended
22:25:19; all test PIDs/ports were cleared. This code change did not read its key,
restart that test, install locally or attempt another account operation.

[Official Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
describes client health/readiness and limits; those checks do not establish that
ChatGPT discovery reached this MCP server. No Host/Origin rewrite guarantee has
been established here. The endpoint still requires the same exact loopback Host
and optional loopback Origin; diagnostics must not be used to auto-allow arbitrary
forwarded headers. The current entry has no explicit429 response path; a generic
ChatGPT message alone cannot distinguish upstream rate limiting from local403,
503, malformed requests or a request that never reached this handler. These
counters add evidence, not a fix for an unverified upstream limit.

### Next minimal bounded test — requires fresh user confirmation

1. Obtain approval for a new short readonly test window, specified machine/port,
   existing permitted Personal Tunnels Read/Use scope and one custom-MCP attempt.
   The expired window is not reusable authorization. Do not expose/print the key,
   create permissions/accounts or repeatedly submit after another rate-limit error.
2. Start only this synthetic isolated entry on the explicitly permitted temporary
   loopback port. Do not start normal ACP. Verify health and read diagnostics on
   loopback; record only the aggregate snapshot after those baseline probes.
3. If separately authorized, run the existing official client normally and verify
   its local readiness. From the ordinary personal Chat account make one controlled
   discovery attempt; do not dispatch, approve, merge or request engineering work.
4. Read the loopback aggregate snapshot again, then stop all test processes and
   prove process/port cleanup. No raw HTTP logging/support dump is needed.
5. Interpret: initialize/list deltas show parsed protocol progress. host_origin403
   means this entry rejected a request, but identifies no caller. capacity503 means
   local saturation. invalid/body/deadline/transport deltas indicate their fixed
   local condition. No parsed-MCP delta does NOT prove no socket arrived: check
   rejections/transport too. Zero relevant deltas only locates the uncertainty
   upstream of those observations; it cannot attribute a provider rate limit.

If no MCP traffic is observed despite readiness, report the snapshots and exact
user-visible error/time to the official platform support channel without secrets;
do not broaden Host/Origin, disable bounds, change keys or loop retries. Real
ordinary Chat connectivity and two-way document handoff remain unpassed until
that actual authorized test succeeds.

## Standard tools/call request metadata

The original strict params guard allowed only `name` and `arguments`. At that
revision, even `{name:"read_capabilities",arguments:{},_meta:{progressToken:1}}`
was rejected locally with JSON-RPC -32602. This is an offline-reproduced protocol
compatibility defect, not proof of the actual request shape from the recent
ChatGPT call (no live body or headers were captured). The later aggregate
diagnostics confirmed three calls reached the local tool-call rejection guard,
with no new Host/Origin, capacity or transport rejections. These counters identify
the rejecting boundary, without identifying the rejected parameter or attributing
each request to a particular visible operation.

The [MCP request schema](https://modelcontextprotocol.io/specification/2025-06-18/schema)
allows request `_meta`, including optional progressToken. The installed SDK can
add it when a client requests progress. The receiver may ignore progress for
these immediate read tools, as specified by the
[progress contract](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress).
The entry now accepts bounded object `_meta` only as protocol-envelope metadata:
at most 8 KiB JSON, 128 values, 8 nested levels, 256-character keys; progressToken is
a string up to 256 characters or a safe integer. Metadata is discarded before SDK
dispatch, never passed as tool arguments, echoed, persisted, used as authority or
added as diagnostic labels. Oversized/malformed metadata gets the same fixed error.

Only the two existing names and absent/empty-object arguments remain valid.
Unknown tools, extra argument keys, null/array arguments and extra top-level tool
params remain rejected. Host/Origin, body, deadline and capacity checks do not
change. No progress notifications or third tool are added.

Offline tests include a real SDK Client calling over Streamable HTTP with an
onprogress callback, both read tools with metadata, malformed/oversized metadata,
and write/argument bypass attempts. This does not claim the installed ordinary
Chat integration is fixed. Existing local/tunnel processes are not restarted by
this change; any live validation is coordinated separately under its active
approval window, with no raw request capture or key access.
