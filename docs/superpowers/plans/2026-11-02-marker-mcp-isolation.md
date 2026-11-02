# PR37 process-scoped MCP isolation compatibility

Authorization: parent Windows passive preflight found two enabled user MCP entries;
no marker/model was dispatched. Preserve PR37 and persistent user configuration.
Execute inline with superpowers:executing-plans and one fresh final reviewer.
Base dcad1ae162ead10c6322bb0898d79d5110150031; no new branch/PR/live operation.

1. RED: bounded encoder tests for top-level `mcp_servers` TOML inline-table value,
   quoted special keys, no endpoint/command copying, malformed/oversized rejection.
   GREEN: dependency-free encoder; no dotted dynamic override paths or shell.
2. RED: real fixture app-server/adapter/queue tests for process-only overrides,
   measured discovery-process stop before one isolated launch, effective zero MCP
   before thread/turn, ignored/new enabled entries fail closed, cancellation and
   uncertain cleanup cannot relaunch, no sensitive names/values in public evidence.
   GREEN: at most one sequential process restart; same adapter and original queue;
   account/quota/config guards rerun. No model, MCP-list/tool or thread RPC on probe.
3. Update operator guide/source references, targeted tests, independent review of
   entire increment, Important fixes RED→GREEN, final npm run verify, ordinary
   feature push/remote SHA and exact-head CI. Real Windows acceptance stays pending.

Review focus: TOML quoted keys vs naive CLI dot splitting; config table merge;
no secrets copied to argv, logs or receipt; all disabled rechecked, no unknown MCP
slips through; no overlapping child/tree/turn; cancellation, exit-event races and
failed old-tree stop retain truth; normal startup unchanged. No live models,
user config writes, new permissions/dependencies, sandbox changes or stage2 work.
