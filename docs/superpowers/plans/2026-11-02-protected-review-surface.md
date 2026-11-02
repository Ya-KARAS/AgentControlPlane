# Protected review surface and host composition

> Use superpowers:executing-plans inline with one independent final review.

Goal: close the actual PR3 user-facing ceremony/host composition code gap while
keeping ordinary startup disabled. Original design§8/10/11: user-originated exact
revision decision, separate delivery state, never merge/execute/approve by AI.

Base: PR35 inventory chain82513ecd4691dbfaf9dddeaf82d99fa60e737163; preserve all prerequisites. No new dependency.

Architecture: explicit host-only factory builds the PR34 approval host and a
bounded loopback-only HTTP handler/page. Host must supply exact origin/RP,
verified session/principal resolver, task access and enrollment policies, provider
and store. No default identity, bearer-derived human, enrollment, port listener,
production config or MCP tool. Normal server startup does not mount this module.
Client chooses only task and decision enum; target comes from current store and
is rechecked before finish. Session-bound CSRF and one-use opaque ceremony tickets
stay in memory, expire and are capacity bounded. UI shows exact repo/PR/head,
requires explicit gesture, uses standard navigator.credentials, no auto approve.

1. RED: default-off/missing policies, anonymous/forged input, trusted fake session,
   enrollment denied by default, real temp-store enrollment→decision→refresh,
   CSRF/session/replay/head race/expiry/unknown input/size limits. GREEN: minimum
   strict handler + explicit composition. No actual authenticator registration.
2. RED: browser encoding roundtrip, standard create/get options and responses,
   busy/doubleclick/reload-safe behavior, cancelled ceremony no finish, text-only
   output, no secrets/body logging. GREEN: small page/controller with actual
   WebAuthn browser API; controlled DOM/credential seam only in tests.
3. Document host contract, real configuration/acceptance and rollback. Independent
   whole-branch review, Important RED→GREEN fixes, fullverify, normal push/draft
   based on PR35 and exact-head CI. No deployment or real credential registration.

Review focus: no caller-selected principal or target, policy revoked/head changed
at async boundaries, page CSRF/session exposure/clickjacking, bounded tickets/body/
HTTP lifetime, no raw errors/public private material. No assumed authenticated
transport or true human presence from fixture assertions. No real runner work.

Implementation/review completed offline; final fullverify and exact-head CI evidence
are recorded in the PR handoff. Real mounting/authentication/enrollment not run.
