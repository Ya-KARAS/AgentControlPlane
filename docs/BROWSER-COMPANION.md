# Browser companion

> [中文文档](BROWSER-COMPANION.zh-CN.md)

The AgentControlPlane browser companion connects a normal web AI conversation
to the local control plane when the web product does not provide a usable custom
MCP connection. It does not reuse, export, or bypass model quota. The web AI
plans the task; the selected local executor performs the engineering work with
its own account or provider configuration.

## Supported pages

- ChatGPT (`chatgpt.com`)
- DeepSeek (`chat.deepseek.com`)
- Claude (`claude.ai`)
- Other HTTPS chat pages after an explicit optional site permission

The generic adapter uses accessibility and composer heuristics. A web page can
change its DOM at any time, so the built-in adapters are preferred and adapter
failures are reported in the page panel.

## Install for local testing

1. Start AgentControlPlane:

   ```powershell
   cd C:\Users\YOUR_USER\Documents\Github\AgentControlPlane
   npm.cmd start
   ```

2. Open `chrome://extensions` or `edge://extensions`.
3. Enable developer mode.
4. Choose **Load unpacked** and select the repository's
   `browser-companion` directory.
5. Open a supported web AI page and click the floating **ACP** button.
6. Click **Pair**, compare the six-digit code, and approve the local page.
7. Select a known workspace. Executor, task profile, model, and reasoning
   effort accept either Auto or a concrete value. The web AI recommends each
   automatic field, and ACP validates the recommendation against live local
   capabilities.

No API key or main control-plane bearer token is copied into the browser. A
paired extension receives a separate scoped credential that can access only
tasks created by that extension.

## Conversation protocol

Click **Teach web AI** to place the controller instructions in the current
composer. The web AI clarifies intent and emits one implementation-ready block:

```text
<ACP_TASK>
{
  "workspace": "DEFAULT",
  "objective": "Implement and verify the requested change",
  "context": "Only execution-relevant context",
  "constraints": ["Preserve compatibility"],
  "acceptance_criteria": ["Automated tests pass"],
  "profile": "balanced",
  "executor": "auto"
}
</ACP_TASK>
```

`DEFAULT` is resolved inside the extension and keeps the local filesystem path
out of the web conversation. Envelopes are always staged first: the companion
holds the envelope and prompts, and the task is dispatched only after the user
replies with a confirmation word (such as 执行 / 开始 / yes) or clicks the
panel Dispatch button. New envelopes replace the staged one while it waits.
The companion then monitors the task and inserts a compact terminal block:

```text
<ACP_RESULT>
{
  "task_id": "...",
  "status": "completed",
  "executor": "opencode",
  "executor_session_id": "ses_...",
  "result": { "summary": "...", "changed_files": [], "tests": [] },
  "error": null,
  "usage": { "total_tokens": 0 }
}
</ACP_RESULT>
```

`executor_session_id` is the executor's own session id (for example the
opencode `ses_...` id) and can be used to reopen the full conversation inside
the executor's interface.

Automatic result submission is disabled by default because task results may
contain local file names or code details. Enable it per browser profile only
when the selected web AI conversation is trusted to receive those results.

## Pairing and security model

- Pairing creation and approval are accepted only over loopback.
- A request expires after 10 minutes by default.
- The approval page shows both the code and exact extension origin.
- The client token is returned once and stored by browser extension storage.
- AgentControlPlane stores only a SHA-256 hash of the client token.
- The token is bound to the exact extension origin.
- A paired client can read, follow up, or cancel only tasks it created.
- Known AI origins are granted in the manifest; every other HTTPS site requires
  a separate optional permission.
- The extension does not read cookies, browser history, passwords, or page
  storage.

Pairing state is stored in the configured AgentControlPlane state directory as
`companion-clients.json`. Removing that file while the service is stopped
revokes all browser companion sessions.

## Validation

Run:

```powershell
npm.cmd test
npm.cmd run companion:check
```

The test suite validates origin restrictions, one-time token delivery, hashed
credential persistence, per-client task ownership, protocol parsing, adapter
selection, manifest permissions, and the scoped dispatch/status/follow-up flow.

## Web AI + Multi-executor end-to-end validation

After setup, validate true end-to-end integration from each supported web page:

1. Start AgentControlPlane in the test profile:

   ```powershell
   cd C:\Users\YOUR_USER\Documents\Github\AgentControlPlane
   npm.cmd start
   ```

2. On the target page, open the ACP panel and pair the browser once (one-time
   approval code).

3. In the web composer, set the execution target by asking the web AI to follow
   this schema exactly:

   - Use `executor: "auto"` for normal routing.
   - Use `executor: "opencode"` to force the local Opencode CLI.
   - Use `executor: "deepseek"` to force MCP deepseek route.
   - Use `executor: "claude"` to force Claude CLI route (if available in your
     local configuration).

4. Use a deterministic objective:

   ```text
   Please emit ACP task block for a tiny local change:
   {
     "workspace": "acp-live-test",
     "objective": "Create C:\\Users\\<user>\\Documents\\Github\\acp-live-test\\acp-hello.txt with exact text: ACP_WEB_AI_OK",
     "context": "local smoke task",
     "acceptance_criteria": ["file exists", "exact text is ACP_WEB_AI_OK"],
     "executor": "opencode"
   }
   ```

5. Verify from terminal:

   - task status returns `completed`
   - `changed_files` includes `acp-hello.txt`
   - file content is exactly `ACP_WEB_AI_OK`

### Acceptance per site

- ChatGPT (`chatgpt.com`): validates browser companion message capture and MCP
  fallback path together.
- DeepSeek (`chat.deepseek.com`): validates adapter button behavior and task
  block transport on a second website.
- Claude (`claude.ai`): validates cross-provider UI compatibility.

For a full multi-executor pass, repeat step 4 with each `executor` value above and
record one row per run in a short table:

- `executor`
- page used
- `task_id`
- `status`
- `changed_files`
- `result.summary`
- elapsed seconds
