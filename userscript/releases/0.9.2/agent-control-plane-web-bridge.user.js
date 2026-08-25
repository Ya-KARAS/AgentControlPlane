// ==UserScript==
// @name         AgentControlPlane Web Bridge Preview
// @name:zh-CN   AgentControlPlane 网页桥接预览
// @namespace    https://github.com/Ya-KARAS/AgentControlPlane
// @version      0.9.2
// @description  Use natural-language web AI conversations to stage and dispatch local engineering tasks.
// @description:zh-CN 通过网页 AI 自然语言对话暂存和派发本地工程任务。
// @author       Ya-KARAS
// @downloadURL  https://acp.asterroute.com/downloads/agent-control-plane-web-bridge-0.9.2.user.js
// @updateURL    https://acp.asterroute.com/downloads/agent-control-plane-web-bridge.meta.js
// @match        https://chatgpt.com/*
// @match        https://chat.deepseek.com/*
// @connect      127.0.0.1
// @connect      acp.asterroute.com
// @grant        GM_openInTab
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const USERSCRIPT_LANGUAGE_KEY = "acp-ui-language-v1";
const USERSCRIPT_LANGUAGE_MODES = Object.freeze(["auto", "zh-CN", "en"]);

const MESSAGES = Object.freeze({
  "zh-CN": Object.freeze({
    ariaLabel: "AgentControlPlane 网页桥接",
    openSettings: "点击打开本机派发设置",
    menuAuto: "ACP 语言：跟随浏览器",
    menuChinese: "ACP 语言：中文",
    menuEnglish: "ACP 语言：英文",
    menuConnectRemote: "ACP：连接手机/远程门户",
    menuDisconnectRemote: "ACP：断开远程门户",
    languageLabel: "ACP 界面语言",
    ready: "就绪",
    planning: "网页 AI 正在整理任务",
    planningRepair: "网页 AI 正在补全任务格式",
    archived: "本对话任务已封存",
    archivedDetail: "已派发任务已记录。你可以继续描述新任务。",
    fieldObjective: "任务目标",
    fieldWorkspace: "工作区",
    fieldExecutor: "执行器",
    fieldProfile: "配置档",
    fieldModel: "模型",
    fieldReasoning: "推理等级",
    taskChanged: "任务已变更 · 回复“确认变更”",
    changedFields: "变更字段：{fields}",
    executionRoute: "执行配置：{route}",
    replyConfirmChanges: "请回复“确认变更”",
    taskRestored: "任务已恢复",
    changesConfirmed: "变更已确认",
    taskReady: "任务已就绪",
    replyRun: "回复“执行”",
    replyRunDetail: "请回复“执行”",
    stageConflict: "任务版本冲突 · 请刷新页面",
    stageConflictDetail: "当前标签页不是最新任务版本。请刷新页面后重新确认。",
    localDefaults: "本机默认配置",
    waitingLocalReview: "等待本机确认",
    statusQueued: "任务排队中",
    statusRunning: "任务执行中",
    statusCompleted: "✓ 完成",
    statusFailed: "任务失败",
    statusBlocked: "任务被阻塞",
    statusPartial: "任务部分完成",
    statusCancelled: "任务已取消",
    failureBalance: "余额不足",
    failureUsage: "额度已用尽",
    failureRate: "请求限流",
    failureAuth: "认证失败",
    failureExecutor: "执行器不可用",
    failureProvider: "模型服务不可用",
    failureTask: "工程任务失败",
    reasonUnknown: "原因未知",
    statusUpdated: "状态已更新",
    statusExpired: "状态查看已过期",
    statusReadStopped: "无法继续读取状态",
    localStatusUnavailable: "本机状态暂不可用",
    remoteStatusUnavailable: "远程任务状态暂不可用",
    remoteTaskUnavailable: "原任务记录不可用，请重新发送任务",
    remotePairingExpired: "远程配对已失效，请重新连接",
    dispatching: "正在派发",
    dispatched: "任务已派发",
    connectionTimeout: "连接本机超时",
    localDisconnected: "本机 ACP 未连接",
    browserDispatchUnsupported: "浏览器不支持安全派发",
    routeCooldown: "所选模型暂时冷却",
    dispatchFailed: "派发失败",
    taskInvalid: "任务格式无效",
    describeTask: "请在 @ACP 后描述任务",
    readingCapabilities: "正在读取本机可选配置",
    readConfigFailed: "无法读取本机配置",
    taskStatusUnverified: "任务状态无法校验",
    remoteUrlPrompt: "输入 ACP 门户地址",
    remoteCodePrompt: "输入注册邮箱收到的六位设备匹配码（手机和电脑使用同一个码）",
    remotePairing: "正在连接远程门户",
    remoteConnected: "远程门户已连接",
    remotePairFailed: "远程门户配对失败",
    remoteDisconnected: "远程门户已断开",
  }),
  en: Object.freeze({
    ariaLabel: "AgentControlPlane web bridge",
    openSettings: "Open local dispatch settings",
    menuAuto: "ACP language: Follow browser",
    menuChinese: "ACP language: Chinese",
    menuEnglish: "ACP language: English",
    menuConnectRemote: "ACP: Connect phone/remote portal",
    menuDisconnectRemote: "ACP: Disconnect remote portal",
    languageLabel: "ACP interface language",
    ready: "Ready",
    planning: "Web AI is preparing the task",
    planningRepair: "Web AI is repairing the task format",
    archived: "Conversation task archived",
    archivedDetail: "The dispatched task is recorded. You can describe a new task.",
    fieldObjective: "Objective",
    fieldWorkspace: "Workspace",
    fieldExecutor: "Executor",
    fieldProfile: "Profile",
    fieldModel: "Model",
    fieldReasoning: "Reasoning effort",
    taskChanged: "Task changed · Reply “Confirm changes”",
    changedFields: "Changed fields: {fields}",
    executionRoute: "Execution route: {route}",
    replyConfirmChanges: "Reply “Confirm changes”",
    taskRestored: "Task restored",
    changesConfirmed: "Changes confirmed",
    taskReady: "Task ready",
    replyRun: "Reply “Run”",
    replyRunDetail: "Reply “Run”",
    stageConflict: "Task version conflict · Refresh the page",
    stageConflictDetail: "This tab does not hold the latest task version. Refresh the page and confirm again.",
    localDefaults: "Local defaults",
    waitingLocalReview: "Waiting for local confirmation",
    statusQueued: "Task queued",
    statusRunning: "Task running",
    statusCompleted: "✓ Completed",
    statusFailed: "Task failed",
    statusBlocked: "Task blocked",
    statusPartial: "Task partially completed",
    statusCancelled: "Task cancelled",
    failureBalance: "Insufficient balance",
    failureUsage: "Usage limit reached",
    failureRate: "Rate limited",
    failureAuth: "Authentication failed",
    failureExecutor: "Executor unavailable",
    failureProvider: "Model service unavailable",
    failureTask: "Engineering task failed",
    reasonUnknown: "Unknown reason",
    statusUpdated: "Status updated",
    statusExpired: "Status access expired",
    statusReadStopped: "Status access ended",
    localStatusUnavailable: "Local status unavailable",
    remoteStatusUnavailable: "Remote task status unavailable",
    remoteTaskUnavailable: "The original task is unavailable. Send the task again.",
    remotePairingExpired: "Remote pairing expired. Connect again.",
    dispatching: "Dispatching",
    dispatched: "Task dispatched",
    connectionTimeout: "Local connection timed out",
    localDisconnected: "Local ACP is disconnected",
    browserDispatchUnsupported: "Browser does not support secure dispatch",
    routeCooldown: "Selected model is cooling down",
    dispatchFailed: "Dispatch failed",
    taskInvalid: "Invalid task format",
    describeTask: "Describe the task after @ACP",
    readingCapabilities: "Reading local execution choices",
    readConfigFailed: "Could not read local settings",
    taskStatusUnverified: "Could not verify task status",
    remoteUrlPrompt: "Enter the ACP portal URL",
    remoteCodePrompt: "Enter the six-digit device matching code sent to your account email (use the same code on phone and computer)",
    remotePairing: "Connecting remote portal",
    remoteConnected: "Remote portal connected",
    remotePairFailed: "Remote portal pairing failed",
    remoteDisconnected: "Remote portal disconnected",
  }),
});

function normalizeUserscriptLanguage(value) {
  return USERSCRIPT_LANGUAGE_MODES.includes(value) ? value : "auto";
}

function resolveUserscriptLanguage(mode, browserLanguages = []) {
  const normalized = normalizeUserscriptLanguage(mode);
  if (normalized !== "auto") return normalized;
  const languages = Array.isArray(browserLanguages) ? browserLanguages : [browserLanguages];
  return languages.some((language) => String(language ?? "").toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en";
}

function userscriptText(language, key, values = {}) {
  const selected = MESSAGES[language] ?? MESSAGES.en;
  const template = selected[key] ?? MESSAGES.en[key] ?? key;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

function userscriptMessageKeys(language) {
  return Object.keys(MESSAGES[language] ?? {}).sort();
}
  function parseCapabilitiesResponse(response) {
  let body;
  try {
    body = JSON.parse(response?.responseText ?? "");
  } catch {
    throw new Error("invalid_capabilities_response");
  }
  if (
    response?.status !== 200
    || !body.capabilities
    || typeof body.capabilities !== "object"
    || Array.isArray(body.capabilities)
  ) {
    throw new Error(body.error?.code ?? `http_${response?.status ?? 0}`);
  }
  return body.capabilities;
}

async function readCapabilitiesWithFallback({
  readLocal,
  readRemote = null,
  preferRemote = false,
}) {
  const readers = preferRemote && readRemote
    ? [readRemote, readLocal]
    : [readLocal, readRemote].filter(Boolean);
  let firstError = null;
  for (const reader of readers) {
    try {
      return parseCapabilitiesResponse(await reader());
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError ?? new Error("capabilities_unavailable");
}
  const TASK_ID = /^[0-9a-f-]{36}$/i;

function parseRemoteTaskResponse(response, expectedStatus = 200) {
  let body;
  try {
    body = JSON.parse(response?.responseText ?? "");
  } catch {
    throw new Error("invalid_remote_task_response");
  }
  if (response?.status !== expectedStatus) {
    throw new Error(body?.error?.code ?? `http_${response?.status ?? 0}`);
  }
  const task = body?.task && typeof body.task === "object" ? body.task : body;
  if (
    !task
    || typeof task !== "object"
    || !TASK_ID.test(String(task.id ?? ""))
    || typeof task.status !== "string"
  ) {
    throw new Error("invalid_remote_task_response");
  }
  return body?.task ? body : { task };
}
  function readFloatingPosition(value) {
  if (
    !value
    || typeof value !== "object"
    || !Number.isFinite(value.x)
    || !Number.isFinite(value.y)
  ) return null;
  return { x: Number(value.x), y: Number(value.y) };
}

function clampFloatingPosition({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  margin = 8,
}) {
  const maxX = Math.max(margin, viewportWidth - width - margin);
  const maxY = Math.max(margin, viewportHeight - height - margin);
  return {
    x: Math.min(maxX, Math.max(margin, x)),
    y: Math.min(maxY, Math.max(margin, y)),
  };
}

function pointerMoved(startX, startY, currentX, currentY, threshold = 6) {
  return Math.hypot(currentX - startX, currentY - startY) >= threshold;
}
  const ACP_MENTION = "@AgentControlPlane";
const ACP_MENTIONS = Object.freeze([ACP_MENTION, "@ACP"]);
const TASK_OPEN = "<ACP_TASK>";
const TASK_CLOSE = "</ACP_TASK>";

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

function parseLaunchCommand(value) {
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

function controllerPrompt(request = "", capabilities = {}, language = "en") {
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

function taskPlanningRepairPrompt(language = "en") {
  const chinese = String(language).toLowerCase().startsWith("zh");
  return chinese
    ? [
        "上一条回复没有包含有效的 <ACP_TASK> 任务块，因此本机桥接尚未派发任何任务。",
        "用户已经明确回复“执行”，不要再次要求确认，也不要声称任务已经提交。",
        "请根据本对话中的真实工程需求和先前提供的本机能力摘要，立即输出完整任务。",
        "只输出一个 <ACP_TASK> 与 </ACP_TASK> 包围的 JSON 对象；不要输出示例、解释、代码或 ACP_RESULT。",
        "JSON 必须包含 objective、context、constraints、acceptance_criteria 和 execution，并填写真实任务值。",
      ].join("\n")
    : [
        "Your previous response did not contain a valid <ACP_TASK> block, so the local bridge has not dispatched anything.",
        "The user already explicitly confirmed Run. Do not request confirmation again and do not claim the task was submitted.",
        "Using the real engineering request in this conversation and the capability summary supplied earlier, emit the complete task now.",
        "Output only one JSON object between <ACP_TASK> and </ACP_TASK>; do not output examples, explanations, code, or ACP_RESULT.",
        "The JSON must contain objective, context, constraints, acceptance_criteria, and execution with real task values.",
      ].join("\n");
}

function extractTaskEnvelope(value) {
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

function candidateFromEnvelope(envelope) {
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

function executionSummary(envelope, defaultLabel = "本机默认配置") {
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

function isConfirmation(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[吧啊呀哦哈呢嘛咯]+[!！。.]?$/u, "")
    .replace(/[!！。.\s]+$/u, "")
    .trim();
  return CONFIRM_WORDS.has(normalized);
}

function isChangeConfirmation(value) {
  return CHANGE_CONFIRM_WORDS.has(
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[!！。.\s]+$/u, "")
      .trim(),
  );
}

function taskEnvelopeChanges(previous, next) {
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

function envelopeId(envelope) {
  const source = JSON.stringify(envelope);
  let value = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

function safeResultBlock(task) {
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
  const STAGE_RECORD_VERSION = 2;

function boundedInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function conversationScope(locationLike) {
  const origin = String(locationLike?.origin ?? "").trim();
  const pathname = String(locationLike?.pathname ?? "/").trim() || "/";
  return `${origin}${pathname}`;
}

function stageStorageKey(scope) {
  return `acp-stage-v2:${String(scope ?? "")}`;
}

function stageLockName(scope) {
  return `acp-stage-lock-v2:${String(scope ?? "")}`;
}

function createStageRecord(stage, { scope, expiresAt }) {
  return {
    version: STAGE_RECORD_VERSION,
    state: "staged",
    scope,
    id: stage.id,
    revision: stage.revision,
    ownerId: stage.ownerId,
    envelope: stage.envelope,
    changes: Array.isArray(stage.changes) ? stage.changes.slice(0, 6) : [],
    changeConfirmed: stage.changeConfirmed === true,
    assistantOrdinal: boundedInteger(stage.assistantOrdinal),
    expiresAt,
  };
}

function createPlanningRecord({
  scope,
  revision,
  ownerId,
  assistantOrdinal,
  baselineEnvelope,
  dispatchWhenReady = false,
  expiresAt,
}) {
  return {
    version: STAGE_RECORD_VERSION,
    state: "planning",
    scope,
    revision,
    ownerId,
    assistantOrdinal: boundedInteger(assistantOrdinal),
    baselineEnvelope: baselineEnvelope ?? null,
    dispatchWhenReady: dispatchWhenReady === true,
    expiresAt,
  };
}

function createDispatchedRecord(stage, { scope, dispatchedAt }) {
  return {
    version: STAGE_RECORD_VERSION,
    state: "dispatched",
    scope,
    id: stage.id,
    assistantOrdinal: boundedInteger(stage.assistantOrdinal),
    dispatchedAt,
  };
}

function readStageRecord(value, { scope, now = Date.now() }) {
  if (
    !value ||
    value.version !== STAGE_RECORD_VERSION ||
    value.scope !== scope ||
    !["staged", "planning", "dispatched"].includes(value.state)
  ) {
    return null;
  }
  if (
    value.state !== "dispatched" &&
    (now >= Number(value.expiresAt ?? 0) ||
      typeof value.revision !== "string" ||
      !value.revision)
  ) {
    return null;
  }
  if (
    value.state === "staged" &&
    (typeof value.id !== "string" ||
      !value.id ||
      !value.envelope ||
      typeof value.envelope !== "object" ||
      Array.isArray(value.envelope))
  ) {
    return null;
  }
  if (value.state === "dispatched" && (typeof value.id !== "string" || !value.id)) {
    return null;
  }
  return value;
}

function stageRecordsMatch(left, right) {
  return Boolean(
    left &&
    right &&
    left.state === "staged" &&
    right.state === "staged" &&
    left.scope === right.scope &&
    left.id === right.id &&
    left.revision === right.revision,
  );
}

function observationCanReplace(record, observation) {
  if (!record) return true;
  if (record.state === "staged" && record.id === observation.id) return true;
  if (record.state === "dispatched" && record.id === observation.id) return false;
  return boundedInteger(observation.assistantOrdinal) >
    boundedInteger(record.assistantOrdinal);
}

function observationWasDispatched(record, observation) {
  return Boolean(
    record?.state === "dispatched" &&
    (record.id === observation?.id ||
      boundedInteger(observation?.assistantOrdinal) <=
        boundedInteger(record.assistantOrdinal)),
  );
}

function observationWaitsBehindBarrier(record, observation) {
  return Boolean(
    record?.state === "planning" &&
    boundedInteger(observation?.assistantOrdinal) <=
      boundedInteger(record.assistantOrdinal),
  );
}
  const RESULT_DELIVERY_RECORD_VERSION = 1;
const RESULT_DELIVERY_MAX_ENTRIES = 32;

function normalizeTaskId(value) {
  const taskId = String(value ?? "").trim();
  return taskId && taskId.length <= 128 ? taskId : null;
}

function resultDeliveryStorageKey(scope) {
  return `acp-result-delivery-v1:${String(scope ?? "")}`;
}

function readResultDeliveryRecord(value, { scope, now = Date.now() }) {
  if (
    !value ||
    value.version !== RESULT_DELIVERY_RECORD_VERSION ||
    value.scope !== scope ||
    !Array.isArray(value.deliveries)
  ) {
    return null;
  }

  const seen = new Set();
  const deliveries = [];
  for (const entry of value.deliveries) {
    const taskId = normalizeTaskId(entry?.taskId);
    const deliveredAt = Number(entry?.deliveredAt);
    const expiresAt = Number(entry?.expiresAt);
    if (
      !taskId ||
      seen.has(taskId) ||
      !Number.isFinite(deliveredAt) ||
      !Number.isFinite(expiresAt) ||
      deliveredAt < 0 ||
      now >= expiresAt
    ) {
      continue;
    }
    seen.add(taskId);
    deliveries.push({ taskId, deliveredAt, expiresAt });
    if (deliveries.length >= RESULT_DELIVERY_MAX_ENTRIES) break;
  }

  return {
    version: RESULT_DELIVERY_RECORD_VERSION,
    scope,
    deliveries,
  };
}

function resultWasDelivered(value, { scope, taskId, now = Date.now() }) {
  const normalizedTaskId = normalizeTaskId(taskId);
  if (!normalizedTaskId) return false;
  return Boolean(
    readResultDeliveryRecord(value, { scope, now })?.deliveries
      .some((entry) => entry.taskId === normalizedTaskId),
  );
}

function rememberResultDelivery(value, {
  scope,
  taskId,
  deliveredAt = Date.now(),
  expiresAt,
}) {
  const normalizedTaskId = normalizeTaskId(taskId);
  if (
    !normalizedTaskId ||
    !Number.isFinite(deliveredAt) ||
    !Number.isFinite(expiresAt) ||
    deliveredAt < 0 ||
    expiresAt <= deliveredAt
  ) {
    throw new Error("invalid_result_delivery");
  }

  const current = readResultDeliveryRecord(value, { scope, now: deliveredAt });
  const deliveries = [
    { taskId: normalizedTaskId, deliveredAt, expiresAt },
    ...(current?.deliveries ?? []).filter(
      (entry) => entry.taskId !== normalizedTaskId,
    ),
  ].slice(0, RESULT_DELIVERY_MAX_ENTRIES);

  return {
    version: RESULT_DELIVERY_RECORD_VERSION,
    scope,
    deliveries,
  };
}

  const ROOT_ID = "acp-web-bridge-preview";
  const LOCAL_BASE_URL = "http://127.0.0.1:4318";
  const CANDIDATE_URL = `${LOCAL_BASE_URL}/v1/local-review/candidates`;
  const CAPABILITIES_URL = `${LOCAL_BASE_URL}/v1/local-review/capabilities`;
  const REMOTE_RELAY_KEY = "acp-remote-relay-v1";
  const FLOATING_POSITION_KEY = "acp-floating-position-v1";
  const DEFAULT_REMOTE_RELAY_URL = "https://acp.asterroute.com";
  const ADAPTERS = Object.freeze([{"id":"chatgpt","displayName":"ChatGPT","origins":["https://chatgpt.com"],"composer":["#prompt-textarea","textarea"],"send":["button[data-testid=\"send-button\"]","button[aria-label*=\"Send\"]"],"assistant":["[data-message-author-role=\"assistant\"]"],"user":["[data-message-author-role=\"user\"]"]},{"id":"deepseek","displayName":"DeepSeek","origins":["https://chat.deepseek.com"],"composer":["textarea","[contenteditable=\"true\"]"],"send":["button[aria-label*=\"Send\"]","button[aria-label*=\"发送\"]","button[type=\"submit\"]","form button:not([type])"],"assistant":[".ds-markdown","[data-role=\"assistant\"]",".markdown-body"],"user":["[data-message-author-role=\"user\"]","[data-role=\"user\"]",".ds-chat [class*=\"user\"]","main [class*=\"user\"]"]}]);
  const STAGE_TTL_MS = 10 * 60 * 1000;
  const RESULT_DELIVERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const TERMINAL_TASK_STATUSES = new Set([
    "completed",
    "failed",
    "blocked",
    "partial",
    "cancelled",
  ]);
  const adapter = ADAPTERS.find((entry) =>
    entry.origins.includes(window.location.origin),
  );
  if (!adapter || document.getElementById(ROOT_ID)) return;

  let languageMode = "auto";
  let uiLanguage = resolveUserscriptLanguage(
    languageMode,
    navigator.languages ?? [navigator.language],
  );
  const t = (key, values) => userscriptText(uiLanguage, key, values);

  let staged = null;
  let dispatchingEnvelopeId = null;
  let tracking = null;
  let pollTimer = null;
  let pendingResult = null;
  let suppressCapture = false;
  let inspectTimer = null;
  let launchPending = false;
  let planningActive = false;
  const TAB_ID = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let revisionSequence = 0;
  let activeScope = conversationScope(window.location);
  let planningBaseline = null;
  let remoteRelay = null;
  const mobileBrowser = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  let statusAction = mobileBrowser ? "pair-remote" : "settings";

  const nextRevision = () =>
    `${Date.now().toString(36)}:${TAB_ID}:${revisionSequence += 1}`;
  const currentStorageKey = () => stageStorageKey(activeScope);
  const currentLockName = () => stageLockName(activeScope);
  const currentResultDeliveryKey = (scope = activeScope) =>
    resultDeliveryStorageKey(scope);
  const withStageLock = async (callback) => {
    if (!navigator.locks?.request) throw new Error("stage_lock_unavailable");
    return navigator.locks.request(currentLockName(), { mode: "exclusive" }, callback);
  };

  const readStoredStage = async () => {
    const record = readStageRecord(
      await Promise.resolve(GM_getValue(currentStorageKey(), null)),
      { scope: activeScope },
    );
    if (record?.state === "staged") {
      try {
        candidateFromEnvelope(record.envelope);
        if (envelopeId(record.envelope) !== record.id) return null;
      } catch {
        return null;
      }
    }
    return record;
  };

  const saveStage = async () => {
    if (!staged) {
      await Promise.resolve(GM_deleteValue(currentStorageKey()));
      return;
    }
    await Promise.resolve(GM_setValue(
      currentStorageKey(),
      createStageRecord(staged, {
        scope: activeScope,
        expiresAt: Date.now() + STAGE_TTL_MS,
      }),
    ));
  };

  const restoreStage = async () => {
    const saved = await readStoredStage();
    if (!saved) {
      planningActive = false;
      await Promise.resolve(GM_deleteValue(currentStorageKey()));
      return;
    }
    if (saved.state === "planning") {
      staged = null;
      planningActive = true;
      planningBaseline = saved.baselineEnvelope ?? null;
      showStatus(t("planning"));
      return;
    }
    if (saved.state === "dispatched") {
      staged = null;
      planningActive = false;
      planningBaseline = null;
      dispatchingEnvelopeId = saved.id;
      showStatus(
        t("archived"),
        t("archivedDetail"),
      );
      return;
    }
    try {
      candidateFromEnvelope(saved.envelope);
      if (envelopeId(saved.envelope) !== saved.id) throw new Error("stage_id_mismatch");
      staged = {
        id: saved.id,
        revision: saved.revision,
        ownerId: saved.ownerId,
        envelope: saved.envelope,
        changes: Array.isArray(saved.changes) ? saved.changes.slice(0, 6) : [],
        changeConfirmed: saved.changeConfirmed === true,
        assistantOrdinal: Number(saved.assistantOrdinal ?? 0),
      };
      planningActive = false;
      showStagedStatus("restored");
    } catch {
      planningActive = false;
      await Promise.resolve(GM_deleteValue(currentStorageKey()));
    }
  };

  const ensureConversationScope = async () => {
    const scope = conversationScope(window.location);
    if (scope === activeScope) return;
    activeScope = scope;
    staged = null;
    planningActive = false;
    planningBaseline = null;
    dispatchingEnvelopeId = null;
    await restoreStage();
    if (pendingResult?.scope === activeScope) {
      void returnResultToConversation();
    }
  };

  const stableIdempotencyKey = async (activeEnvelope) => {
    const payload = new TextEncoder().encode(JSON.stringify({
      origin: window.location.origin,
      path: window.location.pathname,
      envelope: activeEnvelope.envelope,
    }));
    const digest = await crypto.subtle.digest("SHA-256", payload);
    const hex = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return `userscript:${hex}`;
  };

  const request = (options) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      ...options,
      timeout: 10000,
      onload: resolve,
      onerror: () => reject(new Error("network_error")),
      ontimeout: () => reject(new Error("timeout")),
    });
  });

  const normalizeRemoteUrl = (value) => {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "https:") throw new Error("remote_url_invalid");
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  };

  const loadRemoteRelay = async () => {
    const saved = await Promise.resolve(GM_getValue(REMOTE_RELAY_KEY, null));
    try {
      const refreshToken = saved?.refreshToken ?? saved?.token;
      if (
        !saved ||
        typeof saved !== "object" ||
        typeof refreshToken !== "string" ||
        !/^(?:acpr_)?[A-Za-z0-9_-]{32,256}$/.test(refreshToken)
      ) return null;
      return {
        baseUrl: normalizeRemoteUrl(saved.baseUrl),
        refreshToken,
        accessToken: typeof saved.accessToken === "string" ? saved.accessToken : null,
        accessTokenExpiresAt: Number(saved.accessTokenExpiresAt ?? 0),
        credentialVersion: Number(saved.credentialVersion ?? (saved.refreshToken ? 2 : 1)),
      };
    } catch {
      return null;
    }
  };

  const ensureRemoteAccessToken = async () => {
    if (!remoteRelay) throw new Error("remote_not_configured");
    if (
      remoteRelay.accessToken &&
      (remoteRelay.credentialVersion === 1 || remoteRelay.accessTokenExpiresAt - Date.now() > 60000)
    ) return remoteRelay.accessToken;
    const response = await request({
      method: "POST",
      url: `${remoteRelay.baseUrl}/api/acp/tokens/refresh`,
      headers: { authorization: `Bearer ${remoteRelay.refreshToken}` },
    });
    const body = JSON.parse(response.responseText || "{}");
    if (
      response.status === 200 &&
      /^acpa_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(body.access_token ?? "") &&
      Number.isFinite(Date.parse(body.access_token_expires_at ?? ""))
    ) {
      if (body.refresh_token) remoteRelay.refreshToken = body.refresh_token;
      remoteRelay.accessToken = body.access_token;
      remoteRelay.accessTokenExpiresAt = Date.parse(body.access_token_expires_at);
      remoteRelay.credentialVersion = 2;
      await Promise.resolve(GM_setValue(REMOTE_RELAY_KEY, remoteRelay));
      return remoteRelay.accessToken;
    }
    if (remoteRelay.credentialVersion === 1) return remoteRelay.refreshToken;
    throw new Error(body.error?.code ?? `http_${response.status}`);
  };

  const remoteHeaders = async (extra = {}) => ({
    ...extra,
    authorization: `Bearer ${await ensureRemoteAccessToken()}`,
  });

  const pairRemoteRelay = async () => {
    const baseUrl = window.prompt(
      t("remoteUrlPrompt"),
      remoteRelay?.baseUrl ?? DEFAULT_REMOTE_RELAY_URL,
    );
    if (!baseUrl) return;
    const code = window.prompt(t("remoteCodePrompt"), "");
    if (!code) return;
    showStatus(t("remotePairing"));
    try {
      const normalizedUrl = normalizeRemoteUrl(baseUrl);
      const response = await request({
        method: "POST",
        url: `${normalizedUrl}/api/acp/pairings/claim`,
        headers: { "content-type": "application/json", "x-acp-credential-version": "2" },
        data: JSON.stringify({
          code: code.trim().toUpperCase().replaceAll("-", ""),
          kind: "browser",
          label: `${adapter.displayName} · ${navigator.platform || "browser"}`.slice(0, 80),
        }),
      });
      const body = JSON.parse(response.responseText);
      const refreshToken = body.refresh_token ?? body.token;
      if (response.status !== 201 || !/^(?:acpr_)?[A-Za-z0-9_-]{32,256}$/.test(refreshToken ?? "")) {
        throw new Error(body.error?.code ?? `http_${response.status}`);
      }
      remoteRelay = {
        baseUrl: normalizedUrl,
        refreshToken,
        accessToken: typeof body.access_token === "string" ? body.access_token : refreshToken,
        accessTokenExpiresAt: Date.parse(body.access_token_expires_at ?? "") || 0,
        credentialVersion: typeof body.access_token === "string" ? 2 : 1,
      };
      await Promise.resolve(GM_setValue(REMOTE_RELAY_KEY, remoteRelay));
      showStatus(t("remoteConnected"));
    } catch {
      showStatus(t("remotePairFailed"));
    }
  };

  const disconnectRemoteRelay = async () => {
    remoteRelay = null;
    await Promise.resolve(GM_deleteValue(REMOTE_RELAY_KEY));
    showStatus(t("remoteDisconnected"));
  };

  const visibleElements = (selectors) => {
    const found = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (
          node instanceof HTMLElement &&
          node.isConnected &&
          node.getClientRects().length > 0 &&
          !found.includes(node)
        ) {
          found.push(node);
        }
      }
    }
    return found;
  };

  const findComposer = () => visibleElements(adapter.composer).at(-1) ?? null;
  const enabledControl = (node) =>
    node instanceof HTMLElement &&
    node.isConnected &&
    node.getClientRects().length > 0 &&
    !node.matches(":disabled") &&
    node.getAttribute("aria-disabled") !== "true";
  const composerActionSurface = (composer) => {
    if (!composer) return null;
    const form = composer.closest("form");
    if (form) return form;
    let surface = composer.parentElement;
    for (let depth = 0; surface && depth < 6; depth += 1) {
      if (surface.querySelector('button, [role="button"]')) return surface;
      surface = surface.parentElement;
    }
    return null;
  };
  const findSendButton = (composer = findComposer()) => {
    const explicit = visibleElements(adapter.send).filter(enabledControl).at(-1);
    if (explicit) return explicit;
    const surface = composerActionSurface(composer);
    if (!surface) return null;
    const controls = [...surface.querySelectorAll('button, [role="button"]')]
      .filter(enabledControl);
    if (!controls.length) return null;
    return controls.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.right - rightRect.right || leftRect.bottom - rightRect.bottom;
    }).at(-1) ?? null;
  };
  const isComposerSubmission = (event, composer) => {
    if (event.type === "submit") {
      return event.target instanceof HTMLFormElement && event.target.contains(composer);
    }
    if (event.type !== "click" || !(event.target instanceof Element)) return false;
    const clickedControl = event.target.closest('button, [role="button"]');
    const sendButton = findSendButton(composer);
    return Boolean(
      clickedControl &&
      sendButton &&
      (clickedControl === sendButton || sendButton.contains(clickedControl)),
    );
  };
  const latestText = (selectors) =>
    visibleElements(selectors).at(-1)?.textContent?.trim() ?? "";
  const latestTaskObservation = () => {
    const messages = visibleElements(adapter.assistant);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const envelope = extractTaskEnvelope(messages[index].textContent?.trim() ?? "");
      if (envelope) {
        return {
          envelope,
          id: envelopeId(envelope),
          assistantOrdinal: index + 1,
        };
      }
    }
    return null;
  };

  const readComposer = (composer = findComposer()) => {
    if (!composer) return "";
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      return composer.value.trim();
    }
    return composer.textContent?.trim() ?? "";
  };

  const writeComposer = (value, composer = findComposer()) => {
    if (!composer) return false;
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const prototype = composer instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(composer, value);
      else composer.value = value;
    } else {
      composer.textContent = value;
    }
    composer.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value,
    }));
    return true;
  };

  const submitComposer = async () => {
    suppressCapture = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const composer = findComposer();
      const button = findSendButton(composer);
      if (button) {
        button.click();
        return true;
      }
      const form = composer?.closest("form");
      if (!form) return false;
      form.requestSubmit();
      return true;
    } finally {
      setTimeout(() => {
        suppressCapture = false;
      }, 100);
    }
  };

  const root = document.createElement("section");
  root.id = ROOT_ID;
  root.setAttribute("aria-label", t("ariaLabel"));

  const style = document.createElement("style");
  style.textContent = `
    #${ROOT_ID} { align-items: center; bottom: 20px; display: flex; font-family: system-ui, sans-serif; gap: 7px; position: fixed; right: 20px; z-index: 2147483647; }
    #${ROOT_ID} button { background: #536af5; border: 0; border-radius: 999px; box-shadow: 0 8px 24px rgba(28, 39, 102, .28); color: #fff; cursor: grab; font: 700 12px system-ui, sans-serif; max-width: min(360px, calc(100vw - 40px)); overflow: hidden; padding: 9px 13px; text-overflow: ellipsis; touch-action: none; transition: background-color .18s ease, box-shadow .18s ease; user-select: none; white-space: nowrap; }
    #${ROOT_ID} button[data-dragging="true"] { cursor: grabbing; }
    #${ROOT_ID} button[data-state="completed"] { background: #16803d; box-shadow: 0 8px 24px rgba(22, 128, 61, .3); }
    #${ROOT_ID} select { appearance: auto; background: #161b22; border: 1px solid #536af5; border-radius: 999px; color: #fff; cursor: pointer; font: 700 12px system-ui, sans-serif; padding: 8px 9px; }
  `;
  const statusButton = document.createElement("button");
  statusButton.type = "button";
  statusButton.textContent = `ACP · ${t("ready")}`;
  statusButton.title = statusAction === "pair-remote"
    ? t("menuConnectRemote")
    : t("openSettings");
  let suppressStatusClick = false;
  let dragState = null;
  let floatingPosition = null;
  const applyFloatingPosition = (position) => {
    const rect = root.getBoundingClientRect();
    floatingPosition = clampFloatingPosition({
      ...position,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    root.style.left = `${floatingPosition.x}px`;
    root.style.top = `${floatingPosition.y}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  };
  const restoreFloatingPosition = async () => {
    const saved = readFloatingPosition(
      await Promise.resolve(GM_getValue(FLOATING_POSITION_KEY, null)),
    );
    if (saved) applyFloatingPosition(saved);
  };
  statusButton.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = root.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rootX: rect.left,
      rootY: rect.top,
      moved: false,
    };
    statusButton.setPointerCapture?.(event.pointerId);
  });
  statusButton.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState.moved ||= pointerMoved(
      dragState.startX,
      dragState.startY,
      event.clientX,
      event.clientY,
    );
    if (!dragState.moved) return;
    event.preventDefault();
    statusButton.dataset.dragging = "true";
    applyFloatingPosition({
      x: dragState.rootX + event.clientX - dragState.startX,
      y: dragState.rootY + event.clientY - dragState.startY,
    });
  });
  const finishStatusDrag = async (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const moved = dragState.moved;
    dragState = null;
    delete statusButton.dataset.dragging;
    if (!moved || !floatingPosition) return;
    suppressStatusClick = true;
    setTimeout(() => { suppressStatusClick = false; }, 0);
    await Promise.resolve(GM_setValue(FLOATING_POSITION_KEY, floatingPosition));
  };
  statusButton.addEventListener("pointerup", (event) => void finishStatusDrag(event));
  statusButton.addEventListener("pointercancel", (event) => void finishStatusDrag(event));
  statusButton.addEventListener("click", () => {
    if (suppressStatusClick) return;
    if (!remoteRelay && statusAction === "pair-remote") {
      void pairRemoteRelay();
      return;
    }
    GM_openInTab(remoteRelay?.baseUrl ?? `${LOCAL_BASE_URL}/local-review/settings`, {
      active: true,
      insert: true,
      setParent: true,
    });
  });
  const languageSelect = document.createElement("select");
  languageSelect.setAttribute("aria-label", t("languageLabel"));
  for (const [value, label] of [
    ["auto", "Auto"],
    ["zh-CN", "中文"],
    ["en", "English"],
  ]) {
    const languageOption = document.createElement("option");
    languageOption.value = value;
    languageOption.textContent = label;
    languageSelect.append(languageOption);
  }
  languageSelect.addEventListener("change", async () => {
    const mode = normalizeUserscriptLanguage(languageSelect.value);
    await Promise.resolve(GM_setValue(USERSCRIPT_LANGUAGE_KEY, mode));
    window.location.reload();
  });
  root.append(style, languageSelect, statusButton);
  document.body.append(root);
  window.addEventListener("resize", () => {
    if (floatingPosition) applyFloatingPosition(floatingPosition);
  });

  const registerLanguageMenu = () => {
    if (typeof GM_registerMenuCommand !== "function") return;
    for (const [mode, labelKey] of [
      ["auto", "menuAuto"],
      ["zh-CN", "menuChinese"],
      ["en", "menuEnglish"],
    ]) {
      GM_registerMenuCommand(
        `${languageMode === mode ? "✓ " : ""}${t(labelKey)}`,
        async () => {
          await Promise.resolve(GM_setValue(USERSCRIPT_LANGUAGE_KEY, mode));
          window.location.reload();
        },
      );
    }
    GM_registerMenuCommand(t("menuConnectRemote"), pairRemoteRelay);
    if (remoteRelay) {
      GM_registerMenuCommand(t("menuDisconnectRemote"), disconnectRemoteRelay);
    }
  };

  const initializeLanguage = async () => {
    remoteRelay = await loadRemoteRelay();
    languageMode = normalizeUserscriptLanguage(
      await Promise.resolve(GM_getValue(USERSCRIPT_LANGUAGE_KEY, "auto")),
    );
    uiLanguage = resolveUserscriptLanguage(
      languageMode,
      navigator.languages ?? [navigator.language],
    );
    languageSelect.value = languageMode;
    languageSelect.setAttribute("aria-label", t("languageLabel"));
    languageSelect.title = t("languageLabel");
    root.setAttribute("aria-label", t("ariaLabel"));
    statusButton.textContent = `ACP · ${t("ready")}`;
    statusAction = remoteRelay ? "settings" : mobileBrowser ? "pair-remote" : "settings";
    statusButton.title = statusAction === "pair-remote"
      ? t("menuConnectRemote")
      : t("openSettings");
    registerLanguageMenu();
  };

  const showStatus = (text, detail = text, state = "default", action = "settings") => {
    statusAction = action;
    statusButton.textContent = `ACP · ${text}`;
    const actionHint = statusAction === "pair-remote"
      ? t("menuConnectRemote")
      : t("openSettings");
    statusButton.title = `AgentControlPlane\n${detail}\n${actionHint}`;
    statusButton.dataset.state = state;
    if (floatingPosition) requestAnimationFrame(() => applyFloatingPosition(floatingPosition));
  };

  const showStagedStatus = (mode = "ready") => {
    if (!staged) return;
    const route = executionSummary(staged.envelope, t("localDefaults"));
    if (staged.changes?.length && !staged.changeConfirmed) {
      const labels = {
        objective: t("fieldObjective"),
        workspace: t("fieldWorkspace"),
        executor: t("fieldExecutor"),
        profile: t("fieldProfile"),
        model: t("fieldModel"),
        reasoning_effort: t("fieldReasoning"),
      };
      const changed = staged.changes
        .map((field) => labels[field] ?? field)
        .join(uiLanguage === "zh-CN" ? "、" : ", ");
      showStatus(
        t("taskChanged"),
        [
          t("changedFields", { fields: changed }),
          t("executionRoute", { route }),
          t("replyConfirmChanges"),
        ].join("\n"),
      );
      return;
    }
    const label = mode === "restored"
      ? t("taskRestored")
      : mode === "change-confirmed"
        ? t("changesConfirmed")
        : t("taskReady");
    showStatus(
      `${label} · ${t("replyRun")}`,
      [label, t("executionRoute", { route }), t("replyRunDetail")].join("\n"),
    );
  };

  const showStageConflict = () => showStatus(
    t("stageConflict"),
    t("stageConflictDetail"),
  );

  const stageFromRecord = (record) => ({
    id: record.id,
    revision: record.revision,
    ownerId: record.ownerId,
    envelope: record.envelope,
    changes: Array.isArray(record.changes) ? record.changes.slice(0, 6) : [],
    changeConfirmed: record.changeConfirmed === true,
    assistantOrdinal: Number(record.assistantOrdinal ?? 0),
  });

  const refreshStageFromConversation = async () => {
    await ensureConversationScope();
    const refreshed = await withStageLock(async () => {
      const observation = latestTaskObservation();
      const stored = await readStoredStage();
      if (!observation) return { observation: null, stored, conflict: false };
      candidateFromEnvelope(observation.envelope);

      if (observationWaitsBehindBarrier(stored, observation)) {
        staged = null;
        planningActive = true;
        planningBaseline = stored.baselineEnvelope ?? null;
        return { observation, stored, conflict: false };
      }

      if (observationWasDispatched(stored, observation)) {
        staged = null;
        planningActive = false;
        planningBaseline = null;
        dispatchingEnvelopeId = stored.id;
        return { observation, stored, conflict: false };
      }

      if (stored?.state === "staged" && stored.id === observation.id) {
        staged = stageFromRecord(stored);
        planningActive = false;
        planningBaseline = null;
        return { observation, stored, conflict: false };
      }

      if (
        !observationCanReplace(stored, observation) ||
        (stored && document.visibilityState === "hidden")
      ) {
        if (stored?.state === "staged") staged = stageFromRecord(stored);
        else staged = null;
        planningActive = stored?.state === "planning";
        showStageConflict();
        return { observation, stored, conflict: true };
      }

      const baseline = stored?.state === "planning"
        ? stored.baselineEnvelope
        : stored?.envelope ?? staged?.envelope ?? planningBaseline;
      const changes = baseline ? taskEnvelopeChanges(baseline, observation.envelope) : [];
      const autoDispatch = stored?.state === "planning" &&
        stored.dispatchWhenReady === true &&
        changes.length === 0;
      staged = {
        id: observation.id,
        revision: nextRevision(),
        ownerId: TAB_ID,
        envelope: observation.envelope,
        changes,
        changeConfirmed: changes.length === 0,
        assistantOrdinal: observation.assistantOrdinal,
      };
      planningActive = false;
      planningBaseline = null;
      await saveStage();
      showStagedStatus();
      return { observation, stored, conflict: false, autoDispatch };
    });
    if (refreshed.autoDispatch) {
      setTimeout(() => void dispatchEnvelope(), 0);
    }
    return refreshed;
  };

  const beginPlanning = async () => {
    await ensureConversationScope();
    const assistantOrdinal = visibleElements(adapter.assistant).length;
    await withStageLock(async () => {
      const stored = await readStoredStage();
      const baselineEnvelope = staged?.envelope ??
        (stored?.state === "planning" ? stored.baselineEnvelope : stored?.envelope) ??
        null;
      const record = createPlanningRecord({
        scope: activeScope,
        revision: nextRevision(),
        ownerId: TAB_ID,
        assistantOrdinal,
        baselineEnvelope,
        dispatchWhenReady: false,
        expiresAt: Date.now() + STAGE_TTL_MS,
      });
      await Promise.resolve(GM_setValue(currentStorageKey(), record));
      staged = null;
      planningActive = true;
      planningBaseline = baselineEnvelope;
    });
  };

  const markPlanningDispatchRequested = async () => withStageLock(async () => {
    const stored = await readStoredStage();
    if (stored?.state !== "planning") return false;
    const record = createPlanningRecord({
      scope: activeScope,
      revision: nextRevision(),
      ownerId: TAB_ID,
      assistantOrdinal: stored.assistantOrdinal,
      baselineEnvelope: stored.baselineEnvelope,
      dispatchWhenReady: true,
      expiresAt: Date.now() + STAGE_TTL_MS,
    });
    await Promise.resolve(GM_setValue(currentStorageKey(), record));
    planningActive = true;
    planningBaseline = stored.baselineEnvelope ?? null;
    return true;
  });

  const confirmStageChanges = async () => {
    const refreshed = await refreshStageFromConversation();
    if (refreshed.conflict || !staged) return false;
    return withStageLock(async () => {
      const stored = await readStoredStage();
      const localRecord = createStageRecord(staged, {
        scope: activeScope,
        expiresAt: Date.now() + STAGE_TTL_MS,
      });
      if (!stageRecordsMatch(stored, localRecord)) {
        showStageConflict();
        return false;
      }
      staged = {
        ...staged,
        revision: nextRevision(),
        ownerId: TAB_ID,
        changeConfirmed: true,
      };
      await saveStage();
      const confirmed = await readStoredStage();
      const confirmedRecord = createStageRecord(staged, {
        scope: activeScope,
        expiresAt: Date.now() + STAGE_TTL_MS,
      });
      if (!stageRecordsMatch(confirmed, confirmedRecord)) {
        showStageConflict();
        return false;
      }
      showStagedStatus("change-confirmed");
      return true;
    });
  };

  const validatedReviewUrl = (value, candidateId) => {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== "4318" ||
      url.pathname !== "/local-review/review" ||
      url.searchParams.get("id") !== candidateId ||
      !url.searchParams.get("secret")
    ) {
      throw new Error("ACP returned an invalid local review URL");
    }
    return url.toString();
  };

  const taskStatusText = (body) => {
    if (!body.task) return t("waitingLocalReview");
    const labels = {
      queued: t("statusQueued"),
      running: t("statusRunning"),
      completed: t("statusCompleted"),
      failed: t("statusFailed"),
      blocked: t("statusBlocked"),
      partial: t("statusPartial"),
      cancelled: t("statusCancelled"),
    };
    const taskId = String(body.task.id ?? "").slice(0, 8);
    const elapsed = tracking?.startedAt
      ? `${Math.max(0, Math.floor((Date.now() - tracking.startedAt) / 1000))}s`
      : null;
    const failureLabels = {
      insufficient_balance: t("failureBalance"),
      usage_limit: t("failureUsage"),
      rate_limited: t("failureRate"),
      authentication_failed: t("failureAuth"),
      executor_unavailable: t("failureExecutor"),
      provider_unavailable: t("failureProvider"),
      task_failed: t("failureTask"),
    };
    const detail = body.task.status === "failed"
      ? failureLabels[body.task.failure_category] ?? t("reasonUnknown")
      : elapsed;
    return [labels[body.task.status] ?? t("statusUpdated"), taskId, detail]
      .filter(Boolean)
      .join(" · ");
  };

  const readCapabilities = async () => readCapabilitiesWithFallback({
      readLocal: () => request({
        method: "GET",
        url: CAPABILITIES_URL,
        headers: { "x-acp-page-origin": window.location.origin },
      }),
      readRemote: remoteRelay ? async () => request({
        method: "GET",
        url: `${remoteRelay.baseUrl}/api/acp/capabilities`,
        headers: await remoteHeaders(),
      }) : null,
      preferRemote: mobileBrowser && Boolean(remoteRelay),
    });

  const stopTracking = () => {
    tracking = null;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };

  const resultAlreadyReturned = async (taskId, scope) => resultWasDelivered(
    await Promise.resolve(GM_getValue(currentResultDeliveryKey(scope), null)),
    { scope, taskId },
  );

  const rememberReturnedResult = async (taskId, scope) => {
    const key = currentResultDeliveryKey(scope);
    const current = await Promise.resolve(GM_getValue(key, null));
    const deliveredAt = Date.now();
    await Promise.resolve(GM_setValue(key, rememberResultDelivery(current, {
      scope,
      taskId,
      deliveredAt,
      expiresAt: deliveredAt + RESULT_DELIVERY_TTL_MS,
    })));
  };

  const returnResultToConversation = async () => {
    const queued = pendingResult;
    if (!queued || Date.now() >= queued.expiresAt) {
      pendingResult = null;
      return;
    }
    if (queued.scope !== activeScope) return;
    if (await resultAlreadyReturned(queued.taskId, queued.scope)) {
      if (pendingResult === queued) pendingResult = null;
      return;
    }
    if (readComposer()) {
      setTimeout(returnResultToConversation, 1000);
      return;
    }
    if (!writeComposer(queued.value)) {
      setTimeout(returnResultToConversation, 1000);
      return;
    }
    if (pendingResult === queued) pendingResult = null;
    try {
      await rememberReturnedResult(queued.taskId, queued.scope);
    } catch {
      // The current page still consumes this insertion once. A storage failure
      // must never trigger a second write that could overwrite user text.
    }
    await submitComposer();
  };

  const pollStatus = async (activeTracking) => {
    if (tracking !== activeTracking) return;
    if (Date.now() >= activeTracking.expiresAt) {
      stopTracking();
      showStatus(t("statusExpired"));
      return;
    }
    try {
      const response = activeTracking.remote
        ? await request({
            method: "GET",
            url: `${activeTracking.baseUrl}/api/acp/tasks/${encodeURIComponent(activeTracking.id)}`,
            headers: await remoteHeaders(),
          })
        : await request({
            method: "GET",
            url: `${CANDIDATE_URL}/${encodeURIComponent(activeTracking.id)}/status`,
            headers: {
              "x-acp-page-origin": window.location.origin,
              "x-acp-status-secret": activeTracking.secret,
            },
          });
      const body = activeTracking.remote
        ? parseRemoteTaskResponse(response, 200)
        : JSON.parse(response.responseText);
      if (response.status !== 200) {
        throw new Error(body.error?.code ?? `http_${response.status}`);
      }
      const statusText = taskStatusText(body);
      showStatus(statusText, statusText, body.task?.status);
      if (body.task && TERMINAL_TASK_STATUSES.has(body.task.status)) {
        stopTracking();
        if (activeTracking.returnResultToChat) {
          const taskId = String(body.task.id ?? activeTracking.id ?? "").trim();
          const scope = activeTracking.scope ?? activeScope;
          if (taskId && !(await resultAlreadyReturned(taskId, scope))) {
            pendingResult = {
              taskId,
              scope,
              value: safeResultBlock(body.task),
              expiresAt: Date.now() + 2 * 60 * 1000,
            };
            void returnResultToConversation();
          }
        }
        return;
      }
    } catch (error) {
      if (tracking !== activeTracking) return;
      if (["candidate_status_expired", "candidate_status_denied"].includes(error.message)) {
        stopTracking();
        showStatus(t("statusReadStopped"));
        return;
      }
      if (activeTracking.remote && error.message === "not_found") {
        stopTracking();
        showStatus(t("remoteTaskUnavailable"));
        return;
      }
      if (activeTracking.remote && error.message === "unauthorized") {
        stopTracking();
        showStatus(
          t("remotePairingExpired"),
          t("remotePairingExpired"),
          "default",
          "pair-remote",
        );
        return;
      }
      showStatus(t(activeTracking.remote ? "remoteStatusUnavailable" : "localStatusUnavailable"));
    }
    if (tracking === activeTracking) {
      pollTimer = setTimeout(() => pollStatus(activeTracking), 2000);
    }
  };

  const dispatchEnvelope = async () => {
    const refreshed = await refreshStageFromConversation();
    if (refreshed.conflict || !staged || dispatchingEnvelopeId === staged.id) return;
    if (staged.changes?.length && !staged.changeConfirmed) {
      showStagedStatus();
      return;
    }
    try {
      await withStageLock(async () => {
        const activeEnvelope = staged;
        const stored = await readStoredStage();
        const activeRecord = createStageRecord(activeEnvelope, {
          scope: activeScope,
          expiresAt: Date.now() + STAGE_TTL_MS,
        });
        const observation = latestTaskObservation();
        if (
          !stageRecordsMatch(stored, activeRecord) ||
          (observation && observation.id !== activeEnvelope.id)
        ) {
          showStageConflict();
          return;
        }
        dispatchingEnvelopeId = activeEnvelope.id;
        showStatus(t("dispatching"));
        const idempotencyKey = await stableIdempotencyKey(activeEnvelope);
        let response;
        let usedRemote = mobileBrowser && Boolean(remoteRelay);
        const requestRemoteDispatch = async () => request({
          method: "POST",
          url: `${remoteRelay.baseUrl}/api/acp/tasks`,
          headers: await remoteHeaders({
            "content-type": "application/json",
            "x-acp-idempotency-key": idempotencyKey,
          }),
          data: JSON.stringify({ candidate: candidateFromEnvelope(activeEnvelope.envelope) }),
        });
        if (usedRemote) {
          response = await requestRemoteDispatch();
        } else try {
          response = await request({
            method: "POST",
            url: CANDIDATE_URL,
            headers: {
              "content-type": "application/json",
              "x-acp-client": "userscript-v1",
              "x-acp-idempotency-key": idempotencyKey,
              "x-acp-page-origin": window.location.origin,
            },
            data: JSON.stringify(candidateFromEnvelope(activeEnvelope.envelope)),
          });
          if (response.status === 0) throw new Error("network_error");
        } catch (localError) {
          if (!remoteRelay) throw localError;
          usedRemote = true;
          response = await requestRemoteDispatch();
        }
        const body = usedRemote
          ? parseRemoteTaskResponse(response, 201)
          : JSON.parse(response.responseText);
        const candidateId = usedRemote ? body.task?.id : body.candidate?.id;
        if (
          response.status !== 201 ||
          typeof candidateId !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(candidateId) ||
          (!usedRemote && (
            typeof body.status_secret !== "string" ||
            !/^[A-Za-z0-9_-]{20,128}$/.test(body.status_secret)
          ))
        ) {
          throw new Error(body.error?.code ?? `http_${response.status}`);
        }
        const expiresAt = usedRemote
          ? Date.now() + 24 * 60 * 60 * 1000
          : Date.parse(body.candidate.status_expires_at);
        if (!Number.isFinite(expiresAt)) {
          throw new Error("ACP returned an invalid status expiry");
        }
        await Promise.resolve(GM_setValue(
          currentStorageKey(),
          createDispatchedRecord(activeEnvelope, {
            scope: activeScope,
            dispatchedAt: Date.now(),
          }),
        ));
        staged = null;
        planningBaseline = activeEnvelope.envelope;
        stopTracking();
        tracking = {
          id: candidateId,
          scope: activeScope,
          secret: usedRemote ? null : body.status_secret,
          expiresAt,
          startedAt: Date.now(),
          returnResultToChat: usedRemote || body.return_result_to_chat === true,
          remote: usedRemote,
          baseUrl: usedRemote ? remoteRelay.baseUrl : null,
        };
        showStatus(usedRemote || body.auto_dispatched ? t("dispatched") : t("waitingLocalReview"));
        pollStatus(tracking);
        if (!usedRemote && !body.auto_dispatched) {
          const reviewUrl = validatedReviewUrl(body.review_url, candidateId);
          GM_openInTab(reviewUrl, { active: true, insert: true, setParent: true });
        }
      });
    } catch (error) {
      dispatchingEnvelopeId = null;
      if (error.message === "network_error") {
        showStatus(t("localDisconnected"), t("localDisconnected"), "default", "pair-remote");
      } else if (error.message === "timeout") {
        showStatus(t("connectionTimeout"), t("connectionTimeout"), "default", "pair-remote");
      } else {
        showStatus(
          error.message === "stage_lock_unavailable"
            ? t("browserDispatchUnsupported")
            : error.message === "candidate_route_cooldown"
              ? t("routeCooldown")
              : t("dispatchFailed"),
        );
      }
    }
  };

  const inspectConversation = async () => {
    inspectTimer = null;
    try {
      await refreshStageFromConversation();
    } catch {
      showStatus(t("taskInvalid"));
    }
  };

  const scheduleInspection = () => {
    if (inspectTimer) clearTimeout(inspectTimer);
    inspectTimer = setTimeout(() => void inspectConversation(), 250);
  };

  const captureOrExpandComposer = async (event) => {
    if (suppressCapture || !event.isTrusted) return;
    const composer = findComposer();
    if (!composer) return;
    if (event.type === "keydown") {
      if (
        event.isComposing ||
        event.key !== "Enter" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !composer.contains(event.target)
      ) return;
    } else if (!isComposerSubmission(event, composer)) {
      return;
    }

    const text = readComposer(composer);
    const launch = parseLaunchCommand(text);
    if (launch) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (launchPending) return;
      if (!launch.request && !latestText(adapter.user) && !latestText(adapter.assistant)) {
        showStatus(t("describeTask"));
        return;
      }
      launchPending = true;
      showStatus(t("readingCapabilities"));
      try {
        await beginPlanning();
        const capabilities = await readCapabilities();
        writeComposer(controllerPrompt(launch.request, capabilities, uiLanguage), composer);
        showStatus(t("planning"));
        await submitComposer();
      } catch (error) {
        if (error.message === "network_error") {
          showStatus(t("localDisconnected"), t("localDisconnected"), "default", "pair-remote");
        } else if (error.message === "timeout") {
          showStatus(t("connectionTimeout"), t("connectionTimeout"), "default", "pair-remote");
        } else {
          showStatus(t("readConfigFailed"));
        }
      } finally {
        launchPending = false;
      }
      return;
    }

    if (planningActive && isConfirmation(text)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (launchPending) return;
      launchPending = true;
      try {
        await refreshStageFromConversation();
        if (staged) {
          setTimeout(() => void dispatchEnvelope(), 0);
          return;
        }
        if (!(await markPlanningDispatchRequested())) {
          showStatus(t("taskStatusUnverified"));
          return;
        }
        if (!writeComposer(taskPlanningRepairPrompt(uiLanguage), composer)) {
          showStatus(t("taskInvalid"));
          return;
        }
        showStatus(t("planningRepair"));
        await submitComposer();
      } catch {
        showStatus(t("taskStatusUnverified"));
      } finally {
        launchPending = false;
      }
      return;
    }

    try {
      await refreshStageFromConversation();
    } catch (error) {
      showStatus(
        error.message === "stage_lock_unavailable"
          ? t("browserDispatchUnsupported")
          : t("taskStatusUnverified"),
      );
      return;
    }

    if (staged?.changes?.length && !staged.changeConfirmed) {
      if (isChangeConfirmation(text)) {
        await confirmStageChanges();
      } else if (isConfirmation(text)) {
        showStagedStatus();
      }
      return;
    }

    if (staged && isConfirmation(text)) {
      setTimeout(() => void dispatchEnvelope(), 0);
    }
  };

  window.addEventListener("keydown", captureOrExpandComposer, true);
  window.addEventListener("click", captureOrExpandComposer, true);
  window.addEventListener("submit", captureOrExpandComposer, true);
  new MutationObserver(scheduleInspection).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener("focus", () => void refreshStageFromConversation());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshStageFromConversation();
  });
  initializeLanguage()
    .then(restoreFloatingPosition)
    .finally(() => restoreStage().finally(scheduleInspection));
})();
