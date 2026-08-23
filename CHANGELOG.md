# Changelog

## Unreleased

### Added

- The desktop userscript now keeps task planning in the native ChatGPT or
  DeepSeek conversation. `@AgentControlPlane` starts planning, the web AI emits
  a bounded task envelope, and a fresh user Send action with `执行` authorizes
  candidate creation.
- Independent adapter modules provide composer, Send-control, assistant, and
  user selectors. The bridge polls task status with an origin-bound short-lived
  capability and can return a compact `<ACP_RESULT>` to the same conversation.
- A loopback dispatch-settings page stores a locally selected workspace,
  executor, and profile. Automatic dispatch and safe result return are
  independent, default-off options.
- The userscript can now discuss and stage a workspace alias or user-supplied
  path, executor, profile, advertised model, and advertised reasoning effort.
  Omitted fields continue to use local defaults. OpenCode receives an explicit
  reasoning choice through its `--variant` option.
- A loopback capability endpoint gives supported web pages a bounded list of
  workspace aliases, ready executors, profiles, models, and reasoning efforts
  for natural-language planning.
- Web Bridge 0.5.1 restores an unexpired staged task after a refresh, adds a
  stable dispatch idempotency key, and requires a separate confirmation when a
  replacement task changes the objective or execution route.
- Safe task status now separates test commands from parsed test cases and
  includes a bounded failure category. Recent provider failures add a temporary
  cooldown marker to the capability summary.
- Web Bridge 0.5.2 uses compact Chinese action labels in the floating status
  pill and moves the complete execution route into hover text. A workspace name
  synchronized inside the objective is reported as one workspace change.
- Replacement task prompts now ask for `确认变更`. A premature `执行` response
  remains in the conversation while the local bridge keeps dispatch blocked.

### Security

- Userscript status responses exclude objectives, summaries, paths, logs,
  credentials, and raw errors. Settings writes require a one-time local form
  secret, and the automatic-dispatch marker is not permitted by webpage CORS.
- AI replies and DOM changes can stage task data but cannot authorize dispatch.
  Requested execution choices remain untrusted until ACP validates them against
  local workspace roots and live executor capabilities. Credential fields and
  unsupported execution fields are discarded or rejected.
- Refresh recovery uses extension-isolated userscript storage with a ten-minute
  expiry. It stores only the bounded task envelope and change-confirmation
  state; credentials, local paths discovered by ACP, status secrets, and task
  output are excluded.

## v0.9.0 — 2026-08-21

### Added

- `npm run demo` runs one confirmed live MCP dispatch against a ready local
  executor, verifies the generated marker file, and preserves the workspace for
  inspection.
- Public repository onboarding now includes a focused README hero, reproducible
  social preview source, contribution guidance, conduct policy, issue forms,
  pull request checks, and a GitHub launch checklist.
- `npm run release:package` creates deterministic Windows source and browser
  companion ZIP files from explicit tracked inputs.
- `npm run release:sha256` creates a stable SHA256 manifest for explicit asset
  paths and rejects missing files and directories.
- The release includes a 90-second video walkthrough built from the verified
  OpenCode demo task and its persisted evidence.

- Native cross-executor continuation with stable logical task ids,
  append-only executor history, compact continuation packages, deterministic
  failure classification, and capability-gated reroute execution.
- `continue_project` accepts an optional executor override while preserving the
  original same-executor behavior when omitted.
- `npm run accept:reroute` injects one approved infrastructure failure in an
  isolated temporary workspace and verifies continuation through a selected
  real executor. `--model` selects a target executor model for acceptance.
- Dispatch accepts an optional `idempotency_key`; identical retries return the
  original task, and a key reused with different content returns
  `idempotency_conflict`.

- `npm run verify` runs the full suite and the syntax check
  (`npm test && npm run check`) as the single pre-handoff gate, mirroring
  CI.
- `docs/DEVELOPMENT.md` defines the executor-neutral development flow, the
  DEVELOPMENT HANDOFF contract, the executor-switch procedure, and
  working-tree safety rules.

### Changed

- `task_status` now exposes additive continuation and executor-history fields.
- The local dashboard displays the logical task id, executor path, and reroute
  reason for continued tasks.
- Restart recovery can reroute a persisted running task whose recovered turn
  ended with an approved infrastructure failure.
- Automatic reroute is default-off, capped, and restricted to infrastructure
  failures; task implementation and validation failures never auto-switch.

- `AGENTS.md` records the executor-neutral development rules: handoff
  output at the end of each round, working-tree safety, logical task
  continuity, and durable decision storage.
- `docs/ROADMAP.md` adds Phase 5 (cross-executor continuation) as the next
  core runtime milestone.
- The generic continuation path reports a missing session using
  executor-neutral wording.

### Verified

- 215 tests pass locally, including deterministic ZIP contents and SHA256
  manifest validation.
- The OpenCode demo task `c3aaa988-95a0-44ae-a646-090cd60ab105` completed,
  created `hello.txt`, matched the marker, and reported 10,148 tokens.
- Release archives are rebuilt twice and compared byte-for-byte before upload.

## v0.8.4 — 2026-08-16

Beta launch baseline: joint-certification fixes.

### Fixed

- Reconcile client construction merges the relay preset first, so the
  preset `apiKeyEnv` reaches the client and the environment key is used.
- Attribution headers include `x-acp-task-kind`, so certification tasks
  reach the relay with their task kind.

### Verified

- 178 tests pass locally on main.

## v0.8.3 — 2026-08-16

Responses tool-loop compatibility with the relay contract.

### Fixed

- `function_call` continuations now carry `status: "completed"` and
  `function_call_output` items carry a `summary`, matching the relay's
  Responses API validation.

### Verified

- 178 tests pass locally.

## v0.8.2 — 2026-08-16

Credential handling hardening.

### Added

- `npm run key:fingerprint` prints the configured relay key's SHA-256
  fingerprint prefix, length, and source without ever printing the key.
- Repository instructions record the rule: key material is referenced by
  fingerprint only and never written to logs, reports, or commits.

### Changed

- `config/local.json` template usage: the relay key comes from the
  `ASTERROUTE_API_KEY` environment variable; the config file holds null.

### Verified

- Full test suite passes locally.

## v0.8.1 — 2026-08-16

Phase 3.1 Usage/Reconciliation v2 joint certification with AsterRoute v71
(builds on the v0.7.3 frozen contract).

### Fixed

- The bulk lookup client now posts `{ ids: [...] }` and matches provider
  rows by `asterroute_request_id` plus `token_dimensions` — the actual
  AsterRoute lookup row shape. The previous `request_ids` request key and
  `request_id` / `total_tokens` row fields are retired everywhere
  (`reconcile_usage` MCP schema included).
- Reconciliation entries are keyed by `asterroute_request_id`; legacy
  `request_id` entries migrate on load; stored entries keep canonical
  state names. Duplicate application compares the full entry, keeping
  `reconcile_now` idempotent.
- Reconciliation now also refines events whose ids the provider does not
  return (`presence_state: unknown`) and records provider-only rows, so
  presence stays partitioned into both / client_only / provider_only /
  unknown.
- `scope=diagnostic` added to dimensional usage queries (production /
  diagnostic / all); `production_only` remains a legacy alias.

### Shared contract

- `contracts/usage-reconciliation-v2.schema.json` is now the byte-identical
  schema shared with AsterRoute (sha256
  `64900f5746ebe239dfaf7ecb4efae80c76c1bc79cf4536a934abbb3777166dc8`,
  `contractVersion: 2.0`, draft 2020-12), covering wire messages (lookup,
  record, report) and usage events.
- `tests/contract-schema.test.mjs` is byte-identical with the AsterRoute
  copy and validates sample payloads against the schema in addition to
  the pinned hash.

### Verified

- 160+ tests pass locally: shared schema conformance, canonical state
  partition, id-source separation, retry attempts, explicit production
  scope, cross-origin key refusal, idempotent reconciliation, and
  micro-USD integer invariants.

## v0.8.0 — 2026-08-16

Phase 4A: estimate-aware cost selector.

### Added

- Versioned token estimates (`src/core/token-estimate.js`): low /
  expected / high scenarios per profile with component-wise ordering
  enforced; scenarios configurable under `config.recommendation.tokenScenarios`.
- Price normalization to micro-USD per token rates; cost projection
  returns integer micro-USD ranges (low / expected / high). Cached input
  is billed at the cached rate only and reasoning tokens at the reasoning
  rate only; each token is billed exactly once. Missing prices stay
  unknown and are never zero; missing context is never zero.
- Cheapest / Balanced / Best strategies: cheapest picks the lowest
  expected cost among candidates with known pricing, balanced uses the
  profile weights, best prefers reasoning capability first and then deep
  weights. The recommendation snapshot carries the token estimate, per-
  entry pricing versions, and the three strategy picks; selected_model
  stays null.
- Over-budget behavior is configurable: `config.recommendation.overBudget`
  is `warn` (default) or `exclude`.
- Usage events carry `estimated_cost_microusd` (integer) and the
  `pricing_version` used for the estimate.
- Dashboard and companion show the three strategy picks with low–high
  cost ranges; the benchmark prints strategies and ranges.
- The selector is fully static: it never reads usage history and never
  adjusts weights from results; certification and probe data never feed
  it.

### Verified

- 170 tests pass locally, covering token-estimate ordering, single-billing
  for cached and reasoning tokens, unknown pricing and context, pricing
  versions, catalog-order independence, explicit-model preservation,
  route/capability separation, over-budget warn/exclude, strategy picks,
  integer micro-USD ranges, replay, and history isolation.

## v0.7.3 — 2026-08-16

Usage/Reconciliation v2 joint certification fixes.

### Fixed

- Frozen wire enumeration: `presence_state` is both / client_only /
  provider_only / unknown; `token_state` is matched / mismatch / unknown;
  `settlement_state` is pending / settled / adjusted / not_billable.
  Legacy aliases (matched → both, match → matched, cost_pending →
  pending) normalize on read; new writes never emit legacy values.
- Machine-readable contract schema at
  `contracts/usage-reconciliation-v2.schema.json` with a pinned SHA-256
  hash test.
- `asterroute_request_id` comes only from the
  `x-asterroute-request-id` header; the payload id is never used as a
  fallback; missing headers stay null.
- Queries take an explicit `scope` (production / all); production is
  task_kind=production AND request_kind=task_execution including all
  attempts.
- `reconcileUrl` security: the relay key is reused only for same-origin
  reconcile endpoints; cross-origin endpoints require a dedicated
  `reconcileApiKey` and refuse the relay key otherwise.

### Verified

- 157 tests pass locally, including the frozen-enum emission, alias
  reads, schema hash, header-only request ids, scope filtering, and
  same-origin reconcile key security.

## v0.7.2 — 2026-08-16

Contract hardening: usage and reconciliation v2.

### Added

- UsageEvent schema v2 (`schema_version: 2`): `client_event_id`,
  `asterroute_request_id`, `upstream_request_id`, `task_id`, `turn_id`,
  `task_kind`, `request_kind`, `attempt`; the dual-purpose
  `provider_request_id` field is retired.
- Classification semantics: `task_kind` is production, certification,
  benchmark, or maintenance; `request_kind` is `protocol_probe` or
  `task_execution`; attempts are 1-based and `is_retry` derives from
  `attempt > 1`.
- The executor captures `x-asterroute-request-id` and
  `x-asterroute-provider-request-id` separately.
- Reconciliation splits into `presence_state` (matched / client_only /
  provider_only / unknown), `token_state` (match / mismatch / pending),
  and `settlement_state` (settled / cost_pending / pending).
- Money fields use integer micro-USD: `estimated_cost_microusd`,
  `settled_cost_microusd`, `credit_microusd`, `net_cost_microusd`,
  `currency`, `pricing_version`, `billing_revision`.
- A read-only bulk lookup client (`POST /api/usage/reconcile/lookup`,
  configured per relay through `reconcileUrl`) plus a periodic
  reconciliation job (`config.reconciliation.intervalMinutes`) and the
  `reconcile_now` MCP tool. ACP computes presence and token states
  locally and reads settlement from the provider.
- Production scope is `task_kind=production AND
  request_kind=task_execution` including every attempt; probes,
  certification, benchmark, and maintenance stay out of the default view.
- Backward compatibility: existing `usage.jsonl` rows are read through a
  v1 adapter (lazy, no file rewrite); v1 `provider_request_id` maps to
  `asterroute_request_id`; undeterminable ids stay unknown.

### Verified

- 150 tests pass locally, covering the fourteen contract items including
  dual-id separation, 1-based attempts, retry classification, production
  scope, three-way reconciliation states, bulk lookup matching,
  micro-USD precision, credit/net cost, v1 read compatibility, idempotent
  reconciliation, and PII exclusion.

## v0.7.1 — 2026-08-16

Dimensional view fixes.

### Fixed

- `GET /v1/usage/dimensions` honors `production_only=false` so
  certification and smoke rows are inspectable; the default production
  view keeps excluding them.
- Unattached events (probes) report their task kind as `unattached`.

### Verified

- 138 tests pass locally, including production-view exclusion ordering.

## v0.7.0 — 2026-08-16

Usage intelligence and cross-system reconciliation.

### Added

- Request-level usage events (append-only `usage.jsonl`): task, turn,
  request kind (execution / probe / retry / certification / smoke),
  attempt, provider request id, executor, requested and resolved model,
  protocol, duration, outcome, token dimensions, estimated cost, and
  provider-reported actual cost. Events carry a closed whitelist of
  fields; prompts, file contents, workspace paths, and credentials have
  no field and are dropped by construction.
- Token invariants enforced at event creation: cached input is a subset
  of input, reasoning output is a subset of output, and total equals
  input plus output.
- Attribution headers extended: `x-acp-turn-id`, `x-acp-request-kind`,
  `x-acp-attempt`, `x-acp-version`, `x-acp-recommendation-id`.
- Provider request ids from chat and responses payloads are captured and
  persisted; duplicate request ids are idempotent.
- `usage_report_dimensions`, `reconcile_usage`, `usage_events_csv`, and
  `mark_task_kind` MCP tools; `GET /v1/usage/dimensions` and
  `POST /v1/tasks/:id/kind` HTTP routes. Reconciliation classifies
  matched, client_only, provider_only, token_mismatch, cost_pending, and
  settled.
- Dispatch accepts `kind` (production / certification / smoke);
  certification and smoke tasks are excluded from production aggregation.
- CSV export neutralizes spreadsheet formula injection.
- The web panel shows usage by model with request counts, outcome
  counts, estimated/actual costs, and reconciliation counts.

### Verified

- 138 tests pass locally, covering the token invariants, whitelist
  exclusion, CSV injection guard, idempotent provider ids, pagination,
  separate retry and probe events, estimated/actual separation, stable
  ordering, certification exclusion, and reconciliation classification.

## v0.6.2 — 2026-08-16

Score computation fix.

### Fixed

- The pricing component read a nonexistent `estimates.max` field and
  produced NaN scores (serialized as null). It now reads
  `estimates.range.max`; scores are finite numbers.

### Verified

- 128 tests pass locally, including a finite-score regression test.

## v0.6.1 — 2026-08-16

Null metadata guards in the recommender.

### Fixed

- Candidate normalization treats explicit null catalog fields (context,
  latency, freshness) as unknown; the earlier `Number(null) === 0`
  conversion excluded every model whose catalog carried `"context": null`.

### Verified

- 127 tests pass locally, including a regression test for explicit null
  metadata fields.

## v0.6.0 — 2026-08-16

Task-aware model recommendation (advisory only).

### Added

- `src/core/recommend.js`: deterministic, provider-agnostic pipeline —
  versioned task requirements extracted from the brief and profile (no
  model calls), three-state candidate normalization, hard filtering, a
  weighted scorer whose weights live in `config.recommendation`, and the
  recommendation result schema (top 3 with score, estimated cost range,
  reasons, warnings, capability source, health, latency, freshness, plus
  excluded candidates with reasons).
- Dispatch stores a recommendation snapshot per task: requirements,
  catalog hash, ranked and excluded candidates, the requested model, and
  the resolved model. Explicit models are never overridden;
  `selected_model` stays null unless a dispatch resolves one.
- `recommend_models` MCP tool and `GET /v1/recommendations` expose the
  read-only recommender.
- Task records store completion retries; protocol probe usage is recorded
  in executor discovery (`protocols.probe_usage`) and stays separate from
  task usage.
- Dashboard gains a recommendation section; the companion panel gains a
  Recommend models button whose results select a model only on click.
- `npm run benchmark:recommend` prints ranked candidates for fixed
  objectives and consumes no model quota.

### Verified

- 126 tests pass locally, covering the 14 required behaviors: explicit
  model preservation, three-state filtering, route/capability separation,
  context and status exclusion, unknown-cost and low-sample warnings,
  stale metadata, bare-provider compatibility, deterministic replay,
  probe/task usage separation, selection traceability, and the absence of
  provider-specific branches.
- Copy passes the grounded-copy gate with 0 findings.

## v0.5.4 — 2026-08-16

Relay metadata, preferred protocol, and request attribution.

### Added

- Model catalog entries pass through provider routing metadata:
  `preferred_protocol`, `route_health`, `latency`, `pricing`, `status`,
  `context`, and `tier`.
- Auto-detection reads `preferred_protocol` from the catalog: a value of
  `chat` probes Chat Completions first, `responses` keeps the default
  order; the discovery record reports the preference and the probe order.
- Model-endpoint executors send request attribution headers
  (`x-acp-task-id`, `x-acp-project`, `x-acp-executor`) so providers can
  match requests to ACP tasks in their request logs.
- The web panel marks unprobed protocols with a dash in the probe
  checklist.

### Verified

- 111 tests pass locally, including preferred-protocol ordering, routing
  metadata passthrough, and attribution header assertions.

## v0.5.3 — 2026-08-16

Probe checklist on the web panel.

### Added

- Executor cards for auto-protocol endpoints show the detection checklist:
  the selected protocol and per-protocol tool-loop results (✓/✗), so the
  probing outcome is visible directly on the card.

### Verified

- 108 tests pass locally; copy passes the grounded-copy gate with 0
  findings.

## v0.5.2 — 2026-08-16

Smarter protocol probe model selection.

### Fixed

- Auto-detection probes up to three candidate models in order: the
  configured model, the static allowlist, models that declare chat, tool,
  or responses capabilities in `/v1/models`, and the rest of the catalog.
  This keeps probes away from catalog entries that lack an active tool
  route.

### Verified

- 108 tests pass locally.
- Live check on the AsterRoute preset resolves the protocol from a
  capability-declaring model.

## v0.5.1 — 2026-08-16

Protocol probe budget for reasoning models.

### Fixed

- Auto-detection probes cap output at 1024 tokens, which leaves reasoning
  models room to emit a tool call; the earlier 16-token cap exhausted on
  reasoning output and recorded false tool-loop failures.

### Verified

- 108 tests pass locally.
- Live check on the AsterRoute preset: catalog capabilities pass through,
  and the probe resolves the protocol.

## v0.5.0 — 2026-08-16

Phase 1: provider-agnostic capability layer and official relay preset.

### Added

- Provider preset registry (`src/executors/provider-presets.js`): data
  entries that pre-fill relay fields. A relay entry can now be
  `{ "id": "asterroute", "preset": "asterroute", "apiKey": "…" }`;
  explicit fields override the preset. Unknown presets fail with the
  available names. Presets carry no code branches; `official` is a UI
  flag only.
- `protocol: "auto"` detection: probes the Responses API availability,
  the Responses tool loop, then the Chat Completions tool loop with a
  tiny `ping` tool, and selects the protocol that completes the loop.
  Detection runs once per process, is cached, uses a 16-token output cap,
  and explicit `chat`/`responses` never probe. The result shows in
  executor discovery (`protocols.selected`, per-protocol checks, probe
  model).
- Model capability layer: `/v1/models` entries pass through provider-
  declared `capabilities`, `featured`, and `route_tier`; undeclared
  capabilities stay unknown (`null`) and the protocol probe records
  verified capabilities for the probed model.
- Companion model dropdown: per-executor model catalogs from
  `/v1/companion/options` (`models` map), an auto default, official
  provider labels, and a catalog-driven controller prompt that lists
  advertised model names. The dashboard shows official badges and
  capability/featured tags per model.
- Integration guide documents presets, auto-detection, and capabilities
  in both languages.

### Compatibility

- Explicit relay JSON configurations keep working unchanged; `chat` and
  `responses` protocols behave as before. `list_models` and companion
  options now include extra fields (additive). `dispatch` behavior is
  unchanged.

### Verified

- 108 tests pass locally, including preset resolution and overrides,
  detection ordering and caching, a full auto-detected chat tool loop,
  capability passthrough, and companion model-dispatch flow.
- Copy passes the grounded-copy gate with 0 findings.

## v0.4.10 — 2026-08-16

Task search and id-prefix lookup.

### Added

- `search_tasks` MCP tool and `GET /v1/tasks?query=&status=` filter tasks by
  id prefix, objective text, result summary, and status.
- `task_status`, `continue_project`, `cancel_task`, and `GET /v1/tasks/:id`
  accept an unambiguous id prefix (8 or more characters) in addition to the
  full task id.
- The web panel and the companion task history gain a search box; the
  companion search runs against the paired client's own tasks.
- Repository instructions record the provider-independence boundary, and
  `docs/ROADMAP.md` (Chinese version included) fixes the interface shapes
  for the model-routing, usage-intelligence, and cost-aware picker phases.

### Verified

- 96 tests pass locally, including deterministic prefix-ambiguity, content
  search, HTTP filtering, and MCP tool tests.
- Copy passes the grounded-copy gate with 0 findings.

## v0.4.9 — 2026-08-16

Relay request pacing and 429 retries.

### Added

- Per-relay `requestsPerMinute` setting paces completion requests with a
  60-second sliding window; the executor waits when the next request would
  exceed the relay's limit. The `openaiCompat` and `deepseek` endpoints
  accept the same setting.
- Completion requests to model endpoints retry 429 responses twice,
  honoring the `retry-after` header; `/v1/models` discovery stays outside
  the pacing window and is unaffected.
- Integration guide documents the setting in both languages.

### Verified

- 93 tests pass locally, including sliding-window pacing math, a 429-then-
  success chat turn, and relay config wiring.
- Docs pass the grounded-copy gate with 0 findings.

## v0.4.8 — 2026-08-16

Service version markers in the companion UI.

### Added

- The companion panel header and the extension popup show the local
  service version reported by `/v1/companion/options` (for example
  `v0.4.8`). The popup previously carried a hard-coded version label.
- The popup executor list groups relay endpoints under model endpoints
  using the executor kind, matching the in-page panel.

### Verified

- 91 tests pass locally, including version-marker source checks.
- Companion copy passes the grounded-copy gate with 0 findings.

## v0.4.7 — 2026-08-16

Failed executor turns surface their real error.

### Fixed

- A failed executor turn records its error message in the task result
  summary and the task error field; panels and companions then display
  the endpoint's message (for example a relay 503).

### Verified

- 90 tests pass locally, including a failed-turn error-surfacing test.

## v0.4.6 — 2026-08-16

Multiple AI relay endpoints.

### Added

- Each entry under `executor.relays` registers a named OpenAI-compatible
  relay as its own executor, with a display name, live model catalog
  refreshed every 60 seconds, and a static model allowlist. Relay ids must
  differ from built-in executor ids.
- Relay API keys can come from a named environment variable
  (`apiKeyEnv`) so keys stay out of configuration files.
- Relay executors appear in the companion executor list under model
  endpoints, in the web panel, and in `list_models` / `list_executors`.
- Dispatch validates explicit models against the selected relay's live
  catalog with the static allowlist as fallback.
- Integration guide documents the multi-relay shape
  (`docs/AI-RELAY-INTEGRATION.md`, Chinese version included).

### Verified

- 89 tests pass locally, including relay registration, id validation, and
  static-allowlist model checks.
- Docs and config examples pass the grounded-copy gate with 0 findings.

## v0.4.5 — 2026-08-16

Companion task history and project continuation.

### Added

- The companion panel lists recent tasks dispatched by this paired client,
  with status, start time, actual minutes, executor, model, profile, token
  usage, and the result summary (`GET /v1/companion/tasks`, scoped to the
  paired client's own tasks).
- Completed tasks carry a Continue project button that accepts a follow-up
  instruction and dispatches a child task in the same workspace through
  `continue_project`; the panel then tracks the child task with the live
  timer and progress bar.
- Task history refreshes automatically after pairing and after every task
  reaches a terminal status.

### Verified

- 86 tests pass locally, including companion task-list scoping, client
  isolation, and i18n key parity.
- Companion copy passes the grounded-copy gate with 0 findings.

## v0.4.4 — 2026-08-16

Local read-only web panel.

### Added

- A self-contained web panel at `http://127.0.0.1:4318/` (also `/dashboard`)
  showing executor readiness, live model catalogs per executor, recent tasks
  with status, time used, token counts, and budget bars, plus the aggregate
  token usage report.
- The panel is read-only: it performs same-origin GET requests only. It is
  served without a bearer token and shows a token input when the server
  requires one; a strict content security policy and frame denial headers
  apply.
- Chinese and English panel strings in one dictionary (`src/dashboard.js`)
  with a language switcher; Chinese is the default.
- The panel refreshes every 5 seconds.

### Verified

- 85 tests pass locally, including 5 panel tests (route serving, security
  headers, i18n key parity, token exemption).
- Panel copy passes the grounded-copy gate with 0 findings.

## v0.4.3 — 2026-08-15

Token accounting correctness, task time controls, and license policy.

### Added

- Per-task `time_limit_minutes` field (1 to 240) with runtime enforcement and
  validation.
- Estimated completion minutes at dispatch, actual duration at terminal, a
  per-second live timer, and a percentage progress bar in the companion panel.
- Machine-specific configuration through `config/local.json` with automatic
  merging; `default.json` carries neutral values.
- Live model catalogs read from OpenAI-compatible relay endpoints every 60
  seconds, used for `list_models` and dispatch-time validation with a static
  fallback.
- License policy: current source under AGPL-3.0 with a commercial cooperation
  requirement; released versions v0.1.0 through v0.4.2 remain Apache-2.0
  (`docs/LEGACY-LICENSE-APACHE-2.0.md`), trademark statement in `NOTICE`.
- AI relay integration guide (`docs/AI-RELAY-INTEGRATION.md`, Chinese version
  included).

### Fixed

- Budget monitoring for opencode tasks counts marginal tokens; KV-cache reads
  are recorded as `cached_input_tokens` and excluded from budget comparisons.
- Tasks keep their completed status when the executor delivered its final
  report before a late budget interrupt; the exceedance is recorded as an
  event.
- `uncached_input_tokens` computed correctly when cached reads exceed the
  input figure.
- Cached input tokens thread through opencode usage notifications.
- Workspace lists show only directories inside configured roots.
- Service version derives from `package.json` across health, companion
  options, and the MCP handshake.
- Real username paths replaced with `YOUR_USER` placeholders in docs and
  evidence.

### Verified

- 80 tests pass locally and on GitHub Actions CI.
- Four consecutive real end-to-end runs through the opencode executor complete
  with no budget interrupts; files verified on disk.

## v0.4.2 — 2026-08-15

Companion i18n, one-click dispatch confirmation, and executor correctness fixes.

### Added

- Separate Chinese and English companion UI with a language switcher in the
  panel and popup, backed by a dedicated i18n module.
- A one-click Confirm dispatch button in the panel that appears when an
  envelope is staged; chat confirm words remain available as a fallback.
- An auto profile option that resolves economy/balanced/deep from the
  objective's difficulty.
- Executor display names (OpenCodex, DeepSeek Harness) grouped in the UI into
  third-party agents and model endpoints.
- The controller prompt lists the executor catalog, per-executor model names,
  and forbids fabricated `<ACP_RESULT>` envelopes.
- Model allowlists for model-endpoint executors, validated at dispatch time.
- Executor discovery refresh every 60 seconds so endpoints started after the
  server become available without a restart.
- Executor display names and aliases resolve to registered ids before dispatch.
- Submitted composer text captured at page load as a confirm-word source.
- E2E validation records for DeepSeek Harness, OpenCodex, and the Codex quota
  limit in `docs/WEB-AI-E2E-VALIDATION-TEMPLATE.md`.

### Fixed

- The panel rendered nothing on initialization.
- The i18n module was missing from `web_accessible_resources`.
- Send capture registered lazily and missed the first confirm word.
- Stale executor discovery cache after starting the OpenCodex proxy.
- Web AI envelopes that carried display names for the executor field.
- Invalid model names for endpoint executors reaching the executor layer.
- Fabricated `<ACP_RESULT>` envelopes produced by the web AI.
- DeepSeek user-message selectors broadened for confirm-word detection.

### Verified

- 74 tests pass locally and on GitHub Actions CI.
- Real end-to-end runs through opencode, DeepSeek Harness, and OpenCodex
  executors, including a public ChatGPT share link in the validation table.

## v0.4.1 — 2026-08-15

Browser companion pairing, dispatch confirmation, and traceability fixes.

### Fixed

- Companion requests without an Origin header (Chrome sends none on GETs from
  extension service workers) are accepted when authenticated by a pairing
  secret or bearer token; pairing creation keeps its strict origin check.
- CORS headers are omitted for companion requests without an Origin header.
- String `context` and `constraints` fields from web AI envelopes are wrapped
  into string arrays before dispatch.
- Pairing approval now authenticates by the one-time URL secret alone, so
  approval works regardless of the Origin header spelling the browser sends.
- OpenCode session ids are captured across stderr chunk boundaries and stored
  on tasks as `executor_session_id`.

### Added

- Chinese translations for the README and all documentation, with cross-links.
- Bilingual Chinese-English labels for the companion panel, popup, pairing
  approval pages, and server error messages.
- A single confirm-word dispatch flow: envelopes are staged and dispatched only
  after the user replies with a confirmation word (执行 / 开始 / yes / 是否派发
  and others) or clicks the panel Dispatch button; new envelopes replace the
  staged one.
- Trailing modal particles are normalized in confirmation words (开始吧 matches
  开始), unrecognized replies produce a visible panel hint, and custom confirm
  words can be collected in the panel settings.
- The web AI is taught to append a staged-task line after every envelope and to
  wait quietly for `<ACP_RESULT>`.
- The controller prompt documents optional `model`, `reasoning_effort`,
  `token_budget`, and `max_subagents` fields with profile details.
- `executor_session_id` surfaces in panel status and `<ACP_RESULT>` envelopes.
- After pairing, the controller prompt is inserted into the composer
  automatically, and a missing workspace falls back to the first available
  workspace root.
- The web AI asks once for model and reasoning effort before emitting an
  envelope, supports an auto choice based on task difficulty, and reports
  rejected model names from `<ACP_RESULT>` errors back to the user.

### Verified

- 73 tests pass locally and on GitHub Actions CI.
- Real browser-driven E2E on chatgpt.com: ChatGPT emits `<ACP_TASK>`, the
  companion dispatches after the confirm word, OpenCode executes, and
  `acp-e2e-ok.txt` with exact content `ACP_WEB_AI_OK` is produced with passed
  test evidence.

## v0.4.0 — 2026-08-14

Browser companion and provider-neutral web AI control loop.

### Added

- A Manifest V3 browser companion for ChatGPT, DeepSeek, Claude, and optional
  generic HTTPS chat sites.
- One-time local pairing with extension-bound, hashed client credentials; no
  control-plane API key needs to be copied into the browser.
- Scoped companion APIs for executor/profile/workspace discovery, dispatch,
  status, follow-up, cancellation, and compact result delivery.
- `<ACP_TASK>` and `<ACP_RESULT>` envelopes for reliable bidirectional handoff
  between a web planning conversation and local engineering executors.
- Per-site automatic dispatch and result submission controls, with automatic
  result submission disabled until the user opts in.
- Browser companion protocol, pairing, origin, ownership, and manifest tests.
- `benchmark:real` script and real end-to-end comparison artifacts
  (`benchmark/real-results.json`, `benchmark/real-report.json`,
  `benchmark/real-summary.json`, and
  `docs/REAL-TOKEN-COMPARISON-RESULTS.md`) for direct versus controlled
  execution experiments.

### Security

- Pairing approval is loopback-only, short-lived, and bound to the exact browser
  extension origin.
- Paired clients can read and mutate only tasks that they created.
- Raw companion tokens are returned once and never persisted by the control
  plane; only SHA-256 token hashes are stored.

## v0.3.2 — 2026-08-14

Claude Code readiness hotfix.

### Fixed

- Distinguish an installed Claude Code CLI from an authenticated, usable
  executor.
- Mark Claude Code as `not_authenticated` and skip it during automatic routing
  when neither a Pro/Max login nor an Anthropic API key is available.
- Restore Claude Code automatically after account or API-key authentication and
  a control-plane restart.

## v0.3.1 — 2026-08-14

Windows CLI routing and failure-diagnostics hotfix.

### Fixed

- Resolve npm-generated `opencode.cmd` and `claude.cmd` shims to their trusted
  underlying executables before dispatch.
- Apply discovered executable paths to the active adapters and drop unresolved
  command names.
- Include bounded, ANSI-stripped CLI stderr in failed task errors and prevent
  duplicate terminal notifications.
- Use executor-neutral wording when a failed backend returns no final message.

## v0.3.0 — 2026-08-14

Automatic multi-executor routing and a provider-neutral MCP surface.

### Added

- Startup discovery for OpenCode, Codex, Claude Code, OpenAI-compatible local
  endpoints, and DeepSeek configuration.
- Capability/readiness metadata through `list_executors`, `/v1/executors`, and
  diagnostics.
- Per-task `executor` selection with `auto` as the zero-configuration default.
- Executor discovery and automatic fallback tests.
- Apache-2.0 licensing and project attribution through `NOTICE`.

### Changed

- OpenCode is the first automatic route when its CLI is installed; Codex,
  Claude, OpenAI-compatible, and DeepSeek routes remain available.
- MCP instructions and project documentation are provider-neutral.
- Non-Codex executors use their own configured default model unless a task
  explicitly supplies one.

## v0.2.0 — 2026-08-13

Security hardening and the multi-executor foundation.

### Added

- A generic `ExecutorAdapter` contract (`src/executors/`) with a `CodexExecutor`
  implementation, so the control plane can target other coding agents without
  changing the MCP surface.
- Benchmark reporting that compares `direct` versus `controlled` execution and
  reports token, elapsed-time, and success metrics (`src/benchmark/`,
  `docs/BENCHMARKING.md`).
- Per-request rate limiting with `Retry-After` signalling.
- An append-only audit hash chain for tamper-evident logs.
- Security response headers on the HTTP surface.
- A GitHub Actions CI workflow that runs the test suite on every push and pull
  request.

### Changed

- `main` is protected: required status checks, linear history, and no force
  pushes.

## v0.1.0 — 2026-08-13

Initial public release.

### Included

- An MCP server with eight tools: `dispatch_project`, `task_status`,
  `continue_project`, `cancel_task`, `list_tasks`, `list_profiles`,
  `list_models`, `usage_report`.
- Three execution profiles: `economy`, `balanced`, `deep`.
- A persistent Codex project thread per workspace.
- Append-only audit logging and atomic state persistence.
- Loopback-only HTTP binding with optional bearer authentication.
- Workspace allowlist enforcement and `workspace-write` sandbox defaults.
- Stateless `server/discover` support for OpenAI Secure MCP Tunnel connections.
- Measured token usage from Codex thread goals, with a hard budget interrupt.

### Changes since the first commit

- `224c1a6` — support `server/discover` for ChatGPT connectors.
- `2aa4d5d` — measure token usage and enforce the hard budget interrupt.

### Known limitations

- Single-user local scope; not approved for multi-tenant or public-Internet
  exposure.
- Token enforcement polls once per second, so a provider can consume tokens
  during one polling interval after the budget is reached.
- Platform tunnel creation, permission grants, and runtime-key provisioning are
  account-level steps that this repository does not automate.
