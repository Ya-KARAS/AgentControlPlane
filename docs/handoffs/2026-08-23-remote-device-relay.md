DEVELOPMENT HANDOFF

Task:
Add a simple, provider-neutral remote device relay so a web AI on desktop or mobile can stage ACP tasks for a local executor, with acp.asterroute.com as the canonical portal.

Status:
partial

Changed files:
- src/remote-relay/credentials.js
- src/remote-relay/worker.js
- src/server.js
- src/local-review/router.js
- src/local-review/page.js
- src/local-review/i18n.js
- userscript/src/runtime.user.js
- userscript/src/i18n.js
- userscript/agent-control-plane-web-bridge.user.js
- userscript/agent-control-plane-web-bridge.meta.js
- userscript/releases/0.8.0/agent-control-plane-web-bridge.user.js
- userscript/README.md
- docs/REMOTE-DEVICE-RELAY.md
- tests/remote-relay.test.js
- tests/project-library-page.test.js
- tests/userscript.test.js
- C:/Users/45928/Documents/Github/AcpDevicePortal (new standalone portal tree)
- C:/Users/45928/Documents/Github/asterroute-acp/acp-device-relay-contract.md

What was implemented:
- Added an outbound-only HTTPS relay worker with local encrypted-boundary credential storage, pairing, capability sync, task claim, lease renewal and safe-result upload.
- Added Chinese and English local settings for pairing and relay state.
- Added userscript v0.8.0 local-first behavior with remote fallback, browser pairing and remote task/result polling.
- Built a standalone Vinext/Cloudflare/D1 portal with self-use login, separate browser/executor tokens, one-time pairing codes, task queue, leases, device revocation and safe task summaries.
- Made acp.asterroute.com canonical and encoded a permanent redirect from relayone-gateway.chaofanxu97.chatgpt.site.
- Rejected absolute workspace paths and stripped source, logs, changed paths, credentials and narrative from cloud results.

What remains:
- Obtain explicit release authorization before replacing the existing hosted Sites app or binding production domains.
- Add the visible ACP navigation link to the production AsterRoute site during the approved release.
- Set ACP_PORTAL_SECRET as a production secret, deploy D1 migrations, bind acp.asterroute.com and attach the legacy redirect host.
- Restart the local ACP service after the code is committed/released and run a real phone-to-local executor acceptance task.

Tests run:
- AgentControlPlane: npm run verify
- Result: 300 tests passed, browser companion validated, documentation links passed.
- AcpDevicePortal: npm run check
- Result: TypeScript passed, 5 tests passed, Vinext production build passed.
- AcpDevicePortal: npm audit --omit=dev --json
- Result: 0 production vulnerabilities.
- AcpDevicePortal: local scripts/smoke.mjs against Vinext/Miniflare/D1
- Result: login 303, browser and executor paired, capability upload passed, task queued/claimed/completed, invalid lease rejected, 8/8 safe test-case summary returned.

Build:
PASS

Known issues:
- AcpDevicePortal remains a standalone uncommitted tree until the user explicitly approves replacing the legacy hosted Sites app.
- Vinext 0.0.50 has development-only audit findings through image-size; the production dependency audit is clean and no image input route is exposed.
- The portal is not yet deployed and neither production domain has been rebound.

Decisions made:
- Use polling rather than WebSockets.
- Keep AsterRoute model relay, ACP portal and local executor modules decoupled.
- Use acp.asterroute.com as the only canonical public ACP address.
- Keep the legacy chatgpt.site host as compatibility redirect only.
- Never send local absolute paths, source code, logs, changed-file paths or credentials through the portal.
- Require separate scoped browser and executor credentials and local opt-in automatic dispatch.

Do not change:
- Do not touch the user-owned config/default.json profile model changes.
- Do not expose the loopback ACP port publicly.
- Do not merge portal code into the hosted production Sites project or deploy/bind domains without explicit release authorization.
- Do not add provider-specific behavior to ACP core.

Recommended next action:
- Ask the user for explicit confirmation to replace the legacy site, then integrate the standalone portal into the approved Sites project, add the AsterRoute link, deploy, bind acp.asterroute.com, verify the legacy 308 redirect and run one end-to-end mobile task.

Git:
branch: feat/public-launch-readiness
commit: d79c7dc
working tree: ACP relay/userscript/docs/tests are uncommitted; config/default.json is pre-existing user-owned; AcpDevicePortal is a standalone uncommitted tree.

Blockers:
- Production replacement, domain binding, push and deployment require explicit user approval.
