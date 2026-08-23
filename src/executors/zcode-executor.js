import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ControlPlaneError } from "../core/errors.js";
import { ExecutorAdapter, formatCliExitError } from "./executor.js";
import { readCommandVersion, resolveExecutable } from "./discovery.js";

const ZERO_USAGE = Object.freeze({
  input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: 0,
});

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function selectedProviderId(settings, providers) {
  const selected = Object.values(
    settings?.modelProviderFamilySelectedKeys ?? {},
  ).filter((value) => typeof value === "string");
  for (const value of selected) {
    const match = Object.keys(providers).find(
      (providerId) => value === providerId || value.endsWith(`:${providerId}`),
    );
    if (match) {
      if (match.includes("start-plan")) {
        const codingPlan = Object.entries(providers).find(
          ([providerId, provider]) =>
            providerId.includes("coding-plan") &&
            !providerId.includes("start-plan") &&
            typeof provider?.options?.apiKey === "string" &&
            provider.options.apiKey.length > 0,
        )?.[0];
        if (codingPlan) return codingPlan;
      }
      return match;
    }
  }
  return (
    Object.entries(providers).find(
      ([, provider]) => provider?.enabled === true && provider?.options?.apiKey,
    )?.[0] ?? null
  );
}

export function readZCodeDesktopModel(
  root = path.join(os.homedir(), ".zcode", "v2"),
) {
  const config = readJson(path.join(root, "config.json"));
  const settings = readJson(path.join(root, "setting.json"));
  const providers = config?.provider;
  if (!providers || typeof providers !== "object") return null;
  const providerId = selectedProviderId(settings, providers);
  const provider = providerId ? providers[providerId] : null;
  if (!provider) return null;
  const models =
    provider.models && typeof provider.models === "object"
      ? provider.models
      : {};
  const modelIds = Object.keys(models);
  const defaultModel = modelIds.includes("GLM-5.3")
    ? "GLM-5.3"
    : modelIds[0] ?? null;
  const apiKey = provider.options?.apiKey;
  const baseURL = provider.options?.baseURL;
  if (!defaultModel || typeof apiKey !== "string" || !apiKey || !baseURL) {
    return null;
  }
  return {
    providerId,
    providerName: String(provider.name ?? providerId),
    kind: String(provider.kind ?? "openai-compatible"),
    baseURL: String(baseURL),
    apiKey,
    defaultModel,
    models,
  };
}

export function zcodeModelsFromDesktop(desktop, selectedModel = null) {
  if (!desktop) return [];
  const defaultModel = selectedModel ?? desktop.defaultModel;
  return Object.entries(desktop.models ?? {}).map(([modelId, metadata]) => {
    const variants = Array.isArray(metadata?.reasoning?.variants)
      ? metadata.reasoning.variants
      : [];
    return {
      id: modelId,
      model: modelId,
      displayName: String(metadata?.name ?? modelId),
      isDefault: modelId === defaultModel,
      status: "active",
      capabilities: {
        chat: true,
        tools: true,
        vision: metadata?.modalities?.input?.includes?.("image") === true,
      },
      context: Number.isFinite(metadata?.limit?.context)
        ? { window: metadata.limit.context }
        : null,
      supportedReasoningEfforts: [],
      advertisedReasoningEfforts: variants,
      provider: desktop.providerId,
    };
  });
}

function safeZCodeModelMetadata(models) {
  return Object.fromEntries(
    Object.entries(models ?? {}).map(([modelId, metadata]) => [
      modelId,
      {
        ...(metadata?.name == null ? {} : { name: String(metadata.name) }),
        ...(metadata?.reasoning == null
          ? {}
          : { reasoning: metadata.reasoning }),
        ...(metadata?.limit == null ? {} : { limit: metadata.limit }),
        ...(metadata?.modalities == null
          ? {}
          : { modalities: metadata.modalities }),
      },
    ]),
  );
}

export function resolveZCodeInvocation({
  command = null,
  localAppData = process.env.LOCALAPPDATA,
  programFiles = process.env.ProgramFiles,
} = {}) {
  const explicit = command ?? process.env.ZCODE_CLI_PATH ?? null;
  if (explicit) {
    if (/\.(?:cjs|mjs|js)$/i.test(explicit) && fs.existsSync(explicit)) {
      return {
        command: process.execPath,
        prefixArgs: [path.resolve(explicit)],
        scriptPath: path.resolve(explicit),
      };
    }
    const executable = resolveExecutable(explicit);
    if (executable) {
      return { command: executable, prefixArgs: [], scriptPath: null };
    }
  }
  const candidates = [
    localAppData &&
      path.join(
        localAppData,
        "Programs",
        "ZCode",
        "resources",
        "glm",
        "zcode.cjs",
      ),
    programFiles &&
      path.join(programFiles, "ZCode", "resources", "glm", "zcode.cjs"),
  ].filter(Boolean);
  const scriptPath = candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  return scriptPath
    ? { command: process.execPath, prefixArgs: [scriptPath], scriptPath }
    : null;
}

export function prepareZCodeRuntime({ desktop, storageRoot, model = null }) {
  if (!desktop) {
    throw new ControlPlaneError(
      "not_configured",
      "ZCode has no enabled desktop model provider.",
    );
  }
  const selectedModel = model ?? desktop.defaultModel;
  if (!Object.hasOwn(desktop.models, selectedModel)) {
    throw new ControlPlaneError(
      "unknown_model",
      `ZCode desktop does not advertise model: ${selectedModel}`,
    );
  }
  const cliRoot =
    path.basename(storageRoot).toLowerCase() === "cli"
      ? storageRoot
      : path.join(storageRoot, "cli");
  fs.mkdirSync(cliRoot, { recursive: true });
  const configPath = path.join(cliRoot, "config.json");
  const existing = readJson(configPath);
  const config = {
    ...(existing && typeof existing === "object" ? existing : {}),
    provider: {
      ...(existing?.provider && typeof existing.provider === "object"
        ? existing.provider
        : {}),
      [desktop.providerId]: {
        name: desktop.providerName,
        kind: desktop.kind,
        options: {
          apiKeyRequired: true,
          baseURL: desktop.baseURL,
        },
        models: safeZCodeModelMetadata(desktop.models),
      },
    },
    model: {
      ...(existing?.model && typeof existing.model === "object"
        ? existing.model
        : {}),
      main: `${desktop.providerId}/${selectedModel}`,
    },
  };
  const temporaryPath = path.join(
    cliRoot,
    `.config.json.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, configPath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
  return {
    configPath,
    selectedModel,
    env: {
      ...process.env,
      ZCODE_API_KEY: desktop.apiKey,
    },
  };
}

export function buildZCodeRunArgs(
  prompt,
  { cwd, sessionId = null, mode = "yolo" } = {},
) {
  const args = ["--prompt", prompt, "--json"];
  if (cwd) args.push("--cwd", cwd);
  if (mode) args.push("--mode", mode);
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

function textFromValue(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) =>
      typeof part === "string"
        ? part
        : typeof part?.text === "string"
          ? part.text
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

export function normalizeZCodeEvents(events) {
  let finalText = "";
  let sessionId = null;
  let status = "completed";
  let usage = { ...ZERO_USAGE };
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    sessionId =
      event.sessionId ??
      event.session_id ??
      event.session?.id ??
      event.result?.sessionId ??
      sessionId;
    const candidate =
      textFromValue(event.result?.response) ||
      textFromValue(event.result?.text) ||
      textFromValue(event.response) ||
      textFromValue(event.message?.content) ||
      textFromValue(event.part?.text) ||
      textFromValue(event.text) ||
      (typeof event.result === "string" ? event.result : "");
    if (candidate) finalText = candidate;
    if (
      event.error ||
      event.status === "failed" ||
      event.result?.status === "failed"
    ) {
      status = "failed";
    }
    const rawUsage = event.usage ?? event.result?.usage;
    if (rawUsage && typeof rawUsage === "object") {
      const input = Number(rawUsage.input_tokens ?? rawUsage.inputTokens ?? 0);
      const output = Number(
        rawUsage.output_tokens ?? rawUsage.outputTokens ?? 0,
      );
      const reasoning = Number(
        rawUsage.reasoning_output_tokens ?? rawUsage.reasoningTokens ?? 0,
      );
      usage = {
        input_tokens: input,
        output_tokens: output,
        reasoning_output_tokens: reasoning,
        total_tokens: Number(
          rawUsage.total_tokens ??
            rawUsage.totalTokens ??
            input + output + reasoning,
        ),
      };
    }
  }
  return { finalText, sessionId, status, usage };
}

export function parseZCodeOutput(output) {
  const text = String(output ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return text
      .split(/\r?\n/)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}

export class ZCodeExecutor extends ExecutorAdapter {
  constructor({
    command = null,
    model = null,
    mode = "yolo",
    workspaceRoots = [],
    storageRoot = path.join(os.homedir(), ".zcode"),
    desktopRoot = path.join(os.homedir(), ".zcode", "v2"),
  } = {}) {
    super({
      id: "zcode",
      displayName: "ZCode",
      capabilities: {
        persistentThreads: false,
        tokenUsage: true,
        hardInterrupt: true,
        subagents: false,
      },
    });
    this.command = command;
    this.model = model;
    this.mode = mode;
    this.workspaceRoots = workspaceRoots;
    this.storageRoot = storageRoot;
    this.desktopRoot = desktopRoot;
    this.invocation = null;
    this.goals = new Map();
    this.turns = new Map();
  }

  async probe() {
    const invocation = resolveZCodeInvocation({ command: this.command });
    if (!invocation) {
      return {
        available: false,
        status: "unavailable",
        reason: "command_not_found",
        command: null,
        version: null,
      };
    }
    this.invocation = invocation;
    const version = await readCommandVersion(
      invocation.command,
      [...invocation.prefixArgs, "--version"],
      8000,
    );
    const desktop = readZCodeDesktopModel(this.desktopRoot);
    if (!desktop) {
      return {
        available: false,
        status: "unavailable",
        reason: "not_configured",
        command: invocation.scriptPath ?? invocation.command,
        version: version.ok ? version.version : null,
        detail:
          "Open ZCode Settings > Model Settings and enable a model provider.",
      };
    }
    prepareZCodeRuntime({
      desktop,
      storageRoot: this.storageRoot,
      model: this.model,
    });
    return {
      available: true,
      status: "available",
      reason: null,
      command: invocation.scriptPath ?? invocation.command,
      version: version.ok ? version.version : null,
      detail: `${desktop.providerName}; ${Object.keys(desktop.models).length} model(s)`,
    };
  }

  async start() {
    this.ready = true;
  }

  async stop() {
    this.ready = false;
    for (const turn of this.turns.values()) {
      try {
        turn.child?.kill();
      } catch {
        // Ignore.
      }
    }
    this.turns.clear();
  }

  request() {
    return Promise.reject(
      new ControlPlaneError(
        "unsupported",
        "ZCodeExecutor exposes the lifecycle methods directly",
      ),
    );
  }

  respond() {}

  async listModels() {
    return {
      data: zcodeModelsFromDesktop(
        readZCodeDesktopModel(this.desktopRoot),
        this.model,
      ),
    };
  }

  async getSandboxReadiness() {
    return { status: "ready" };
  }

  async startThread({ cwd } = {}) {
    const threadId = randomUUID();
    this.goals.set(threadId, {
      cwd: cwd ?? null,
      objective: "",
      tokenBudget: 0,
      tokensUsed: 0,
      status: "active",
      sessionId: null,
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
    return {
      goal: {
        threadId,
        status:
          goal.tokenBudget > 0 && goal.tokensUsed >= goal.tokenBudget
            ? "budgetLimited"
            : goal.status,
        tokenBudget: goal.tokenBudget,
        tokensUsed: goal.tokensUsed,
      },
    };
  }

  async startTurn(params) {
    const { threadId, input, model, cwd, outputSchema } = params ?? {};
    const goal = this.goals.get(threadId);
    if (!goal) {
      throw new ControlPlaneError(
        "thread_not_found",
        `Unknown thread: ${threadId}`,
      );
    }
    const invocation =
      this.invocation ?? resolveZCodeInvocation({ command: this.command });
    if (!invocation) {
      throw new ControlPlaneError(
        "command_not_found",
        "ZCode CLI was not found.",
      );
    }
    const runtime = prepareZCodeRuntime({
      desktop: readZCodeDesktopModel(this.desktopRoot),
      storageRoot: this.storageRoot,
      model: model ?? this.model,
    });
    const args = [
      ...invocation.prefixArgs,
      ...buildZCodeRunArgs(this.#buildPrompt(input, outputSchema), {
        cwd: cwd ?? goal.cwd,
        sessionId: goal.sessionId,
        mode: this.mode,
      }),
    ];
    const turnId = randomUUID();
    const child = spawn(invocation.command, args, {
      cwd: cwd ?? goal.cwd ?? undefined,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: runtime.env,
    });
    this.turns.set(turnId, { child, threadId });
    queueMicrotask(() => this.#runZCode(turnId, { child, threadId }));
    return { turn: { id: turnId } };
  }

  async interruptTurn({ turnId } = {}) {
    const turn = this.turns.get(turnId);
    try {
      turn?.child?.kill();
    } catch {
      // Ignore.
    }
    this.turns.delete(turnId);
    return {};
  }

  #runZCode(turnId, { child, threadId }) {
    let stdout = "";
    let stderr = "";
    let diagnostics = "";
    let finished = false;
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      this.#finishZCode(turnId, threadId, payload);
    };
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-2_000_000);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr = `${stderr}${text}`.slice(-4000);
      this.emit("stderr", text);
    });
    child.on("error", (error) => {
      finish({
        status: "failed",
        error: error.message,
        finalText: "",
        usage: { ...ZERO_USAGE },
      });
    });
    child.on("close", (code) => {
      const events = parseZCodeOutput(stdout);
      if (events.length === 0) diagnostics = stdout.slice(-4000);
      const normalized = normalizeZCodeEvents(events);
      const goal = this.goals.get(threadId);
      if (goal && normalized.sessionId) goal.sessionId = normalized.sessionId;
      const failed = code !== 0 || normalized.status === "failed";
      finish({
        status: failed ? "failed" : "completed",
        error: failed
          ? formatCliExitError(
              "zcode",
              code,
              stderr || diagnostics || normalized.finalText,
            )
          : null,
        finalText: normalized.finalText,
        usage: normalized.usage,
      });
    });
  }

  #finishZCode(turnId, threadId, { status, error, finalText, usage }) {
    const goal = this.goals.get(threadId);
    if (goal) goal.tokensUsed += Number(usage?.total_tokens ?? 0);
    const notified = {
      inputTokens: Number(usage?.input_tokens ?? 0),
      cachedInputTokens: 0,
      outputTokens: Number(usage?.output_tokens ?? 0),
      reasoningOutputTokens: Number(usage?.reasoning_output_tokens ?? 0),
      totalTokens: Number(usage?.total_tokens ?? 0),
    };
    this.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId,
        turnId,
        tokenUsage: { last: notified, total: notified },
      },
    });
    this.emit("notification", {
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: turnId,
          status,
          error: error ? { message: error } : null,
          items:
            status === "completed"
              ? [
                  {
                    type: "agentMessage",
                    phase: "final_answer",
                    text: this.#normalizeReport(finalText),
                  },
                ]
              : [],
        },
      },
    });
    this.turns.delete(turnId);
  }

  #buildPrompt(input, outputSchema) {
    const brief = Array.isArray(input)
      ? input
          .map((item) => (typeof item?.text === "string" ? item.text : ""))
          .filter(Boolean)
          .join("\n")
      : typeof input === "string"
        ? input
        : "";
    const schema =
      outputSchema && typeof outputSchema === "object"
        ? `\nReturn a JSON object matching this schema:\n${JSON.stringify(outputSchema)}`
        : "";
    return [
      "You are a secure software engineering execution agent.",
      "Work only inside the provided workspace.",
      "Verify your changes and return a compact final report.",
      "The report must be a JSON object with keys: status, summary, changed_files, tests, blockers, next_action.",
      schema,
      "TASK:",
      brief,
    ]
      .filter(Boolean)
      .join("\n");
  }

  #normalizeReport(text) {
    const match = String(text ?? "").match(/```(?:json)?\s*([\s\S]*?)```/);
    const cleaned = String(match ? match[1] : text ?? "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return cleaned || "{}";
    }
    if (!parsed || typeof parsed !== "object") return cleaned;
    return JSON.stringify({
      status: ["completed", "partial", "blocked", "failed"].includes(
        parsed.status,
      )
        ? parsed.status
        : parsed.status === "success"
          ? "completed"
          : "completed",
      summary: String(parsed.summary ?? ""),
      changed_files: Array.isArray(parsed.changed_files)
        ? parsed.changed_files.map(String)
        : [],
      tests: Array.isArray(parsed.tests) ? parsed.tests : [],
      blockers: Array.isArray(parsed.blockers)
        ? parsed.blockers.map(String)
        : [],
      next_action:
        parsed.next_action == null ? null : String(parsed.next_action),
    });
  }
}
