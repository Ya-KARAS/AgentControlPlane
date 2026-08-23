export const ACP_MENTION = "@AgentControlPlane";
export const TASK_OPEN = "<ACP_TASK>";
export const TASK_CLOSE = "</ACP_TASK>";

const CONFIRM_WORDS = new Set([
  "执行",
  "开始",
  "确认",
  "可以",
  "继续",
  "yes",
  "confirm",
  "dispatch",
  "run",
]);

function boundedText(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

export function parseLaunchCommand(value) {
  const text = String(value ?? "").trim();
  if (!text.toLowerCase().startsWith(ACP_MENTION.toLowerCase())) return null;
  const boundary = text.slice(ACP_MENTION.length, ACP_MENTION.length + 1);
  if (boundary && !/\s/.test(boundary)) return null;
  return {
    request: boundedText(text.slice(ACP_MENTION.length), 4000),
  };
}

export function controllerPrompt(request = "") {
  const userRequest = boundedText(request, 4000);
  return [
    "You are the planning controller for AgentControlPlane in this conversation.",
    "Discuss the engineering request with the user in natural language. Ask for missing requirements and resolve ambiguity before staging work.",
    "When the task is implementation-ready, output exactly one JSON object between <ACP_TASK> and </ACP_TASK>.",
    TASK_OPEN,
    JSON.stringify(
      {
        objective: "A concrete engineering objective",
        context: "Execution context needed by the engineering agent",
        constraints: ["Important implementation constraints"],
        acceptance_criteria: ["Observable completion criteria"],
      },
      null,
      2,
    ),
    TASK_CLOSE,
    "AgentControlPlane resolves workspace, executor, profile, model, and credentials from local settings.",
    "The task is staged after you output ACP_TASK. Tell the user to reply with 执行 or another clear confirmation word.",
    "Execution begins only after the browser bridge observes that confirmation. Report execution only after this conversation receives an ACP_RESULT block.",
    userRequest
      ? `Current user request: ${userRequest}`
      : "Use the current conversation to identify the task the user wants to prepare.",
  ].join("\n");
}

export function extractTaskEnvelope(value) {
  const source = String(value ?? "");
  const start = source.lastIndexOf(TASK_OPEN);
  if (start < 0) return null;
  const end = source.indexOf(TASK_CLOSE, start + TASK_OPEN.length);
  if (end < 0) return null;
  const payload = source.slice(start + TASK_OPEN.length, end).trim();
  if (!payload || payload.length > 16_000) return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      boundedText(parsed.objective, 4000)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function candidateFromEnvelope(envelope) {
  const objective = boundedText(envelope?.objective, 4000);
  if (!objective) throw new Error("task_objective_missing");
  const constraints = [];
  const context = boundedText(envelope?.context, 1000);
  if (context) constraints.push(`Context: ${context}`);
  for (const entry of Array.isArray(envelope?.constraints)
    ? envelope.constraints
    : []) {
    const value = boundedText(entry, 1000);
    if (value) constraints.push(value);
  }
  for (const entry of Array.isArray(envelope?.acceptance_criteria)
    ? envelope.acceptance_criteria
    : []) {
    const value = boundedText(entry, 980);
    if (value) constraints.push(`Acceptance: ${value}`);
  }
  return {
    objective,
    constraints: constraints.slice(0, 16),
    source: "userscript-preview",
  };
}

export function isConfirmation(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[吧啊呀哦哈呢嘛咯]+[!！。.]?$/u, "")
    .replace(/[!！。.\s]+$/u, "")
    .trim();
  return CONFIRM_WORDS.has(normalized);
}

export function envelopeId(envelope) {
  const source = JSON.stringify(envelope);
  let value = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

export function safeResultBlock(task) {
  return `<ACP_RESULT>\n${JSON.stringify({
    task_id: String(task?.id ?? ""),
    status: String(task?.status ?? "unknown"),
    changed_files_count: Number(task?.changed_files_count ?? 0),
    tests: {
      total: Number(task?.tests?.total ?? 0),
      passed: Number(task?.tests?.passed ?? 0),
      failed: Number(task?.tests?.failed ?? 0),
    },
    blocker_count: Number(task?.blocker_count ?? 0),
  }, null, 2)}\n</ACP_RESULT>`;
}
