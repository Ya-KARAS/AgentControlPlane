import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { ControlPlaneError } from "../core/errors.js";
import {
  EXECUTION_REPORT_INSTRUCTION,
  normalizeExecutionReportText,
} from "../core/execution-report.js";
import { ExecutorAdapter, formatCliExitError } from "./executor.js";
import { probeCommandExecutor, readCommandVersion } from "./discovery.js";

export function classifyClaudeAuthentication(
  output,
  { apiKeyConfigured = false } = {},
) {
  if (apiKeyConfigured) {
    return { authenticated: true, authMethod: "api_key" };
  }
  const text = String(output ?? "").trim();
  if (!text) return null;
  try {
    const status = JSON.parse(text);
    if (status?.loggedIn === true) {
      return {
        authenticated: true,
        authMethod: String(status.authMethod ?? "account"),
      };
    }
    if (status?.loggedIn === false) {
      return { authenticated: false, authMethod: "none" };
    }
  } catch {
    // Older Claude Code releases may not support JSON auth status output.
  }
  return null;
}

export function normalizeClaudeResult(events) {
  let resultText = "";
  let status = "completed";
  let usage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (event.type === "result") {
      status =
        event.subtype === "success" && !event.is_error ? "completed" : "failed";
      if (typeof event.result === "string") resultText = event.result;
      if (event.usage) {
        const inputTokens = Number(event.usage.input_tokens ?? 0);
        const outputTokens = Number(event.usage.output_tokens ?? 0);
        usage = {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        };
      }
    }
  }
  return { resultText, status, usage };
}

export class ClaudeCodeExecutor extends ExecutorAdapter {
  constructor({
    command = "claude",
    model = null,
    allowedTools = ["Read", "Write", "Edit", "Bash"],
    permissionMode = "acceptEdits",
    maxTurns = 30,
    workspaceRoots = [],
  } = {}) {
    super({
      id: "claude",
      displayName: "Claude Code",
      capabilities: {
        persistentThreads: false,
        tokenUsage: true,
        hardInterrupt: true,
        subagents: false,
      },
    });
    this.command = command;
    this.model = model;
    this.allowedTools = allowedTools;
    this.permissionMode = permissionMode;
    this.maxTurns = maxTurns;
    this.workspaceRoots = workspaceRoots;
    this.goals = new Map();
    this.turns = new Map();
  }

  async start() {
    this.ready = true;
  }

  async probe() {
    const installed = await probeCommandExecutor({ command: this.command });
    if (!installed.available) return installed;

    const authentication = classifyClaudeAuthentication(null, {
      apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    });
    if (authentication?.authenticated) {
      return {
        ...installed,
        status: "available",
        detail: `Authenticated with ${authentication.authMethod}`,
      };
    }

    const authStatus = await readCommandVersion(
      installed.command,
      ["auth", "status"],
      5000,
    );
    const detected = classifyClaudeAuthentication(authStatus.output);
    if (detected?.authenticated === false) {
      return {
        ...installed,
        available: false,
        status: "unavailable",
        reason: "not_authenticated",
        detail:
          "Claude Code requires a Pro/Max account login or an Anthropic API key.",
      };
    }
    if (detected?.authenticated) {
      return {
        ...installed,
        status: "available",
        detail: `Authenticated with ${detected.authMethod}`,
      };
    }
    return {
      ...installed,
      status: "degraded",
      reason: "auth_status_unknown",
      detail: authStatus.error ?? "Could not determine Claude Code login status",
    };
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
        "ClaudeCodeExecutor exposes the lifecycle methods directly",
      ),
    );
  }

  respond() {}

  async listModels() {
    return { data: [] };
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
    const { threadId, input, model, cwd, outputSchema } = params ?? {};
    const turnId = randomUUID();
    const child = this.#spawnClaude(
      this.#buildPrompt(input, outputSchema),
      model ?? this.model,
      cwd,
    );
    this.turns.set(turnId, { child, threadId });
    queueMicrotask(() => this.#runClaude(turnId, { threadId, child }));
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

  #spawnClaude(prompt, model, cwd) {
    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (Array.isArray(this.allowedTools) && this.allowedTools.length) {
      args.push("--allowedTools", this.allowedTools.join(","));
    }
    args.push("--permission-mode", this.permissionMode);
    if (this.maxTurns) {
      args.push("--max-turns", String(this.maxTurns));
    }
    if (model) args.push("--model", model);
    const child = spawn(this.command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    child.stdin.write(prompt);
    child.stdin.end();
    return child;
  }

  #runClaude(turnId, { threadId, child }) {
    const events = [];
    let stderr = "";
    let stdoutDiagnostics = "";
    let finished = false;
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      this.#finishClaude(turnId, threadId, payload);
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
      const normalized = normalizeClaudeResult(events);
      const failed = normalized.status !== "completed" || code !== 0;
      finish({
        status: failed ? "failed" : "completed",
        error: failed
          ? formatCliExitError(
              "claude",
              code,
              stderr || stdoutDiagnostics || normalized.resultText,
            )
          : null,
        resultText: normalized.resultText,
        usage: normalized.usage,
      });
    });
  }

  #finishClaude(turnId, threadId, { status, error, resultText, usage }) {
    const goal = this.goals.get(threadId);
    if (goal) {
      goal.tokensUsed = Math.max(goal.tokensUsed, usage?.total_tokens ?? 0);
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
              text: normalizeExecutionReportText(resultText),
            },
          ]
        : [];
    this.emit("notification", {
      method: "turn/completed",
      params: {
        threadId,
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
      EXECUTION_REPORT_INSTRUCTION,
      schemaLine,
      "",
      "TASK:",
      brief,
    ]
      .filter((line) => line !== "")
      .join("\n");
  }

  #notifiedUsage(usage) {
    return {
      inputTokens: usage.input_tokens,
      cachedInputTokens: 0,
      outputTokens: usage.output_tokens,
      reasoningOutputTokens: 0,
      totalTokens: usage.total_tokens,
    };
  }

  #zeroUsage() {
    return {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
  }
}
