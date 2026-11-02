# Credential-free conversation browser fixture

This is a manual browser test resource for the same candidate's actual serialized
conversation page code. It is **not production ACP**, an authentication system,
a runner, real task queue, MCP server or ordinary Chat connection. Its banner and
JSON responses explicitly say synthetic/fixture-only. No actual Agent responds.

## Launch and resources

Use the reviewed candidate checkout, Node.js >=22 and its existing lockfile
installation. No additional package, Playwright, token or account is needed:

```bash
node scripts/serve-conversation-fixture.js --port 18889
```

It prints only a synthetic-mode declaration and `http://127.0.0.1:18889`.
`--port 0` selects a free temporary port. Binding is fixed to IPv4 loopback; there
is no host, path, environment, credential, fixture-file or remote URL option.
Use an existing modern browser **on that same authorized test machine**, with its
supported sandbox working. Do not expose this unauthenticated fixture publicly or
create a tunnel. No local-user-machine fallback is implied by this command.

Necessary resources: this checkout/dependencies, one available loopback port,
one temporary Node process and an existing supported sandboxed browser. Current
CI has Node Ubuntu/Windows jobs only, no installed Playwright/browser test setup.
An official supported browser test environment must be coordinated separately;
this command does not fix Cloud's SUID sandbox configuration or justify disabling it.

## Manual interaction checklist

1. Open the printed loopback URL. Confirm the **SYNTHETIC UI FIXTURE** banner.
   Keep the token field **empty** and click connect. Never enter a real secret.
2. Select synthetic A/B scopes. Both have fixed foreground/background messages;
   the sample `<img ...>` text must display literally, never create an image/script.
3. Choose `@Synthetic Dot`: it must say unconnected. Send synthetic discussion;
   repeated clicks must not duplicate the frozen envelope. Refresh is read-only.
4. In A request stop and confirm. Its canned transport acknowledges the request,
   keeps status `running` and shows awaiting confirmation. This is a simulated UI
   state only: no executor exists and it proves no physical stop.
5. In B choose its completed synthetic task and enter a modification. Confirm
   continuation; only an in-memory synthetic queued child appears. It does not
   launch anything, write to TaskStore or exercise real runner fencing.
6. Switch scopes, browser back, refresh, reconnect and leave/return. No automatic
   write may occur; old private rows must not return after exit or supersede the
   selected scope. Drafts are memory-only and disappear on reload/exit.
7. Stop this fixture process with Ctrl+C. Confirm the loopback port is released.
   Restart resets all fixture data; there is no cleanup/migration of production state.

Record exact candidate SHA, browser/version/OS, sandbox mode, checklist results and
any screenshot using **only synthetic content**. The later coordinator receipt below records an actual synthetic browser run.
Node's DOM contract harness and HTTP checks remain different evidence; neither
that run nor this guide independently certifies browser sandbox configuration.

## Isolation and limits

The launcher imports only a pure fixture HTTP composition and the pure page; it
never imports production config, TaskStore, Orchestrator, executors, pairing or relay.
It reads no `.env`, local config, state, files requested in input, credentials or
vendor APIs. It creates no bearer or user identity. Any nonempty credential-like
Authorization is rejected with a fixed error; the actual page's empty `Bearer`
placeholder is not authentication and conveys no authority.

Fixed loopback Host/Origin checks, bounded JSON input16KiB, eight concurrent requests,
16 connections including unfinished headers, absolute five-second connection/request deadlines, fixed route/scope/target allowlists and max100 in-memory
message operations apply. Unknown routes including `/mcp`, `/v1/tasks`, `.env` and
production paths fail. No raw errors/body/headers are logged, no persistence or
remote request occurs. The only simulated actions are discussion, synthetic child
creation and stop acknowledgement; they never import/approve/merge/deploy/execute.

Automated tests cover the served real page/fixture declarations, host/origin/input/
credential rejection, memory-only deduplication, no production routes, guarded
startup with poisoned config plus negative import control, CLI exit shape on both
platforms and actual port reuse after shutdown. These do not certify a real browser.

## Coordinator browser receipt — 2026-11-02

Dot reports same-cloud-desktop Node24.22.1/platform CDP Chromium acceptance at
11:04–11:12UTC, runtime244ac31, ZIP SHA256
`4a1b88a5f5714c0cac4eab2b85df4bf7f3b8f38d073380e90afba15d05192157`;
605 file hashes verified. A/B isolation, unconnected labels, injection rendered
literally (img nodes0), double-click dedup, pending-stop display, one synthetic
continuation, no refresh/back/reconnect replay and memory-draft cleanup passed.
Ctrl+C and `ss` confirmed no18889 listener at11:12UTC. No sandbox setting changed;
internal configuration-page inspection was policy-denied without bypass, so no
independent sandbox-configuration proof is claimed. This is coordinator-reported
actual **synthetic UI** acceptance, not real auth/persistence/executor/production.
See [full receipt and remaining work](ACP-V1-ACCEPTANCE-GAPS.md).
