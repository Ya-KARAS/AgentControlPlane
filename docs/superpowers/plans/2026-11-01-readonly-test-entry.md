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
