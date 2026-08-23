# AgentControlPlane Web Bridge userscript preview

This desktop preview keeps routine ACP operation inside the native web AI
conversation. On ChatGPT or DeepSeek, write:

```text
@ACP describe the engineering work
```

The web AI discusses the request, asks for missing details, and prepares a
structured task. The bridge stages that task. Reply with `执行` in Chinese or
`Run` in English when the task is ready. In the same conversation, the user can select a workspace alias or an
explicit path, executor, profile, advertised model, and reasoning effort. Any
omitted choice comes from the local settings page.

The floating ACP pill reports local state and opens settings. It does not
contain a second task form.

Version 0.7.4 provides separate Chinese and English interfaces and keeps an
unexpired staged task through a page refresh. If a new
task changes the objective, workspace, executor, profile, model, or reasoning
effort before dispatch, the pill asks for `确认变更` before it accepts `执行`.
The pill uses a compact action label. Its hover text contains the changed
fields and complete execution route. A conversation-scoped planning barrier,
persisted revision, and browser-wide lock prevent another tab from dispatching
an older task after the route changes. After dispatch, a conversation-scoped
terminal fingerprint prevents the same task envelope from being staged again
when the result message changes the page DOM.

## Supported sites

- `https://chatgpt.com/*`
- `https://chat.deepseek.com/*`

## Install and configure

1. Install a userscript manager such as Tampermonkey in a desktop browser.
2. Open `agent-control-plane-web-bridge.user.js` from this directory.
3. Use the userscript manager's install or update action.
4. Start AgentControlPlane on `127.0.0.1:4318`.
5. Use the visible language selector beside the floating ACP status button to
   choose **Auto**, **中文**, or **English**. The Tampermonkey script menu keeps
   the same choices as a fallback. The script stores this choice in
   userscript-isolated storage.
6. Open a supported web AI page and select the floating **ACP** pill.
7. Save a workspace and choose Auto or a concrete default for executor, task
   profile, model, and reasoning effort on the local settings page.
8. Enable automatic dispatch if `执行` or `Run` should use those saved choices without
   opening another local review page.
9. Enable safe result return if the terminal task status should be sent back to
   the same web AI conversation.

## Updates

Tampermonkey checks the small
`agent-control-plane-web-bridge.meta.js` file and downloads the complete
`.user.js` only after it detects a newer version. Both URLs use the explicit
GitHub `refs/heads/main` path. Every full release has its own versioned path
under `userscript/releases/`, so a newly detected release cannot reuse an older
cached script body.

If an older installation still uses the legacy `/main/` update URL, install
0.7.4 once from the current `.user.js`; later releases use the new update
channel automatically. If update checks still fail, open the browser extension
details for Tampermonkey and confirm that Site access is set to **On all sites**.
Tampermonkey documents that restricted runtime host permissions can break
script updates and `GM_xmlhttpRequest`.

## Interface language

The floating ACP control and the Tampermonkey script menu provide three
persistent choices:

- **Follow browser** selects Chinese for a `zh` browser locale and English for
  other locales.
- **Chinese** applies Chinese status text and a Chinese planning controller.
- **English** applies English status text and an English planning controller.

Changing the language reloads the current web AI page. `<ACP_TASK>` and
`<ACP_RESULT>` field names remain stable across both languages.

The local dispatch-settings and project-library page has its own visible
Chinese/English selector. This preference stays in ACP's local settings and is
independent from the userscript preference.

## Conversation flow

1. A user sends `@ACP` followed by a request. `@acp` and
   `@AgentControlPlane` are accepted aliases.
2. The bridge expands that message into a controller instruction for the web AI.
3. The web AI asks questions until it can produce one `<ACP_TASK>` envelope.
4. The bridge stages the envelope. AI-generated text or DOM changes cannot
   dispatch it.
5. A user presses Send with a short confirmation such as `执行` or `Run`.
6. The web AI recommends concrete values for fields saved as Auto. ACP validates
   every requested execution choice against local workspace roots and live
   executor capabilities. Concrete saved values supply the defaults.
7. If safe result return is enabled, the bridge sends an `<ACP_RESULT>` block
   to the same conversation after the task reaches a terminal state.

The result block contains task status, a safe workspace alias, file and blocker counts, test-command
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
  extension-isolated userscript storage. A pending entry expires after ten
  minutes. A dispatched-task fingerprint and message ordinal remain for that
  conversation so page history cannot silently re-stage already consumed work.
- Confirmation and dispatch re-read the latest visible task and the persisted
  conversation revision. A stale tab fails closed and asks for a refresh.
- A browser-wide Web Lock serializes candidate creation across tabs for the
  same conversation.
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
An unexpired staged envelope or a dispatched-task fingerprint can remain in
extension-isolated userscript storage for refresh and replay protection.

## Current boundary

This release covers desktop ChatGPT and DeepSeek pages connected to a local ACP
instance. Device pairing, mobile relay support, remote access, and automatic
adaptation to unknown web AI layouts remain separate roadmap work.
