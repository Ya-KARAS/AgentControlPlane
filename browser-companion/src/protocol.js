const TASK_OPEN = "<ACP_TASK>";
const TASK_CLOSE = "</ACP_TASK>";

function boundedString(value, limit = 24000) {
  return String(value ?? "").trim().slice(0, limit);
}

export function extractTaskEnvelope(text) {
  const source = String(text ?? "");
  const start = source.lastIndexOf(TASK_OPEN);
  if (start < 0) return null;
  const end = source.indexOf(TASK_CLOSE, start + TASK_OPEN.length);
  if (end < 0) return null;
  const payload = source.slice(start + TASK_OPEN.length, end).trim();
  if (!payload || payload.length > 64000) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function resolveExecutorAlias(requested, executors = []) {
  const value = String(requested ?? "auto").trim();
  if (!value || value === "auto") return "auto";
  const match = executors.find(
    (entry) =>
      String(entry.display_name ?? "").trim().toLowerCase() === value.toLowerCase(),
  );
  return match?.id ?? value;
}

export function autoProfile(objective) {
  const text = String(objective ?? "");
  if (
    /(架构|重构|迁移|大规模|性能优化|安全审计|全面检查|深度)/.test(text) ||
    text.length > 400
  ) {
    return "deep";
  }
  if (
    /(最小|简单|单文件|一行|小修|微调|示例|hello|demo)/i.test(text) &&
    text.length < 200
  ) {
    return "economy";
  }
  return "balanced";
}

export function normalizeDispatch(envelope, settings = {}) {
  const objective = boundedString(envelope?.objective);
  const workspace = boundedString(settings.workspace, 4096);
  if (!objective) throw new Error("The ACP task has no objective");
  if (!workspace) throw new Error("Select a local workspace before dispatch");
  const requestedProfile = boundedString(
    envelope?.profile ?? settings.profile ?? "balanced",
    40,
  );
  const request = {
    workspace,
    objective,
    profile:
      requestedProfile === "auto" ? autoProfile(objective) : requestedProfile,
    executor: boundedString(
      envelope?.executor ?? settings.executor ?? "auto",
      80,
    ),
  };
  const listTargets = new Set([
    "context",
    "constraints",
    "acceptance_criteria",
    "preferred_files",
    "forbidden_actions",
  ]);
  for (const [source, target, limit] of [
    ["context", "context", 16000],
    ["constraints", "constraints", 12000],
    ["acceptance_criteria", "acceptance_criteria", 12000],
    ["preferred_files", "preferred_files", 8000],
    ["forbidden_actions", "forbidden_actions", 8000],
    ["model", "model", 120],
    ["reasoning_effort", "reasoning_effort", 40],
  ]) {
    const value =
      envelope?.[source] ??
      (source === "model" || source === "reasoning_effort"
        ? settings?.[source]
        : undefined);
    if (value == null || value === "" || value === "auto") continue;
    if (listTargets.has(target) && typeof value === "string") {
      request[target] = [boundedString(value, limit)];
      continue;
    }
    request[target] = Array.isArray(value)
      ? value.map((entry) => boundedString(entry, 1000)).slice(0, 100)
      : boundedString(value, limit);
  }
  for (const [source, target] of [
    ["max_subagents", "max_subagents"],
    ["token_budget", "token_budget"],
    ["time_limit_minutes", "time_limit_minutes"],
  ]) {
    if (Number.isInteger(envelope?.[source])) {
      request[target] = envelope[source];
    }
  }
  return request;
}

export function formatTaskResult(task) {
  const payload = {
    task_id: task.id,
    logical_task_id: task.logical_task_id ?? task.id,
    status: task.status,
    executor: task.executor,
    executor_history: task.executor_history ?? [],
    reroute_reason: task.reroute_reason ?? null,
    executor_session_id: task.executor_session_id ?? null,
    result: task.result ?? null,
    error: task.error ?? null,
    usage: task.usage ?? null,
  };
  return `<ACP_RESULT>\n${JSON.stringify(payload, null, 2)}\n</ACP_RESULT>`;
}

export function controllerPrompt(settings = {}, executors = [], models = {}) {
  const profile = boundedString(settings.profile, 40) || "balanced";
  const executor = boundedString(settings.executor, 80) || "auto";
  const executorCatalog = executors
    .map((entry) => `${entry.id} (${entry.display_name ?? entry.id})`)
    .join(", ");
  const modelCatalog = executors
    .map((entry) => {
      const list = models?.[entry.id] ?? [];
      const names = list
        .slice(0, 5)
        .map((model) => {
          const id = model.id ?? model.model;
          const efforts = model.reasoning_efforts ??
            model.supported_reasoning_efforts ?? [];
          return efforts.length ? `${id} [${efforts.join(", ")}]` : id;
        })
        .filter(Boolean);
      return names.length
        ? `${entry.display_name ?? entry.id}: ${names.join(", ")}`
        : null;
    })
    .filter(Boolean)
    .join("; ");
  return [
    "You are the planning controller for a local engineering control plane.",
    "Clarify the user's goal in this conversation before dispatching engineering work.",
    "When the request is implementation-ready, output exactly one JSON envelope in this form:",
    TASK_OPEN,
    JSON.stringify(
      {
        workspace: "DEFAULT",
        objective: "A concrete engineering objective",
        context: "Only the context the executor needs",
        constraints: ["Important constraints"],
        acceptance_criteria: ["Observable completion criteria"],
        profile,
        executor,
      },
      null,
      2,
    ),
    TASK_CLOSE,
    "DEFAULT is resolved locally by the companion; do not ask for or expose a local filesystem path.",
    `Current local modes: executor=${executor}, profile=${profile}, model=${boundedString(settings.model, 120) || "auto"}, reasoning_effort=${boundedString(settings.reasoning_effort, 40) || "auto"}.`,
    `Available executors: ${executorCatalog || "auto (automatic routing)"}. When the user names an executor, put its id in the "executor" field; otherwise use "auto".`,
    "Optional fields to add only when the user explicitly asks for them:",
    modelCatalog
      ? `"model": only when the user names a model. Advertised models: ${modelCatalog}. Omit the field to use the executor default.`
      : '"model": only when the user names a model; omit the field to use the executor default.',
    '"reasoning_effort": "low" | "medium" | "high"; omit for the default.',
    '"token_budget": an integer token cap for the task.',
    '"max_subagents": an integer subagent cap.',
    '"time_limit_minutes": an integer minute cap on task runtime (1 to 240); omit for the default.',
    'Profiles: "economy" (small edits, low effort, 0 subagents), "balanced" (normal work, high effort, up to 2 subagents), "deep" (architecture, ultra effort, up to 4 subagents).',
    "Automatic execution recommendation: for each current local mode set to auto, choose one concrete listed executor, profile, model, or reasoning_effort that fits the task and include it in the envelope. Use a reasoning effort advertised by the chosen model; omit reasoning_effort when that model lists no efforts.",
    "A concrete local mode is the default for that field. Keep it by omitting the field unless the user explicitly requests a different listed value.",
    "Model and reasoning check: copy user-named values exactly. The local control plane validates every recommendation against its current capability catalog before dispatch.",
    "Do not claim the task ran until an <ACP_RESULT> envelope is returned.",
    "Never invent or write an <ACP_RESULT> envelope yourself. Only quote the real envelope the conversation receives. If asked about completion before an <ACP_RESULT> arrives, answer only that no result has arrived yet.",
    "Dispatch is performed locally: after the user replies with a confirmation word, the browser companion sends the staged envelope to the local control plane automatically. Do not claim you dispatched anything and do not tell the user to click or press anything. After the user confirms, reply only that the task is executing locally and wait for the <ACP_RESULT> envelope before reporting any outcome.",
    "After the envelope, append exactly this line so the user knows the task is only staged:",
    "任务已暂存。回复「执行」确认派发，或点 ACP 面板的「派发」。(Task staged: reply 执行 to confirm dispatch.)",
    "After receiving ACP_RESULT, explain the verified outcome and continue with a follow-up envelope only when needed.",
  ].join("\n");
}

export function stableEnvelopeId(envelope) {
  const source = JSON.stringify(envelope);
  let value = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}
