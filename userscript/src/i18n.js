export const USERSCRIPT_LANGUAGE_KEY = "acp-ui-language-v1";
export const USERSCRIPT_LANGUAGE_MODES = Object.freeze(["auto", "zh-CN", "en"]);

const MESSAGES = Object.freeze({
  "zh-CN": Object.freeze({
    ariaLabel: "AgentControlPlane 网页桥接",
    openSettings: "点击打开本机派发设置",
    menuAuto: "ACP 语言：跟随浏览器",
    menuChinese: "ACP 语言：中文",
    menuEnglish: "ACP 语言：英文",
    ready: "就绪",
    planning: "网页 AI 正在整理任务",
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
  }),
  en: Object.freeze({
    ariaLabel: "AgentControlPlane web bridge",
    openSettings: "Open local dispatch settings",
    menuAuto: "ACP language: Follow browser",
    menuChinese: "ACP language: Chinese",
    menuEnglish: "ACP language: English",
    ready: "Ready",
    planning: "Web AI is preparing the task",
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
  }),
});

export function normalizeUserscriptLanguage(value) {
  return USERSCRIPT_LANGUAGE_MODES.includes(value) ? value : "auto";
}

export function resolveUserscriptLanguage(mode, browserLanguages = []) {
  const normalized = normalizeUserscriptLanguage(mode);
  if (normalized !== "auto") return normalized;
  const languages = Array.isArray(browserLanguages) ? browserLanguages : [browserLanguages];
  return languages.some((language) => String(language ?? "").toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en";
}

export function userscriptText(language, key, values = {}) {
  const selected = MESSAGES[language] ?? MESSAGES.en;
  const template = selected[key] ?? MESSAGES.en[key] ?? key;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function userscriptMessageKeys(language) {
  return Object.keys(MESSAGES[language] ?? {}).sort();
}
