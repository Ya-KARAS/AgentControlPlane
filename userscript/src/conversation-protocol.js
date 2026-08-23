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

const CHANGE_CONFIRM_WORDS = new Set([
  "确认变更",
  "接受变更",
  "confirm changes",
  "accept changes",
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

export function controllerPrompt(request = "", capabilities = {}) {
  const userRequest = boundedText(request, 4000);
  const safeCapabilities = JSON.stringify(capabilities ?? {}, null, 2);
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
        execution: {
          workspace: "A listed project alias or stable project id, or an absolute path explicitly supplied by the user",
          executor: "A listed executor id",
          profile: "A listed profile id",
          model: "A model id listed for the selected executor",
          reasoning_effort: "A reasoning effort listed for the selected model",
        },
      },
      null,
      2,
    ),
    TASK_CLOSE,
    "The local ACP capability summary below is authoritative for execution choices in this conversation.",
    safeCapabilities,
    "The user may choose workspace, executor, profile, model, and reasoning effort in natural language.",
    "Use only listed project aliases or ids, workspace aliases, executor ids, profile ids, model ids, and reasoning efforts. Prefer a listed project alias so the stable local project identity survives path changes.",
    "An absolute workspace path is allowed only when the user explicitly supplied it; never invent a local path.",
    "Do not select a model or provider whose status is cooldown. Explain the safe failure category and ask the user to choose an available route or wait until retry_after.",
    "Omit an execution field when the user did not choose it; local saved defaults then apply. Credentials always remain local and must never appear in ACP_TASK.",
    "Before staging, state the execution choices that will override defaults and identify every omitted field as using the local default.",
    "After an ACP_RESULT failure, preserve the objective, workspace, and execution route unless the user explicitly requests a change. Never replace the requested engineering task with a smoke test or change its workspace as an automatic troubleshooting step.",
    "When the user explicitly changes the objective, workspace, executor, profile, model, or reasoning effort, state exactly which fields changed before emitting the replacement ACP_TASK.",
    "After emitting a replacement ACP_TASK with changed fields, tell the user to reply with 确认变更. The local bridge requires that separate confirmation before it accepts 执行.",
    "If the user sends 执行 before confirming changed fields, explain that the local bridge is still waiting for 确认变更. Do not claim that execution started.",
    "For an initial ACP_TASK with no replaced fields, tell the user to reply with 执行 or another clear confirmation word.",
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
  const executionLimits = {
    workspace: 1000,
    executor: 64,
    profile: 64,
    model: 200,
    reasoning_effort: 32,
  };
  const execution = envelope?.execution &&
    typeof envelope.execution === "object" &&
    !Array.isArray(envelope.execution)
    ? Object.fromEntries(
        Object.entries(executionLimits)
          .map(([key, limit]) => [key, boundedText(envelope.execution[key], limit)])
          .filter(([, value]) => value),
      )
    : null;
  return {
    objective,
    constraints: constraints.slice(0, 16),
    ...(execution && Object.keys(execution).length ? { execution } : {}),
    source: "userscript-preview",
  };
}

export function executionSummary(envelope) {
  const execution = candidateFromEnvelope(envelope).execution;
  if (!execution) return "本机默认配置";
  const workspace = execution.workspace
    ? execution.workspace.split(/[\\/]/).filter(Boolean).at(-1)
    : null;
  return [
    workspace,
    execution.executor,
    execution.profile,
    execution.model,
    execution.reasoning_effort,
  ].filter(Boolean).join(" · ");
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

export function isChangeConfirmation(value) {
  return CHANGE_CONFIRM_WORDS.has(
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[!！。.\s]+$/u, "")
      .trim(),
  );
}

export function taskEnvelopeChanges(previous, next) {
  if (!previous || !next) return [];
  const fields = [];
  const previousObjective = boundedText(previous.objective, 4000);
  const nextObjective = boundedText(next.objective, 4000);
  const previousWorkspace = boundedText(previous.execution?.workspace, 1000);
  const nextWorkspace = boundedText(next.execution?.workspace, 1000);
  const workspaceOnlyObjectiveChange =
    previousWorkspace &&
    nextWorkspace &&
    previousWorkspace !== nextWorkspace &&
    previousObjective.split(previousWorkspace).join(nextWorkspace) === nextObjective;
  if (previousObjective !== nextObjective && !workspaceOnlyObjectiveChange) {
    fields.push("objective");
  }
  for (const field of [
    "workspace",
    "executor",
    "profile",
    "model",
    "reasoning_effort",
  ]) {
    const before = boundedText(previous.execution?.[field], field === "workspace" ? 1000 : 200);
    const after = boundedText(next.execution?.[field], field === "workspace" ? 1000 : 200);
    if (before !== after) fields.push(field);
  }
  return fields;
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
    test_commands: {
      total: Number(task?.test_commands?.total ?? task?.tests?.total ?? 0),
      passed: Number(task?.test_commands?.passed ?? task?.tests?.passed ?? 0),
      failed: Number(task?.test_commands?.failed ?? task?.tests?.failed ?? 0),
    },
    test_cases: task?.test_cases && typeof task.test_cases === "object"
      ? {
          total: Number(task.test_cases.total ?? 0),
          passed: Number(task.test_cases.passed ?? 0),
          failed: Number(task.test_cases.failed ?? 0),
        }
      : null,
    blocker_count: Number(task?.blocker_count ?? 0),
    failure_category: boundedText(task?.failure_category, 64) || null,
    execution: {
      workspace: boundedText(task?.execution?.workspace, 200) || null,
      executor: boundedText(task?.execution?.executor, 64) || null,
      profile: boundedText(task?.execution?.profile, 64) || null,
      model: boundedText(task?.execution?.model, 200) || null,
      reasoning_effort:
        boundedText(task?.execution?.reasoning_effort, 32) || null,
    },
  }, null, 2)}\n</ACP_RESULT>`;
}
