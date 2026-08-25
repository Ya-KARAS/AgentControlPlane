# Maintenance scripts

The `package.json` commands are the stable interface for routine work. Direct
script execution is useful when a command needs additional arguments.

## Verification and local operation

| Command | Script | Purpose |
|---|---|---|
| `npm run verify` | test and check scripts | Run the full repository gate. |
| `npm run doctor` | `doctor.js` | Report executor discovery and readiness. |
| `npm start` | `src/server.js` | Start ACP on the configured loopback address. |
| direct | `start-server.ps1`, `stop-server.ps1` | Manage the Windows background service process. A provider API key is optional; paired remote devices use their stored relay credential. |
| direct | `install-autostart.ps1`, `uninstall-autostart.ps1` | Add or remove the per-user Windows Startup shortcut. |
| `npm run sandbox:setup` | `setup-windows-sandbox.js` | Start Codex Windows sandbox setup. |

## Browser bridge and userscript

| Command | Script | Purpose |
|---|---|---|
| `npm run userscript:build` | `build-userscript.js` | Build the tracked userscript from modular sources. |
| `npm run userscript:check` | `build-userscript.js --check` | Verify that the tracked userscript matches its sources. |
| `npm run companion:check` | `check-browser-companion.js` | Validate browser companion scripts and manifest references. |
| `npm run harness:companion` | `serve-companion-harness.js` | Serve the local browser companion test harness. |

## Demo, smoke, and acceptance

| Command | Script | Purpose |
|---|---|---|
| `npm run demo` | `demo.js` | Run the documented local executor demo. |
| `npm run smoke` | `smoke.js` | Run the control-plane smoke flow. |
| `npm run smoke:companion` | `smoke-companion.js` | Run the browser companion smoke flow. |
| `npm run smoke:budget` | `smoke-budget.js` | Check budget accounting behavior. |
| `npm run accept:reroute` | `accept-reroute.js` | Verify an explicit cross-executor continuation. |
| direct | `create-demo-video.ps1` | Render the verified demo walkthrough. |

## Benchmark, release, and relay

| Command | Script | Purpose |
|---|---|---|
| `npm run benchmark:real` | `benchmark-real.js` | Run committed benchmark cases. |
| `npm run benchmark:report` | `benchmark-report.js` | Generate the benchmark report. |
| `npm run benchmark:recommend` | `benchmark-recommend.js` | Generate benchmark-based recommendations. |
| `npm run release:package` | `package-release.js` | Create deterministic release archives. |
| `npm run release:sha256` | `sha256-manifest.js` | Create release asset SHA256 values. |
| `npm run check:relay` | `check-relay.js` | Check a configured relay with local credentials. |
| `npm run key:fingerprint` | `key-fingerprint.js` | Print a key fingerprint prefix for operator comparison. |
| `npm run verify:audit` | `verify-audit.js` | Verify persisted audit evidence. |
