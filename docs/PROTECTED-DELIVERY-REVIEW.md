# Default-off protected delivery review

This follow-on to PR34/35 implements an actual HTML/WebAuthn HTTP handler composed
with the private credential/CAS/decision-journal host. It is **not mounted by
ordinary startup**, and does not register any CLI/MCP approval, merge or executor
operation. Tests use temporary stores, loopback HTTP and fake verifier/provider
seams. No personal identity or authenticator is enrolled here.

## Explicit host contract

`createProtectedDeliveryReview` requires explicit `enabled:true`, the existing
TaskStore, read-only provider, exact origin/RP/name, verifier authorization/user
policy, a `resolveSession(request)` verified-principal/session callback and
`authorizeTask(principalId,taskId)`. Enrollment additionally requires its own
`authorizeEnrollment` callback; omission denies registration. No default user,
account type, TTY, human flag or shared bearer establishes a person. Client JSON
cannot select these callbacks or provide a principal/target/verified receipt.
The resolver must revalidate a real authenticated host session each time; a
callback returning a constant identity or trusting a request header is a **test
seam**, never a production authentication implementation.

The returned `handle(req,res)` can be mounted by a deliberately configured host
on a **separate loopback listener** at the exact configured origin. It rejects
non-loopback local/remote addresses, mismatched Host/Origin, queries, oversized
headers and unknown routes. It creates no listener itself. Before mounting, the
host must enforce socket/header limits too: max8 connections, max32 headers,
headers/request timeout<=5s, keepalive<=1s, and an absolute<=5s socket deadline
including slow headers. Set the bind address to127.0.0.1. Do not publicly forward
this surface or reuse the ordinary shared bearer as identity. No such listener
or host session service has been installed in this development task.

Routes are GET `/review`, GET `/review/api/<task-uuid>`, and POST to that task's
`/begin` or `/finish`. Bootstrap returns only bounded delivery fields, enrollment
availability and a random in-memory CSRF value. It never returns prompts, paths,
user/principal/credential IDs, errors or private storage. Each bootstrap rotates
CSRF and stores its exact reviewed repo/PR/head. A newer read in another tab
invalidates the earlier tab: reread before proceeding. This conservative choice
prevents a displayed old HEAD from silently authorizing a newly refreshed HEAD.

Begin accepts only kind and decision enum. Finish accepts only an opaque ticket
and the standard browser credential response. Tickets bind session, task, kind,
repo/PR/head and expiry; consume once before async verification. Host derives the
target from the server record, matches the reviewed snapshot, and rechecks it
before finishing. Positive decisions additionally require provider HEAD/policy
verification in the underlying host. Registration only registers; it never
approves. A restrictive host callback rechecks current verified session, task
access, enrollment permission and exact target during crypto/CAS and immediately
before decision persistence. Removing access while verification awaits fails
closed. This callback cannot grant authority missing from existing host policy.

Memory caps:32 sessions and32 pending tickets (configurable downward),8 active
handlers,73,728-byte JSON body,256-character URL,8KiB headers,120s ephemeral
session/ticket TTL and request deadline<=5s. Requests/replies use no-store and
connection close; no body/header/credential logging or diagnostics are added.
The private journal still owns restart/replay/CAS/audit semantics. HTTP failure
can be uncertain after a successful durable decision: reread status, never
blindly retry a ceremony or infer approval from an HTTP transport result alone.

## Browser and actual evidence

The page shows literal repo/PR/fullHEAD/checks/current review state, with explicit
buttons for registration, approval, requested changes and revocation. It uses
standard `navigator.credentials.create/get` with base64url BufferSource encoding;
crypto is delegated to the existing standard server library, per the
[WebAuthn specification](https://www.w3.org/TR/webauthn-3/).
No automatic approval, browser scraping, private API or persistent client storage.
Double clicks are blocked; changed task/page exit invalidates delayed callbacks;
cancelled verification posts no decision. On uncertain completion, explicitly
reread. A bfcache-restored page currently requires a hard reload (safe UX limit).

Actual evidence here is Node HTTP/temp-store integration plus controlled DOM/
credential-seam tests of the exact page script, **not a real browser authenticator
or human-presence acceptance**. The development container's previously observed
browser sandbox platform blockage was not bypassed or retried. Parent cloud
browser evidence for the earlier conversation fixture does not cover this page.

## Remaining real configuration and rollback

Select the user's actual existing host/session authentication source, exact local
origin/RP, allowed principal/task/enrollment policies and existing read-only
GitHub transport/check policy. If that host has no verified-session adapter, its
specific adapter remains code work after the real authentication source is
chosen; a constant callback cannot close that gap. User personally authorizes
and performs enrollment and exact-head verification there, followed by revoke,
new-head, restart and unavailable-provider acceptance. Mounting/deployment,
credentials and any new access require their specific approval. No values or
identities were selected by the agent. Real runner stop/remote transport/write
fencing and bounded live recovery remain separate unfinished PR4 acceptance.
Ordinary Chat unattended handoff remains conditional research, not a new release
gate under original design§9.

Rollback closes the surface/host, invalidates pending memory capabilities and
keeps private state/audit/history. Disable mounting before code rollback; do not
resume with an older component that ignores decision revocations or generation
fences. No main merge, credential deletion or destructive cleanup is automatic.
