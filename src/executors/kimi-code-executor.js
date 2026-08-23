import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { ControlPlaneError } from "../core/errors.js";
import { ExecutorAdapter, formatCliExitError } from "./executor.js";
import { probeCommandExecutor, readCommandVersion } from "./discovery.js";

const ZERO_USAGE = Object.freeze({
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
});

export function parseKimiProviderConfig(output) {
  try {
    const parsed = JSON.parse(String(output ?? "").trim());
    return {
      providers:
        parsed?.providers && typeof parsed.providers === "object"
          ? parsed.providers
          : {},
      models:
        parsed?.models && typeof parsed.models === "object"
          ? parsed.models
          : {},
    };
  } catch {
    return null;
  }
}

export function kimiModelsFromConfig(config, defaultModel = null) {
  return Object.entries(config?.models ?? {}).map(([alias, entry]) => ({
    id: alias,
    model: alias,
    displayName: String(entry?.name ?? entry?.model ?? alias),
    isDefault: alias === defaultModel,
    status: "active",
    capabilities: {
      chat: true,
      tools: true,
      vision: false,
    },
    context: null,
    supportedReasoningEfforts: [],
    provider: entry?.provider == null ? null : String(entry.provider),
  }));
}

export function hasKimiOAuthCredential(
  root = process.env.KIMI_CODE_HOME ?? path.join(os.homedir(), ".kimi-code"),
) {
  const directory = path.join(root, "credentials");
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.endsWith(".json"));
  } catch {
    return false;
  }
}

export function buildKimiRunArgs(
  prompt,
  { model = null, sessionId = null } = {},
) {
  const args = ["-p", prompt, "--output-format", "stream-json"];
  if (sessionId) args.push("--session", sessionId);
  if (model) args.push("--model", model);
  return args;
}

// npm's Windows shim forwards arguments through cmd.exe. Resolve the official
// JavaScript entry point and invoke Node directly so task text never becomes a
// shell command line.
export function resolveKimiInvocation(command, args) {
  if (process.platform !== "win32" || !/\.cmd$/i.test(command)) {
    return { command, args };
  }
  try {
    const source = fs.readFileSync(command, "utf8");
    const match = source.match(/"%dp0%\\([^"\r\n]+\.(?:mjs|cjs|js))"\s+%\*/i);
    if (match) {
      return {
        command: process.execPath,
        args: [path.resolve(path.dirname(command), match[1]), ...args],
      };
    }
  } catch {
    // Report a deterministic launch error below.
  }
  throw new ControlPlaneError(
    "unsupported_windows_shim",
    `Kimi command is a Windows shim that cannot be resolved safely: ${command}`,
  );
}

export function normalizeKimiEvents(events) {
  let finalText = "";
  let sessionId = null;
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (
      event.role === "meta" &&
      event.type === "session.resume_hint" &&
      typeof event.session_id === "string"
    ) {
      sessionId = event.session_id;
    }
    if (event.role !== "assistant") continue;
    if (typeof event.content === "string" && event.content) {
      finalText = event.content;
      continue;
    }
    if (Array.isArray(event.content)) {
      const text = event.content
        .map((part) =>
          typeof part === "string"
            ? part
            : typeof part?.text === "string"
              ? part.text
              : "",
        )
        .filter(Boolean)
        .join("\n");
      if (text) finalText = text;
    }
  }
  return { finalText, sessionId, usage: { ...ZERO_USAGE } };
}

export class KimiCodeExecutor extends ExecutorAdapter {
  constructor({ command = "kimi", model = null, workspaceRoots = [] } = {}) {
    super({
      id: "kimi",
      displayName: "Kimi Code",
      capabilities: {
        persistentThreads: false,
        tokenUsage: false,
        hardInterrupt: true,
        subagents: false,
      },
    });
    this.command = command;
    this.model = model;
    this.workspaceRoots = workspaceRoots;
    this.goals = new Map();
    this.turns = new Map();
  }

  async probe() {
    const installed = await probeCommandExecutor({
      command: this.command,
      verifyVersion: true,
    });
    if (!installed.available) return installed;
    const catalog = await readCommandVersion(
      installed.command,
      ["provider", "list", "--json"],
      8000,
    );
    const config = parseKimiProviderConfig(catalog.output);
    if (!catalog.ok || !config) {
      return {
        ...installed,
        available: false,
        status: "unavailable",
        reason: "configuration_probe_failed",
        detail: catalog.error ?? "Kimi provider configuration is unreadable",
      };
    }
    const configuredModels = Object.keys(config.models).length;
    if (configuredModels === 0 && !hasKimiOAuthCredential()) {
      return {
        ...installed,
        available: false,
        status: "unavailable",
        reason: "not_configured",
        detail: "Run `kimi login` and configure a Kimi model before dispatch.",
      };
    }
    return {
      ...installed,
      available: true,
      status: configuredModels > 0 ? "available" : "degraded",
      reason: configuredModels > 0 ? null : "auth_unverified",
      detail:
        configuredModels > 0
          ? `${configuredModels} configured model(s)`
          : "Managed OAuth credential present; first dispatch validates membership.",
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
        "KimiCodeExecutor exposes the lifecycle methods directly",
      ),
    );
  }

  respond() {}

  async listModels() {
    const catalog = await readCommandVersion(
      this.command,
      ["provider", "list", "--json"],
      8000,
    );
    const config = catalog.ok ? parseKimiProviderConfig(catalog.output) : null;
    return { data: config ? kimiModelsFromConfig(config, this.model) : [] };
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
      cwd: cwd ?? null,
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
        status: goal.status,
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
    const prompt = this.#buildPrompt(input, outputSchema);
    const args = buildKimiRunArgs(prompt, {
      model: model ?? this.model,
      sessionId: goal.sessionId,
    });
    const launch = resolveKimiInvocation(this.command, args);
    const turnId = randomUUID();
    const child = spawn(launch.command, launch.args, {
      cwd: cwd ?? goal.cwd ?? undefined,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    this.turns.set(turnId, { child, threadId });
    queueMicrotask(() => this.#runKimi(turnId, { threadId, child }));
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

  #runKimi(turnId, { threadId, child }) {
    const events = [];
    let stderr = "";
    let diagnostics = "";
    let finished = false;
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      this.#finishKimi(turnId, threadId, payload);
    };
    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => {
      try {
        events.push(JSON.parse(line));
      } catch {
        diagnostics = `${diagnostics}${line}\n`.slice(-4000);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr = `${stderr}${text}`.slice(-4000);
      this.emit("stderr", text);
    });
    child.on("error", (error) => {
      finish({ status: "failed", error: error.message, finalText: "" });
    });
    child.on("close", (code) => {
      const normalized = normalizeKimiEvents(events);
      if (normalized.sessionId) {
        const goal = this.goals.get(threadId);
        if (goal) goal.sessionId = normalized.sessionId;
      }
      finish({
        status: code === 0 ? "completed" : "failed",
        error:
          code === 0
            ? null
            : formatCliExitError(
                "kimi",
                code,
                stderr || diagnostics || normalized.finalText,
              ),
        finalText: normalized.finalText,
      });
    });
  }

  #finishKimi(turnId, threadId, { status, error, finalText }) {
    const notified = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
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
      "Work only inside the provided workspace.",
      "Verify your changes and return a compact final report.",
      "The report must be a JSON object with keys: status, summary, changed_files, tests, blockers, next_action.",
      schemaLine,
      "",
      "TASK:",
      brief,
    ]
      .filter((line) => line !== "")
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
    const status = ["completed", "partial", "blocked", "failed"].includes(
      parsed.status,
    )
      ? parsed.status
      : parsed.status === "success"
        ? "completed"
        : "completed";
    return JSON.stringify({
      status,
      summary: String(parsed.summary ?? ""),
      changed_files: Array.isArray(parsed.changed_files)
        ? parsed.changed_files.map(String)
        : [],
      tests: Array.isArray(parsed.tests)
        ? parsed.tests.map((entry) => ({
            command: String(entry?.command ?? ""),
            status: ["passed", "failed", "not_run"].includes(entry?.status)
              ? entry.status
              : "not_run",
            detail: entry?.detail == null ? null : String(entry.detail),
          }))
        : [],
      blockers: Array.isArray(parsed.blockers)
        ? parsed.blockers.map(String)
        : [],
      next_action: parsed.next_action == null ? null : String(parsed.next_action),
    });
  }
}
