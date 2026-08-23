// ==UserScript==
// @name         AgentControlPlane Web Bridge Preview
// @namespace    https://github.com/Ya-KARAS/AgentControlPlane
// @version      0.4.0
// @description  Use natural-language web AI conversations to stage and dispatch local engineering tasks.
// @author       Ya-KARAS
// @downloadURL  https://raw.githubusercontent.com/Ya-KARAS/AgentControlPlane/main/userscript/agent-control-plane-web-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/Ya-KARAS/AgentControlPlane/main/userscript/agent-control-plane-web-bridge.user.js
// @match        https://chatgpt.com/*
// @match        https://chat.deepseek.com/*
// @connect      127.0.0.1
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const ACP_MENTION = "@AgentControlPlane";
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

function boundedText(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

function parseLaunchCommand(value) {
  const text = String(value ?? "").trim();
  if (!text.toLowerCase().startsWith(ACP_MENTION.toLowerCase())) return null;
  const boundary = text.slice(ACP_MENTION.length, ACP_MENTION.length + 1);
  if (boundary && !/\s/.test(boundary)) return null;
  return {
    request: boundedText(text.slice(ACP_MENTION.length), 4000),
  };
}

function controllerPrompt(request = "") {
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
  return {
    objective,
    constraints: constraints.slice(0, 16),
    source: "userscript-preview",
  };
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
    blocker_count: Number(task?.blocker_count ?? 0),
  }, null, 2)}\n</ACP_RESULT>`;
}

  const ROOT_ID = "acp-web-bridge-preview";
  const LOCAL_BASE_URL = "http://127.0.0.1:4318";
  const CANDIDATE_URL = `${LOCAL_BASE_URL}/v1/local-review/candidates`;
  const ADAPTERS = Object.freeze([{"id":"chatgpt","displayName":"ChatGPT","origins":["https://chatgpt.com"],"composer":["#prompt-textarea","textarea"],"send":["button[data-testid=\"send-button\"]","button[aria-label*=\"Send\"]"],"assistant":["[data-message-author-role=\"assistant\"]"],"user":["[data-message-author-role=\"user\"]"]},{"id":"deepseek","displayName":"DeepSeek","origins":["https://chat.deepseek.com"],"composer":["textarea","[contenteditable=\"true\"]"],"send":["button[aria-label*=\"Send\"]","button[aria-label*=\"发送\"]"],"assistant":[".ds-markdown","[data-role=\"assistant\"]",".markdown-body"],"user":["[data-message-author-role=\"user\"]","[data-role=\"user\"]",".ds-chat [class*=\"user\"]","main [class*=\"user\"]"]}]);
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

  let staged = null;
  let dispatchingEnvelopeId = null;
  let tracking = null;
  let pollTimer = null;
  let pendingResult = null;
  let pendingResultExpiresAt = 0;
  let suppressCapture = false;
  let inspectTimer = null;

  const request = (options) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      ...options,
      timeout: 10000,
      onload: resolve,
      onerror: () => reject(new Error("network_error")),
      ontimeout: () => reject(new Error("timeout")),
    });
  });

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
  const findSendButton = () => visibleElements(adapter.send).at(-1) ?? null;
  const latestText = (selectors) =>
    visibleElements(selectors).at(-1)?.textContent?.trim() ?? "";

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
      const button = findSendButton();
      if (!button || button.disabled) return false;
      button.click();
      return true;
    } finally {
      setTimeout(() => {
        suppressCapture = false;
      }, 100);
    }
  };

  const root = document.createElement("section");
  root.id = ROOT_ID;
  root.setAttribute("aria-label", "AgentControlPlane web bridge");

  const style = document.createElement("style");
  style.textContent = `
    #${ROOT_ID} { bottom: 20px; font-family: system-ui, sans-serif; position: fixed; right: 20px; z-index: 2147483647; }
    #${ROOT_ID} button { background: #536af5; border: 0; border-radius: 999px; box-shadow: 0 8px 24px rgba(28, 39, 102, .28); color: #fff; cursor: pointer; font: 700 12px system-ui, sans-serif; max-width: min(360px, calc(100vw - 40px)); overflow: hidden; padding: 9px 13px; text-overflow: ellipsis; white-space: nowrap; }
  `;
  const statusButton = document.createElement("button");
  statusButton.type = "button";
  statusButton.textContent = "ACP · 就绪";
  statusButton.title = "点击打开本机派发设置";
  statusButton.addEventListener("click", () => {
    GM_openInTab(`${LOCAL_BASE_URL}/local-review/settings`, {
      active: true,
      insert: true,
      setParent: true,
    });
  });
  root.append(style, statusButton);
  document.body.append(root);

  const showStatus = (text) => {
    statusButton.textContent = `ACP · ${text}`;
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
    if (!body.task) return "等待本机确认";
    const labels = {
      queued: "任务排队中",
      running: "任务执行中",
      completed: "任务已完成",
      failed: "任务失败",
      blocked: "任务被阻塞",
      partial: "任务部分完成",
      cancelled: "任务已取消",
    };
    return labels[body.task.status] ?? "状态已更新";
  };

  const stopTracking = () => {
    tracking = null;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };

  const returnResultToConversation = async () => {
    if (!pendingResult || Date.now() >= pendingResultExpiresAt) {
      pendingResult = null;
      return;
    }
    if (readComposer()) {
      setTimeout(returnResultToConversation, 1000);
      return;
    }
    const value = pendingResult;
    pendingResult = null;
    if (!writeComposer(value) || !(await submitComposer())) {
      pendingResult = value;
      setTimeout(returnResultToConversation, 1000);
    }
  };

  const pollStatus = async (activeTracking) => {
    if (tracking !== activeTracking) return;
    if (Date.now() >= activeTracking.expiresAt) {
      stopTracking();
      showStatus("状态查看已过期");
      return;
    }
    try {
      const response = await request({
        method: "GET",
        url: `${CANDIDATE_URL}/${encodeURIComponent(activeTracking.id)}/status`,
        headers: {
          "x-acp-page-origin": window.location.origin,
          "x-acp-status-secret": activeTracking.secret,
        },
      });
      const body = JSON.parse(response.responseText);
      if (response.status !== 200) {
        throw new Error(body.error?.code ?? `http_${response.status}`);
      }
      showStatus(taskStatusText(body));
      if (body.task && TERMINAL_TASK_STATUSES.has(body.task.status)) {
        stopTracking();
        if (activeTracking.returnResultToChat) {
          pendingResult = safeResultBlock(body.task);
          pendingResultExpiresAt = Date.now() + 2 * 60 * 1000;
          returnResultToConversation();
        }
        return;
      }
    } catch (error) {
      if (tracking !== activeTracking) return;
      if (["candidate_status_expired", "candidate_status_denied"].includes(error.message)) {
        stopTracking();
        showStatus("无法继续读取状态");
        return;
      }
      showStatus("本机状态暂不可用");
    }
    if (tracking === activeTracking) {
      pollTimer = setTimeout(() => pollStatus(activeTracking), 2000);
    }
  };

  const dispatchEnvelope = async (activeEnvelope) => {
    if (!activeEnvelope || dispatchingEnvelopeId === activeEnvelope.id) return;
    dispatchingEnvelopeId = activeEnvelope.id;
    showStatus("正在派发");
    try {
      const response = await request({
        method: "POST",
        url: CANDIDATE_URL,
        headers: {
          "content-type": "application/json",
          "x-acp-client": "userscript-v1",
          "x-acp-page-origin": window.location.origin,
        },
        data: JSON.stringify(candidateFromEnvelope(activeEnvelope.envelope)),
      });
      const body = JSON.parse(response.responseText);
      const candidateId = body.candidate?.id;
      if (
        response.status !== 201 ||
        typeof candidateId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(candidateId) ||
        typeof body.status_secret !== "string" ||
        !/^[A-Za-z0-9_-]{20,128}$/.test(body.status_secret)
      ) {
        throw new Error(body.error?.message ?? `ACP returned ${response.status}`);
      }
      const expiresAt = Date.parse(body.candidate.status_expires_at);
      if (!Number.isFinite(expiresAt)) {
        throw new Error("ACP returned an invalid status expiry");
      }
      staged = null;
      stopTracking();
      tracking = {
        id: candidateId,
        secret: body.status_secret,
        expiresAt,
        returnResultToChat: body.return_result_to_chat === true,
      };
      showStatus(body.auto_dispatched ? "任务已派发" : "等待本机确认");
      pollStatus(tracking);
      if (!body.auto_dispatched) {
        const reviewUrl = validatedReviewUrl(body.review_url, candidateId);
        GM_openInTab(reviewUrl, { active: true, insert: true, setParent: true });
      }
    } catch (error) {
      dispatchingEnvelopeId = null;
      showStatus(
        error.message === "timeout"
          ? "连接本机超时"
          : error.message === "network_error"
            ? "本机 ACP 未连接"
            : "派发失败",
      );
    }
  };

  const inspectConversation = () => {
    inspectTimer = null;
    const assistantText = latestText(adapter.assistant);
    const envelope = extractTaskEnvelope(assistantText);
    if (!envelope) return;
    try {
      candidateFromEnvelope(envelope);
      const id = envelopeId(envelope);
      if (id === dispatchingEnvelopeId || id === staged?.id) return;
      staged = { id, envelope };
      showStatus("任务已准备，请回复“执行”");
    } catch {
      showStatus("任务格式无效");
    }
  };

  const scheduleInspection = () => {
    if (inspectTimer) clearTimeout(inspectTimer);
    inspectTimer = setTimeout(inspectConversation, 250);
  };

  const captureOrExpandComposer = (event) => {
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
    } else {
      const button = findSendButton();
      if (!button || !(event.target instanceof Node) || !button.contains(event.target)) return;
    }

    const text = readComposer(composer);
    const launch = parseLaunchCommand(text);
    if (launch) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!launch.request && !latestText(adapter.user) && !latestText(adapter.assistant)) {
        showStatus("请在 @AgentControlPlane 后描述任务");
        return;
      }
      writeComposer(controllerPrompt(launch.request), composer);
      showStatus("网页 AI 正在整理任务");
      submitComposer();
      return;
    }

    if (staged && isConfirmation(text)) {
      const activeEnvelope = staged;
      setTimeout(() => dispatchEnvelope(activeEnvelope), 0);
    }
  };

  window.addEventListener("keydown", captureOrExpandComposer, true);
  window.addEventListener("click", captureOrExpandComposer, true);
  new MutationObserver(scheduleInspection).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  scheduleInspection();
})();
