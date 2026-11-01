# Isolated read-only MCP test entry

Use executing-plans and test-driven-development. Independent main branch; no PR24
validator copy or dependency. The fixture is synthetic, not a handoff importer.

1. Write failing real HTTP/MCP tests for initialize/list/call, truthful limited
   health, absent write tools and rejected direct write calls. Add invalid/body
   size, loopback host/origin, strict fixture and no-file-access cases.
2. Implement a separate explicit entry using existing MCP SDK stateless transport,
   HTTP and Zod only. Do not import the production application/config/state/store,
   executors, pairing or relay. No discovery, workers, polling or external network.
   Default127.0.0.1:4328; tests use ephemeral ports. Two tools expose fixture and
   bounded mode capabilities. No network mutation or arbitrary file tool.
3. Test CLI under poisoned production environment with filesystem/process guards;
   production npm start remains unchanged. No new dependency.
4. Document exact usage, no live ordinary Chat claim, safe shutdown and rollback;
   run npm run verify, commit and submit immutable head for independent review.

Bounds: fixture body16KiB, summary512chars, request32KiB, maximum8 concurrent
requests, HTTP request timeout5s. Stateless requests keep no session registry.
Reject non-loopback host/origin; no CORS. Capability and health describe only this
entry, not normal ACP readiness. Public tunneling/account configuration is out of
scope. No storage or fixture path is accepted through tools or CLI.


Review corrections: strict prevalidation of params plus empty arguments prevents
SDK error reflection. HTTP connection/request lifecycle deadlines (not ACP
background timers) explicitly destroy stalled sockets and free capacity, instead
of relying on Node's delayed timeout sweep. Connection count is also bounded16.
Both defects reproduced as RED before the minimal corrections; no scope expansion.

## Follow-up: fixed, memory-only diagnostics

- [ ] RED tests: GET /diagnostics, fixed HTTP/reason/method categories, rejection
  visibility, forbidden marker absence, unknown-path cardinality, slow-request
  expiry/capacity and no extra MCP tools. No tunnel/account activity.
- [ ] Add saturating counters in the isolated composition root only; no request
  values, persistent writes, reset route or new MCP tools. Diagnostic GET uses
  unchanged loopback/Host/Origin/concurrency/deadline constraints.
- [ ] GREEN targeted tests and full verify; independent review before push.
- [ ] Document snapshot self-counting, interpretation limits, official-client
  compatibility, and a newly authorized short window for any future live test.
