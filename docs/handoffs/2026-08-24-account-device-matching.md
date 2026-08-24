DEVELOPMENT HANDOFF

Task:
Align the local ACP clients and userscript with AsterRoute account-based email device matching.

Status:
completed

Changed files:
- docs/REMOTE-DEVICE-RELAY.md
- docs/handoffs/2026-08-24-account-device-matching.md
- src/local-review/i18n.js
- tests/userscript.test.js
- userscript/README.md
- userscript/agent-control-plane-web-bridge.meta.js
- userscript/agent-control-plane-web-bridge.user.js
- userscript/releases/0.8.3/agent-control-plane-web-bridge.user.js
- userscript/src/i18n.js
- userscript/src/runtime.user.js

What was implemented:
- Documented the AsterRoute account email matching flow.
- Updated local and userscript prompts for one six-digit code shared by one browser and one executor.
- Documented ten-minute matching codes and the current thirty-day customer device term.
- Built userscript release 0.8.3 and updated its release tests.

What remains:
- Publish userscript 0.8.3 only when the repository push is authorized.
- Perform a real phone and computer claim with a newly received production email code.

Tests run:
- npm run verify
- 304 tests passed; generated userscript, links, and browser companion checks passed.

Build:
PASS

Known issues:
- config/default.json contains pre-existing user-owned changes and was not touched or staged.

Decisions made:
- Six-digit email matching codes remain compatible with the existing 6-16 character client input validation.
- Legacy eight-character portal pairing remains supported by the relay during migration.
- The browser and executor each claim the same code at most once.

Do not change:
- Do not expose email addresses, matching codes, local paths, or device credentials to web AI conversations.
- Do not modify config/default.json without explicit user scope.

Recommended next action:
- Publish the portal, request one production email code, and enter it once on the phone and once on the computer.

Git:
branch: feat/public-launch-readiness
commit: pending
working tree: task files modified; config/default.json remains user-owned and unstaged

Blockers:
- None for local validation.
