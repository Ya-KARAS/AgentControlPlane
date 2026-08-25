# Beta onboarding (invite-only paid beta)

This document covers the two entry paths of the AsterRoute ×
AgentControlPlane invite-only paid beta. The beta serves 3–5 invited
users, provides no enterprise SLA, and offers no self-service signup.

## Path A — AsterRoute API Beta

1. Request an invite from the operator. Each user receives a dedicated
   project and API key; keys are never shared between users.
2. Base URL: `https://asterroute.com/v1` (OpenAI-compatible).
3. Model catalog: `GET /v1/models`; the live catalog and route health are
   authoritative at request time.
4. Example chat completion:

   ```bash
   curl https://asterroute.com/v1/chat/completions \
     -H "Authorization: Bearer $ASTERROUTE_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-5.6-sol-economy","messages":[{"role":"user","content":"Reply with OK"}]}'
   ```

5. Each key carries a model allowlist, RPM, daily limit, and monthly
   budget configured by the operator.

The step-by-step provider walkthrough lives in
[docs/PROVIDER-ASTERROUTE.md](PROVIDER-ASTERROUTE.md); AsterRoute mirrors it
in its integration guide at
[`https://asterroute.com/integrations/agentcontrolplane?utm_source=agentcontrolplane&utm_medium=docs&utm_campaign=asterroute-acp`](https://asterroute.com/integrations/agentcontrolplane?utm_source=agentcontrolplane&utm_medium=docs&utm_campaign=asterroute-acp).

## Path B — AsterRoute + ACP assisted setup

1. Install ACP on your own machine (Node.js 22 or newer):

   ```bash
   git clone https://github.com/Ya-KARAS/AgentControlPlane.git
   cd AgentControlPlane
   npm install
   ```

2. If you use an AsterRoute model route, keep its key out of files:

   - Set the `ASTERROUTE_API_KEY` environment variable. On Windows, the
     persistent location is the User environment (registry); the start
     script reads it from there.
   - Add the official preset relay in `config/local.json`:

     ```json
     {
       "executor": {
         "relays": [
           { "id": "asterroute", "preset": "asterroute", "reconcileUrl": "https://asterroute.com" }
         ]
       }
     }
     ```

3. Start the service: `npm start`. The service binds to
   `127.0.0.1:4318` only; it is not a public endpoint. On Windows,
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-server.ps1`
   starts the service detached, waits for `/health`, and prints the pid
   and health body. The AsterRoute model key is optional; paired phone and
   web relay devices use their stored device credential. To start ACP at
   sign-in, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-autostart.ps1`.
4. The first dispatch runs `protocol:auto` detection and stores the
   selected protocol; recommendation lists are advisory and never switch
   the model you picked.

## Common errors

- `401 invalid_api_key`: the key is missing, mistyped, or revoked. Rotate
  it through the operator.
- `402 / insufficient balance`: the project balance or monthly budget is
  exhausted; contact the operator.
- `429 rate_limit_exceeded`: the key's RPM or daily limit is reached;
  retry after the window.
- `5xx`: gateway or upstream trouble; check the
  [status page](https://asterroute.com/status?utm_source=agentcontrolplane&utm_medium=error&utm_campaign=asterroute-acp)
  and the operator's incident channel.

## Key rotation

Ask the operator to issue a new key when needed. Update the
`ASTERROUTE_API_KEY` environment variable, restart ACP, and ask the
operator to revoke the old key. On Windows, update the value in the User
environment (registry), stop the running server with
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/stop-server.ps1`,
and start it again with
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-server.ps1`.

## Support

Operator contact is provided with the invite. Incidents are announced on
the operator's status page.
