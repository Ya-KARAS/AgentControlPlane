# Remote device relay

AgentControlPlane can pair with an HTTPS device portal so a web AI on a phone or another computer can stage work for a local executor.

Official portal: `https://acp.asterroute.com`

## Security boundary

- The local ACP process makes outbound HTTPS polling requests. It does not expose its loopback HTTP server to the internet.
- The portal receives project aliases, bounded task fields and safe result counters only.
- Absolute workspace paths are rejected by the portal. The local project library resolves the alias to the current path.
- Source code, command output, changed-file paths, API keys and executor credentials stay local.
- Browser and executor clients use separate scoped credentials.
- Pairing codes are one-time values that expire after ten minutes.
- New pairings receive a revocable refresh credential and a signed access token
  that expires after five minutes. Clients refresh automatically before expiry.
- The portal stores only refresh-credential hashes. Refresh credentials are not
  accepted by task or capability endpoints.
- Existing static-token clients remain compatible and upgrade on their next
  refresh after both the portal and client are updated.
- Portal login attempts are limited to ten failures per ten-minute window and
  state-changing portal actions require a same-origin authenticated session.
- Remote task claiming is paused unless local automatic dispatch is enabled.

## Sign in and manage trusted devices

`ACP_PORTAL_SECRET` is the recovery code and signing secret. After the first
login, set a separate access code under **Security and devices**. The recovery
code remains valid if the user access code is lost.

The same page lists paired browser and executor devices, their credential
version, creation time and last-seen time. Revoking one device invalidates its
next access-token verification or refresh without affecting other devices.

## Pair a computer

1. Open `https://acp.asterroute.com` and sign in.
2. Generate a computer pairing code.
3. Open the local ACP settings page.
4. Under Remote pairing, keep the official portal address, enter the code and choose Pair.
5. Confirm the status changes to ready. ACP stores the refresh credential in
   its machine-local credential file and rotates access tokens automatically.

The computer must remain powered on with AgentControlPlane running for engineering tasks to execute.

## Pair the userscript

1. Generate a browser pairing code in the portal.
2. Open the Tampermonkey menu on a supported web AI page.
3. Choose Connect remote ACP and enter the code. The userscript stores the
   refresh credential in Tampermonkey storage and rotates access tokens
   automatically.

The userscript always tries the local loopback bridge first. It falls back to the remote portal only when the local bridge is unreachable.

## Domain migration

`acp.asterroute.com` is the canonical address. The legacy `relayone-gateway.chaofanxu97.chatgpt.site` host is compatibility-only and should return a permanent redirect to the canonical host after deployment.
