# PR5 ordinary Chat feasibility — research preparation only

Prepared 2026-11-01. No browser/login/session extraction, ordinary-chat automation,
provider account operation, live experiment or new API service was performed.
Original design Sections1/9/11 permit this stage to remain manual.

| Path | Evidence/status | Proposed acceptance |
|---|---|---|
| User creates document in ordinary Chat and submits approved file/brief | Design-supported manual path; existing ACP brief boundary | User checks full content/hash and sends compact brief; task/evidence returns through ACP |
| ChatGPT connected app/MCP integration | Official apps connect supported data/actions; availability varies by interface/account/workspace | Reuse approved MCP/companion path only after actual tool discovery, permission and response-integrity tests; not proof of UI-driving API |
| Existing ACP userscript/companion | Repository integration exists; not evidence of current cross-product UI stability | Test supported surface after user authorization; do not capture cookies, session tokens or hidden billing data |
| Unattended ordinary-chat browser control | No supported official unattended channel established by this research | Research-only; cannot promise reliable/offline/24x7 operation or subscription bypass |
| Model API | Different product and billing; not a free ordinary-chat substitute | Out of scope without separate explicit authorization; no purchases |

Official evidence checked 2026-11-01:
[Connected apps in ChatGPT](https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt)
describes apps, supported actions and availability depending on account/interface.
That documentation does not establish a general API to drive ordinary Chat UI.
The latter is an evidence gap, not a claim that every future product forbids it.

## Bounded feasibility gates (future tests, not performed)

1. Identify exact product surface, account plan and documented supported channel.
   Record official documentation/version; do not infer support from DOM selectors.
2. User performs any necessary login themselves. Test no credential/session export,
   least permissions, explicit task initiation and user cancellation.
3. Submit a benign bounded document through the approved channel; verify exact
   content, attribution, tool/output boundaries and absence of hidden prompts.
4. Test timeout, UI change, rate limit, lost session and restart. Block rather than
   loop/replay silently or invent progress. No automatic model quota test.
5. Assess terms/permissions and operational stability separately. Only a channel
   passing all gates may become an optional adapter through its own reviewed PR.

No new login, connector installation, session recovery, browser automation or live
quota operation is authorized by this document. The manual file/brief path remains
a valid design outcome when unattended feasibility cannot be demonstrated.

## Meaning of completion

A source-backed compatibility matrix plus actual authorized feasibility results
(or a clearly blocked/manual recommendation) completes research; it does not
promise an unattended official Chat channel. All implementation claims need
separate evidence. PR4 actual runner acceptance cannot be substituted by a PR5
browser conversation, and neither removes subscription limits.
