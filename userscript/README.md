# AgentControlPlane Web Bridge userscript preview

This desktop-only preview adds an ACP button to supported web AI pages. A user
can manually enter a task candidate and send it to the local AgentControlPlane.
By default, the local review page requires a fresh confirmation and locally
selected workspace, executor, and profile.

The script does not read a conversation, use a relay, store credentials, select
local execution options, or run engineering commands. A short-lived,
origin-bound status capability stays only in memory while the panel displays a
safe task-state summary. Raw summaries, paths, logs, and errors are not returned
to the webpage.

## Supported sites

- `https://chatgpt.com/*`
- `https://chat.deepseek.com/*`

## Install

1. Install a userscript manager such as Tampermonkey in a desktop browser.
2. Open `agent-control-plane-web-bridge.user.js` from this directory.
3. Use the userscript manager's install action.
4. Start AgentControlPlane on its default loopback address.
5. Open a supported site and look for the floating ACP button in the lower
   right corner.
6. Use **Dispatch settings** to select a default workspace, executor, and
   profile. Automatic dispatch is off by default.
7. Enter a task candidate. Confirm it on the local review page, or enable the
   local automatic-dispatch setting if you want manual userscript submissions
   to use the saved choices immediately.

## Add a web AI adapter

Each supported site is an independent data module in `src/adapters/`. The
shared registry validates adapter ids, HTTPS origins, and userscript match
patterns. Add one adapter file, then run:

```powershell
npm.cmd run userscript:build
npm.cmd run userscript:check
```

The generated installable script remains
`agent-control-plane-web-bridge.user.js`; it has no runtime dependency on
remote module files.

## Disable or uninstall

Open the userscript manager, find `AgentControlPlane Web Bridge Preview`, then
disable or remove it. The script has no persistent settings or account data.

## Current boundary

The userscript connects only to local review and status endpoints on
`127.0.0.1`. It sends only the objective and constraints manually entered in
its own panel. It has no task API credential. Workspace, executor, and profile
choices are saved and validated by ACP on the local machine.

Device pairing, mobile relay support, remote access, automatic dispatch, and
webpage-content extraction remain out of scope.
