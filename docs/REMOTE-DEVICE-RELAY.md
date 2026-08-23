# Remote device relay

AgentControlPlane can pair with an HTTPS device portal so a web AI on a phone or another computer can stage work for a local executor.

Official portal: `https://acp.asterroute.com`

## Security boundary

- The local ACP process makes outbound HTTPS polling requests. It does not expose its loopback HTTP server to the internet.
- The portal receives project aliases, bounded task fields and safe result counters only.
- Absolute workspace paths are rejected by the portal. The local project library resolves the alias to the current path.
- Source code, command output, changed-file paths, API keys and executor credentials stay local.
- Browser and executor clients use separate scoped bearer tokens.
- Pairing codes are one-time values that expire after ten minutes.
- Remote task claiming is paused unless local automatic dispatch is enabled.

## Pair a computer

1. Open `https://acp.asterroute.com` and sign in.
2. Generate a computer pairing code.
3. Open the local ACP settings page.
4. Under Remote pairing, keep the official portal address, enter the code and choose Pair.
5. Confirm the status changes to ready.

The computer must remain powered on with AgentControlPlane running for engineering tasks to execute.

## Pair the userscript

1. Generate a browser pairing code in the portal.
2. Open the Tampermonkey menu on a supported web AI page.
3. Choose Connect remote ACP and enter the code.

The userscript always tries the local loopback bridge first. It falls back to the remote portal only when the local bridge is unreachable.

## Domain migration

`acp.asterroute.com` is the canonical address. The legacy `relayone-gateway.chaofanxu97.chatgpt.site` host is compatibility-only and should return a permanent redirect to the canonical host after deployment.
