DEVELOPMENT HANDOFF

Task:
Replace repeated mobile/desktop access-code handling with one-time device pairing, trusted-device management and automatically rotating access tokens while keeping legacy clients compatible.

Status:
completed locally; release not published

Changed files:
- src/remote-relay/credentials.js
- src/remote-relay/worker.js
- tests/remote-relay.test.js
- userscript/src/runtime.user.js
- userscript/agent-control-plane-web-bridge.user.js
- userscript/agent-control-plane-web-bridge.meta.js
- userscript/releases/0.8.2/agent-control-plane-web-bridge.user.js
- docs/REMOTE-DEVICE-RELAY.md
- docs/README.md
- C:/Users/45928/Documents/Github/AcpDevicePortal app, API, D1 schema, tests and smoke script

What was implemented:
- Added protocol version negotiation. New clients request credential version 2; old clients continue receiving version 1 static credentials.
- Added separate refresh credentials and five-minute signed access tokens for browser and executor devices.
- Added automatic access-token refresh to the ACP worker and userscript, including first-refresh migration for existing clients.
- Added portal user access-code management while retaining the production secret as a recovery code.
- Added trusted-device status, credential-version display and per-device revocation.
- Added same-origin session enforcement, no-store API responses, bounded access-code inputs and a D1-backed ten-attempt login limit.
- Preserved the privacy boundary: the portal receives project aliases and safe task/result fields, never local paths, source, logs or executor credentials.

What remains:
- Obtain explicit authorization before committing, pushing or deploying.
- Deploy the portal D1 schema and application before publishing userscript 0.8.2 or restarting updated ACP clients.
- Verify the production domain, legacy redirect and one real phone-to-local task after deployment.

Tests run:
- AgentControlPlane: npm run verify — PASS, 304/304 tests.
- AcpDevicePortal: npm run check — PASS, 8/8 tests and production build.
- AcpDevicePortal local smoke — PASS: login, access-code replacement and re-login, browser/executor v2 pairing, token refresh, capability upload, task claim, lease rejection, completion and status read.
- Login abuse check — PASS: ten invalid attempts returned 401 and the eleventh returned 429.

Build:
PASS

Known issues:
- AcpDevicePortal is a standalone source tree without a Git repository; production deployment must use its existing Sites project metadata.
- The portal and userscript release are not live until an authorized deployment/push occurs.

Decisions made:
- Pairing is one-time; routine use is silent and device-bound.
- Refresh credentials are long-lived, scoped and revocable; access tokens are signed and expire after five minutes.
- Refresh credentials are never accepted as task API bearer tokens.
- Legacy v1 stays available during rollout to avoid disconnecting installed clients.
- Production cookies are Secure by default; only an explicit ACP_COOKIE_SECURE=false local override permits HTTP development login.

Do not change:
- Do not touch the user-owned config/default.json changes.
- Do not expose local ACP ports or absolute workspace paths.
- Do not deploy the portal before its D1 schema and application are released together.
- Do not publish secrets, refresh credentials or access tokens.

Recommended next action:
- With explicit user authorization, commit and push the ACP changes, deploy AcpDevicePortal with the D1 migration, then verify acp.asterroute.com and pair one phone browser plus one local executor.

Git:
branch: feat/public-launch-readiness
commit: 4500d04 (pre-change HEAD)
working tree: implementation and docs uncommitted; config/default.json is pre-existing user-owned; AcpDevicePortal is a standalone non-Git tree.

Blockers:
- External push and production deployment require explicit authorization.
