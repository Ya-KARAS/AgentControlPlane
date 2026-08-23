import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import {
  buildEngineeringPrompt,
  finalReportSchema,
  normalizeBrief,
} from "./brief.js";
import { ControlPlaneError, asErrorPayload } from "./errors.js";
import { resolveProfile, resolveEndpointModel, estimateTaskMinutes } from "./profiles.js";
import { resolveWorkspace } from "./workspace.js";
import { discoverExecutors } from "../executors/discovery.js";
import { resolvePreset } from "../executors/provider-presets.js";
import {
  extractTaskRequirements,
  normalizeCandidate,
  recommendModels,
  normalizePricing,
  computeCostRange,
} from "./recommend.js";
import { extractTokenEstimate } from "./token-estimate.js";
import { createUsageEvent } from "./usage-events.js";
import { reconcileUsage } from "./usage-dimensions.js";
import { reconcileClientFor } from "./reconcile-client.js";
import {
  classifyExecutorFailure,
  evaluateExecutorCompatibility,
  snapshotExecutorCapabilities,
} from "./reroute.js";

function zeroUsage() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    uncached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
}

function marginalTokens(usage) {
  return (
    Number(usage?.uncached_input_tokens ?? usage?.input_tokens ?? 0) +
    Number(usage?.output_tokens ?? 0) +
    Number(usage?.reasoning_output_tokens ?? 0)
  );
}

function mapUsage(tokenUsage) {
  const source = tokenUsage?.last ?? tokenUsage?.total;
  if (!source) return zeroUsage();
  const inputTokens = Number(source.inputTokens ?? 0);
  const cachedInputTokens = Number(source.cachedInputTokens ?? 0);
  // Codex reports input including cached reads; opencode reports marginal
  // input with cache reads reported separately. When cached exceeds input,
  // the input figure already excludes cached reads.
  const uncachedInputTokens =
    cachedInputTokens > inputTokens
      ? inputTokens
      : Math.max(0, inputTokens - cachedInputTokens);
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    uncached_input_tokens: uncachedInputTokens,
    output_tokens: Number(source.outputTokens ?? 0),
    reasoning_output_tokens: Number(source.reasoningOutputTokens ?? 0),
    total_tokens: Number(source.totalTokens ?? 0),
  };
}

function mapGoalUsage(goal, currentUsage = null) {
  const totalTokens = Math.max(0, Number(goal?.tokensUsed ?? 0));
  return {
    ...(currentUsage ?? zeroUsage()),
    total_tokens: Math.max(
      totalTokens,
      Number(currentUsage?.total_tokens ?? 0),
    ),
  };
}

function normalizeIdempotencyKey(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new ControlPlaneError(
      "invalid_idempotency_key",
      "idempotency_key must be a string",
    );
  }
  const key = value.trim();
  if (key.length < 8 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new ControlPlaneError(
      "invalid_idempotency_key",
      "idempotency_key must contain 8-200 letters, digits, dots, underscores, colons, or hyphens",
    );
  }
  return key;
}

function dispatchFingerprint(request, workspace, brief) {
  const payload = {
    workspace,
    brief,
    executor: request.executor ?? "auto",
    profile: request.profile ?? "balanced",
    model: request.model ?? null,
    reasoning_effort: request.reasoning_effort ?? null,
    max_subagents: request.max_subagents ?? null,
    token_budget: request.token_budget ?? null,
    time_limit_minutes: request.time_limit_minutes ?? null,
    allowed_models: request.allowed_models ?? null,
    kind: request.kind ?? "production",
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function continuationTestEvidence(tests = []) {
  return (Array.isArray(tests) ? tests : []).map((entry) => {
    if (entry && typeof entry === "object") {
      return {
        command: String(entry.command ?? entry.name ?? "unknown"),
        status: entry.status === "passed" ? "passed" : "failed",
      };
    }
    const command = String(entry);
    return {
      command,
      status: /\b(pass|passed|ok)\b/i.test(command) ? "passed" : "failed",
    };
  });
}

function buildContinuationPackage(task, rerouteReason, error = null) {
  const result = task.result ?? {};
  const errorPayload = error ? asErrorPayload(error) : task.error;
  return {
    version: 1,
    logical_task_id: task.logical_task_id ?? task.id,
    objective: task.brief?.objective ?? "",
    current_state: ["partial", "blocked"].includes(task.status)
      ? task.status
      : "running",
    completed_steps: Array.isArray(result.completed_steps)
      ? structuredClone(result.completed_steps)
      : [],
    remaining_steps: Array.isArray(result.remaining_steps)
      ? structuredClone(result.remaining_steps)
      : structuredClone(task.brief?.acceptance_criteria ?? []),
    changed_files: structuredClone(result.changed_files ?? []),
    test_evidence: continuationTestEvidence(result.tests),
    decisions: structuredClone(result.decisions ?? []),
    constraints: structuredClone(task.brief?.constraints ?? []),
    known_failures: errorPayload?.message ? [errorPayload.message] : [],
    previous_executor: task.executor,
    reroute_reason: rerouteReason,
    next_action: result.next_action ?? null,
  };
}

function extractReport(turn, cachedFinalMessage = null) {
  const messages = (turn?.items ?? []).filter(
    (item) => item.type === "agentMessage" && typeof item.text === "string",
  );
  const preferred =
    messages.findLast((item) => item.phase === "final_answer") ?? messages.at(-1);
  const finalText = preferred?.text ?? cachedFinalMessage;
  if (!finalText) {
    const turnError =
      turn?.error?.message ??
      turn?.error?.error?.message ??
      turn?.error?.error?.message?.message;
    const summary =
      typeof turnError === "string" && turnError
        ? turnError
        : "Executor completed without a final agent message.";
    return {
      status: turn?.status === "completed" ? "completed" : "failed",
      summary,
      changed_files: [],
      tests: [],
      blockers: [],
      next_action: null,
    };
  }
  try {
    const parsed = JSON.parse(finalText);
    const normalizedSummary = String(parsed.summary ?? "").toLowerCase();
    if (
      parsed.status === "completed" &&
      (normalizedSummary.includes("status: blocked") ||
        normalizedSummary.includes("could not") ||
        normalizedSummary.includes("unable to") ||
        (Array.isArray(parsed.blockers) && parsed.blockers.length > 0))
    ) {
      parsed.status = "blocked";
    }
    return parsed;
  } catch {
    const normalized = finalText.toLowerCase();
    const status = normalized.includes("status: blocked")
      ? "blocked"
      : normalized.includes("status: failed")
        ? "failed"
        : normalized.includes("status: partial")
          ? "partial"
          : turn?.status === "completed"
            ? "completed"
            : "failed";
    return {
      status,
      summary: finalText,
      changed_files: [],
      tests: [],
      blockers: status === "blocked" ? [finalText] : [],
      next_action: null,
    };
  }
}

export class Orchestrator extends EventEmitter {
  constructor({
    config,
    store,
    codex = null,
    executors = null,
    defaultProvider = null,
    projectRegistry = null,
  }) {
    super();
    this.config = config;
    this.store = store;
    this.executors =
      executors ?? new Map([[defaultProvider ?? "codex", codex]]);
    this.defaultProvider = defaultProvider ?? config?.executor?.provider ?? "auto";
    this.projectRegistry = projectRegistry;
    this.primaryProvider = null;
    this.executorDiscovery = {};
    this.running = new Map();
    this.queue = [];
    this.modelCatalog = [];
    this.modelCatalogs = new Map();
    this.modelCatalogUpdatedAt = new Map();
    this.runtimeHealth = {
      windowsSandbox: process.platform === "win32" ? "unknown" : "not_applicable",
    };
    for (const executor of this.executors.values()) {
      executor.on("notification", (message) =>
        this.#onNotification(message, executor),
      );
      executor.on("serverRequest", (message) =>
        this.#onServerRequest(message, executor),
      );
      executor.on("stderr", (text) =>
        this.emit("diagnostic", { source: executor.id ?? "executor", text }),
      );
    }
  }

  #orderedProviders(profileName = null) {
    const profileOrder = profileName
      ? this.config.executor?.routing?.profiles?.[profileName]
      : null;
    const configured = profileOrder ?? this.config.executor?.routing?.order ?? [];
    return [...new Set([...configured, ...this.executors.keys()])];
  }

  #executorEntry(task = {}) {
    const requested = task.executor ?? this.defaultProvider;
    const order = this.#orderedProviders(task.profile ?? task.policy?.name);
    const provider =
      requested === "auto"
        ? order.find(
            (id) =>
              this.executors.has(id) &&
              this.executorDiscovery[id]?.available !== false &&
              this.executorDiscovery[id]?.status !== "degraded",
          ) ??
          order.find(
            (id) =>
              this.executors.has(id) &&
              this.executorDiscovery[id]?.available !== false,
          )
        : requested;
    if (!provider) {
      throw new ControlPlaneError(
        "no_executor_available",
        "No configured engineering executor is available",
        { executors: this.getExecutors() },
      );
    }
    const executor = this.executors.get(provider);
    if (!executor) {
      throw new ControlPlaneError(
        "unknown_executor",
        `Unknown executor: ${provider}`,
        { available: [...this.executors.keys()] },
      );
    }
    const discovery = this.executorDiscovery[provider];
    if (discovery?.available === false) {
      throw new ControlPlaneError(
        "executor_unavailable",
        `Executor is not available: ${provider}`,
        { executor: provider, discovery },
      );
    }
    return { id: provider, executor };
  }

  #executorFor(task) {
    return this.#executorEntry(task).executor;
  }

  async start() {
    this.executorDiscovery = await discoverExecutors(this.executors);
    const { id, executor: primary } = this.#executorEntry({});
    this.primaryProvider = id;
    await primary.start();
    await Promise.all(
      [...this.executors.entries()]
        .filter(
          ([executorId]) =>
            executorId !== id &&
            this.executorDiscovery[executorId]?.available !== false,
        )
        .map(async ([executorId, executor]) => {
          try {
            await executor.start();
          } catch (error) {
            await Promise.resolve(executor.stop()).catch(() => {});
            this.executorDiscovery[executorId] = {
              ...(this.executorDiscovery[executorId] ?? {}),
              status: "degraded",
              reason: "start_failed",
              detail: error.message,
            };
            this.emit("diagnostic", {
              source: `${executorId}-start`,
              text: error.message,
            });
          }
        }),
    );
    await this.#refreshModelCatalogs();
    this.modelCatalog = this.modelCatalogs.get(id) ?? [];
    if (process.platform === "win32" && primary.requiresWindowsSandbox) {
      try {
        const readiness = await primary.getSandboxReadiness({});
        this.runtimeHealth.windowsSandbox = readiness.status;
      } catch (error) {
        this.runtimeHealth.windowsSandbox = "unknown";
        this.emit("diagnostic", {
          source: "windows-sandbox",
          text: error.message,
        });
      }
    } else if (process.platform === "win32") {
      this.runtimeHealth.windowsSandbox = "not_required";
    }
    this.runtimeHealth.defaultExecutor = id;
    this.runtimeHealth.executors = structuredClone(this.executorDiscovery);
    await this.#recoverInterruptedTasks();
    const refreshMs = Number(
      this.config.limits?.discoveryRefreshMs ?? 60000,
    );
    if (refreshMs > 0 && !this.discoveryTimer) {
      this.discoveryTimer = setInterval(() => {
        this.#refreshDiscovery().catch((error) => {
          this.emit("diagnostic", {
            source: "discovery-refresh",
            text: error.message,
          });
        });
      }, refreshMs);
      this.discoveryTimer.unref?.();
    }
    const reconcileMinutes = Number(
      this.config.reconciliation?.intervalMinutes ?? 0,
    );
    if (reconcileMinutes > 0 && !this.reconcileTimer) {
      this.reconcileTimer = setInterval(() => {
        this.reconcileNow().catch((error) => {
          this.emit("diagnostic", {
            source: "reconcile",
            text: error.message,
          });
        });
      }, reconcileMinutes * 60 * 1000);
      this.reconcileTimer.unref?.();
    }
  }

  async #refreshDiscovery() {
    const next = await discoverExecutors(this.executors);
    this.executorDiscovery = next;
    this.runtimeHealth.executors = structuredClone(next);
    await this.#refreshModelCatalogs();
  }

  async #refreshModelCatalogs() {
    for (const [id, executor] of this.executors) {
      if (typeof executor.listModels !== "function") continue;
      try {
        const models = await executor.listModels({
          limit: 200,
          includeHidden: false,
        });
        this.modelCatalogs.set(id, models.data ?? []);
        this.modelCatalogUpdatedAt.set(id, Date.now());
      } catch (error) {
        this.emit("diagnostic", { source: `${id}-models`, text: error.message });
      }
    }
  }

  recommend(request = {}) {    const requirements = extractTaskRequirements(
      {
        objective: request.objective,
        profile: request.profile,
        reasoning_effort: request.reasoning_effort ?? null,
        allowed_models: request.allowed_models ?? null,
        model: request.model ?? null,
      },
      this.config,
    );
    const wantedExecutor =
      typeof request.executor === "string" &&
      request.executor &&
      request.executor !== "auto"
        ? request.executor
        : null;
    const candidates = [];
    for (const [executorId, executor] of this.executors) {
      if (executor.kind !== "model-endpoint") continue;
      if (wantedExecutor && executorId !== wantedExecutor) continue;
      const catalog = this.modelCatalogs.get(executorId) ?? [];
      const fetchedAt = this.modelCatalogUpdatedAt.get(executorId) ?? Date.now();
      const freshness = Math.max(
        0,
        Math.round((Date.now() - fetchedAt) / 1000),
      );
      for (const model of catalog) {
        candidates.push(
          normalizeCandidate(executorId, {
            ...model,
            metadata_freshness_seconds: freshness,
          }),
        );
      }
    }
    return recommendModels({ candidates, requirements, config: this.config });
  }

  async reconcileNow() {
    const results = [];
    for (const [executorId, executor] of this.executors) {
      if (executor.kind !== "model-endpoint") continue;
      const relayConfigRaw = (this.config.executor?.relays ?? []).find(
        (relay) => relay.id === executorId,
      );
      // apiKeyEnv/apiKey come from the preset (e.g. ASTERROUTE_API_KEY);
      // merge it the same way buildExecutors does before building the client.
      const preset = relayConfigRaw?.preset
        ? resolvePreset(relayConfigRaw.preset)
        : null;
      const relayConfig = { ...(preset ?? {}), ...(relayConfigRaw ?? {}) };
      const { client, error } = reconcileClientFor({
        relayConfig,
        executorBaseUrl: executor.baseUrl,
      });
      if (!client) {
        if (error) {
          this.emit("diagnostic", {
            source: `reconcile-${executorId}`,
            text: error,
          });
        }
        continue;
      }
      const reconciledIds = new Set(
        this.store
          .listReconciliations()
          .map((entry) => entry.asterroute_request_id ?? entry.request_id),
      );
      const pending = [];
      const seen = new Set();
      for (const event of this.store.listUsageEvents({ limit: 100000 }).events) {
        const id = event.asterroute_request_id;
        if (!id || reconciledIds.has(id) || seen.has(id)) continue;
        seen.add(id);
        pending.push(id);
      }
      const { rows, error: lookupError } = await client.lookup(pending);
      if (lookupError) {
        this.emit("diagnostic", {
          source: `reconcile-${executorId}`,
          text: lookupError,
        });
        continue;
      }
      const { statuses, applied } = reconcileUsage(this.store, rows);
      results.push({ executor: executorId, statuses, applied });
    }
    return results;
  }

  getModels(executorId = null) {
    const selected =
      !executorId || executorId === "auto"
        ? this.primaryProvider
        : executorId;
    return structuredClone(this.modelCatalogs.get(selected) ?? []);
  }

  getExecutors() {
    return [...this.executors.entries()].map(([id, executor]) => ({
      ...(typeof executor.describe === "function"
        ? executor.describe()
        : {
            id,
            display_name: executor.displayName ?? id,
            ready: Boolean(executor.ready),
            discovery: structuredClone(this.executorDiscovery[id] ?? {}),
            capabilities: structuredClone(executor.capabilities ?? {}),
          }),
      id,
      selected: id === this.primaryProvider,
    }));
  }

  getDefaultExecutorId() {
    return this.primaryProvider;
  }

  getRuntimeHealth() {
    return structuredClone(this.runtimeHealth);
  }

  #policyForExecutor(task, executorId) {
    const executor = this.executors.get(executorId);
    const catalog = this.modelCatalogs.get(executorId) ?? [];
    const policy = structuredClone(task.policy);
    const currentModel = policy.model;
    const currentSupported = catalog.some(
      (entry) => (entry.model ?? entry.id) === currentModel,
    );
    if (executor?.kind === "model-endpoint") {
      const defaultEntry =
        catalog.find((entry) => entry.isDefault) ?? catalog[0] ?? null;
      policy.model = currentSupported
        ? currentModel
        : defaultEntry?.model ?? defaultEntry?.id ?? executor.model ?? null;
    } else if (executorId !== "codex") {
      policy.model = null;
    }
    return policy;
  }

  #capabilitiesFor(executorId, policy) {
    return snapshotExecutorCapabilities(this.executors.get(executorId), {
      catalog: this.modelCatalogs.get(executorId) ?? [],
      model: policy?.model ?? null,
      discovery: this.executorDiscovery[executorId] ?? null,
    });
  }

  #updateCurrentExecutorHistory(taskId, patch) {
    const task = this.store.getTask(taskId);
    if (!task) return null;
    const history = structuredClone(task.executor_history ?? []);
    if (history.length === 0) return task;
    history[history.length - 1] = {
      ...history[history.length - 1],
      ...patch,
    };
    return this.store.updateTask(taskId, { executor_history: history });
  }

  #selectRerouteCandidate(task) {
    const candidates = [];
    for (const executorId of this.#orderedProviders(task.policy?.name)) {
      if (executorId === task.executor || !this.executors.has(executorId)) {
        continue;
      }
      const discovery = this.executorDiscovery[executorId];
      if (discovery?.available === false) {
        candidates.push({
          executor: executorId,
          compatible: false,
          reasons: ["executor_unavailable"],
          warnings: [],
        });
        continue;
      }
      const policy = this.#policyForExecutor(task, executorId);
      const capabilities = this.#capabilitiesFor(executorId, policy);
      const compatibility = evaluateExecutorCompatibility(
        task.capability_requirements ?? {},
        capabilities,
      );
      const candidate = {
        executor: executorId,
        policy,
        capabilities,
        ...compatibility,
      };
      candidates.push(candidate);
      if (candidate.compatible) return { candidate, candidates };
    }
    return { candidate: null, candidates };
  }

  #attemptReroute(taskId, error, context = {}) {
    const task = this.store.getTask(taskId, true);
    const reroute = this.config.executor?.reroute;
    if (!task || reroute?.enabled !== true) return false;
    const reason = classifyExecutorFailure(error, context);
    if (
      reason === "task_failure" ||
      !(reroute.allowed_reasons ?? []).includes(reason)
    ) {
      return false;
    }

    const history = structuredClone(task.executor_history ?? []);
    const reroutesUsed = Math.max(0, history.length - 1);
    const continuation = buildContinuationPackage(task, reason, error);
    if (reroutesUsed >= Number(reroute.max_reroutes ?? 2)) {
      this.store.updateTask(taskId, {
        status: "blocked",
        continuation,
        reroute_reason: reason,
        error: {
          code: "reroute_limit_reached",
          message: `The logical task reached its reroute limit of ${reroute.max_reroutes}.`,
          details: { reason, reroutes_used: reroutesUsed },
        },
        completedAt: new Date().toISOString(),
      });
      this.store.addEvent(taskId, {
        type: "task.reroute_blocked",
        reason,
        blocker: "reroute_limit_reached",
      });
      this.#finishActiveTask(taskId);
      return true;
    }

    const { candidate, candidates } = this.#selectRerouteCandidate(task);
    if (!candidate) {
      this.store.updateTask(taskId, {
        status: "blocked",
        continuation,
        reroute_reason: reason,
        error: {
          code: "no_compatible_executor",
          message: "No compatible executor is available for continuation.",
          details: {
            reason,
            candidates: candidates.map((entry) => ({
              executor: entry.executor,
              reasons: entry.reasons,
              warnings: entry.warnings,
            })),
          },
        },
        completedAt: new Date().toISOString(),
      });
      this.store.addEvent(taskId, {
        type: "task.reroute_blocked",
        reason,
        blocker: "no_compatible_executor",
      });
      this.#finishActiveTask(taskId);
      return true;
    }

    const changedAt = new Date().toISOString();
    if (history.length > 0) {
      history[history.length - 1] = {
        ...history[history.length - 1],
        ended_at: changedAt,
        ended_reason: reason,
        thread_id: task.threadId ?? history.at(-1)?.thread_id ?? null,
        turn_id: task.turnId ?? history.at(-1)?.turn_id ?? null,
        usage: structuredClone(task.usage ?? history.at(-1)?.usage ?? zeroUsage()),
      };
    }
    history.push({
      executor: candidate.executor,
      started_at: changedAt,
      ended_at: null,
      ended_reason: null,
      thread_id: null,
      turn_id: null,
      attempts: 1,
      usage: zeroUsage(),
    });
    this.store.updateTask(taskId, {
      status: "queued",
      executor: candidate.executor,
      policy: candidate.policy,
      executor_history: history,
      continuation,
      reroute_reason: reason,
      executor_capabilities: candidate.capabilities,
      threadId: null,
      turnId: null,
      executorSessionId: null,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      usage: null,
    });
    this.store.addEvent(taskId, {
      type: "task.rerouted",
      from: task.executor,
      to: candidate.executor,
      reason,
      warnings: candidate.warnings,
    });
    this.queue.push({ taskId, followUp: true, rerouted: true });
    this.#finishActiveTask(taskId);
    return true;
  }

  dispatch(request) {
    if (request.project_id && !this.projectRegistry) {
      throw new ControlPlaneError(
        "project_registry_unavailable",
        "A project id was supplied but the local project registry is unavailable",
      );
    }
    const project = this.projectRegistry?.resolve(
      request.project_id ?? request.workspace,
    );
    if (
      !project &&
      (request.project_id || String(request.workspace ?? "").startsWith("project:"))
    ) {
      throw new ControlPlaneError(
        "project_not_found",
        "The selected project id is not registered on this device",
      );
    }
    if (
      project &&
      request.project_path_revision != null &&
      Number(request.project_path_revision) !== project.pathRevision
    ) {
      throw new ControlPlaneError(
        "project_revision_conflict",
        "The selected project moved after it was approved; refresh and confirm again",
        {
          project_id: project.projectId,
          approved_revision: Number(request.project_path_revision),
          current_revision: project.pathRevision,
        },
      );
    }
    const workspace = project?.workspace ?? resolveWorkspace(
      request.workspace,
      this.config.workspaceRoots,
    );
    const brief = normalizeBrief(
      request,
      this.config.limits.maxBriefCharacters,
    );
    const idempotencyKey = normalizeIdempotencyKey(request.idempotency_key);
    const requestFingerprint = idempotencyKey
      ? dispatchFingerprint(request, workspace, brief)
      : null;
    if (idempotencyKey) {
      const existing = this.store.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.request_fingerprint !== requestFingerprint) {
          throw new ControlPlaneError(
            "idempotency_conflict",
            "The idempotency key is already associated with a different dispatch request",
            { task_id: existing.id },
          );
        }
        return existing;
      }
    }
    this.#assertQueueCapacity();
    const { id: provider } = this.#executorEntry({
      executor: request.executor ?? this.defaultProvider,
      profile: request.profile,
    });
    const catalog = this.modelCatalogs.get(provider) ?? [];
    const policy = resolveProfile(this.config, request, catalog);
    if (provider !== "codex" && !request.model) policy.model = null;
    if (request.model) {
      const executor = this.executors.get(provider);
      if (executor?.kind === "model-endpoint") {
        const endpointKey =
          provider === "deepseek" ? "deepseek" : "openaiCompat";
        const configModels = this.config.executor?.[endpointKey]?.models;
        const liveCatalog = this.modelCatalogs.get(provider) ?? [];
        const allowed =
          liveCatalog.length > 0
            ? liveCatalog.map((model) => model.model ?? model.id)
            : executor?.staticModels ?? configModels ?? [];
        resolveEndpointModel(provider, request.model, allowed);
      }
    }
    let recommendation = null;
    try {
      recommendation = this.recommend({
        objective: brief.objective,
        profile: policy.name,
        reasoning_effort: policy.effort ?? null,
        allowed_models: request.allowed_models ?? null,
        model: request.model ?? null,
        executor: provider,
      });
      recommendation.selected_model = policy.model ?? null;
    } catch (error) {
      this.emit("diagnostic", {
        source: "recommendation",
        text: error.message,
      });
    }
    const capabilityRequirements =
      recommendation?.requirements ??
      extractTaskRequirements(
        {
          objective: brief.objective,
          profile: policy.name,
          reasoning_effort: policy.effort ?? null,
          allowed_models: request.allowed_models ?? null,
          model: policy.model ?? null,
        },
        this.config,
      );
    const selectedExecutor = this.executors.get(provider);
    const executorCapabilities = snapshotExecutorCapabilities(selectedExecutor, {
      catalog,
      model: policy.model ?? null,
      discovery: this.executorDiscovery[provider] ?? null,
    });
    const task = this.store.createTask({
      workspace,
      brief,
      policy,
      executor: provider,
      estimatedMinutes: estimateTaskMinutes(
        policy.name,
        policy.timeLimitMinutes,
      ),
      recommendation,
      kind: request.kind ?? "production",
      capabilityRequirements,
      executorCapabilities,
      idempotencyKey,
      requestFingerprint,
      projectId: project?.projectId ?? null,
      projectPathRevision: project?.pathRevision ?? null,
    });
    this.queue.push({ taskId: task.id, followUp: false });
    queueMicrotask(() => this.#drain());
    return task;
  }

  continueTask(taskId, request) {
    this.#assertQueueCapacity();
    const parent = this.store.getTask(taskId);
    if (!parent) {
      throw new ControlPlaneError("task_not_found", `Unknown task: ${taskId}`);
    }
    const requestedExecutor =
      request.executor ?? parent.executor ?? this.defaultProvider;
    const { id: provider } = this.#executorEntry({
      executor: requestedExecutor,
      profile: request.profile ?? parent.policy.name,
    });
    const executorChanged = provider !== parent.executor;
    const project = parent.project_id
      ? this.projectRegistry?.resolve(parent.project_id)
      : null;
    const workspace = project?.workspace ?? parent.workspace;
    const workspaceRelinked = Boolean(
      project &&
      (project.pathRevision !== parent.project_path_revision ||
        project.workspace.toLowerCase() !== parent.workspace.toLowerCase()),
    );
    const sessionChanged = executorChanged || workspaceRelinked;
    if (!parent.threadId && !executorChanged) {
      throw new ControlPlaneError(
        "task_not_started",
        "The original task has no active executor session yet",
      );
    }
    const brief = normalizeBrief(
      {
        objective: request.objective,
        constraints: request.constraints,
        acceptance_criteria: request.acceptance_criteria,
        context: request.context,
        evidence_required: request.evidence_required,
      },
      this.config.limits.maxBriefCharacters,
    );
    const policy = resolveProfile(
      this.config,
      {
        profile: request.profile ?? parent.policy.name,
        model: request.model,
        reasoning_effort: request.reasoning_effort,
        max_subagents: request.max_subagents,
        token_budget: request.token_budget,
      },
      this.modelCatalogs.get(provider) ?? [],
    );
    if (provider !== "codex" && !request.model) policy.model = null;
    const capabilityRequirements = extractTaskRequirements(
      {
        objective: brief.objective,
        profile: policy.name,
        reasoning_effort: policy.effort ?? null,
        model: policy.model ?? null,
      },
      this.config,
    );
    const selectedExecutor = this.executors.get(provider);
    const executorCapabilities = snapshotExecutorCapabilities(selectedExecutor, {
      catalog: this.modelCatalogs.get(provider) ?? [],
      model: policy.model ?? null,
      discovery: this.executorDiscovery[provider] ?? null,
    });
    const compatibility = evaluateExecutorCompatibility(
      capabilityRequirements,
      executorCapabilities,
    );
    if (executorChanged && !compatibility.compatible) {
      throw new ControlPlaneError(
        "incompatible_executor",
        `Executor ${provider} cannot continue this task`,
        {
          executor: provider,
          reasons: compatibility.reasons,
          warnings: compatibility.warnings,
        },
      );
    }
    const rerouteReason = executorChanged
      ? parent.reroute_reason ?? null
      : null;
    const continuation = sessionChanged
      ? buildContinuationPackage(parent, rerouteReason, parent.error)
      : null;
    if (continuation && workspaceRelinked) {
      continuation.workspace_relinked = true;
      continuation.previous_path_revision = parent.project_path_revision ?? null;
      continuation.current_path_revision = project.pathRevision;
    }
    const history = structuredClone(parent.executor_history ?? []);
    if (sessionChanged) {
      const changedAt = new Date().toISOString();
      if (history.length > 0 && history.at(-1).ended_at == null) {
        history[history.length - 1] = {
          ...history.at(-1),
          ended_at: changedAt,
          ended_reason: rerouteReason,
          thread_id: parent.threadId ?? history.at(-1).thread_id ?? null,
          turn_id: parent.turnId ?? history.at(-1).turn_id ?? null,
          usage: structuredClone(parent.usage ?? history.at(-1).usage ?? zeroUsage()),
        };
      }
      history.push({
        executor: provider,
        started_at: changedAt,
        ended_at: null,
        ended_reason: null,
        thread_id: null,
        turn_id: null,
        attempts: 1,
        usage: zeroUsage(),
      });
    }
    const task = this.store.createTask({
      workspace,
      brief,
      policy,
      parentTaskId: parent.id,
      executor: provider,
      logicalTaskId: parent.logical_task_id ?? parent.id,
      executorHistory: history,
      continuation,
      rerouteReason,
      capabilityRequirements,
      executorCapabilities,
      projectId: project?.projectId ?? parent.project_id ?? null,
      projectPathRevision:
        project?.pathRevision ?? parent.project_path_revision ?? null,
      workspaceRelinked,
    });
    if (!sessionChanged) {
      this.store.updateTask(task.id, { threadId: parent.threadId });
    }
    if (workspaceRelinked) {
      this.store.addEvent(task.id, {
        type: "workspace.relinked",
        project_id: project.projectId,
        previous_path_revision: parent.project_path_revision ?? null,
        current_path_revision: project.pathRevision,
      });
    }
    this.queue.push({ taskId: task.id, followUp: true });
    queueMicrotask(() => this.#drain());
    return this.store.getTask(task.id);
  }

  async cancel(taskId) {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new ControlPlaneError("task_not_found", `Unknown task: ${taskId}`);
    }
    if (["completed", "partial", "blocked", "failed", "cancelled"].includes(task.status)) {
      return task;
    }
    this.queue = this.queue.filter((entry) => entry.taskId !== taskId);
    const active = this.running.get(taskId);
    if (task.threadId && task.turnId && active) {
      try {
        await this.#executorFor(task).interruptTurn({
          threadId: task.threadId,
          turnId: task.turnId,
        });
      } catch (error) {
        this.store.addEvent(taskId, {
          type: "task.cancel_interrupt_failed",
          error: asErrorPayload(error),
        });
      }
    }
    this.store.updateTask(taskId, {
      status: "cancelled",
      completedAt: new Date().toISOString(),
    });
    this.store.audit("task.cancelled", {
      taskId,
      previousStatus: task.status,
      threadId: task.threadId,
      turnId: task.turnId,
    });
    this.#finishActiveTask(taskId);
    return this.store.getTask(taskId);
  }

  async #drain() {
    const limit = this.config.limits.maxConcurrentTasks;
    while (this.running.size < limit && this.queue.length) {
      const activeWorkspaces = new Set(
        [...this.running.values()].map((entry) => entry.workspace),
      );
      const index = this.queue.findIndex((entry) => {
        const task = this.store.getTask(entry.taskId);
        return task && !activeWorkspaces.has(task.workspace);
      });
      if (index === -1) break;
      const [queued] = this.queue.splice(index, 1);
      const task = this.store.getTask(queued.taskId);
      if (!task || task.status !== "queued") continue;
      this.running.set(queued.taskId, {
        ...queued,
        workspace: task.workspace,
        turnId: null,
      });
      this.#run(queued.taskId, queued.followUp).finally(() => {
        this.#finishActiveTask(queued.taskId);
        this.running.delete(queued.taskId);
        queueMicrotask(() => this.#drain());
      });
    }
  }

  async #run(taskId, followUp) {
    const task = this.store.getTask(taskId, true);
    if (!task || task.status !== "queued") return;
    try {
      const registryProject = task.project_id
        ? this.projectRegistry?.resolve(task.project_id)
        : null;
      if (
        registryProject &&
        (registryProject.pathRevision !== task.project_path_revision ||
          registryProject.workspace.toLowerCase() !== task.workspace.toLowerCase())
      ) {
        throw new ControlPlaneError(
          "project_revision_conflict",
          "The project moved after this task was staged; create a continuation after relinking",
          {
            project_id: registryProject.projectId,
            staged_revision: task.project_path_revision,
            current_revision: registryProject.pathRevision,
          },
        );
      }
      const workspace = registryProject?.workspace ?? resolveWorkspace(
        task.workspace,
        this.config.workspaceRoots,
      );
      const executor = this.#executorFor(task);
      this.store.updateTask(taskId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (!executor.ready) {
        await executor.start();
      }
      if (executor.requiresWindowsSandbox && process.platform === "win32") {
        const readiness = await executor.getSandboxReadiness({});
        if (readiness.status !== "ready") {
          throw new ControlPlaneError(
            "windows_sandbox_not_ready",
            "Codex Windows sandbox is not configured. Run npm run sandbox:setup before dispatching engineering work.",
            { status: readiness.status },
          );
        }
      }
      const projectKey = task.project_id ?? task.workspace;
      const project = this.store.getProject(projectKey);
      const reusableProjectThread =
        !task.continuation &&
        (!task.project_id || project?.pathRevision === task.project_path_revision) &&
        (!project?.executor || project.executor === task.executor)
          ? project?.threadId ?? null
          : null;
      let threadId = task.threadId ?? reusableProjectThread;

      if (threadId) {
        try {
          await executor.resumeThread({
            threadId,
            historyMode: "paginated",
          });
        } catch (error) {
          this.store.addEvent(taskId, {
            type: "thread.resume_failed",
            error: asErrorPayload(error),
          });
          threadId = null;
        }
      }

      if (!threadId) {
        const started = await executor.startThread({
          cwd: workspace,
          model: task.policy.model,
          approvalPolicy: this.config.codex.approvalPolicy,
          approvalsReviewer: "user",
          sandbox: this.config.codex.sandbox,
          runtimeWorkspaceRoots: [workspace],
          historyMode: "paginated",
          baseInstructions:
            "You are a secure software engineering execution agent. Work only inside the provided workspace. Use tools efficiently, verify changes, and return a concise final report.",
          developerInstructions:
            "You are the engineering execution agent. Follow the compact brief, minimize duplicated context, use subagents only within the supplied policy, verify work, and return a compact final report.",
          config: {
            agents: {
              max_threads: Math.max(1, task.policy.maxSubagents + 1),
            },
            sandbox_workspace_write: {
              network_access: Boolean(this.config.codex.networkAccess),
            },
          },
        });
        threadId = started.thread.id;
        this.store.setProject(projectKey, {
          threadId,
          executor: task.executor,
          pathRevision: task.project_path_revision ?? null,
        });
      }

      this.store.updateTask(taskId, { threadId });
      this.#updateCurrentExecutorHistory(taskId, { thread_id: threadId });
      await executor.setGoal({
        threadId,
        objective: task.brief.objective,
        status: "active",
        tokenBudget: task.policy.tokenBudget,
      });

      const response = await executor.startTurn({
        threadId,
        input: [
          {
            type: "text",
            text:
              buildEngineeringPrompt(task.brief, task.policy, followUp) +
              (task.continuation
                ? `\n\nContinuation package (structured):\n${JSON.stringify(task.continuation)}`
                : ""),
          },
        ],
        model: task.policy.model,
        effort: task.policy.effort,
        summary: task.policy.summary,
        cwd: workspace,
        runtimeWorkspaceRoots: [workspace],
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [workspace],
          networkAccess: Boolean(this.config.codex.networkAccess),
        },
        approvalPolicy: this.config.codex.approvalPolicy,
        outputSchema: finalReportSchema,
        ...(executor.kind === "model-endpoint"
          ? {
              attribution: {
                taskId,
                workspace,
                taskKind: task.kind ?? "production",
                requestedModel: task.policy?.model ?? null,
                recommendationId:
                  task.recommendation?.recommendation_id ?? null,
              },
            }
          : {}),
        responsesapiClientMetadata: {
          control_plane: "agent-control-plane",
          task_id: taskId,
          profile: task.policy.name,
        },
      });

      const turnId = response.turn.id;
      const latestTask = this.store.getTask(taskId);
      if (latestTask?.status === "cancelled") {
        await executor.interruptTurn({
          threadId,
          turnId,
        });
        return;
      }
      const active = this.running.get(taskId);
      if (active) {
        active.turnId = turnId;
        const pendingUsage = active.pendingUsage?.get(turnId);
        if (pendingUsage) {
          this.store.updateTask(taskId, { usage: mapUsage(pendingUsage) });
        }
        active.pendingUsage = null;
      }
      this.store.updateTask(taskId, { turnId });
      this.#updateCurrentExecutorHistory(taskId, { turn_id: turnId });
      this.store.addEvent(taskId, {
        method: "turn/started",
        threadId,
        turnId,
      });
      this.#startBudgetMonitor(taskId);
      await this.#waitForTerminalNotification(taskId);
    } catch (error) {
      if (this.#attemptReroute(taskId, error)) return;
      this.store.updateTask(taskId, {
        status: "failed",
        error: asErrorPayload(error),
        completedAt: new Date().toISOString(),
      });
      this.store.audit("task.failed", {
        taskId,
        error: asErrorPayload(error),
      });
    }
  }

  #waitForTerminalNotification(taskId) {
    const active = this.running.get(taskId);
    if (!active) return Promise.resolve();
    const current = this.store.getTask(taskId);
    if (current && current.status !== "running") {
      return Promise.resolve();
    }
    const limitMinutes = Number(
      current?.policy?.timeLimitMinutes ??
        this.config.limits.maxTaskRuntimeMinutes ??
        240,
    );
    const timeoutMs = limitMinutes * 60 * 1000;
    return new Promise((resolve) => {
      active.resolve = resolve;
      active.timer = setTimeout(async () => {
        const task = this.store.getTask(taskId);
        if (task?.status === "running") {
          let interruptionError = null;
          try {
            await this.#executorFor(task).interruptTurn(
              {
                threadId: task.threadId,
                turnId: task.turnId,
              },
              10000,
            );
          } catch (error) {
            interruptionError = asErrorPayload(error);
          }
          this.store.updateTask(taskId, {
            status: "interrupted",
            error: {
              code: "task_runtime_exceeded",
              message: `Task exceeded the configured runtime limit of ${limitMinutes} minutes.`,
              details: interruptionError,
            },
            completedAt: new Date().toISOString(),
          });
          this.store.audit("task.interrupted", {
            taskId,
            reason: "task_runtime_exceeded",
            threadId: task.threadId,
            turnId: task.turnId,
            interruptionError,
          });
        }
        resolve();
      }, timeoutMs);
    });
  }

  #finishActiveTask(taskId) {
    const active = this.running.get(taskId);
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    if (active.budgetTimer) clearInterval(active.budgetTimer);
    active.budgetTimer = null;
    active.resolve?.();
  }

  #startBudgetMonitor(taskId) {
    const active = this.running.get(taskId);
    if (!active || active.budgetTimer) return;
    const intervalMs = Number(
      this.config.limits.tokenUsagePollIntervalMs ?? 1000,
    );
    const poll = () => {
      this.#refreshGoalUsage(taskId).catch((error) => {
        const current = this.running.get(taskId);
        if (!current || current.goalUsageDiagnosticEmitted) return;
        current.goalUsageDiagnosticEmitted = true;
        this.store.addEvent(taskId, {
          type: "task.usage_poll_failed",
          error: asErrorPayload(error),
        });
      });
    };
    poll();
    active.budgetTimer = setInterval(poll, intervalMs);
    active.budgetTimer.unref?.();
  }

  async #refreshGoalUsage(taskId, { enforceBudget = true } = {}) {
    const active = this.running.get(taskId);
    const task = this.store.getTask(taskId);
    if (!active || !task?.threadId) return null;
    if (active.goalUsagePollPromise) {
      return active.goalUsagePollPromise;
    }
    const pollPromise = (async () => {
      const executor = this.#executorFor(task);
      const response = await executor.getGoal(
        { threadId: task.threadId },
        10000,
      );
      const goal = response?.goal;
      if (!goal) return null;
      const currentUsage = this.store.getTask(taskId)?.usage;
      const usage = mapGoalUsage(goal, currentUsage);
      if (
        !currentUsage ||
        usage.total_tokens >= Number(currentUsage.total_tokens ?? 0)
      ) {
        this.store.updateTask(taskId, { usage });
      }

      const latest = this.store.getTask(taskId);
      const overBudget =
        marginalTokens(usage) >= latest.policy.tokenBudget ||
        goal.status === "budgetLimited";
      if (
        enforceBudget &&
        !active.completing &&
        !active.finalMessage &&
        latest.status === "running" &&
        overBudget &&
        !active.budgetInterruptRequested
      ) {
        active.budgetInterruptRequested = true;
        active.budgetMeasuredTokens = marginalTokens(usage);
        this.store.addEvent(taskId, {
          type: "task.token_budget_exceeded",
          budget: latest.policy.tokenBudget,
          measured: marginalTokens(usage),
          source: "thread_goal",
        });
        try {
          await executor.interruptTurn(
            {
              threadId: latest.threadId,
              turnId: active.turnId,
            },
            10000,
          );
        } catch (error) {
          this.store.addEvent(taskId, {
            type: "task.budget_interrupt_failed",
            error: asErrorPayload(error),
          });
        }
      }
      return usage;
    })();
    active.goalUsagePollPromise = pollPromise;
    try {
      return await pollPromise;
    } finally {
      if (active.goalUsagePollPromise === pollPromise) {
        active.goalUsagePollPromise = null;
      }
    }
  }

  async #recoverInterruptedTasks() {
    const stale = this.store.listByStatus(["queued", "running"]);
    for (const task of stale) {
      if (task.status === "queued") {
        this.queue.push({
          taskId: task.id,
          followUp: Boolean(task.parentTaskId || task.continuation),
          rerouted: Boolean(task.continuation),
        });
        continue;
      }

      let recovered = false;
      if (task.threadId) {
        try {
          const executor = this.#executorFor(task);
          if (!executor.ready) await executor.start();
          const resumed = await executor.resumeThread({
            threadId: task.threadId,
            historyMode: "paginated",
          });
          const turns = resumed.thread?.turns ?? [];
          const lastTurn = turns.at(-1);
          if (lastTurn && lastTurn.status !== "inProgress") {
            const report = extractReport(lastTurn);
            const status =
              lastTurn.status === "completed"
                ? report.status === "blocked"
                  ? "blocked"
                  : "completed"
                : lastTurn.status;
            const completedAt = new Date().toISOString();
            this.store.updateTask(task.id, {
              status,
              turnId: lastTurn.id,
              result: report,
              error: lastTurn.error ?? null,
              completedAt,
            });
            this.store.addEvent(task.id, {
              type: "task.recovered",
              recoveredStatus: status,
            });
            if (
              ["failed", "blocked"].includes(status) &&
              this.#attemptReroute(task.id, lastTurn.error ?? report, {
                result: report,
                recovered: true,
              })
            ) {
              recovered = true;
              continue;
            }
            const recoveredTask = this.store.getTask(task.id);
            this.#updateCurrentExecutorHistory(task.id, {
              ended_at: completedAt,
              ended_reason: lastTurn.error?.code ?? status,
              thread_id: recoveredTask.threadId,
              turn_id: lastTurn.id,
              attempts: Math.max(1, Number(lastTurn.retries ?? 0) + 1),
              usage: structuredClone(recoveredTask.usage ?? zeroUsage()),
            });
            recovered = true;
          }
        } catch (error) {
          this.store.addEvent(task.id, {
            type: "task.recovery_failed",
            error: asErrorPayload(error),
          });
        }
      }

      if (!recovered) {
        this.store.updateTask(task.id, {
          status: "interrupted",
          error: {
            code: "control_plane_restarted",
            message:
              "The control-plane process stopped before this task reached a terminal state.",
            details: null,
          },
          completedAt: new Date().toISOString(),
        });
      }
    }
    if (this.queue.length) queueMicrotask(() => this.#drain());
  }

  #taskForNotification(params) {
    const turnId = params.turnId ?? params.turn?.id;
    if (turnId) {
      for (const [taskId, active] of this.running.entries()) {
        if (active.turnId === turnId) return taskId;
      }
      const threadMatches = [];
      for (const [taskId, active] of this.running.entries()) {
        const task = this.store.getTask(taskId);
        if (task && params.threadId && task.threadId === params.threadId) {
          threadMatches.push(taskId);
        }
      }
      return threadMatches.length === 1 ? threadMatches[0] : null;
    }
    const matches = [];
    for (const [taskId, active] of this.running.entries()) {
      const task = this.store.getTask(taskId);
      if (!task) continue;
      if (params.threadId && task.threadId === params.threadId) {
        matches.push(taskId);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  #estimatedCostFor(executorId, modelId, profileName) {
    const catalog = this.modelCatalogs.get(executorId) ?? [];
    const entry = catalog.find((model) => (model.id ?? model.model) === modelId);
    if (!entry?.pricing) return null;
    const normalized = normalizePricing({
      input: entry.pricing.input,
      output: entry.pricing.output,
      cached_input: entry.pricing.cached_input,
      reasoning: entry.pricing.reasoning,
      currency: entry.pricing.currency,
      pricing_version: entry.pricing.pricing_version ?? entry.pricing.version,
    });
    const tokenEstimate = extractTokenEstimate(
      { profile: profileName ?? "balanced" },
      this.config,
    );
    const range = computeCostRange(tokenEstimate, normalized);
    if (!range) return null;
    return {
      estimated_cost_microusd: range.expected_microusd,
      pricing_version: range.pricing_version,
    };
  }

  #recordUsageEvent(message, executor, params) {
    const taskId = this.#taskForNotification(params);
    const task = taskId ? this.store.getTask(taskId) : null;
    const estimate = this.#estimatedCostFor(
      executor.id,
      params.resolvedModel,
      task?.policy?.name ?? null,
    );
    const event = createUsageEvent({
      task_id: taskId ?? null,
      turn_id: params.turnId ?? null,
      task_kind: params.taskKind ?? task?.kind ?? "production",
      request_kind: params.requestKind ?? "task_execution",
      attempt: params.attempt ?? 1,
      asterroute_request_id: params.asterrouteRequestId ?? null,
      upstream_request_id: params.upstreamRequestId ?? null,
      executor: executor.id,
      requested_model: params.requestedModel ?? null,
      resolved_model: params.resolvedModel ?? null,
      protocol: params.protocol ?? null,
      duration_ms: params.durationMs ?? 0,
      outcome: params.outcome ?? "ok",
      usage: params.usage,
      estimated_cost_microusd: estimate?.estimated_cost_microusd ?? null,
      pricing_version: estimate?.pricing_version ?? null,
    });
    this.store.appendUsageEvent(event);
  }

  #onNotification(message, executor) {
    const params = message.params ?? {};
    if (message.method === "usage/request") {
      this.#recordUsageEvent(message, executor, params);
      return;
    }
    const taskId = this.#taskForNotification(params);
    if (!taskId) return;

    if (message.method === "thread/tokenUsage/updated") {
      const active = this.running.get(taskId);
      if (!active) return;
      if (!active.turnId) {
        active.pendingUsage ??= new Map();
        active.pendingUsage.set(params.turnId, params.tokenUsage);
        return;
      }
      if (params.turnId !== active.turnId) {
        return;
      }
      const usage = mapUsage(params.tokenUsage);
      this.store.updateTask(taskId, { usage });
      const task = this.store.getTask(taskId);
      if (
        !active.budgetInterruptRequested &&
        marginalTokens(usage) > task.policy.tokenBudget
      ) {
        active.budgetInterruptRequested = true;
        active.budgetMeasuredTokens = marginalTokens(usage);
        this.store.addEvent(taskId, {
          type: "task.token_budget_exceeded",
          budget: task.policy.tokenBudget,
          measured: marginalTokens(usage),
          source: "token_usage_notification",
        });
        executor
          .interruptTurn({
            threadId: task.threadId,
            turnId: active.turnId,
          })
          .catch((error) => {
            this.store.addEvent(taskId, {
              type: "task.budget_interrupt_failed",
              error: asErrorPayload(error),
            });
          });
      }
      return;
    }

    if (message.method === "item/completed") {
      const item = params.item;
      if (item?.type === "agentMessage" && item.phase === "final_answer") {
        const active = this.running.get(taskId);
        if (active) active.finalMessage = item.text;
      }
      if (item?.type === "collabAgentToolCall") {
        const task = this.store.getTask(taskId);
        const known = new Map(
          (task.subagents ?? []).map((entry) => [entry.thread_id, entry]),
        );
        for (const threadId of item.receiverThreadIds ?? []) {
          known.set(threadId, {
            thread_id: threadId,
            model: item.model ?? null,
            reasoning_effort: item.reasoningEffort ?? null,
            status: item.agentsStates?.[threadId]?.status ?? item.status,
          });
        }
        this.store.updateTask(taskId, {
          subagents: [...known.values()],
        });
      }
      this.store.addEvent(taskId, {
        method: message.method,
        item: this.#compactItem(item),
      });
      return;
    }

    if (message.method === "turn/completed") {
      this.#completeTask(taskId, params).catch((error) => {
        this.store.updateTask(taskId, {
          status: "failed",
          error: asErrorPayload(error),
          completedAt: new Date().toISOString(),
        });
        this.#finishActiveTask(taskId);
      });
      return;
    }

    if (
      message.method === "turn/diff/updated" ||
      message.method === "thread/status/changed" ||
      message.method === "error"
    ) {
      this.store.addEvent(taskId, {
        method: message.method,
        params,
      });
    }
  }

  async #completeTask(taskId, params) {
    const current = this.store.getTask(taskId);
    if (!current || current.status !== "running") {
      this.#finishActiveTask(taskId);
      return;
    }
    const active = this.running.get(taskId);
    if (active) {
      active.completing = true;
      if (active.budgetTimer) clearInterval(active.budgetTimer);
      active.budgetTimer = null;
    }
    await this.#refreshGoalUsage(taskId, { enforceBudget: false }).catch(
      () => null,
    );
    const report = extractReport(
      params.turn,
      active?.finalMessage ?? null,
    );
    const budgetInterrupted = Boolean(active?.budgetInterruptRequested);
    const turnFinished = params.turn.status === "completed";
    const finalStatus =
      turnFinished && report.status
        ? report.status
        : budgetInterrupted
          ? "interrupted"
          : turnFinished
            ? report.status
            : params.turn.status;
    const error =
      budgetInterrupted && !(turnFinished && report.status)
        ? {
            code: "token_budget_exceeded",
            message: `Task exceeded its token budget of ${current.policy.tokenBudget} tokens and was interrupted.`,
            details: {
              budget: current.policy.tokenBudget,
              measured: active?.budgetMeasuredTokens ?? null,
            },
          }
        : params.turn.error ?? null;
    if (
      ["failed", "blocked"].includes(finalStatus) &&
      this.#attemptReroute(taskId, error ?? report, { result: report })
    ) {
      return;
    }
    if (budgetInterrupted && turnFinished && report.status) {
      this.store.addEvent(taskId, {
        type: "task.budget_exceeded_after_completion",
        budget: current.policy.tokenBudget,
        measured: active?.budgetMeasuredTokens ?? null,
        note: "The executor delivered its final report; the task keeps its completed status.",
      });
    }
    this.store.updateTask(taskId, {
      status: finalStatus,
      result: report,
      error,
      retries: Number(params.turn.retries ?? 0),
      completedAt: new Date().toISOString(),
      ...(params.executorSessionId
        ? { executorSessionId: params.executorSessionId }
        : {}),
    });
    const completedTask = this.store.getTask(taskId);
    this.#updateCurrentExecutorHistory(taskId, {
      ended_at: completedTask.completedAt,
      ended_reason: error?.code ?? finalStatus,
      thread_id: completedTask.threadId,
      turn_id: completedTask.turnId,
      attempts: Math.max(1, Number(params.turn.retries ?? 0) + 1),
      usage: structuredClone(completedTask.usage ?? zeroUsage()),
    });
    this.store.audit("task.completed", {
      taskId,
      status: finalStatus,
    });
    this.#finishActiveTask(taskId);
  }

  #onServerRequest(message, executor) {
    const params = message.params ?? {};
    const taskId = this.#taskForNotification(params);
    if (taskId) {
      this.store.addEvent(taskId, {
        method: message.method,
        action: "denied_by_control_plane",
      });
    }

    if (message.method === "item/commandExecution/requestApproval") {
      executor.respond(message.id, {
        decision: {
          denied: {
            rejection:
              "AgentControlPlane denied an unapproved command escalation.",
          },
        },
      });
      return;
    }
    if (message.method === "item/fileChange/requestApproval") {
      executor.respond(message.id, { decision: "decline" });
      return;
    }
    if (message.method === "item/tool/requestUserInput") {
      executor.respond(message.id, { answers: {} });
      return;
    }
    if (message.method === "item/permissions/requestApproval") {
      executor.respond(message.id, {
        permissions: {},
        scope: "turn",
        strictAutoReview: true,
      });
      return;
    }
    executor.respond(message.id, {});
  }

  #compactItem(item) {
    if (!item || typeof item !== "object") return item;
    if (item.type === "agentMessage") {
      return {
        type: item.type,
        phase: item.phase ?? null,
        text: String(item.text ?? "").slice(0, 4000),
      };
    }
    if (item.type === "collabAgentToolCall") {
      return {
        type: item.type,
        tool: item.tool,
        status: item.status,
        receiverThreadIds: item.receiverThreadIds,
        model: item.model ?? null,
        reasoningEffort: item.reasoningEffort ?? null,
      };
    }
    return {
      type: item.type ?? "unknown",
      id: item.id ?? null,
      status: item.status ?? null,
    };
  }

  #assertQueueCapacity() {
    const limit = this.config.limits.maxQueuedTasks ?? 100;
    if (this.queue.length >= limit) {
      throw new ControlPlaneError(
        "queue_full",
        `Task queue limit reached (${limit})`,
      );
    }
  }
}
