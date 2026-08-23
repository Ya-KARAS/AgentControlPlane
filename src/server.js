import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./core/config.js";
import { ControlPlaneError } from "./core/errors.js";
import { sendError, sendJson, sendHtml, readJson, routeParts } from "./core/http.js";
import { Orchestrator } from "./core/orchestrator.js";
import { publicModels, publicProfiles } from "./core/profiles.js";
import { RateLimiter } from "./core/rate-limit.js";
import { TaskStore } from "./core/store.js";
import { CodexExecutor } from "./executors/codex-executor.js";
import { ClaudeCodeExecutor } from "./executors/claude-code-executor.js";
import { OpenCodeExecutor } from "./executors/opencode-executor.js";
import { KimiCodeExecutor } from "./executors/kimi-code-executor.js";
import { ZCodeExecutor } from "./executors/zcode-executor.js";
import { OpenAICompatibleExecutor } from "./executors/openai-compatible-executor.js";
import { assertExecutor } from "./executors/executor.js";
import { assertLifecycle } from "./executors/lifecycle.js";
import { resolvePreset, presetNames } from "./executors/provider-presets.js";
import { createMcpHandler } from "./mcp/server.js";
import { PairingManager } from "./companion/pairing-manager.js";
import { CompanionRouter } from "./companion/router.js";
import { dashboardHtml } from "./dashboard.js";
import { usageDimensions, reconcileUsage } from "./core/usage-dimensions.js";
import { LocalReviewRouter } from "./local-review/router.js";
import { LocalReviewSettings } from "./local-review/settings.js";
import { ProjectRegistry } from "./core/project-registry.js";
import {
  createCandidateReviewService,
  localReviewCapabilities,
  localReviewOptions,
  validateLocalSelection,
} from "./local-review/service.js";

export function buildExecutor(config, provider) {
  if (provider === "openai-compatible") {
    const options = config.executor.openaiCompat ?? {};
    return new OpenAICompatibleExecutor({
      id: "openai-compatible",
      displayName: "OpenCodex",
      baseUrl: options.baseUrl,
      apiKey:
        process.env.AGENT_CONTROL_OPENAI_KEY ??
        options.apiKey ??
        null,
      model: options.model,
      protocol: options.protocol,
      requestsPerMinute: options.requestsPerMinute ?? null,
      workspaceRoots: config.workspaceRoots,
      version: config.version ?? null,
    });
  }
  if (provider === "deepseek") {
    const options = config.executor.deepseek ?? {};
    return new OpenAICompatibleExecutor({
      id: "deepseek",
      displayName: "DeepSeek Harness",
      baseUrl: options.baseUrl,
      apiKey: process.env[options.apiKeyEnv] ?? options.apiKey ?? null,
      model: options.model,
      protocol: options.protocol,
      requestsPerMinute: options.requestsPerMinute ?? null,
      workspaceRoots: config.workspaceRoots,
      version: config.version ?? null,
    });
  }
  if (provider === "claude") {
    const options = config.executor.claude ?? {};
    return new ClaudeCodeExecutor({
      command: options.command,
      model: options.model ?? null,
      allowedTools: options.allowedTools,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      workspaceRoots: config.workspaceRoots,
    });
  }
  if (provider === "opencode") {
    const options = config.executor.opencode ?? {};
    return new OpenCodeExecutor({
      command: options.command,
      model: options.model ?? null,
      agent: options.agent ?? null,
      autoApprove: options.autoApprove,
      workspaceRoots: config.workspaceRoots,
    });
  }
  if (provider === "kimi") {
    const options = config.executor.kimi ?? {};
    return new KimiCodeExecutor({
      command: options.command,
      model: options.model ?? null,
      workspaceRoots: config.workspaceRoots,
    });
  }
  if (provider === "zcode") {
    const options = config.executor.zcode ?? {};
    return new ZCodeExecutor({
      command: options.command ?? null,
      model: options.model ?? null,
      mode: options.mode ?? "yolo",
      workspaceRoots: config.workspaceRoots,
      storageRoot: options.storageRoot ?? undefined,
      desktopRoot: options.desktopRoot ?? undefined,
    });
  }
  return new CodexExecutor({
    command: config.codex.command,
    disabledFeatures: config.codex.disabledFeatures,
  });
}

export function buildExecutors(config) {
  const providers = [
    "codex",
    "openai-compatible",
    "deepseek",
    "claude",
    "opencode",
    "kimi",
    "zcode",
  ];
  const executors = new Map();
  for (const provider of providers) {
    executors.set(provider, buildExecutor(config, provider));
  }
  for (const relay of config.executor?.relays ?? []) {
    const preset = relay?.preset ? resolvePreset(relay.preset) : null;
    if (relay?.preset && !preset) {
      throw new ControlPlaneError(
        "unknown_provider_preset",
        `Unknown provider preset: ${relay.preset}`,
        { available: presetNames() },
      );
    }
    const merged = { ...(preset ?? {}), ...relay };
    const id = String(merged.id ?? "").trim();
    if (!id) {
      throw new ControlPlaneError(
        "invalid_relay_id",
        "Every configured relay needs a non-empty id",
      );
    }
    if (executors.has(id)) {
      throw new ControlPlaneError(
        "duplicate_executor_id",
        `Relay id collides with a built-in executor: ${id}`,
        { id },
      );
    }
    executors.set(
      id,
      new OpenAICompatibleExecutor({
        id,
        displayName: merged.displayName ?? id,
        baseUrl: merged.baseUrl,
        apiKey: process.env[merged.apiKeyEnv] ?? merged.apiKey ?? null,
        model: merged.model,
        protocol: merged.protocol,
        models: merged.models ?? [],
        requestsPerMinute: merged.requestsPerMinute ?? null,
        official: merged.official === true,
        workspaceRoots: config.workspaceRoots,
        version: config.version ?? null,
      }),
    );
  }
  return executors;
}

export async function createApplication(overrides = {}) {
  const config = overrides.config ?? loadConfig();
  config.publicProfiles = () => publicProfiles(config);
  const store =
    overrides.store ??
    new TaskStore(
      config.stateDir,
      config.limits.maxStoredEventsPerTask,
      config.limits.maxStoredTasks,
      config.limits.maxAuditBytes,
      config.audit?.integrityKey,
    );
  const rateLimiter = config.limits?.rateLimit?.enabled
    ? new RateLimiter({
        windowMs: config.limits.rateLimit.windowMs,
        max: config.limits.rateLimit.max,
      })
    : null;
  const projectRootsExist = (config.workspaceRoots ?? []).every(
    (root) => fs.existsSync(root) && fs.statSync(root).isDirectory(),
  );
  const shouldCreateProjectRegistry = overrides.config === undefined || projectRootsExist;
  const projectRegistry = overrides.projectRegistry !== undefined
    ? overrides.projectRegistry
    : shouldCreateProjectRegistry
      ? new ProjectRegistry({
      stateDir: config.stateDir,
      workspaceRoots: config.workspaceRoots ?? [],
      discoveryRoots: config.projectDiscoveryRoots ?? [],
      audit: (type, payload) => store.audit(type, payload),
      hasActiveTasks: (projectId) =>
        store
          .listByStatus(["queued", "running"])
          .some((task) => task.project_id === projectId),
        })
      : null;
  let executors;
  let defaultProvider;
  if (overrides.executors) {
    executors = overrides.executors;
    if (!(executors instanceof Map) || executors.size === 0) {
      throw new TypeError("createApplication executors must be a non-empty Map");
    }
    defaultProvider = overrides.defaultProvider ?? executors.keys().next().value;
    if (!executors.has(defaultProvider)) {
      throw new TypeError(
        `createApplication defaultProvider is not registered: ${defaultProvider}`,
      );
    }
    for (const executor of executors.values()) {
      assertExecutor(executor, { execution: overrides.startCodex !== false });
      assertLifecycle(executor);
    }
  } else if (overrides.executor || overrides.codex) {
    const codex = assertExecutor(
      overrides.executor ?? overrides.codex,
      { execution: overrides.startCodex !== false },
    );
    executors = new Map([["codex", codex]]);
    defaultProvider = "codex";
  } else {
    executors = buildExecutors(config);
    defaultProvider = config.executor?.provider ?? "auto";
    for (const executor of executors.values()) {
      assertLifecycle(executor);
    }
    if (defaultProvider !== "auto") {
      assertExecutor(executors.get(defaultProvider), {
        execution: overrides.startCodex !== false,
      });
    }
  }
  const codex = executors.get("codex") ?? executors.get(defaultProvider);
  let orchestrator = overrides.orchestrator;
  if (!orchestrator) {
    orchestrator = new Orchestrator({
      config,
      store,
      executors,
      defaultProvider,
      projectRegistry,
    });
  }
  if (overrides.startCodex !== false) {
    await orchestrator.start();
  }
  const handleMcp = createMcpHandler({ orchestrator, store, config });
  const pairingManager =
    overrides.pairingManager ??
    new PairingManager({
      stateDir: config.stateDir,
      pairingTtlMs:
        Number(config.companion?.pairingTtlMinutes ?? 10) * 60 * 1000,
      maxClients: Number(config.companion?.maxClients ?? 32),
      maxPending: Number(config.companion?.maxPending ?? 16),
    });
  const companion = new CompanionRouter({
    pairingManager,
    orchestrator,
    store,
    config,
  });
  const candidateReview =
    overrides.candidateReview ??
    createCandidateReviewService({
      config,
      orchestrator,
      store,
      projectRegistry,
    });
  const getLocalReviewOptions = () =>
    localReviewOptions(config, orchestrator, projectRegistry);
  const localReviewSettings =
    overrides.localReviewSettings ??
    new LocalReviewSettings({
      stateDir: config.stateDir,
      getOptions: getLocalReviewOptions,
      validateSelection: (selection) =>
        validateLocalSelection(config, orchestrator, selection, {
          projectRegistry,
          preserveAuto: true,
        }),
      normalizeWorkspace: (workspace) =>
        projectRegistry?.referenceForPath(workspace) ?? workspace,
      audit: (type, payload) => store.audit(type, payload),
    });
  const getLocalReviewCapabilities = () =>
    localReviewCapabilities(
      config,
      orchestrator,
      localReviewSettings.current(),
      store,
      projectRegistry,
    );
  const localReview = new LocalReviewRouter({
    service: candidateReview,
    settings: localReviewSettings,
    port: config.server.port,
    allowedPageOrigins: config.localReview?.allowedPageOrigins,
    getOptions: getLocalReviewOptions,
    getCapabilities: getLocalReviewCapabilities,
    projectRegistry,
  });

  function tokenMatches(request) {
    if (!config.server.authToken) return true;
    const authorization = request.headers.authorization ?? "";
    const supplied = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const expected = Buffer.from(config.server.authToken);
    const actual = Buffer.from(supplied);
    return (
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual)
    );
  }

  function originAllowed(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    return config.server.allowedOrigins.includes(origin);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const { url, parts } = routeParts(request);

      if (
        !originAllowed(request) &&
        !companion.originAllowed(request, url) &&
        !localReview.originAllowed(request, url)
      ) {
        sendJson(response, 403, {
          error: { code: "origin_denied", message: "Origin is not allowed 来源不被允许" },
        });
        return;
      }

      const isHealth = request.method === "GET" && url.pathname === "/health";
      const isDashboard =
        request.method === "GET" &&
        (url.pathname === "/" || url.pathname === "/dashboard");
      const isProtectedResourceMetadata =
        request.method === "GET" &&
        [
          "/.well-known/oauth-protected-resource/mcp",
          "/.well-known/oauth-protected-resource",
        ].includes(url.pathname);
      if (!isHealth && !isProtectedResourceMetadata && rateLimiter) {
        const key = request.socket.remoteAddress ?? "unknown";
        const decision = rateLimiter.consume(key);
        if (!decision.allowed) {
          sendJson(
            response,
            429,
            {
              error: {
                code: "rate_limited",
                message: "Too many requests",
              },
            },
            { "retry-after": String(decision.retryAfterSeconds) },
          );
          return;
        }
      }
      if (localReview.matches(url)) {
        await localReview.handle(request, response, url);
        return;
      }
      if (companion.matches(url)) {
        await companion.handle(request, response, url, parts);
        return;
      }
      if (
        !isHealth &&
        !isDashboard &&
        !isProtectedResourceMetadata &&
        !tokenMatches(request)
      ) {
        sendJson(
          response,
          401,
          {
            error: {
              code: "unauthorized",
              message: "A valid bearer token is required",
            },
          },
          { "www-authenticate": 'Bearer realm="AgentControlPlane"' },
        );
        return;
      }

      if (isHealth) {
        const defaultExecutor = orchestrator.getDefaultExecutorId?.() ?? "codex";
        const executors = orchestrator.getExecutors?.() ?? [];
        sendJson(response, 200, {
          status: "ok",
          service: "agent-control-plane",
          version: config.version ?? "0.0.0",
          default_executor: defaultExecutor,
          executor_ready:
            executors.find((executor) => executor.id === defaultExecutor)?.ready ??
            Boolean(codex.ready),
          codex_ready: Boolean(codex.ready),
          companion_enabled: config.companion?.enabled !== false,
        });
        return;
      }

      if (isDashboard) {
        sendHtml(response, 200, dashboardHtml(config));
        return;
      }

      if (isProtectedResourceMetadata) {
        const forwardedProto = request.headers["x-forwarded-proto"];
        const protocol =
          typeof forwardedProto === "string"
            ? forwardedProto.split(",", 1)[0].trim()
            : "http";
        const host = request.headers.host ?? `${config.server.host}:${config.server.port}`;
        sendJson(response, 200, {
          resource: `${protocol}://${host}/mcp`,
          bearer_methods_supported: ["header"],
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/diagnostics") {
        sendJson(response, 200, {
          codex_ready: Boolean(codex.ready),
          codex_command: config.codex?.command ?? null,
          default_executor: orchestrator.getDefaultExecutorId?.() ?? "codex",
          executors: orchestrator.getExecutors?.() ?? [],
          runtime: orchestrator.getRuntimeHealth(),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/executors") {
        sendJson(response, 200, {
          default_executor: orchestrator.getDefaultExecutorId?.() ?? "codex",
          executors: orchestrator.getExecutors?.() ?? [],
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/profiles") {
        sendJson(response, 200, { profiles: publicProfiles(config) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/models") {
        const executor = url.searchParams.get("executor");
        sendJson(response, 200, {
          executor: executor ?? orchestrator.getDefaultExecutorId?.() ?? null,
          models: publicModels(orchestrator.getModels(executor)),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/tasks") {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
        const query = url.searchParams.get("query") ?? "";
        const status = url.searchParams.get("status") ?? null;
        sendJson(response, 200, {
          tasks: store.findTasks({ query, status, limit }),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/tasks") {
        const body = await readJson(request);
        const task = orchestrator.dispatch(body);
        sendJson(response, 202, { task });
        return;
      }

      if (
        request.method === "GET" &&
        parts.length === 3 &&
        parts[0] === "v1" &&
        parts[1] === "tasks"
      ) {
        const resolvedId = store.resolveTaskId(parts[2]);
        const task = resolvedId
          ? store.getTask(resolvedId, url.searchParams.get("events") === "1")
          : null;
        if (!task) {
          sendJson(response, 404, {
            error: { code: "task_not_found", message: "Task not found" },
          });
          return;
        }
        sendJson(response, 200, { task });
        return;
      }

      if (
        request.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "v1" &&
        parts[1] === "tasks" &&
        parts[3] === "follow-up"
      ) {
        const body = await readJson(request);
        const task = orchestrator.continueTask(parts[2], body);
        sendJson(response, 202, { task });
        return;
      }

      if (
        request.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "v1" &&
        parts[1] === "tasks" &&
        parts[3] === "cancel"
      ) {
        const task = await orchestrator.cancel(parts[2]);
        sendJson(response, 200, { task });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/usage") {
        sendJson(response, 200, { usage: store.usageReport() });
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/v1/usage/dimensions"
      ) {
        sendJson(
          response,
          200,
          usageDimensions(store, {
            by: url.searchParams.get("by") ?? "model",
            since: url.searchParams.get("since") ?? null,
            kind: url.searchParams.get("kind") ?? null,
            limit: url.searchParams.get("limit") ?? 100,
            offset: url.searchParams.get("offset") ?? 0,
            scope:
              url.searchParams.get("scope") ??
              (url.searchParams.get("production_only") === "false"
                ? "all"
                : "production"),
          }),
        );
        return;
      }

      if (
        request.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "v1" &&
        parts[1] === "tasks" &&
        parts[3] === "kind"
      ) {
        const body = await readJson(request, 4 * 1024);
        const kind = String(body?.kind ?? "");
        if (
          !["production", "certification", "benchmark", "maintenance", "smoke"].includes(
            kind,
          )
        ) {
          sendJson(response, 400, {
            error: {
              code: "invalid_kind",
              message:
                "kind must be production, certification, benchmark, maintenance, or smoke",
            },
          });
          return;
        }
        const resolvedId = store.resolveTaskId(parts[2]);
        const task = resolvedId ? store.markTaskKind(resolvedId, kind) : null;
        if (!task) {
          sendJson(response, 404, {
            error: { code: "task_not_found", message: "Task not found" },
          });
          return;
        }
        sendJson(response, 200, { task });
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/v1/recommendations"
      ) {
        const objective = url.searchParams.get("objective") ?? "";
        if (!objective) {
          sendJson(response, 400, {
            error: {
              code: "missing_objective",
              message: "The objective query parameter is required",
            },
          });
          return;
        }
        const recommendation = orchestrator.recommend({
          objective,
          profile: url.searchParams.get("profile") ?? undefined,
          reasoning_effort:
            url.searchParams.get("reasoning_effort") ?? undefined,
          executor: url.searchParams.get("executor") ?? undefined,
          model: url.searchParams.get("model") ?? undefined,
        });
        sendJson(response, 200, { recommendation });
        return;
      }

      if (
        url.pathname === "/mcp" &&
        ["POST", "GET", "DELETE"].includes(request.method)
      ) {
        const body =
          request.method === "POST"
            ? await readJson(request, 1024 * 1024)
            : undefined;
        await handleMcp(request, response, body);
        return;
      }

      sendJson(response, 404, {
        error: { code: "not_found", message: "Route not found" },
      });
    } catch (error) {
      try {
        const { url } = routeParts(request);
        if (companion.matches(url) && companion.sendError(request, response, error)) {
          return;
        }
      } catch {
        // Fall through to the standard error response.
      }
      sendError(response, error);
    }
  });

  return {
    config,
    store,
    codex,
    orchestrator,
    pairingManager,
    candidateReview,
    projectRegistry,
    server,
    async close() {
      for (const executor of executors.values()) {
        await Promise.resolve(executor.stop()).catch(() => {});
      }
      if (server.listening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  };
}

export async function main() {
  const app = await createApplication();
  app.server.listen(app.config.server.port, app.config.server.host, () => {
    console.log(
      `AgentControlPlane listening on http://${app.config.server.host}:${app.config.server.port}`,
    );
  });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
