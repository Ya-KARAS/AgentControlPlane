import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ControlPlaneError } from "../core/errors.js";
import {
  EXECUTION_REPORT_INSTRUCTION,
  normalizeExecutionReportText,
} from "../core/execution-report.js";
import { normalizeUsage } from "../core/usage-events.js";
import { ExecutorAdapter } from "./executor.js";

const TOOLS = [
  {
    type: "function",
    name: "read_file",
    description: "Read a UTF-8 file inside the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "write_file",
    description: "Write a UTF-8 file inside the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace." },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "shell",
    description: "Run a shell command with the workspace as the working directory.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
];

const TOOLS_CHAT = TOOLS.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveInsideWorkspace(workspace, inputPath) {
  const target = path.resolve(workspace, inputPath);
  if (!isInside(workspace, target)) {
    throw new ControlPlaneError(
      "tool_path_denied",
      `Path is outside the workspace: ${inputPath}`,
    );
  }
  return target;
}

function encodeHeaderValue(value) {
  return encodeURIComponent(String(value));
}

function runShell(workspace, command, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: workspace,
      shell: true,
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        WINDIR: process.env.WINDIR ?? "",
        TEMP: process.env.TEMP ?? "",
        TMP: process.env.TMP ?? "",
        USERPROFILE: process.env.USERPROFILE ?? "",
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(0, 4000);
      resolve({ ok: code === 0, exitCode: code, output });
    });
  });
}

export function computeCompletionWait(timestamps, limit, nowMs, windowMs = 60000) {
  if (!limit || Number(limit) <= 0) return { waitMs: 0, next: null };
  const recent = timestamps.filter((at) => at > nowMs - windowMs);
  if (recent.length < limit) {
    return { waitMs: 0, next: [...recent, nowMs] };
  }
  const waitMs = Math.max(0, recent[0] + windowMs - nowMs + 5);
  return { waitMs, next: [...recent.slice(1), nowMs + waitMs] };
}

export class OpenAICompatibleExecutor extends ExecutorAdapter {
  #completionTimes = [];
  #resolvedProtocol = null;
  #modelCapabilities = new Map();

  constructor({
    id = "openai-compatible",
    displayName = "OpenAI Compatible",
    baseUrl,
    apiKey = null,
    model = "deepseek/deepseek-v4-pro",
    protocol = "responses",
    requestTimeoutMs = 30000,
    maxToolRounds = 20,
    workspaceRoots = [],
    models = [],
    requestsPerMinute = null,
    official = false,
    version = null,
  } = {}) {
    super({
      id,
      displayName,
      capabilities: {
        persistentThreads: false,
        tokenUsage: true,
        hardInterrupt: true,
        subagents: false,
      },
    });
    this.kind = "model-endpoint";
    this.staticModels = Array.isArray(models)
      ? models.map((entry) => String(entry))
      : [];
    if (baseUrl && typeof baseUrl === "string") {
      this.baseUrl = baseUrl.replace(/\/+$/, "");
    } else {
      this.baseUrl = null;
    }
    this.apiKey = apiKey ?? null;
    this.model = model;
    this.protocol = ["chat", "auto"].includes(protocol)
      ? protocol
      : "responses";
    this.official = official === true;
    this.version = typeof version === "string" && version ? version : null;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxToolRounds = maxToolRounds;
    this.workspaceRoots = workspaceRoots;
    const rpm = Number(requestsPerMinute);
    this.requestsPerMinute = Number.isFinite(rpm) && rpm > 0 ? rpm : null;
    this.goals = new Map();
    this.turns = new Map();
  }

  async probe() {
    let parsed;
    try {
      parsed = new URL(this.baseUrl);
    } catch {
      return {
        available: false,
        status: "unavailable",
        reason: "invalid_base_url",
      };
    }
    const local = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    if (this.protocol === "auto" || this.#resolvedProtocol) {
      if (!local && !this.apiKey) {
        return {
          available: false,
          status: "unavailable",
          reason: "missing_api_key",
        };
      }
      const detection = await this.#resolveProtocolOnce();
      return {
        available: Boolean(detection.protocol),
        status: detection.protocol ? "available" : "degraded",
        reason: detection.protocol
          ? null
          : detection.reason ?? "tool_loop_unsupported",
        protocols: {
          chat: detection.chat,
          responses: detection.responses,
          selected: detection.protocol,
          probe_model: detection.model,
          preferred_protocol: detection.preferred_protocol ?? null,
          probe_order: detection.probe_order ?? null,
          probe_usage: detection.probe_usage ?? {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
          },
        },
      };
    }
    if (!local) {
      return this.apiKey
        ? { available: true, status: "configured", reason: null }
        : {
            available: false,
            status: "unavailable",
            reason: "missing_api_key",
          };
    }
    try {
      await this.#fetchJson("GET", "/models");
      return { available: true, status: "available", reason: null };
    } catch (error) {
      return {
        available: false,
        status: "unavailable",
        reason: "endpoint_unreachable",
        detail: error.message,
      };
    }
  }

  async #resolveProtocolOnce() {
    if (this.#resolvedProtocol) return this.#resolvedProtocol;
    if (this.protocol !== "auto") {
      return { protocol: this.protocol, chat: {}, responses: {}, reason: null };
    }
    const detection = await this.#detectProtocol();
    if (detection.protocol) this.protocol = detection.protocol;
    this.#resolvedProtocol = detection;
    return detection;
  }

  async #ensureProtocol() {
    if (this.protocol !== "auto") return this.protocol;
    const detection = await this.#resolveProtocolOnce();
    if (detection.protocol) return detection.protocol;
    throw new ControlPlaneError(
      "protocol_detection_failed",
      detection.reason ?? "No protocol completed the agent tool loop",
      { detection },
    );
  }

  async #pickProbeModels() {
    const candidates = [];
    if (this.model) candidates.push(this.model);
    for (const entry of this.staticModels) candidates.push(entry);
    const catalog = (await this.listModels()).data ?? [];
    const capable = catalog.filter(
      (entry) =>
        entry.capabilities?.chat === true ||
        entry.capabilities?.tools === true ||
        entry.capabilities?.responses === true,
    );
    for (const entry of capable) candidates.push(entry.id ?? entry.model);
    for (const entry of catalog) candidates.push(entry.id ?? entry.model);
    return {
      candidates: [...new Set(candidates.filter(Boolean))].slice(0, 3),
      catalog,
    };
  }

  async #probeModelProtocol(model, probeToolResponses, probeToolChat, order) {
    const outcome = {
      responses: { available: false, toolLoop: null },
      chat: { available: false, toolLoop: null },
      reasoning: null,
      probe_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
    const probeMeta = {
      threadId: null,
      turnId: null,
      taskKind: "production",
      requestKind: "protocol_probe",
      model,
      requestedModel: null,
    };
    const statusOf = (error) => Number(error?.details?.status ?? 0);
    const addProbeUsage = (usage) => {
      if (!usage) return;
      const input =
        Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
      const output =
        Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
      const total = Number(usage.total_tokens ?? 0);
      outcome.probe_usage.input_tokens += input;
      outcome.probe_usage.output_tokens += output;
      outcome.probe_usage.total_tokens += total || input + output;
    };
    const recordReasoning = (usage) => {
      if (
        !usage ||
        typeof usage.completion_tokens_details?.reasoning_tokens !== "number"
      ) {
        return;
      }
      outcome.reasoning =
        outcome.reasoning ??
        usage.completion_tokens_details.reasoning_tokens > 0;
    };

    const probeChat = async () => {
      try {
        const chatResponse = await this.#requestCompletion("/chat/completions", {
          model,
          messages: [
            { role: "user", content: "Call the ping tool exactly once." },
          ],
          tools: [probeToolChat],
          stream: false,
          max_tokens: 1024,
        }, null, null, null, probeMeta);
        outcome.chat.available = true;
        const message = chatResponse?.choices?.[0]?.message ?? {};
        outcome.chat.toolLoop = Array.isArray(message.tool_calls)
          ? message.tool_calls.some((call) => call?.function?.name === "ping")
          : false;
        recordReasoning(chatResponse?.usage);
        addProbeUsage(chatResponse?.usage);
      } catch (error) {
        const status = statusOf(error);
        outcome.chat.available = ![404, 405, 0].includes(status);
        if (outcome.chat.available) outcome.chat.toolLoop = false;
      }
    };

    const probeResponses = async () => {
      let responsesStatus = 0;
      try {
        const availability = await this.#requestCompletion("/responses", {
          model,
          instructions: "Reply with the word pong.",
          input: "ping",
          stream: false,
          max_output_tokens: 1024,
        }, null, null, null, probeMeta);
        responsesStatus = 200;
        recordReasoning(availability?.usage);
        addProbeUsage(availability?.usage);
      } catch (error) {
        responsesStatus = statusOf(error);
      }
      if ([404, 405, 0].includes(responsesStatus)) {
        outcome.responses.available = false;
        return;
      }
      outcome.responses.available = true;
      try {
        const toolResponse = await this.#requestCompletion("/responses", {
          model,
          instructions: "Call the ping tool exactly once.",
          input: "ping",
          tools: [probeToolResponses],
          stream: false,
          max_output_tokens: 1024,
        }, null, null, null, probeMeta);
        const output = Array.isArray(toolResponse?.output) ? toolResponse.output : [];
        outcome.responses.toolLoop = output.some(
          (item) => item.type === "function_call" && item.name === "ping",
        );
        recordReasoning(toolResponse?.usage);
        addProbeUsage(toolResponse?.usage);
      } catch {
        outcome.responses.toolLoop = false;
      }
    };

    const first = order[0] === "chat" ? probeChat : probeResponses;
    const second = order[0] === "chat" ? probeResponses : probeChat;
    await first();
    const firstPassed =
      order[0] === "chat"
        ? outcome.chat.toolLoop === true
        : outcome.responses.toolLoop === true;
    if (!firstPassed) await second();
    return outcome;
  }

  async #detectProtocol() {
    const probeToolResponses = {
      type: "function",
      name: "ping",
      description: "Reply with pong.",
      parameters: { type: "object", properties: {} },
    };
    const probeToolChat = {
      type: "function",
      function: {
        name: "ping",
        description: "Reply with pong.",
        parameters: { type: "object", properties: {} },
      },
    };
    const { candidates, catalog } = await this.#pickProbeModels();
    const result = {
      protocol: null,
      model: candidates[0] ?? null,
      responses: { available: false, toolLoop: null },
      chat: { available: false, toolLoop: null },
      reasoning: null,
      reason: null,
      probe_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
    if (candidates.length === 0) {
      result.reason = "no_model_to_probe";
      return result;
    }
    const firstCandidate = candidates[0];
    const preferred =
      catalog.find((entry) => (entry.id ?? entry.model) === firstCandidate)
        ?.preferred_protocol ??
      catalog.find(
        (entry) =>
          entry.preferred_protocol === "chat" ||
          entry.preferred_protocol === "responses",
      )?.preferred_protocol ??
      null;
    const order =
      preferred === "chat" ? ["chat", "responses"] : ["responses", "chat"];
    result.preferred_protocol = preferred;
    result.probe_order = order;
    for (const model of candidates) {
      result.model = model;
      const outcome = await this.#probeModelProtocol(
        model,
        probeToolResponses,
        probeToolChat,
        order,
      );
      result.responses = outcome.responses;
      result.chat = outcome.chat;
      if (outcome.reasoning != null) result.reasoning = outcome.reasoning;
      result.probe_usage.input_tokens += outcome.probe_usage.input_tokens;
      result.probe_usage.output_tokens += outcome.probe_usage.output_tokens;
      result.probe_usage.total_tokens += outcome.probe_usage.total_tokens;
      if (outcome.responses.toolLoop) {
        result.protocol = "responses";
        this.#modelCapabilities.set(model, {
          chat: false,
          responses: true,
          tools: true,
          reasoning: outcome.reasoning,
          vision: null,
        });
        break;
      }
      if (outcome.chat.toolLoop) {
        result.protocol = "chat";
        this.#modelCapabilities.set(model, {
          chat: true,
          responses: false,
          tools: true,
          reasoning: outcome.reasoning,
          vision: null,
        });
        break;
      }
    }
    if (!result.protocol) {
      const anyAvailable =
        result.responses.available || result.chat.available;
      result.reason = anyAvailable
        ? "tool_loop_unsupported"
        : "endpoint_unreachable";
    }
    if (this.protocol === "auto" && result.protocol) {
      this.protocol = result.protocol;
    }
    return result;
  }

  async start() {
    this.ready = true;
  }

  async stop() {
    this.ready = false;
    for (const turn of this.turns.values()) {
      turn.controller?.abort();
    }
    this.turns.clear();
  }

  request() {
    return Promise.reject(
      new ControlPlaneError(
        "unsupported",
        "OpenAICompatibleExecutor exposes the lifecycle methods directly",
      ),
    );
  }

  respond() {}

  async listModels() {
    try {
      const body = await this.#fetchJson("GET", "/models");
      const data = Array.isArray(body?.data) ? body.data : [];
      return {
        data: data
          .map((entry) => this.#normalizeCatalogEntry(entry))
          .filter((entry) => entry.id),
      };
    } catch {
      return { data: [] };
    }
  }

  #normalizeCatalogEntry(entry) {
    const id = String(entry?.id ?? entry?.model ?? "");
    const declared =
      entry?.capabilities && typeof entry.capabilities === "object"
        ? entry.capabilities
        : null;
    const probed = this.#modelCapabilities.get(id) ?? null;
    const capabilities = declared
      ? {
          chat: declared.chat != null ? Boolean(declared.chat) : null,
          responses:
            declared.responses != null ? Boolean(declared.responses) : null,
          tools: declared.tools != null ? Boolean(declared.tools) : null,
          reasoning: declared.reasoning ?? null,
          vision: declared.vision ?? null,
        }
      : probed
        ? { ...probed }
        : null;
    const metadata = entry?.metadata && typeof entry.metadata === "object"
      ? entry.metadata
      : {};
    return {
      id,
      model: id,
      displayName: id,
      isDefault: Boolean(id && id === this.model),
      capabilities,
      featured: metadata.featured ?? entry?.featured ?? null,
      route_tier: metadata.routeTier ?? entry?.routeTier ?? null,
      preferred_protocol:
        entry?.preferred_protocol ??
        entry?.preferredProtocol ??
        metadata.preferred_protocol ??
        null,
      route_health: entry?.route_health ?? metadata.route_health ?? null,
      latency: entry?.latency ?? metadata.latency ?? null,
      pricing: entry?.pricing ?? metadata.pricing ?? null,
      status: entry?.status ?? metadata.status ?? null,
      context: entry?.context ?? metadata.context ?? null,
      tier: entry?.tier ?? metadata.tier ?? null,
    };
  }

  async getSandboxReadiness() {
    return { status: "ready" };
  }

  async startThread({ cwd } = {}) {
    const threadId = randomUUID();
    this.goals.set(threadId, {
      objective: "",
      tokenBudget: 0,
      tokensUsed: 0,
      status: "active",
    });
    return { thread: { id: threadId, cwd: cwd ?? null } };
  }

  async resumeThread({ threadId } = {}) {
    if (!this.goals.has(threadId)) {
      throw new ControlPlaneError(
        "thread_not_found",
        `Unknown thread: ${threadId}`,
      );
    }
    return { thread: { id: threadId, turns: [] } };
  }

  async setGoal({ threadId, objective, tokenBudget } = {}) {
    const goal = this.goals.get(threadId);
    if (!goal) {
      throw new ControlPlaneError(
        "thread_not_found",
        `Unknown thread: ${threadId}`,
      );
    }
    goal.objective = objective ?? goal.objective;
    goal.tokenBudget = Number(tokenBudget ?? goal.tokenBudget ?? 0);
    goal.status = "active";
    return {};
  }

  async getGoal({ threadId } = {}) {
    const goal = this.goals.get(threadId);
    if (!goal) return { goal: null };
    const status =
      goal.tokenBudget > 0 && goal.tokensUsed >= goal.tokenBudget
        ? "budgetLimited"
        : goal.status;
    return {
      goal: {
        threadId,
        status,
        tokenBudget: goal.tokenBudget,
        tokensUsed: goal.tokensUsed,
      },
    };
  }

  async startTurn(params) {
    const { threadId, input, model, cwd, outputSchema, attribution } =
      params ?? {};
    const turnId = randomUUID();
    const controller = new AbortController();
    const retryCounter = { count: 0 };
    this.turns.set(turnId, { controller, threadId, cwd, retryCounter });
    queueMicrotask(() => {
      this.#runTurn(turnId, {
        threadId,
        input,
        model,
        cwd,
        outputSchema,
        attribution,
        retryCounter,
      }).catch(
        (error) => {
          this.emit("notification", {
            method: "turn/completed",
            params: {
              threadId,
              turn: {
                id: turnId,
                status: "failed",
                error: { message: error.message },
                items: [],
                retries: retryCounter.count,
              },
            },
          });
        },
      );
    });
    return { turn: { id: turnId } };
  }

  async interruptTurn({ turnId } = {}) {
    const turn = this.turns.get(turnId);
    turn?.controller?.abort();
    this.turns.delete(turnId);
    return {};
  }

  async #runTurn(
    turnId,
    { threadId, input, model, cwd, outputSchema, attribution, retryCounter },
  ) {
    const protocol = await this.#ensureProtocol();
    const eventMeta = {
      threadId,
      turnId,
      taskKind: attribution?.taskKind ?? "production",
      requestKind: "task_execution",
      model: model ?? this.model,
      requestedModel: attribution?.requestedModel ?? null,
    };
    if (protocol === "chat") {
      return this.#runChatTurn(turnId, {
        threadId,
        input,
        model,
        cwd,
        outputSchema,
        attribution,
        retryCounter,
        eventMeta,
      });
    }
    const controller = this.turns.get(turnId)?.controller;
    const brief = this.#extractBrief(input);
    const instructions = this.#buildInstructions(outputSchema);
    const inputItems = [
      { role: "user", content: brief },
    ];
    let usage = this.#zeroUsage();

    for (let round = 0; round < this.maxToolRounds; round += 1) {
      if (controller?.signal.aborted) break;
      const response = await this.#responses(
        inputItems,
        {
          model: model ?? this.model,
          instructions,
          controller,
          attribution,
          retryCounter,
          eventMeta,
        },
      );
      usage = this.#addUsage(usage, response.usage);
      const goal = this.goals.get(threadId);
      if (goal) {
        goal.tokensUsed = Math.max(goal.tokensUsed, usage.total_tokens);
      }
      this.emit("notification", {
        method: "thread/tokenUsage/updated",
        params: {
          threadId,
          turnId,
          tokenUsage: {
            last: this.#toNotifiedUsage(usage),
            total: this.#toNotifiedUsage(usage),
          },
        },
      });
      const output = Array.isArray(response.output) ? response.output : [];
      const toolCalls = output.filter(
        (item) => item.type === "function_call" && typeof item.name === "string",
      );
      if (toolCalls.length === 0) {
        const text = normalizeExecutionReportText(this.#extractFinalText(output));
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId,
            turn: {
              id: turnId,
              status: "completed",
              retries: retryCounter?.count ?? 0,
              items: [
                {
                  type: "agentMessage",
                  phase: "final_answer",
                  text,
                },
              ],
            },
          },
        });
        return;
      }

      for (const item of output) {
        if (item.type === "reasoning") {
          inputItems.push({
            type: "reasoning",
            content: item.content ?? [],
          });
        }
      }
      for (const call of toolCalls) {
        const result = await this.#executeTool(call, cwd);
        const callId = call.call_id ?? call.id;
        inputItems.push({
          type: "function_call",
          call_id: callId,
          name: call.name,
          arguments:
            typeof call.arguments === "string"
              ? call.arguments
              : JSON.stringify(call.arguments ?? {}),
          status: "completed",
        });
        inputItems.push({
          type: "function_call_output",
          call_id: callId,
          output: result,
          summary: String(result).slice(0, 200),
        });
      }
    }

    throw new ControlPlaneError(
      "tool_round_limit",
      `Exceeded ${this.maxToolRounds} tool rounds`,
    );
  }

  #extractBrief(input) {
    const text = Array.isArray(input)
      ? input
          .map((item) => (typeof item?.text === "string" ? item.text : ""))
          .filter(Boolean)
          .join("\n")
      : typeof input === "string"
        ? input
        : "";
    return text || "Complete the task.";
  }

  #buildInstructions(outputSchema) {
    let schemaLine = "";
    if (outputSchema && typeof outputSchema === "object") {
      try {
        schemaLine = `\nReturn a JSON object matching this schema:\n${JSON.stringify(outputSchema)}`;
      } catch {
        schemaLine = "";
      }
    }
    return [
      "You are a secure software engineering execution agent.",
      "Work only inside the provided workspace using the read_file, write_file, and shell tools.",
      "Verify your changes and return a compact final report.",
      EXECUTION_REPORT_INSTRUCTION,
      schemaLine,
    ]
      .filter(Boolean)
      .join("\n");
  }

  #extractFinalText(output) {
    const message = output.findLast(
      (item) => item.type === "message" || item.type === "output_text",
    );
    if (message?.content && Array.isArray(message.content)) {
      const text = message.content
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("");
      if (text) return text;
    }
    if (typeof message?.text === "string") return message.text;
    const raw = output.findLast((item) => typeof item.text === "string");
    return raw?.text ?? "{}";
  }

  async #executeTool(call, cwd) {
    let args = call.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    try {
      if (call.name === "read_file") {
        const target = resolveInsideWorkspace(cwd, args.path);
        const text = fs.readFileSync(target, "utf8").slice(0, 4000);
        return JSON.stringify({ ok: true, content: text });
      }
      if (call.name === "write_file") {
        const target = resolveInsideWorkspace(cwd, args.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, String(args.content ?? ""), "utf8");
        return JSON.stringify({ ok: true, wrote: target });
      }
      if (call.name === "shell") {
        const result = await runShell(cwd, String(args.command ?? ""));
        return JSON.stringify(result);
      }
      return JSON.stringify({ ok: false, error: `Unknown tool: ${call.name}` });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #runChatTurn(
    turnId,
    { threadId, input, model, cwd, outputSchema, attribution, retryCounter, eventMeta },
  ) {
    const controller = this.turns.get(turnId)?.controller;
    const brief = this.#extractBrief(input);
    const instructions = this.#buildInstructions(outputSchema);
    const messages = [
      { role: "system", content: instructions },
      { role: "user", content: brief },
    ];
    let usage = this.#zeroUsage();

    for (let round = 0; round < this.maxToolRounds; round += 1) {
      if (controller?.signal.aborted) break;
      const response = await this.#callChat(
        messages,
        {
          model: model ?? this.model,
          controller,
        },
        attribution,
        retryCounter,
        eventMeta,
      );
      usage = this.#addUsage(usage, response.usage);
      const goal = this.goals.get(threadId);
      if (goal) {
        goal.tokensUsed = Math.max(goal.tokensUsed, usage.total_tokens);
      }
      this.emit("notification", {
        method: "thread/tokenUsage/updated",
        params: {
          threadId,
          turnId,
          tokenUsage: {
            last: this.#toNotifiedUsage(usage),
            total: this.#toNotifiedUsage(usage),
          },
        },
      });

      if (response.toolCalls.length === 0) {
        const text = normalizeExecutionReportText(response.finalText);
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId,
            turn: {
              id: turnId,
              status: "completed",
              retries: retryCounter?.count ?? 0,
              items: [{ type: "agentMessage", phase: "final_answer", text }],
            },
          },
        });
        return;
      }

      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.rawToolCalls,
      });
      for (const call of response.toolCalls) {
        const result = await this.#executeTool(
          { name: call.name, arguments: call.arguments },
          cwd,
        );
        messages.push({
          role: "tool",
          tool_call_id: call.callId,
          content: result,
        });
      }
    }

    throw new ControlPlaneError(
      "tool_round_limit",
      `Exceeded ${this.maxToolRounds} tool rounds`,
    );
  }

  async #callChat(
    messages,
    { model, controller },
    attribution = null,
    retryCounter = null,
    eventMeta = null,
  ) {
    const body = {
      model,
      messages,
      tools: TOOLS_CHAT,
      stream: false,
      max_tokens: 4000,
    };
    const response = await this.#requestCompletion(
      "/chat/completions",
      body,
      controller,
      attribution,
      retryCounter,
      eventMeta,
    );
    const message = response?.choices?.[0]?.message ?? {};
    const rawToolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [];
    const toolCalls = rawToolCalls.map((call) => ({
      callId: call.id,
      name: call.function?.name,
      arguments:
        typeof call.function?.arguments === "string"
          ? call.function.arguments
          : JSON.stringify(call.function?.arguments ?? {}),
    }));
    return {
      content: typeof message.content === "string" ? message.content : null,
      toolCalls,
      rawToolCalls,
      finalText: typeof message.content === "string" ? message.content : "",
      usage: this.#normalizeChatUsage(response?.usage),
    };
  }

  #normalizeChatUsage(usage) {
    if (!usage) return this.#zeroUsage();
    return {
      input_tokens: Number(usage.prompt_tokens ?? 0),
      cached_input_tokens: Number(
        usage.prompt_tokens_details?.cached_tokens ?? 0,
      ),
      output_tokens: Number(usage.completion_tokens ?? 0),
      reasoning_output_tokens: Number(
        usage.completion_tokens_details?.reasoning_tokens ?? 0,
      ),
      total_tokens: Number(usage.total_tokens ?? 0),
    };
  }

  async #responses(
    inputItems,
    { model, instructions, controller, attribution, retryCounter, eventMeta },
  ) {
    const body = {
      model,
      instructions,
      input: inputItems,
      tools: TOOLS,
      stream: false,
      max_output_tokens: 4000,
    };
    const response = await this.#requestCompletion(
      "/responses",
      body,
      controller,
      attribution,
      retryCounter,
      eventMeta,
    );
    return {
      output: response?.output ?? [],
      usage: response?.usage ?? this.#zeroUsage(),
    };
  }

  async #paceCompletionRequest() {
    if (!this.requestsPerMinute) return;
    const { waitMs, next } = computeCompletionWait(
      this.#completionTimes,
      this.requestsPerMinute,
      Date.now(),
    );
    this.#completionTimes = next ?? [];
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  async #requestCompletion(
    pathname,
    body,
    controller,
    attribution = null,
    retryCounter = null,
    eventMeta = null,
  ) {
    for (let attempt = 1; ; attempt += 1) {
      await this.#paceCompletionRequest();
      const headers = { "content-type": "application/json" };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      headers["x-acp-executor"] = this.id;
      if (attribution?.taskId) {
        headers["x-acp-task-id"] = String(attribution.taskId);
      }
      if (attribution?.workspace) {
        headers["x-acp-project"] = encodeHeaderValue(
          path.basename(String(attribution.workspace)),
        );
      }
      if (eventMeta?.turnId) headers["x-acp-turn-id"] = String(eventMeta.turnId);
      if (eventMeta?.taskKind) {
        headers["x-acp-task-kind"] = String(eventMeta.taskKind);
      }
      if (eventMeta?.requestKind) {
        headers["x-acp-request-kind"] = String(eventMeta.requestKind);
      }
      headers["x-acp-attempt"] = String(attempt);
      if (this.version) headers["x-acp-version"] = this.version;
      if (attribution?.recommendationId) {
        headers["x-acp-recommendation-id"] = String(attribution.recommendationId);
      }
      const startedAt = Date.now();
      let response;
      try {
        response = await fetch(`${this.baseUrl}${pathname}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller?.signal,
        });
      } catch (error) {
        this.#emitUsageEvent(eventMeta, {
          attempt,
          durationMs: Date.now() - startedAt,
          outcome: "error",
          asterrouteRequestId: null,
          upstreamRequestId: null,
          usage: null,
        });
        throw error;
      }
      const durationMs = Date.now() - startedAt;
      const asterrouteHeaderId = response.headers.get("x-asterroute-request-id");
      const upstreamHeaderId = response.headers.get("x-asterroute-provider-request-id");
      if (response.status === 429 && attempt <= 2) {
        if (retryCounter) retryCounter.count += 1;
        this.#emitUsageEvent(eventMeta, {
          attempt,
          durationMs,
          outcome: "error",
          asterrouteRequestId: asterrouteHeaderId,
          upstreamRequestId: upstreamHeaderId,
          usage: null,
        });
        const retryAfter = Number(response.headers.get("retry-after"));
        const delayMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(30000, retryAfter * 1000)
            : 2000 * attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        this.#emitUsageEvent(eventMeta, {
          attempt,
          durationMs,
          outcome: "error",
          asterrouteRequestId: asterrouteHeaderId,
          upstreamRequestId: upstreamHeaderId,
          usage: null,
        });
        throw new ControlPlaneError(
          "upstream_error",
          `OpenAI-compatible endpoint returned ${response.status}: ${text.slice(0, 200)}`,
          { status: response.status },
        );
      }
      const payload = await response.json();
      const asterrouteRequestId = asterrouteHeaderId ?? null;
      this.#emitUsageEvent(eventMeta, {
        attempt,
        durationMs,
        outcome: "ok",
        asterrouteRequestId,
        upstreamRequestId: upstreamHeaderId ?? null,
        usage: payload?.usage,
      });
      return payload;
    }
  }

  #emitUsageEvent(eventMeta, info) {
    if (!eventMeta) return;
    this.emit("notification", {
      method: "usage/request",
      params: {
        threadId: eventMeta.threadId ?? null,
        turnId: eventMeta.turnId ?? null,
        taskKind: eventMeta.taskKind ?? "production",
        requestKind: eventMeta.requestKind ?? "task_execution",
        attempt: info.attempt,
        durationMs: info.durationMs,
        outcome: info.outcome,
        asterrouteRequestId: info.asterrouteRequestId,
        upstreamRequestId: info.upstreamRequestId,
        usage: normalizeUsage(info.usage),
        protocol: this.protocol,
        requestedModel: eventMeta.requestedModel ?? null,
        resolvedModel: eventMeta.model ?? null,
      },
    });
  }

  async #fetchJson(method, pathname, body, controller) {
    const headers = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ControlPlaneError(
        "upstream_error",
        `OpenAI-compatible endpoint returned ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    return response.json();
  }

  #zeroUsage() {
    return {
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 0,
    };
  }

  #addUsage(current, usage) {
    if (!usage) return current;
    const inputTokens = Number(usage.input_tokens ?? 0);
    return {
      input_tokens: current.input_tokens + inputTokens,
      cached_input_tokens:
        current.cached_input_tokens + Number(usage.input_tokens_details?.cached_tokens ?? 0),
      output_tokens: current.output_tokens + Number(usage.output_tokens ?? 0),
      reasoning_output_tokens:
        current.reasoning_output_tokens +
        Number(usage.output_tokens_details?.reasoning_tokens ?? 0),
      total_tokens: current.total_tokens + Number(usage.total_tokens ?? 0),
    };
  }

  #toNotifiedUsage(usage) {
    return {
      inputTokens: usage.input_tokens,
      cachedInputTokens: usage.cached_input_tokens,
      outputTokens: usage.output_tokens,
      reasoningOutputTokens: usage.reasoning_output_tokens,
      totalTokens: usage.total_tokens,
    };
  }
}
