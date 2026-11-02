# Isolated single-Codex acceptance host

Use superpowers:executing-plans inline; one independent final review.
Base PR36 4797da7. Original design§7/10/12 and explicit parent authorization:
User-owned Windows first real local acceptance, preserve original checkout/config/state.
Cloud develops/tests offline only; Windows task runs the real subscribed task.

1. RED→GREEN: optional trusted-code launch callback in existing Codex client;
   default legacy behavior unchanged. Acceptance uses documented stdio transport,
   fresh cwd, disabled multiagent/apps/plugins/browser/computer/image/hooks,
   ChatGPT-only auth and provider, no hosted search. Actual child fixture proves
   existing CodexExecutor transport; no direct codex exec alternative.
2. RED→GREEN: bounded own-process-tree observation/termination. Windows CIM only
   PID/parent/creation timestamp, taskkill only own verified process tree; POSIX
   own detached group for fixture. Unknown/denied measurement never means stopped;
   retain artifacts/uncertain result. Never alter sandbox/permissions/system.
3. RED→GREEN: default-off one-shot host creates its own empty temp state/Git repo,
   no loadConfig/createApplication/oldqueue/relay/companion. Account/config passive
   guards before dispatch; only original Orchestrator/CodexExecutor queue. Fixed
   marker, explicit model from actual catalog, 4k budget, <=120s, cancellation,
   read-only loopback status, bounded outputs. Cleanup process/listener, preserve
   compact private receipt, remove owned runtime files only after measured stop.
4. Document exact Windows start/stop/evidence steps and unresolved real auth
   choices. Fake app-server child+temporary store/real queue tests, cancellation,
   deadline, isolation/HostOrigin/no write routes and privacy. Independent review,
   Important fixes RED→GREEN, fullverify, normal push/draft/exact-head CI.

Review focus: default-off no process/config reads; no old files or credentials
copied; app-server actualchild/queue once; preflight cannot use API/custom route;
PID ownership/reuse/races; failure/timeout/abort cannot fake completion/cleanup;
HTTP read-only not identity; no raw model output/account/header/path leakage;
original startup/queue/sandbox behavior unchanged. Fixtures never claim live pass.
