import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { ControlPlaneError } from "../core/errors.js";
import { ExecutorAdapter, formatCliExitError } from "./executor.js";
import { probeCommandExecutor } from "./discovery.js";

const MODEL_LINE = /^[^\s{}]+\/[^\s{}]+$/;

export function parseOpenCodeModels(output) {
  const models = [];
  let model = null;
  let json = "";
  for (const rawLine of String(output ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!model && MODEL_LINE.test(line)) {
      model = line;
      json = "";
      continue;
    }
    if (!model) continue;
    json += `${rawLine}\n`;
    let metadata;
    try {
      metadata = JSON.parse(json);
    } catch {
      continue;
    }
    const efforts = Object.keys(
      metadata?.variants && typeof metadata.variants === "object"
        ? metadata.variants
        : {},
    );
    models.push({
      id: model,
      model,
      displayName: String(metadata?.name ?? model),
      isDefault: false,
      status: metadata?.status ?? null,
      capabilities: {
        chat: true,
        tools: metadata?.capabilities?.toolcall === true,
        vision: metadata?.capabilities?.input?.image === true,
      },
      context: Number.isFinite(metadata?.limit?.context)
        ? { window: metadata.limit.context }
        : null,
      supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
        reasoningEffort,
      })),
    });
    model = null;
    json = "";
  }
  return models;
}

export function buildOpenCodeRunArgs(
  prompt,
  { model = null, effort = null, cwd = null, agent = null, autoApprove = false } = {},
) {
  const args = ["run", prompt, "--format", "json"];
  if (cwd) args.push("--dir", cwd);
  if (model) args.push("--model", model);
  if (effort) args.push("--variant", effort);
  if (agent) args.push("--agent", agent);
  if (autoApprove) args.push("--auto");
  args.push("--print-logs");
  return args;
}

// Matches `opencode run --format json`: newline-delimited JSON events with a
// top-level `type` and a `part` object. Text parts carry `part.text`; each
// `step_finish` part carries per-step marginal `part.tokens` (input/output/
// reasoning) plus a cumulative `total` that includes KV-cache reads. Marginal
// components are accumulated; the latest cache read and cumulative total are
// kept for transparency.
export function normalizeOpenCodeEvents(events) {
  let finalText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cachedInputTokens = 0;
  let totalTokens = 0;

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const part = event.part ?? {};
    if (event.type === "text" || part.type === "text") {
      if (typeof part.text === "string" && part.text) finalText = part.text;
    }
    if (part.tokens && typeof part.tokens === "object") {
      inputTokens += Number(part.tokens.input ?? 0);
      outputTokens += Number(part.tokens.output ?? 0);
      reasoningTokens += Number(part.tokens.reasoning ?? 0);
      cachedInputTokens = Number(part.tokens.cache?.read ?? 0);
      totalTokens = Number(
        part.tokens.total ??
          inputTokens + outputTokens + reasoningTokens + cachedInputTokens,
      );
    }
  }

  return {
    finalText,
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      uncached_input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_output_tokens: reasoningTokens,
      total_tokens: totalTokens,
    },
  };
}

function marginalTokens(usage) {
  return (
    Number(usage?.uncached_input_tokens ?? usage?.input_tokens ?? 0) +
    Number(usage?.output_tokens ?? 0) +
    Number(usage?.reasoning_output_tokens ?? 0)
  );
}

export class OpenCodeExecutor extends ExecutorAdapter {
  constructor({
    command = "opencode",
    model = null,
    agent = null,
    autoApprove = true,
    workspaceRoots = [],
  } = {}) {
    super({
      id: "opencode",
      displayName: "OpenCode",
      capabilities: {
        persistentThreads: false,
        tokenUsage: true,
        hardInterrupt: true,
        subagents: false,
      },
    });
    this.command = command;
    this.model = model;
    this.agent = agent;
    this.autoApprove = Boolean(autoApprove);
    this.workspaceRoots = workspaceRoots;
    this.goals = new Map();
    this.turns = new Map();
  }

  async start() {
    this.ready = true;
  }

  probe() {
    return probeCommandExecutor({ command: this.command });
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
        "OpenCodeExecutor exposes the lifecycle methods directly",
      ),
    );
  }

  respond() {}

  async listModels() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (data) => {
        if (settled) return;
        settled = true;
        resolve({ data });
      };
      const child = spawn(this.command, ["models", "--verbose"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: process.env,
      });
      let stdout = "";
      const timer = setTimeout(() => child.kill(), 15_000);
      child.stdout.on("data", (chunk) => {
        stdout = `${stdout}${chunk.toString("utf8")}`.slice(-2_000_000);
      });
      child.stderr.resume();
      child.on("error", () => {
        clearTimeout(timer);
        finish([]);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const data = code === 0 ? parseOpenCodeModels(stdout) : [];
        for (const entry of data) {
          entry.isDefault = Boolean(this.model && entry.id === this.model);
        }
        finish(data);
      });
    });
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
    const { threadId, input, model, effort, cwd, outputSchema } = params ?? {};
    const turnId = randomUUID();
    const child = this.#spawnOpenCode(
      this.#buildPrompt(input, outputSchema),
      model ?? this.model,
      effort,
      cwd,
    );
    this.turns.set(turnId, { child, threadId });
    queueMicrotask(() => this.#runOpenCode(turnId, { threadId, child }));
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

  #spawnOpenCode(prompt, model, effort, cwd) {
    const args = buildOpenCodeRunArgs(prompt, {
      model,
      effort,
      cwd,
      agent: this.agent,
      autoApprove: this.autoApprove,
    });
    const child = spawn(this.command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    child.stdin.end();
    return child;
  }

  #runOpenCode(turnId, { threadId, child }) {
    const events = [];
    let stderr = "";
    let stdoutDiagnostics = "";
    let executorSessionId = null;
    let stderrTail = "";
    let finished = false;
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      this.#finishOpenCode(turnId, threadId, payload);
    };
    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => {
      try {
        events.push(JSON.parse(line));
      } catch {
        stdoutDiagnostics = `${stdoutDiagnostics}${line}\n`.slice(-4000);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (!executorSessionId) {
        stderrTail = `${stderrTail}${text}`.slice(-400);
        const match = stderrTail.match(/session\.id=(ses_[A-Za-z0-9]+)/);
        if (match) executorSessionId = match[1];
      }
      stderr = `${stderr}${text}`.slice(-4000);
      this.emit("stderr", text);
    });
    child.on("error", (error) => {
      finish({
        status: "failed",
        error: error.message,
        resultText: "",
        usage: this.#zeroUsage(),
      });
    });
    child.on("close", (code) => {
      const normalized = normalizeOpenCodeEvents(events);
      const failed = code !== 0;
      finish({
        status: failed ? "failed" : "completed",
        error: failed
          ? formatCliExitError(
              "opencode",
              code,
              stderr || stdoutDiagnostics || normalized.finalText,
            )
          : null,
        resultText: normalized.finalText,
        usage: normalized.usage,
        executorSessionId,
      });
    });
  }

  #finishOpenCode(
    turnId,
    threadId,
    { status, error, resultText, usage, executorSessionId },
  ) {
    const goal = this.goals.get(threadId);
    if (goal) {
      goal.tokensUsed = Math.max(goal.tokensUsed, marginalTokens(usage));
    }
    const notified = this.#notifiedUsage(usage ?? this.#zeroUsage());
    this.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId,
        turnId,
        tokenUsage: { last: notified, total: notified },
      },
    });
    const items =
      status === "completed"
        ? [
            {
              type: "agentMessage",
              phase: "final_answer",
              text: this.#normalizeReport(resultText),
            },
          ]
        : [];
    this.emit("notification", {
      method: "turn/completed",
      params: {
        threadId,
        executorSessionId: executorSessionId ?? null,
        turn: {
          id: turnId,
          status,
          error: error ? { message: error } : null,
          items,
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
    const cleaned = this.#stripFence(String(text ?? "")).trim();
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
    const tests = Array.isArray(parsed.tests)
      ? parsed.tests.map((entry) => ({
          command: String(entry?.command ?? ""),
          status: ["passed", "failed", "not_run"].includes(entry?.status)
            ? entry.status
            : "not_run",
          detail: entry?.detail == null ? null : String(entry.detail),
        }))
      : [];
    return JSON.stringify({
      status,
      summary: String(parsed.summary ?? ""),
      changed_files: Array.isArray(parsed.changed_files)
        ? parsed.changed_files.map((item) => String(item))
        : [],
      tests,
      blockers: Array.isArray(parsed.blockers)
        ? parsed.blockers.map((item) => String(item))
        : [],
      next_action: parsed.next_action == null ? null : String(parsed.next_action),
    });
  }

  #stripFence(text) {
    const match = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
    return match ? match[1] : text;
  }

  #notifiedUsage(usage) {
    return {
      inputTokens: usage.input_tokens,
      cachedInputTokens: usage.cached_input_tokens ?? 0,
      outputTokens: usage.output_tokens,
      reasoningOutputTokens: usage.reasoning_output_tokens ?? 0,
      totalTokens: usage.total_tokens,
    };
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
}
