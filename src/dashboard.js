// Local read-only web panel. Serves one self-contained page at "/" that
// renders task, executor, model-catalog, and usage state from the existing
// /v1 endpoints. All strings live in DASHBOARD_STRINGS so tests and the copy
// gate can read them; the page itself makes no network calls beyond
// same-origin GETs and stores nothing on the server.

export const DASHBOARD_STRINGS = {
  zh: {
    title: "AgentControlPlane 本地面板",
    subtitle: "本机工程任务、执行器与令牌用量的只读视图。",
    healthOk: "运行正常",
    healthBad: "状态异常",
    executors: "执行器",
    default: "默认",
    official: "官方",
    relayTag: "中转端点",
    ready: "就绪",
    notReady: "未就绪",
    modelsInCatalog: "模型目录 {n} 个",
    models: "模型目录",
    modelFilter: "输入模型名过滤",
    noModels: "该执行器暂无模型目录。",
    featuredTag: "主打",
    capTools: "工具",
    capReasoning: "推理",
    capVision: "视觉",
    capUnknown: "能力未知",
    protoLabel: "协议",
    protoResponses: "Responses 工具循环",
    protoChat: "Chat 工具循环",
    protoPending: "探测中",
    recommendTitle: "模型推荐",
    recommendObjectivePlaceholder: "输入任务目标，获取模型推荐（仅建议，不派发）",
    recommendButton: "推荐",
    recommendEmpty: "输入目标后点「推荐」。",
    recommendScore: "得分 {score}",
    recommendCost: "预估 $ {low}–{high} {currency}（期望 {expected}）",
    recommendCostUnknown: "成本未知",
    recommendExcluded: "已排除",
    strategyCheapest: "最便宜",
    strategyBalanced: "均衡",
    strategyBest: "最佳",
    recommendCapability: "能力来源：{source}",
    recommendLatency: "延迟 {avg}ms · n={samples}",
    recommendFreshness: "元数据 {seconds} 秒前",
    reasonCapabilityFit: "能力匹配",
    reasonRouteHealthy: "路由健康",
    reasonPriceLow: "价格低",
    reasonLatencyLow: "延迟低",
    reasonMetadataFresh: "元数据新鲜",
    warnStatusUnknown: "状态未知",
    warnContextUnknown: "上下文未知",
    warnToolsUnknown: "工具能力未知",
    warnVisionUnknown: "视觉能力未知",
    warnReasoningUnknown: "推理能力未知",
    warnProtocolUnknown: "协议未知：{protocol}",
    warnRouteHealthUnknown: "路由健康未知",
    warnRouteHealthNotConfirmed: "路由健康未确认",
    warnPricingUnknown: "价格未知",
    warnLatencySamples: "延迟样本不足 3 条",
    warnMetadataStale: "元数据过旧",
    exclInvalidEntry: "无效条目",
    exclNotAllowlisted: "不在允许列表",
    exclStatusUnavailable: "状态不可用",
    exclContextInsufficient: "上下文不足",
    exclToolsUnsupported: "不支持工具",
    exclVisionUnsupported: "不支持视觉",
    exclReasoningUnsupported: "不支持推理",
    exclProtocolUnsupported: "协议不支持：{protocol}",
    exclRouteUnhealthy: "路由不健康",
    capSourceDeclared: "声明",
    capSourceProbed: "探测",
    capSourceUnknown: "未知",
    tasks: "任务",
    noTasks: "暂无任务记录。",
    searchTasks: "按编号或内容搜索任务",
    searchButton: "搜索",
    colTime: "时间",
    colTask: "任务",
    colStatus: "状态",
    colExecutor: "执行器",
    lineage: "谱系 {id}",
    executorPath: "执行路径 {path}",
    rerouteReason: "切换原因 {reason}",
    colModel: "模型",
    colProfile: "档位",
    colTimeUsed: "用时",
    colTokens: "令牌（入/出/推理）",
    colBudget: "预算",
    statusQueued: "排队",
    statusRunning: "运行中",
    statusCompleted: "已完成",
    statusFailed: "失败",
    statusBlocked: "受阻",
    statusPartial: "部分完成",
    statusCancelled: "已取消",
    statusInterrupted: "已中断",
    minActual: "{n} 分钟",
    minRunning: "{n} 分钟（进行中）",
    queuedTime: "排队中",
    tokensTitle: "输入 {in} · 输出 {out} · 推理 {reason}",
    budget: "预算 {used} / {total}（{pct}%）",
    usage: "用量汇总",
    usageTasks: "记录用量的任务",
    usageInput: "输入令牌",
    usageCached: "缓存命中输入",
    usageUncached: "未缓存输入",
    usageOutput: "输出令牌",
    usageReasoning: "推理令牌",
    usageTotal: "令牌合计",
    dimTitle: "分模型用量",
    dimColModel: "模型",
    dimColTokens: "令牌",
    dimColCost: "成本（估算/结算）",
    dimColRequests: "请求数",
    dimColReconcile: "对账状态",
    version: "版本",
    tokenPrompt: "该服务要求 Bearer 访问令牌。",
    tokenPlaceholder: "粘贴访问令牌",
    tokenSave: "保存并重试",
    refreshNote: "每 5 秒自动刷新",
    footer: "仅监听 {host}:{port} · 任务状态保存在本机 {stateDir}",
    errorBanner: "加载失败：{message}",
  },
  en: {
    title: "AgentControlPlane local panel",
    subtitle: "A read-only view of local engineering tasks, executors, and token usage.",
    healthOk: "Healthy",
    healthBad: "Unhealthy",
    executors: "Executors",
    default: "Default",
    official: "Official",
    relayTag: "relay",
    ready: "Ready",
    notReady: "Not ready",
    modelsInCatalog: "{n} models in catalog",
    models: "Model catalog",
    modelFilter: "Filter by model name",
    noModels: "This executor has no model catalog.",
    featuredTag: "Featured",
    capTools: "tools",
    capReasoning: "reasoning",
    capVision: "vision",
    capUnknown: "capabilities unknown",
    protoLabel: "Protocol",
    protoResponses: "Responses tool loop",
    protoChat: "Chat tool loop",
    protoPending: "probing",
    recommendTitle: "Model recommendation",
    recommendObjectivePlaceholder:
      "Enter the task objective for advisory model recommendations",
    recommendButton: "Recommend",
    recommendEmpty: "Enter an objective and click Recommend.",
    recommendScore: "score {score}",
    recommendCost: "est. ${low}–${high} {currency} (expected ${expected})",
    recommendCostUnknown: "cost unknown",
    recommendExcluded: "Excluded",
    strategyCheapest: "Cheapest",
    strategyBalanced: "Balanced",
    strategyBest: "Best",
    recommendCapability: "capability: {source}",
    recommendLatency: "latency {avg}ms · n={samples}",
    recommendFreshness: "metadata {seconds}s ago",
    reasonCapabilityFit: "capability fit",
    reasonRouteHealthy: "route healthy",
    reasonPriceLow: "low price",
    reasonLatencyLow: "low latency",
    reasonMetadataFresh: "metadata fresh",
    warnStatusUnknown: "status unknown",
    warnContextUnknown: "context unknown",
    warnToolsUnknown: "tools unknown",
    warnVisionUnknown: "vision unknown",
    warnReasoningUnknown: "reasoning unknown",
    warnProtocolUnknown: "protocol unknown: {protocol}",
    warnRouteHealthUnknown: "route health unknown",
    warnRouteHealthNotConfirmed: "route health not confirmed",
    warnPricingUnknown: "pricing unknown",
    warnLatencySamples: "latency samples below 3",
    warnMetadataStale: "metadata stale",
    exclInvalidEntry: "invalid entry",
    exclNotAllowlisted: "not in allowlist",
    exclStatusUnavailable: "status unavailable",
    exclContextInsufficient: "context insufficient",
    exclToolsUnsupported: "tools unsupported",
    exclVisionUnsupported: "vision unsupported",
    exclReasoningUnsupported: "reasoning unsupported",
    exclProtocolUnsupported: "protocol unsupported: {protocol}",
    exclRouteUnhealthy: "route unhealthy",
    capSourceDeclared: "declared",
    capSourceProbed: "probed",
    capSourceUnknown: "unknown",
    tasks: "Tasks",
    noTasks: "No task records yet.",
    searchTasks: "Search tasks by id or content",
    searchButton: "Search",
    colTime: "Time",
    colTask: "Task",
    colStatus: "Status",
    colExecutor: "Executor",
    lineage: "Lineage {id}",
    executorPath: "Executor path {path}",
    rerouteReason: "Reroute reason {reason}",
    colModel: "Model",
    colProfile: "Profile",
    colTimeUsed: "Time used",
    colTokens: "Tokens (in/out/reasoning)",
    colBudget: "Budget",
    statusQueued: "Queued",
    statusRunning: "Running",
    statusCompleted: "Completed",
    statusFailed: "Failed",
    statusBlocked: "Blocked",
    statusPartial: "Partial",
    statusCancelled: "Cancelled",
    statusInterrupted: "Interrupted",
    minActual: "{n} min",
    minRunning: "{n} min (running)",
    queuedTime: "Queued",
    tokensTitle: "In {in} · Out {out} · Reasoning {reason}",
    budget: "Budget {used} / {total} ({pct}%)",
    usage: "Usage summary",
    usageTasks: "Tasks with usage",
    usageInput: "Input tokens",
    usageCached: "Cached input",
    usageUncached: "Uncached input",
    usageOutput: "Output tokens",
    usageReasoning: "Reasoning tokens",
    usageTotal: "Total tokens",
    dimTitle: "Usage by model",
    dimColModel: "Model",
    dimColTokens: "Tokens",
    dimColCost: "Cost (est./settled)",
    dimColRequests: "Requests",
    dimColReconcile: "Reconciliation states",
    version: "Version",
    tokenPrompt: "This server requires a bearer access token.",
    tokenPlaceholder: "Paste the access token",
    tokenSave: "Save and retry",
    refreshNote: "Refreshes every 5 seconds",
    footer: "Bound to {host}:{port} · Task state is stored locally at {stateDir}",
    errorBanner: "Load failed: {message}",
  },
};

// Display only fixed fields; never interpolate imported text as markup or URLs.
export function deliverySummaryHtml(delivery) {
  if (!delivery) return "";
  const esc = value => String(value ?? "unknown").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
  const freshMerge = delivery.verification === "verified" && delivery.source === "verified_host" &&
    Date.parse(delivery.verified_until) > Date.now();
  const freshHost = delivery.verification === "verified" && delivery.source === "verified_host" &&
    delivery.approval_supported === true && Date.parse(delivery.verified_until) > Date.now();
  return '<div class="task-lineage">Delivery · ' + (freshHost ? 'verified host observation' : 'unverified · approval unavailable') + '<br>' +
    [delivery.repository, delivery.base_branch, delivery.branch, delivery.pull_request_number, delivery.head_sha].map(esc).join(" · ") +
    '<br>Verified checks/review: ' + (freshHost ? [delivery.checks, delivery.review_state].map(esc).join(' · ') : 'unknown') + ' · Reported: ' + [delivery.reported_checks, delivery.reported_review_state, delivery.observed_at].map(esc).join(" · ") + '<br>Merged fact: ' + esc(freshMerge ? delivery.merged : null) + ' · merge commit: ' + esc(freshMerge ? delivery.merge_commit_sha : null) + '</div>';
}

export function taskListUrl(query,active=false) {
  return '/v1/tasks?limit=30'+(active?'&view=active':'')+(query?'&query='+encodeURIComponent(query):'');
}

export function dashboardHtml(config) {
  const info = {
    version: config.version ?? "0.0.0",
    workflowEnabled:config.workflow?.enabled===true,
    host: config.server?.host ?? "127.0.0.1",
    port: config.server?.port ?? 4318,
    stateDir: config.stateDir ?? "",
  };
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentControlPlane</title>
<style>
:root {
  --bg: #0f1115;
  --card: #161a20;
  --line: #232a33;
  --text: #e6e8eb;
  --muted: #8b93a1;
  --accent: #4f8cff;
  --ok: #34c26b;
  --warn: #e0a53e;
  --bad: #e0564f;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  background: var(--bg);
}
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--muted); flex: none; }
.dot.ok { background: var(--ok); }
.dot.bad { background: var(--bad); }
h1 { font-size: 16px; margin: 0; white-space: nowrap; }
.muted { color: var(--muted); }
.lang button {
  background: var(--card);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.lang button.active { color: var(--text); border-color: var(--accent); }
main { padding: 16px 20px 24px; max-width: 1180px; margin: 0 auto; }
section { margin-bottom: 26px; }
h2 { font-size: 14px; margin: 0 0 10px; color: var(--muted); font-weight: 600; text-transform: none; letter-spacing: 0; }
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
}
.exec-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.exec-name { font-weight: 600; }
.exec-id { font-family: Consolas, monospace; font-size: 12px; color: var(--muted); }
.badge {
  display: inline-block;
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 12px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.badge.ready { color: var(--ok); border-color: var(--ok); }
.badge.notready { color: var(--bad); border-color: var(--bad); }
.badge.default { color: var(--accent); border-color: var(--accent); }
.badge.official { color: #d29922; border-color: #d29922; }
.exec-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.exec-detail { font-size: 12px; color: var(--muted); margin-top: 6px; word-break: break-all; }
.row { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
select, input[type="text"] {
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 5px 8px;
}
input[type="text"] { min-width: 220px; }
.model-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
}
.model-list li {
  padding: 7px 12px;
  border-bottom: 1px solid var(--line);
  font-family: Consolas, monospace;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.model-list li:last-child { border-bottom: none; }
.model-list .tag { color: var(--accent); font-size: 12px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12px; white-space: nowrap; }
td.mono { font-family: Consolas, monospace; font-size: 12.5px; }
td.objective { max-width: 380px; }
td.objective div { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.task-lineage { color: var(--muted); font-family: Consolas, monospace; font-size: 11px; margin-top: 3px; }
.st-q { color: var(--muted); }
.st-r { color: var(--accent); }
.st-c { color: var(--ok); }
.st-p { color: var(--warn); }
.st-f, .st-i { color: var(--bad); }
.st-b, .st-x { color: var(--muted); }
.budget-bar { width: 110px; height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; margin-top: 3px; }
.budget-fill { height: 100%; background: var(--ok); }
.budget-fill.warn { background: var(--warn); }
.budget-fill.over { background: var(--bad); }
.budget-label { font-size: 11px; color: var(--muted); }
.usage td:first-child { color: var(--muted); }
.usage td:last-child { font-family: Consolas, monospace; text-align: right; }
.hidden { display: none; }
#tokenBar, #errorBar {
  border: 1px solid var(--warn);
  background: var(--card);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
#errorBar { border-color: var(--bad); }
#tokenBar input { flex: 1; min-width: 240px; }
button.save {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
}
footer { padding: 10px 20px 18px; color: var(--muted); font-size: 12px; max-width: 1180px; margin: 0 auto; }
@media (max-width: 760px) {
  td.objective { max-width: 200px; }
  .hide-sm { display: none; }
}
</style>
</head>
<body>
<header>
  <div class="brand">
    <span class="dot" id="healthDot"></span>
    <h1 id="title"></h1>
    <span class="muted" id="version"></span>
  </div>
  <div class="lang">
    <button id="langZh">中文</button>
    <button id="langEn">EN</button>
  </div>
</header>
<main>
  <div id="tokenBar" class="hidden">
    <span id="tokenPrompt"></span>
    <input type="text" id="tokenInput" autocomplete="off">
    <button class="save" id="tokenSave"></button>
  </div>
  <div id="errorBar" class="hidden"></div>

  <section>
    <h2 id="kExecutors"></h2>
    <div class="exec-grid" id="executors"></div>
  </section>

  <section>
    <h2 id="kModels"></h2>
    <div class="row">
      <select id="execSelect"></select>
      <span class="muted" id="modelCount"></span>
      <input type="text" id="modelFilter">
    </div>
    <ul class="model-list" id="models"></ul>
  </section>

  <section>
    <h2 id="kRecommend"></h2>
    <div class="row">
      <input type="text" id="recommendObjective">
      <select id="recommendProfile">
        <option value="economy">economy</option>
        <option value="balanced" selected>balanced</option>
        <option value="deep">deep</option>
      </select>
      <button class="save" id="recommendButton"></button>
    </div>
    <div id="recommendation"></div>
  </section>

  <section>
    <h2 id="kTasks"></h2>
    <div class="row">
      <input type="text" id="taskSearch">
      <button class="save" id="taskSearchButton"></button>
    </div>
    <div id="tasks"></div>
  </section>

  <section>
    <h2 id="kUsage"></h2>
    <table class="usage" id="usage"></table>
    <h2 id="kDim" style="margin-top:18px"></h2>
    <table class="usage" id="dimensions"></table>
  </section>
</main>
<footer>
  <span id="footerText"></span>
  <span class="muted"> · <span id="refreshNote"></span></span>
</footer>
<script>
"use strict";
var deliverySummaryHtml = ${deliverySummaryHtml.toString()};
var taskListUrl = ${taskListUrl.toString()};
var STRINGS = ${JSON.stringify(DASHBOARD_STRINGS)};
var CFG = ${JSON.stringify(info)};

function fmt(template, values) {
  return template.replace(/\\{([a-z]+)\\}/g, function (_, key) {
    return values[key] !== undefined ? values[key] : key;
  });
}
function pad2(value) {
  return String(value).padStart(2, "0");
}
function clock(iso) {
  var date = new Date(iso);
  return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
}
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function number(value) {
  return (value ?? 0).toLocaleString();
}

var lang = localStorage.getItem("acp-dash-lang") || "zh";
var token = localStorage.getItem("acp-dash-token") || "";
var modelFilter = "";
var taskQuery = "";
var selectedExecutor = null;
var catalogs = {};
var lastRecommendation = null;
var lastDimensions = null;
var lastData = { executors: [], tasks: [], usage: null, health: null };
var liveSeconds = 0;

function t(key) {
  return STRINGS[lang][key] || STRINGS.zh[key] || key;
}

function statusKey(status) {
  var map = {
    queued: "statusQueued",
    running: "statusRunning",
    completed: "statusCompleted",
    failed: "statusFailed",
    blocked: "statusBlocked",
    partial: "statusPartial",
    cancelled: "statusCancelled",
    interrupted: "statusInterrupted",
  };
  return map[status] ? t(map[status]) : status;
}
function statusClass(status) {
  var map = {
    queued: "st-q",
    running: "st-r",
    completed: "st-c",
    partial: "st-p",
    failed: "st-f",
    interrupted: "st-i",
  };
  return map[status] || "st-x";
}

async function api(path) {
  var headers = {};
  if (token) headers["authorization"] = "Bearer " + token;
  var response = await fetch(path, { headers: headers });
  if (response.status === 401) {
    document.getElementById("tokenBar").classList.remove("hidden");
    throw new Error("unauthorized");
  }
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

function setLang(next) {
  lang = next;
  localStorage.setItem("acp-dash-lang", lang);
  document.documentElement.lang = lang;
  document.getElementById("langZh").classList.toggle("active", lang === "zh");
  document.getElementById("langEn").classList.toggle("active", lang === "en");
  document.getElementById("title").textContent = t("title");
  document.getElementById("version").textContent = t("version") + " " + CFG.version;
  document.getElementById("kExecutors").textContent = t("executors");
  document.getElementById("kModels").textContent = t("models");
  document.getElementById("kTasks").textContent = t("tasks");
  document.getElementById("kUsage").textContent = t("usage");
  document.getElementById("kDim").textContent = t("dimTitle");
  document.getElementById("modelFilter").placeholder = t("modelFilter");
  document.getElementById("kRecommend").textContent = t("recommendTitle");
  document.getElementById("recommendObjective").placeholder = t("recommendObjectivePlaceholder");
  document.getElementById("recommendButton").textContent = t("recommendButton");
  renderRecommendation();
  document.getElementById("taskSearch").placeholder = t("searchTasks");
  document.getElementById("taskSearchButton").textContent = t("searchButton");
  document.getElementById("tokenPrompt").textContent = t("tokenPrompt");
  document.getElementById("tokenInput").placeholder = t("tokenPlaceholder");
  document.getElementById("tokenSave").textContent = t("tokenSave");
  document.getElementById("refreshNote").textContent = t("refreshNote");
  document.getElementById("footerText").textContent = fmt(t("footer"), CFG);
  renderExecutors();
  renderModels();
  renderTasks();
  renderUsage();
  renderDimensions();
}

function renderExecutors() {
  var box = document.getElementById("executors");
  var items = lastData.executors;
  if (!items || !items.length) {
    box.textContent = "";
    return;
  }
  box.innerHTML = items
    .map(function (executor) {
      var ready = Boolean(executor.ready);
      var count = (catalogs[executor.id] || []).length;
      var detail = executor.discovery && executor.discovery.error
        ? '<div class="exec-detail">' + escapeHtml(String(executor.discovery.error)) + "</div>"
        : "";
      // Relays are model-endpoint executors. Show their endpoint purely from
      // executor data; no executor id or provider is special-cased here.
      var relayDetail =
        executor.kind === "model-endpoint" && executor.base_url
          ? '<div class="exec-detail">' +
            escapeHtml(executor.base_url) +
            "</div>"
          : "";
      var protocols = executor.discovery && executor.discovery.protocols;
      var probeLines = "";
      if (protocols) {
        var check = function (entry) {
          if (!entry || entry.toolLoop == null) {
            return '<span style="color:#8b93a1">—</span>';
          }
          return '<span style="color:' + (entry.toolLoop ? "#34c26b" : "#e0564f") + '">' + (entry.toolLoop ? "✓" : "✗") + "</span>";
        };
        probeLines =
          '<div class="exec-detail">' +
          t("protoLabel") + ": " +
          escapeHtml(protocols.selected ?? t("protoPending")) +
          "<br>" +
          t("protoResponses") + " " + check(protocols.responses) +
          "<br>" +
          t("protoChat") + " " + check(protocols.chat) +
          "</div>";
      }
      return (
        '<div class="card">' +
        '<div class="exec-name">' + escapeHtml(executor.display_name || executor.id) + "</div>" +
        '<div class="exec-id">' + escapeHtml(executor.id) + "</div>" +
        '<div class="exec-row">' +
        '<span class="badge ' + (ready ? "ready" : "notready") + '">' + t(ready ? "ready" : "notReady") + "</span>" +
        (executor.official ? '<span class="badge official">' + t("official") + "</span>" : "") +
        (executor.selected ? '<span class="badge default">' + t("default") + "</span>" : "") +
        (executor.kind === "model-endpoint" ? '<span class="muted">' + t("relayTag") + "</span>" : "") +
        '<span class="muted">' + fmt(t("modelsInCatalog"), { n: count }) + "</span>" +
        "</div>" +
        detail +
        relayDetail +
        probeLines +
        "</div>"
      );
    })
    .join("");
}

function renderModels() {
  var box = document.getElementById("models");
  var select = document.getElementById("execSelect");
  var list = (selectedExecutor && catalogs[selectedExecutor]) || [];
  if (select.options.length !== lastData.executors.length) {
    select.innerHTML = lastData.executors
      .map(function (executor) {
        var name = escapeHtml(executor.display_name || executor.id);
        return '<option value="' + escapeHtml(executor.id) + '">' + name + "</option>";
      })
      .join("");
  }
  if (selectedExecutor && select.value !== selectedExecutor) {
    select.value = selectedExecutor;
  }
  var filtered = modelFilter
    ? list.filter(function (model) {
        return String(model.id).toLowerCase().includes(modelFilter.toLowerCase());
      })
    : list;
  document.getElementById("modelCount").textContent = fmt(t("modelsInCatalog"), {
    n: filtered.length,
  });
  if (!list.length) {
    box.innerHTML = '<li class="muted">' + escapeHtml(t("noModels")) + "</li>";
    return;
  }
  box.innerHTML = filtered
    .map(function (model) {
      const caps = model.capabilities;
      const tags = [];
      if (!caps) {
        tags.push(t("capUnknown"));
      } else {
        if (caps.tools) tags.push(t("capTools"));
        if (caps.reasoning) tags.push(t("capReasoning"));
        if (caps.vision) tags.push(t("capVision"));
        if (model.featured) tags.push(t("featuredTag"));
        if (!tags.length) tags.push(t("capUnknown"));
      }
      return (
        "<li><span>" +
        escapeHtml(model.id || model.model) +
        "</span>" +
        '<span class="tag">' +
        tags.map((tag) => escapeHtml(tag)).join(" · ") +
        "</span>" +
        "</li>"
      );
    })
    .join("");
}

function minutesBetween(startIso, endIso) {
  var start = new Date(startIso).getTime();
  var end = endIso ? new Date(endIso).getTime() : Date.now();
  if (!start) return null;
  return Math.round(((end - start) / 60000) * 10) / 10;
}

function renderTasks() {
  var box = document.getElementById("tasks");
  var tasks = lastData.tasks || [];
  if (!tasks.length) {
    box.innerHTML =
      '<div class="card muted">' + escapeHtml(t("noTasks")) + "</div>";
    return;
  }
  var head =
    "<table><thead><tr>" +
    "<th>" + t("colTime") + "</th>" +
    "<th>" + t("colTask") + "</th>" +
    "<th>" + t("colStatus") + "</th>" +
    '<th class="hide-sm">' + t("colExecutor") + "</th>" +
    '<th class="hide-sm">' + t("colModel") + "</th>" +
    '<th class="hide-sm">' + t("colProfile") + "</th>" +
    "<th>" + t("colTimeUsed") + "</th>" +
    "<th>" + t("colTokens") + "</th>" +
    "<th>" + t("colBudget") + "</th>" +
    "</tr></thead><tbody>";
  var rows = tasks
    .map(function (task) {
      var objective = escapeHtml(
        (task.brief && task.brief.objective) || task.objective || task.id,
      );
      var logicalId = task.logical_task_id || task.id;
      var history = (task.executor_history || [])
        .map(function (entry) { return entry.executor; })
        .filter(Boolean);
      var lineageParts = [];
      if (logicalId !== task.id || history.length > 1) {
        lineageParts.push(fmt(t("lineage"), { id: String(logicalId).slice(0, 8) }));
      }
      if (history.length > 1) {
        lineageParts.push(fmt(t("executorPath"), { path: history.join(" → ") }));
      }
      if (task.reroute_reason) {
        lineageParts.push(
          fmt(t("rerouteReason"), { reason: task.reroute_reason }),
        );
      }
      var lineage = lineageParts.length
        ? '<div class="task-lineage">' +
          escapeHtml(lineageParts.join(" · ")) +
          "</div>"
        : "";
      var usage = task.usage || {};
      var tokens = usage.total_tokens
        ? fmt(t("tokensTitle"), {
            "in": number(usage.input_tokens),
            out: number(usage.output_tokens),
            reason: number(usage.reasoning_output_tokens),
          })
        : "—";
      var timeCell;
      if (task.status === "queued" && !task.startedAt) {
        timeCell = '<span class="muted">' + t("queuedTime") + "</span>";
      } else if (task.completedAt) {
        var actual = minutesBetween(task.startedAt, task.completedAt);
        timeCell = actual === null ? "—" : fmt(t("minActual"), { n: actual });
      } else {
        var live = minutesBetween(task.startedAt, null);
        timeCell = live === null ? "—" : fmt(t("minRunning"), { n: live });
      }
      var budgetCell = "—";
      var budget = task.policy && task.policy.tokenBudget;
      if (budget && usage.total_tokens) {
        var pct = Math.min(100, Math.round((usage.total_tokens / budget) * 100));
        var cls = pct >= 100 ? "over" : pct >= 70 ? "warn" : "";
        budgetCell =
          '<div class="budget-label">' +
          escapeHtml(
            fmt(t("budget"), {
              used: number(usage.total_tokens),
              total: number(budget),
              pct: pct,
            }),
          ) +
          "</div>" +
          '<div class="budget-bar"><div class="budget-fill ' + cls + '" style="width:' + pct + '%"></div></div>';
      }
      return (
        "<tr>" +
        '<td class="mono">' + clock(task.createdAt) + "</td>" +
        '<td class="objective"><div title="' + objective + '">' + objective + "</div>" + lineage + deliverySummaryHtml(task.delivery) + "</td>" +
        '<td class="' + statusClass(task.status) + '">' + statusKey(task.status) + "</td>" +
        '<td class="hide-sm">' + escapeHtml(task.executor || "") + "</td>" +
        '<td class="hide-sm mono">' + escapeHtml((task.policy && task.policy.model) || "") + "</td>" +
        '<td class="hide-sm">' + escapeHtml((task.policy && task.policy.name) || "") + "</td>" +
        "<td>" + timeCell + "</td>" +
        '<td class="mono">' + tokens + "</td>" +
        "<td>" + budgetCell + "</td>" +
        "</tr>"
      );
    })
    .join("");
  box.innerHTML = '<div class="card" style="overflow-x:auto; padding:0">' + head + rows + "</tbody></table></div>";
}

function renderDimensions() {
  var box = document.getElementById("dimensions");
  if (!box) return;
  var rows = lastDimensions ?? [];
  if (!rows.length) {
    box.innerHTML = "";
    return;
  }
  var usd = function (microusd) {
    return microusd == null ? null : (microusd / 1e6).toFixed(6);
  };
  var states = function (entry) {
    var parts = [];
    var present = Object.entries(entry.presence ?? {})
      .map(function (pair) {
        return pair[0] + ":" + pair[1];
      })
      .join(",");
    var token = Object.entries(entry.token ?? {})
      .map(function (pair) {
        return pair[0] + ":" + pair[1];
      })
      .join(",");
    var settlement = Object.entries(entry.settlement ?? {})
      .map(function (pair) {
        return pair[0] + ":" + pair[1];
      })
      .join(",");
    if (present) parts.push("presence{" + present + "}");
    if (token) parts.push("token{" + token + "}");
    if (settlement) parts.push("settlement{" + settlement + "}");
    return parts.join(" ");
  };
  box.innerHTML =
    "<thead><tr>" +
    "<th>" + t("dimColModel") + "</th>" +
    "<th>" + t("dimColRequests") + "</th>" +
    "<th>" + t("dimColTokens") + "</th>" +
    "<th>" + t("dimColCost") + "</th>" +
    "<th>" + t("dimColReconcile") + "</th>" +
    "</tr></thead><tbody>" +
    rows
      .map(function (row) {
        var estimated = usd(row.estimated_cost_microusd);
        var settled = usd(row.settled_cost_microusd);
        var cost =
          (estimated != null ? "est $" + estimated : "") +
          (settled != null ? " / settled $" + settled : "");
        return (
          "<tr>" +
          "<td>" + escapeHtml(row.model ?? "unknown") + "</td>" +
          '<td class="mono">' + number(row.events) + " (" + row.succeeded + " ok / " + row.failed + " fail · retries " + row.retries + ")</td>" +
          '<td class="mono">' + number(row.total_tokens) + "</td>" +
          '<td class="mono">' + escapeHtml(cost || "—") + "</td>" +
          '<td class="mono">' + escapeHtml(states(row)) + "</td>" +
          "</tr>"
        );
      })
      .join("") +
    "</tbody>";
}

function renderUsage() {
  var box = document.getElementById("usage");
  var usage = lastData.usage;
  if (!usage) {
    box.innerHTML = "";
    return;
  }
  var rows = [
    [t("usageTasks"), number(usage.tasks_with_usage)],
    [t("usageInput"), number(usage.input_tokens)],
    [t("usageCached"), number(usage.cached_input_tokens)],
    [t("usageUncached"), number(usage.uncached_input_tokens)],
    [t("usageOutput"), number(usage.output_tokens)],
    [t("usageReasoning"), number(usage.reasoning_output_tokens)],
    [t("usageTotal"), number(usage.total_tokens)],
  ];
  box.innerHTML =
    "<tbody>" +
    rows
      .map(function (row) {
        return "<tr><td>" + row[0] + "</td><td>" + row[1] + "</td></tr>";
      })
      .join("") +
    "</tbody>";
}

function renderAll() {
  setLang(lang);
  var dot = document.getElementById("healthDot");
  var healthy = lastData.health && lastData.health.status === "ok";
  dot.className = "dot " + (healthy ? "ok" : "bad");
  dot.title = healthy ? t("healthOk") : t("healthBad");
}

function reasonText(key) {
  var map = {
    capability_fit: "reasonCapabilityFit",
    route_healthy: "reasonRouteHealthy",
    price_low: "reasonPriceLow",
    latency_low: "reasonLatencyLow",
    metadata_fresh: "reasonMetadataFresh",
  };
  return map[key] ? t(map[key]) : key;
}

function warningText(key) {
  var map = {
    status_unknown: "warnStatusUnknown",
    context_unknown: "warnContextUnknown",
    tools_unknown: "warnToolsUnknown",
    vision_unknown: "warnVisionUnknown",
    reasoning_unknown: "warnReasoningUnknown",
    route_health_unknown: "warnRouteHealthUnknown",
    route_health_not_confirmed: "warnRouteHealthNotConfirmed",
    pricing_unknown: "warnPricingUnknown",
    latency_samples_insufficient: "warnLatencySamples",
    metadata_stale: "warnMetadataStale",
  };
  if (key.indexOf("protocol_unknown:") === 0) {
    return fmt(t("warnProtocolUnknown"), { protocol: key.slice(17) });
  }
  return map[key] ? t(map[key]) : key;
}

function exclusionText(key) {
  var map = {
    invalid_entry: "exclInvalidEntry",
    not_in_allowlist: "exclNotAllowlisted",
    status_unavailable: "exclStatusUnavailable",
    context_insufficient: "exclContextInsufficient",
    tools_unsupported: "exclToolsUnsupported",
    vision_unsupported: "exclVisionUnsupported",
    reasoning_unsupported: "exclReasoningUnsupported",
    route_unhealthy: "exclRouteUnhealthy",
  };
  if (key.indexOf("protocol_unsupported:") === 0) {
    return fmt(t("exclProtocolUnsupported"), { protocol: key.slice(21) });
  }
  return map[key] ? t(map[key]) : key;
}

function capabilitySourceText(source) {
  if (source === "declared") return t("capSourceDeclared");
  if (source === "probed") return t("capSourceProbed");
  return t("capSourceUnknown");
}

function renderRecommendation() {
  var box = document.getElementById("recommendation");
  if (!box) return;
  var recommendation = lastRecommendation;
  if (!recommendation) {
    box.innerHTML =
      '<div class="card muted">' + escapeHtml(t("recommendEmpty")) + "</div>";
    return;
  }
  var usd6 = function (microusd) {
    return microusd == null ? null : (microusd / 1e6).toFixed(6);
  };
  var strategyRow = function (key, label) {
    var entry = recommendation.strategies?.[key];
    if (!entry) {
      return (
        '<div class="card"><div class="exec-name">' + escapeHtml(label) + "</div>" +
        '<div class="exec-detail muted">—</div></div>'
      );
    }
    var range = entry.estimated_cost_range;
    var cost = range
      ? "est $" + usd6(range.low_microusd) + " – $" + usd6(range.high_microusd) +
        (range.pricing_version ? " · pricing " + escapeHtml(range.pricing_version) : "")
      : t("recommendCostUnknown");
    return (
      '<div class="card">' +
      '<div class="exec-name">' + escapeHtml(label) + ": " + escapeHtml(entry.model) + "</div>" +
      '<div class="exec-id">' + escapeHtml(entry.executor) + "</div>" +
      '<div class="exec-detail">' + escapeHtml(cost) + "</div>" +
      "</div>"
    );
  };
  var strategies =
    strategyRow("cheapest", t("strategyCheapest")) +
    strategyRow("balanced", t("strategyBalanced")) +
    strategyRow("best", t("strategyBest"));
  var rows = (recommendation.ranked ?? [])
    .map(function (entry) {
      var range = entry.estimated_cost_range;
      var cost = range
        ? fmt(t("recommendCost"), {
            low: usd6(range.low_microusd),
            expected: usd6(range.expected_microusd),
            high: usd6(range.high_microusd),
            currency: range.currency,
          })
        : t("recommendCostUnknown");
      var reasons = (entry.reasons ?? []).map(reasonText).join(" · ");
      var warnings = (entry.warnings ?? []).map(warningText).join(" · ");
      var latency =
        entry.latency_avg_ms != null
          ? fmt(t("recommendLatency"), {
              avg: entry.latency_avg_ms,
              samples: entry.latency_samples ?? 0,
            })
          : "";
      var freshness =
        entry.metadata_freshness_seconds != null
          ? fmt(t("recommendFreshness"), {
              seconds: entry.metadata_freshness_seconds,
            })
          : "";
      return (
        '<div class="card">' +
        '<div class="exec-name">' + escapeHtml(entry.model) + "</div>" +
        '<div class="exec-id">' + escapeHtml(entry.executor) + " · " + escapeHtml(fmt(t("recommendScore"), { score: entry.score })) + "</div>" +
        '<div class="exec-row">' +
        '<span class="badge default">' + escapeHtml(capabilitySourceText(entry.capability_source)) + "</span>" +
        '<span class="muted">' + escapeHtml(cost) + "</span>" +
        "</div>" +
        (reasons ? '<div class="exec-detail">' + escapeHtml(reasons) + "</div>" : "") +
        (latency || freshness ? '<div class="exec-detail">' + escapeHtml([latency, freshness].filter(Boolean).join(" · ")) + "</div>" : "") +
        (warnings ? '<div class="exec-detail" style="color:#e0a53e">' + escapeHtml(warnings) + "</div>" : "") +
        "</div>"
      );
    })
    .join("");
  var excluded = (recommendation.excluded ?? [])
    .map(function (entry) {
      return (
        '<div class="exec-detail">' +
        escapeHtml(entry.model + " (" + entry.executor + ")") +
        " — " +
        escapeHtml((entry.reasons ?? []).map(exclusionText).join(", ")) +
        "</div>"
      );
    })
    .join("");
  box.innerHTML =
    strategies +
    rows +
    (excluded
      ? '<div class="card"><div class="exec-name">' + escapeHtml(t("recommendExcluded")) + "</div>" + excluded + "</div>"
      : "");
}

async function refresh() {
  try {
    var executorList = await api("/v1/executors");
    var tasksUrl = taskListUrl(taskQuery,CFG.workflowEnabled);
    var [health, tasksRes, usageRes, dimensionsRes] = await Promise.all([
      api("/health"),
      api(tasksUrl),
      api("/v1/usage"),
      api("/v1/usage/dimensions?by=model&limit=10"),
    ]);
    lastData.health = health;
    lastData.executors = executorList.executors || [];
    if (!selectedExecutor) {
      selectedExecutor =
        executorList.default_executor ||
        (lastData.executors[0] && lastData.executors[0].id) ||
        null;
    }
    var catalogJobs = lastData.executors.map(function (executor) {
      return api("/v1/models?executor=" + encodeURIComponent(executor.id))
        .then(function (res) {
          catalogs[executor.id] = res.models || [];
        })
        .catch(function () {
          catalogs[executor.id] = [];
        });
    });
    await Promise.all(catalogJobs);
    lastData.tasks = tasksRes.tasks || [];
    lastData.usage = usageRes.usage || null;
    lastDimensions = dimensionsRes.rows || [];
    document.getElementById("errorBar").classList.add("hidden");
    renderAll();
  } catch (error) {
    if (error.message === "unauthorized") return;
    var bar = document.getElementById("errorBar");
    bar.textContent = fmt(t("errorBanner"), { message: error.message });
    bar.classList.remove("hidden");
  }
}

document.getElementById("langZh").addEventListener("click", function () {
  setLang("zh");
});
document.getElementById("langEn").addEventListener("click", function () {
  setLang("en");
});
document.getElementById("execSelect").addEventListener("change", function (event) {
  selectedExecutor = event.target.value;
  renderModels();
});
document.getElementById("modelFilter").addEventListener("input", function (event) {
  modelFilter = event.target.value.trim();
  renderModels();
});
document.getElementById("recommendButton").addEventListener("click", async function () {
  var objective = document.getElementById("recommendObjective").value.trim();
  if (!objective) {
    lastRecommendation = null;
    renderRecommendation();
    return;
  }
  var profile = document.getElementById("recommendProfile").value;
  var query =
    "objective=" + encodeURIComponent(objective) + "&profile=" + encodeURIComponent(profile);
  try {
    var response = await api("/v1/recommendations?" + query);
    lastRecommendation = response.recommendation ?? null;
    renderRecommendation();
  } catch (error) {
    var bar = document.getElementById("errorBar");
    bar.textContent = fmt(t("errorBanner"), { message: error.message });
    bar.classList.remove("hidden");
  }
});
document.getElementById("taskSearchButton").addEventListener("click", function () {
  taskQuery = document.getElementById("taskSearch").value.trim();
  refresh();
});
document.getElementById("taskSearch").addEventListener("keydown", function (event) {
  if (event.key !== "Enter") return;
  taskQuery = event.target.value.trim();
  refresh();
});
document.getElementById("tokenSave").addEventListener("click", function () {
  token = document.getElementById("tokenInput").value.trim();
  if (!token) return;
  localStorage.setItem("acp-dash-token", token);
  document.getElementById("tokenBar").classList.add("hidden");
  refresh();
});

renderAll();
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}
