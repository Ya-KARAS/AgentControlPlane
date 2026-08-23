# AgentControlPlane Web Bridge userscript preview

This desktop-only preview adds an ACP button to supported web AI pages. A user
can manually enter a task candidate and open the local AgentControlPlane review
page. The userscript cannot dispatch a task: the local review page requires a
fresh confirmation and locally selected workspace, executor, and profile.

The script does not read a conversation, use a relay, store credentials, select
local execution options, or run engineering commands.

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
6. Enter a task candidate, open the local review page, inspect the local
   choices, and confirm there if the request is correct.

## Disable or uninstall

Open the userscript manager, find `AgentControlPlane Web Bridge Preview`, then
disable or remove it. The script has no persistent settings or account data.

## Current boundary

The userscript connects only to the local candidate-review endpoint on
`127.0.0.1`. It sends only the objective and constraints manually entered in
its own panel. It has no task API credential and cannot select a workspace,
executor, profile, or model.

Device pairing, mobile relay support, remote access, automatic dispatch, and
webpage-content extraction remain out of scope.
