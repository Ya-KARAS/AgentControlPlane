# AgentControlPlane Web Bridge userscript preview

This desktop preview keeps routine ACP operation inside the native web AI
conversation. On ChatGPT or DeepSeek, write:

```text
@AgentControlPlane describe the engineering work
```

The web AI discusses the request, asks for missing details, and prepares a
structured task. The bridge stages that task. Reply with `执行` when the task is
ready. In the same conversation, the user can select a workspace alias or an
explicit path, executor, profile, advertised model, and reasoning effort. Any
omitted choice comes from the local settings page.

The floating ACP pill reports local state and opens settings. It does not
contain a second task form.

Version 0.5.1 keeps an unexpired staged task through a page refresh. If a new
task changes the objective, workspace, executor, profile, model, or reasoning
effort before dispatch, the pill lists the changed fields and asks for
`确认变更` before it accepts `执行`.

## Supported sites

- `https://chatgpt.com/*`
- `https://chat.deepseek.com/*`

## Install and configure

1. Install a userscript manager such as Tampermonkey in a desktop browser.
2. Open `agent-control-plane-web-bridge.user.js` from this directory.
3. Use the userscript manager's install or update action.
4. Start AgentControlPlane on `127.0.0.1:4318`.
5. Open a supported web AI page and select the floating **ACP** pill.
6. Save a default workspace, executor, and profile on the local settings page.
7. Enable automatic dispatch if `执行` should use those saved choices without
   opening another local review page.
8. Enable safe result return if the terminal task status should be sent back to
   the same web AI conversation.

## Conversation flow

1. A user sends `@AgentControlPlane` followed by a request.
2. The bridge expands that message into a controller instruction for the web AI.
3. The web AI asks questions until it can produce one `<ACP_TASK>` envelope.
4. The bridge stages the envelope. AI-generated text or DOM changes cannot
   dispatch it.
5. A user presses Send with a short confirmation such as `执行`.
6. ACP validates the requested execution choices against local workspace roots
   and live executor capabilities. Omitted choices use locally saved defaults.
7. If safe result return is enabled, the bridge sends an `<ACP_RESULT>` block
   to the same conversation after the task reaches a terminal state.

The result block contains task status, file and blocker counts, test-command
counts, parsed test-case counts when available, a safe failure category, and
non-secret executor, profile, model, and reasoning ids. It does not send local
paths, raw logs, credentials, or raw errors to the webpage.

## Local safety boundary

- ACP listens on loopback; the userscript does not expose it on a public URL.
- The bridge gives the web AI workspace aliases and the ids of ready executors,
  profiles, advertised models, and reasoning efforts. It does not provide full
  local paths or credentials.
- The webpage may request those execution choices in a bounded nested object.
  ACP treats the request as untrusted and validates it locally. A full path is
  accepted only when the user supplied it and it is inside a configured root.
- Dispatch requires a fresh user Send action containing a recognized short
  confirmation. Reading an AI reply or observing a DOM change is insufficient.
- The origin-bound status capability expires and stays in userscript memory.
- Refresh recovery stores only the bounded staged envelope and change state in
  extension-isolated userscript storage. The entry expires after ten minutes.
- A stable, non-secret idempotency key prevents a refresh or retry from creating
  a second engineering task for the same staged envelope.
- Automatic dispatch and result return are separate, default-off local settings.

## Add a web AI adapter

Each supported site is a data module in `src/adapters/`. It declares HTTPS
origins and selectors for the composer, Send control, assistant messages, and
user messages. The shared registry validates the data. After adding an adapter,
run:

```powershell
npm.cmd run userscript:build
npm.cmd run userscript:check
```

The generated installable file is
`agent-control-plane-web-bridge.user.js`. It has no runtime dependency on the
source modules.

## Disable or uninstall

Open the userscript manager, find `AgentControlPlane Web Bridge Preview`, then
disable or remove it. Execution choices remain in ACP's local state directory.
Only an unexpired staged envelope can remain in extension-isolated userscript
storage for refresh recovery.

## Current boundary

This release covers desktop ChatGPT and DeepSeek pages connected to a local ACP
instance. Device pairing, mobile relay support, remote access, and automatic
adaptation to unknown web AI layouts remain separate roadmap work.
