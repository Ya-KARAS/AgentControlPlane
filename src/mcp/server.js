import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { asErrorPayload } from "../core/errors.js";
import { estimateCost, latencyStats } from "../core/cost-latency.js";
import { publicModels } from "../core/profiles.js";
import { readPackageVersion } from "../core/config.js";
import { usageDimensions, reconcileUsage } from "../core/usage-dimensions.js";
import { usageEventsToCsv } from "../core/usage-events.js";

const SERVER_INFO = { name: "agent-control-plane" };

// OpenAI negotiates this protocol version through its connector flow.
// Prefer it over the SDK's latest so the discovery handshake matches what
// ChatGPT's control plane already speaks.
const DISCOVERY_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS.includes(
  "2025-06-18",
)
  ? "2025-06-18"
  : SUPPORTED_PROTOCOL_VERSIONS[0];

const SERVER_INSTRUCTIONS =
  "This is a control plane between an AI conversation and private engineering " +
  "executors. Call list_executors and list_profiles when execution settings " +
  "matter, then send a compact objective through dispatch_project. Leave " +
  "executor as auto unless the user requests a specific backend. Treat " +
  "dispatch tools as asynchronous: " +
  "they queue a background agent task and return a task id; " +
  "poll task_status until it completes. If the structured result is blocked, " +
  "partial, failed, or shows a misunderstanding, correct the compact brief " +
  "with continue_project when the same executor should keep its session. Use " +
  "handoff_project after the source task is terminal when a different executor " +
  "should review or continue from compact source evidence. Ask the user only " +
  "when a real decision or permission is required. Never run engineering work " +
  "directly in the conversation; route all of it through these tools.";

const briefFields = {
  workspace: z.string().describe("Absolute project workspace path"),
  objective: z.string().min(1).describe("Compact engineering objective"),
  idempotency_key: z
    .string()
    .min(8)
    .max(200)
    .regex(/^[A-Za-z0-9._:-]+$/)
    .optional()
    .describe("Stable retry key; an identical replay returns the original task"),
  executor: z
    .string()
    .default("auto")
    .describe("Engineering executor id, or auto for capability-based routing"),
  constraints: z.array(z.string()).optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  context: z.array(z.string()).optional(),
  evidence_required: z.array(z.string()).optional(),
  profile: z.enum(["economy", "balanced", "deep"]).default("balanced"),
  model: z.string().nullable().optional(),
  reasoning_effort: z.string().nullable().optional(),
  max_subagents: z.number().int().min(0).max(8).nullable().optional(),
  token_budget: z.number().int().min(1000).max(250000).nullable().optional(),
  time_limit_minutes: z.number().int().min(1).max(240).nullable().optional(),
  kind: z
    .enum(["production", "certification", "benchmark", "maintenance", "smoke"])
    .optional(),
};

function result(payload, message) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: message }],
  };
}

function failure(error) {
  const payload = { error: asErrorPayload(error) };
  return {
    isError: true,
    structuredContent: payload,
    content: [{ type: "text", text: payload.error.message }],
  };
}

function toJsonSchema(shape) {
  return zodToJsonSchema(z.object(shape), {
    target: "jsonSchema7",
    $refStrategy: "none",
  });
}

function buildToolSpecs({ orchestrator, store, config }) {
  const networkAccess = Boolean(config.codex?.networkAccess);
  return [
    {
      name: "dispatch_project",
      title: "Dispatch engineering project",
      description:
        "Queue a compact engineering brief. By default the control plane automatically selects an available local executor.",
      inputSchema: briefFields,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: networkAccess,
        idempotentHint: false,
      },
      async handler(args) {
        try {
          const task = orchestrator.dispatch(args);
          return result(
            { task },
            `Engineering task ${task.id} was queued with profile ${task.policy.name}.`,
          );
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "dispatch_opencode",
      title: "Dispatch engineering project to OpenCode",
      description:
        "Queue a compact engineering brief on the local OpenCode execution backend. Do not pass opencode as a model.",
      inputSchema: briefFields,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: networkAccess,
        idempotentHint: false,
      },
      async handler(args) {
        try {
          const task = orchestrator.dispatch({ ...args, executor: "opencode" });
          return result(
            { task },
            `OpenCode task ${task.id} was queued with profile ${task.policy.name}.`,
          );
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "task_status",
      title: "Read engineering task status",
      description:
        "Use this when checking whether a dispatched engineering task finished or needs attention. Accepts a full task id or an unambiguous id prefix (8 or more characters).",
      inputSchema: {
        task_id: z.string().min(4),
        include_events: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ task_id, include_events }) {
        const resolved = store.resolveTaskId(task_id);
        const task = resolved ? store.getTask(resolved, include_events) : null;
        if (!task) {
          return failure(
            new Error(`Unknown or ambiguous task id: ${task_id}`),
          );
        }
        return result({ task }, `Task ${task.id} is ${task.status}.`);
      },
    },
    {
      name: "search_tasks",
      title: "Search engineering tasks",
      description:
        "Use this when the user wants to find an earlier task by its id prefix, objective text, result summary, or status.",
      inputSchema: {
        query: z.string().default(""),
        status: z
          .enum([
            "queued",
            "running",
            "completed",
            "partial",
            "blocked",
            "failed",
            "cancelled",
            "interrupted",
          ])
          .optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ query, status, limit }) {
        const tasks = store.findTasks({ query, status, limit });
        return result({ tasks }, `Returned ${tasks.length} matching tasks.`);
      },
    },
    {
      name: "continue_project",
      title: "Continue engineering project",
      description:
        "Use this when acceptance or review found a concrete follow-up. By default it reuses the current executor session; optional executor starts a capability-gated continuation on another executor while preserving the logical task lineage.",
      inputSchema: {
        task_id: z.string().min(4),
        executor: z.string().optional(),
        objective: z.string().min(1),
        constraints: z.array(z.string()).optional(),
        acceptance_criteria: z.array(z.string()).optional(),
        context: z.array(z.string()).optional(),
        evidence_required: z.array(z.string()).optional(),
        profile: z.enum(["economy", "balanced", "deep"]).optional(),
        model: z.string().nullable().optional(),
        reasoning_effort: z.string().nullable().optional(),
        max_subagents: z.number().int().min(0).max(8).nullable().optional(),
        token_budget: z.number().int().min(1000).max(250000).nullable().optional(),
        time_limit_minutes: z.number().int().min(1).max(240).nullable().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: networkAccess,
        idempotentHint: false,
      },
      async handler({ task_id, ...args }) {
        try {
          const resolved = store.resolveTaskId(task_id);
          if (!resolved) {
            throw new Error(`Unknown or ambiguous task id: ${task_id}`);
          }
          const task = orchestrator.continueTask(resolved, args);
          return result(
            { task },
            `Follow-up task ${task.id} was queued on executor ${task.executor} within logical task ${task.logical_task_id}.`,
          );
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "handoff_project",
      title: "Hand off project to another engineering executor",
      description:
        "After a source task is terminal, queue a review or continuation on another executor in the same logical lineage. The target receives only a compact continuation package (status, summary, changed files, tests, blockers, and error), not the web conversation or the source executor thread.",
      inputSchema: {
        source_task_id: z.string().min(4),
        executor: z
          .string()
          .default("auto")
          .describe("Target executor id, or auto for capability-based routing"),
        objective: z.string().min(1),
        idempotency_key: z
          .string()
          .min(8)
          .max(200)
          .regex(/^[A-Za-z0-9._:-]+$/)
          .optional()
          .describe("Stable retry key; an identical replay returns the original handoff"),
        constraints: z.array(z.string()).optional(),
        acceptance_criteria: z.array(z.string()).optional(),
        context: z.array(z.string()).optional(),
        evidence_required: z.array(z.string()).optional(),
        profile: z.enum(["economy", "balanced", "deep"]).optional(),
        model: z.string().nullable().optional(),
        reasoning_effort: z.string().nullable().optional(),
        max_subagents: z.number().int().min(0).max(8).nullable().optional(),
        token_budget: z.number().int().min(1000).max(250000).nullable().optional(),
        time_limit_minutes: z.number().int().min(1).max(240).nullable().optional(),
        fresh_session: z
          .boolean()
          .optional()
          .describe("Start a new target session instead of resuming that executor's saved project thread"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: networkAccess,
        idempotentHint: false,
      },
      async handler({ source_task_id, ...args }) {
        try {
          const resolved = store.resolveTaskId(source_task_id);
          if (!resolved) {
            throw new Error(`Unknown or ambiguous task id: ${source_task_id}`);
          }
          const task = orchestrator.handoffTask(resolved, args);
          return result(
            { task },
            `Handoff task ${task.id} was queued on ${task.executor} from source task ${resolved}.`,
          );
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "cancel_task",
      title: "Cancel engineering task",
      description:
        "Use this when the user explicitly asks to stop an active engineering task. Accepts a full task id or an unambiguous id prefix.",
      inputSchema: { task_id: z.string().min(4) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ task_id }) {
        try {
          const resolved = store.resolveTaskId(task_id);
          if (!resolved) {
            throw new Error(`Unknown or ambiguous task id: ${task_id}`);
          }
          const task = await orchestrator.cancel(resolved);
          return result({ task }, `Task ${task.id} is cancelled.`);
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "list_tasks",
      title: "List engineering tasks",
      description:
        "Use this when the user asks what engineering work is queued, running, or recently completed.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ limit }) {
        return result({ tasks: store.listTasks(limit) }, "Returned recent tasks.");
      },
    },
    {
      name: "list_executors",
      title: "List engineering executors",
      description:
        "List discovered engineering backends, readiness, capabilities, and the automatically selected default.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler() {
        return result(
          {
            default_executor: orchestrator.getDefaultExecutorId(),
            executors: orchestrator.getExecutors(),
          },
          "Returned discovered engineering executors.",
        );
      },
    },
    {
      name: "list_profiles",
      title: "List engineering execution profiles",
      description:
        "Use this when choosing the model effort, subagent concurrency, and token budget for a project.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler() {
        return result(
          { profiles: config.publicProfiles() },
          "Returned execution profiles.",
        );
      },
    },
    {
      name: "list_models",
      title: "List available engineering models",
      description:
        "List the cached model catalog for the selected or specified executor.",
      inputSchema: { executor: z.string().default("auto") },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ executor }) {
        return result(
          {
            executor:
              executor === "auto"
                ? orchestrator.getDefaultExecutorId()
                : executor,
            models: publicModels(orchestrator.getModels(executor)),
          },
          "Returned the cached models advertised by the executor.",
        );
      },
    },
    {
      name: "recommend_models",
      title: "Recommend engineering models",
      description:
        "Use this to rank available model endpoints for an engineering objective. The recommendation is advisory: it never changes a dispatch and never overrides an explicit model. Returns ranked candidates with scores, reasons, warnings, and excluded candidates.",
      inputSchema: {
        objective: z.string().min(1),
        profile: z.enum(["economy", "balanced", "deep"]).optional(),
        reasoning_effort: z.string().nullable().optional(),
        executor: z.string().nullable().optional(),
        allowed_models: z.array(z.string()).optional(),
        model: z.string().nullable().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler(args) {
        const recommendation = orchestrator.recommend(args);
        return result(
          { recommendation },
          `Ranked ${recommendation.ranked.length} candidates; ${recommendation.excluded.length} excluded.`,
        );
      },
    },
    {
      name: "usage_report_dimensions",
      title: "Read dimensional usage report",
      description:
        "Use this to aggregate measured request-level usage by task, project, model, executor, protocol, request kind, or task kind. The default production scope includes task_kind=production and request_kind=task_execution only (all attempts, retries included). Estimated and settled costs stay in separate integer micro-USD columns.",
      inputSchema: {
        by: z
          .enum(["task", "project", "model", "executor", "protocol", "request_kind", "task_kind"])
          .default("model"),
        since: z.string().nullable().optional(),
        kind: z.string().nullable().optional(),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
        scope: z.enum(["production", "diagnostic", "all"]).default("production"),
        production_only: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler(args) {
        return result(
          usageDimensions(store, args),
          "Returned the dimensional usage report.",
        );
      },
    },
    {
      name: "mark_task_kind",
      title: "Mark task kind",
      description:
        "Use this to classify a task as production, certification, benchmark, or maintenance. The production scope excludes every other task kind.",
      inputSchema: {
        task_id: z.string().min(4),
        kind: z.enum(["production", "certification", "benchmark", "maintenance", "smoke"]),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ task_id, kind }) {
        const resolved = store.resolveTaskId(task_id);
        const task = resolved ? store.markTaskKind(resolved, kind) : null;
        if (!task) {
          return failure(new Error(`Unknown or ambiguous task id: ${task_id}`));
        }
        return result({ task }, `Task ${task.id} is marked ${task.kind}.`);
      },
    },
    {
      name: "reconcile_usage",
      title: "Reconcile usage against provider rows",
      description:
        "Use this to match recorded request events against provider-reported rows by asterroute_request_id and compute presence, token, and settlement states. Reads settlement fields from the provider rows; never writes actual cost or settled state to the provider.",
      inputSchema: {
        provider_rows: z
          .array(
            z.object({
              asterroute_request_id: z.string(),
              upstream_request_id: z.string().nullable().optional(),
              token_dimensions: z
                .object({
                  input: z.number().int().min(0),
                  output: z.number().int().min(0),
                  cached_input: z.number().int().min(0).optional(),
                  reasoning_output: z.number().int().min(0).optional(),
                })
                .optional(),
              presence_state: z
                .enum(["both", "client_only", "provider_only", "unknown"])
                .nullable()
                .optional(),
              token_state: z
                .enum(["matched", "mismatch", "unknown"])
                .nullable()
                .optional(),
              settlement_state: z
                .enum(["pending", "settled", "adjusted", "not_billable"])
                .nullable()
                .optional(),
              settled_cost_microusd: z.number().int().min(0).nullable().optional(),
              credit_microusd: z.number().int().min(0).nullable().optional(),
              net_cost_microusd: z.number().int().min(0).nullable().optional(),
              currency: z.string().nullable().optional(),
              pricing_version: z.string().nullable().optional(),
              billing_revision: z.string().nullable().optional(),
            }),
          )
          .max(200),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ provider_rows }) {
        const { statuses, applied } = reconcileUsage(store, provider_rows);
        return result(
          { statuses, applied },
          "Returned reconciliation statuses.",
        );
      },
    },
    {
      name: "reconcile_now",
      title: "Run read-only reconciliation lookup",
      description:
        "Use this to trigger the bulk lookup for local request ids that have no reconciliation entry yet. Configured per relay through reconcileUrl.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler() {
        const results = await orchestrator.reconcileNow();
        return result({ results }, "Reconciliation lookup finished.");
      },
    },
    {
      name: "usage_events_csv",
      title: "Export usage events as CSV",
      description:
        "Use this to export request-level usage events as CSV with formula-injection protection.",
      inputSchema: {
        task_id: z.string().min(4).optional(),
        since: z.string().nullable().optional(),
        kind: z.string().nullable().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ task_id, since, kind, limit }) {
        const resolved = task_id ? store.resolveTaskId(task_id) : null;
        const { events } = store.listUsageEvents({
          taskId: resolved ?? null,
          since,
          kind,
          limit,
        });
        return result(
          { csv: usageEventsToCsv(events) },
          `Exported ${events.length} usage events.`,
        );
      },
    },
    {
      name: "estimate_cost",
      title: "Estimate model cost from the published formula",
      description:
        "Return the cost formula and the token-estimate and catalog-price inputs used for one model. A missing price, or a missing input or output rate the estimate needs, stays unknown and names the missing rate. This does not select or switch a model.",
      inputSchema: {
        model: z.string().min(1),
        profile: z.enum(["economy", "balanced", "deep"]).default("balanced"),
        executor: z.string().default("auto"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ model, profile, executor }) {
        const catalog = orchestrator.getModels(executor);
        const entry = catalog.find((item) => item.model === model || item.id === model) ?? null;
        const estimate = estimateCost(
          { profile },
          entry
            ? { model: entry.model ?? entry.id ?? model, pricing: entry.pricing ?? null }
            : { model, pricing: null },
          config,
        );
        return result(
          { estimate },
          estimate.range
            ? `Estimated ${estimate.range.expected_microusd} micro-USD for ${model}. This does not select a model.`
            : estimate.inputs.pricing
              ? `Catalog price for ${model} is missing ${estimate.missing_rates.join(", ")}. Cost stays unknown. This does not select a model.`
              : `No catalog price for ${model}. Returned the formula with unknown pricing. This does not select a model.`,
        );
      },
    },
    {
      name: "latency_stats",
      title: "Read recorded task latency for one model",
      description:
        "Return count, p50, and p95 from recorded task durations for one model and a time window. This does not select or switch a model.",
      inputSchema: {
        model: z.string().min(1),
        window: z.string().default("7d"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ model, window }) {
        try {
          const latency = latencyStats(store.listTaskTimings(), model, window);
          return result(
            { latency },
            `Returned latency for ${latency.count} recorded tasks of ${model}. This does not select a model.`,
          );
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "usage_report",
      title: "Read measured engineering token usage",
      description:
        "Use this when the user asks how many Codex tokens the control plane has measured across tasks.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler() {
        return result(
          { usage: store.usageReport() },
          "Returned measured usage totals.",
        );
      },
    },
  ];
}

export function createMcpHandler({ orchestrator, store, config }) {
  const transports = new Map();
  const idleTimeoutMs = config.server.mcpSessionIdleMinutes * 60 * 1000;
  const toolSpecs = buildToolSpecs({ orchestrator, store, config });
  const serverInfo = {
    ...SERVER_INFO,
    version: config.version ?? readPackageVersion(),
  };

  function buildServer() {
    // Compact briefs need far fewer entries; bound validation work as well as
    // the HTTP parser's existing 1 MiB body cap (GHSA-46jr-4wx8-v453).
    const server = new McpServer(serverInfo, { maxToolInputElements: 10_000 });
    for (const spec of toolSpecs) {
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: spec.inputSchema,
          annotations: spec.annotations,
        },
        spec.handler,
      );
    }
    return server;
  }

  // OpenAI sends `server/discover` as a stateless JSON-RPC request (no MCP
  // session) while connecting a remote connector. It expects a single result
  // describing the server and its tools, so the connector flow can preview and
  // register them before any standard `initialize`/`tools/list` handshake.
  function discoverResult() {
    return {
      protocolVersion: DISCOVERY_PROTOCOL_VERSION,
      serverInfo,
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
      },
      instructions: SERVER_INSTRUCTIONS,
      tools: toolSpecs.map((spec) => ({
        name: spec.name,
        title: spec.title,
        description: spec.description,
        inputSchema: toJsonSchema(spec.inputSchema),
        annotations: spec.annotations,
      })),
      resources: [],
      prompts: [],
    };
  }

  function closeSession(id) {
    const entry = transports.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    transports.delete(id);
    entry.transport.close().catch(() => {});
  }

  function touchSession(id, transport) {
    const existing = transports.get(id);
    if (existing?.timer) clearTimeout(existing.timer);
    const timer = setTimeout(() => closeSession(id), idleTimeoutMs);
    timer.unref?.();
    transports.set(id, { transport, timer });
  }

  return async function handleMcp(request, response, parsedBody) {
    // OpenAI connector discovery: stateless, before any session exists.
    if (parsedBody?.method === "server/discover") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsedBody.id ?? null,
          result: discoverResult(),
        }),
      );
      return;
    }

    const sessionId = request.headers["mcp-session-id"];
    let transport = sessionId ? transports.get(sessionId)?.transport : null;
    if (sessionId && transport) touchSession(sessionId, transport);

    if (!transport && request.method === "POST" && isInitializeRequest(parsedBody)) {
      if (transports.size >= config.server.maxMcpSessions) {
        response.writeHead(503, {
          "content-type": "application/json",
          "retry-after": "30",
        });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "MCP session limit reached" },
            id: parsedBody?.id ?? null,
          }),
        );
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => touchSession(id, transport),
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          const entry = transports.get(transport.sessionId);
          if (entry?.timer) clearTimeout(entry.timer);
          transports.delete(transport.sessionId);
        }
      };
      const server = buildServer();
      await server.connect(transport);
    } else if (!transport) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Invalid or missing MCP session" },
          id: null,
        }),
      );
      return;
    }
    await transport.handleRequest(request, response, parsedBody);
  };
}
