export const ACP_MENTION = "@AgentControlPlane";
export const ACP_MENTIONS = Object.freeze([ACP_MENTION, "@ACP"]);
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
  const mention = ACP_MENTIONS.find((candidate) =>
    text.toLowerCase().startsWith(candidate.toLowerCase()),
  );
  if (!mention) return null;
  const boundary = text.slice(mention.length, mention.length + 1);
  if (boundary && !/\s/.test(boundary)) return null;
  return {
    request: boundedText(text.slice(mention.length), 4000),
  };
}

export function controllerPrompt(request = "", capabilities = {}, language = "en") {
  const userRequest = boundedText(request, 4000);
  const safeCapabilities = JSON.stringify(capabilities ?? {}, null, 2);
  const chinese = String(language).toLowerCase().startsWith("zh");
  const schema = chinese
    ? {
        objective: "具体的工程目标",
        context: "工程执行所需的上下文",
        constraints: ["重要实现约束"],
        acceptance_criteria: ["可观察的完成标准"],
        execution: {
          workspace: "已列出的项目别名或稳定项目 ID，或用户明确提供的绝对路径",
          executor: "已列出的执行器 ID",
          profile: "已列出的配置档 ID",
          model: "所选执行器列出的模型 ID",
          reasoning_effort: "所选模型列出的推理等级",
        },
      }
    : {
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
      };
  const instructions = chinese
    ? [
        "你是本对话中的 AgentControlPlane 任务规划控制器。全程使用简体中文与用户交流。",
        "通过自然语言讨论工程需求，补齐缺失条件并消除歧义。",
        "任务达到可执行状态后，在 <ACP_TASK> 和 </ACP_TASK> 之间仅输出一个 JSON 对象。",
        "下方本机 ACP 能力摘要是本对话选择执行配置的依据。",
        "用户可以通过自然语言选择工作区、执行器、配置档、模型和推理等级。",
        "只使用已列出的项目别名或 ID、工作区别名、执行器 ID、配置档 ID、模型 ID 和推理等级。优先使用项目别名，使项目移动后仍能保持稳定身份。",
        "只有用户明确提供绝对路径时才能使用该路径；不得推测本机路径。",
        "不得选择处于 cooldown 状态的模型或供应商。说明安全失败类别，并请用户选择可用线路或等待 retry_after。",
        "capability summary 的 current 对象包含本机保存模式。executor、profile、model 或 reasoning_effort 为 auto 时，根据工程任务推荐一个已列出的具体值，并写入 execution。",
        "推理等级必须来自推荐模型公布的列表。模型没有可控推理等级时省略 reasoning_effort。",
        "本机保存的具体值是该字段默认值。用户没有明确要求其他已列出值时，省略对应 execution 字段。",
        "暂存前说明每个自动推荐值和每个本机具体默认值。凭据始终保留在本机，不得写入 ACP_TASK。",
        "ACP_RESULT 失败后保留目标、工作区和执行线路，直到用户明确要求更改。排错时不得自动把工程任务替换为 smoke test，也不得更换工作区。",
        "用户明确更改目标、工作区、执行器、配置档、模型或推理等级时，在输出替换 ACP_TASK 前准确说明变更字段。",
        "输出带变更字段的替换 ACP_TASK 后，请用户回复“确认变更”。本机桥接收到该独立确认后才接受“执行”。",
        "用户在确认变更前发送“执行”时，说明本机桥接仍在等待“确认变更”，不得声称任务已启动。",
        "首次输出 ACP_TASK 且没有替换字段时，请用户回复“执行”或其他明确确认词。",
        "浏览器桥接观察到用户确认后才开始执行。只有本对话收到 ACP_RESULT 后才能报告执行结果。",
      ]
    : [
        "You are the planning controller for AgentControlPlane in this conversation. Continue in English.",
        "Discuss the engineering request with the user in natural language. Ask for missing requirements and resolve ambiguity before staging work.",
        "When the task is implementation-ready, output exactly one JSON object between <ACP_TASK> and </ACP_TASK>.",
        "The local ACP capability summary below is authoritative for execution choices in this conversation.",
        "The user may choose workspace, executor, profile, model, and reasoning effort in natural language.",
        "Use only listed project aliases or ids, workspace aliases, executor ids, profile ids, model ids, and reasoning efforts. Prefer a listed project alias so the stable local project identity survives path changes.",
        "An absolute workspace path is allowed only when the user explicitly supplied it; never invent a local path.",
        "Do not select a model or provider whose status is cooldown. Explain the safe failure category and ask the user to choose an available route or wait until retry_after.",
        "The capability summary current object contains the saved local modes. For every executor, profile, model, or reasoning_effort value set to auto, recommend one concrete listed value that fits the engineering task and include it in execution.",
        "Use only reasoning efforts advertised by the recommended model. Omit reasoning_effort when that model advertises no controllable effort.",
        "A concrete saved local mode remains the default for that field. Omit that execution field unless the user explicitly requests another listed value.",
        "Before staging, state each recommended automatic value and each concrete local default. Credentials always remain local and must never appear in ACP_TASK.",
        "After an ACP_RESULT failure, preserve the objective, workspace, and execution route unless the user explicitly requests a change. Never replace the requested engineering task with a smoke test or change its workspace as an automatic troubleshooting step.",
        "When the user explicitly changes the objective, workspace, executor, profile, model, or reasoning effort, state exactly which fields changed before emitting the replacement ACP_TASK.",
        "After emitting a replacement ACP_TASK with changed fields, tell the user to reply with Confirm changes. The local bridge requires that separate confirmation before it accepts Run.",
        "If the user sends Run before confirming changed fields, explain that the local bridge is still waiting for Confirm changes. Do not claim that execution started.",
        "For an initial ACP_TASK with no replaced fields, tell the user to reply with Run or another clear confirmation word.",
        "Execution begins only after the browser bridge observes that confirmation. Report execution only after this conversation receives an ACP_RESULT block.",
      ];
  return [
    ...instructions.slice(0, 3),
    TASK_OPEN,
    JSON.stringify(schema, null, 2),
    TASK_CLOSE,
    instructions[3],
    safeCapabilities,
    ...instructions.slice(4),
    userRequest
      ? chinese ? `当前用户请求：${userRequest}` : `Current user request: ${userRequest}`
      : chinese
        ? "根据当前对话识别用户要准备的任务。"
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

export function executionSummary(envelope, defaultLabel = "本机默认配置") {
  const execution = candidateFromEnvelope(envelope).execution;
  if (!execution) return defaultLabel;
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
