// ==UserScript==
// @name         AgentControlPlane Web Bridge Preview
// @namespace    https://github.com/Ya-KARAS/AgentControlPlane
// @version      0.5.1
// @description  Use natural-language web AI conversations to stage and dispatch local engineering tasks.
// @author       Ya-KARAS
// @downloadURL  https://raw.githubusercontent.com/Ya-KARAS/AgentControlPlane/main/userscript/agent-control-plane-web-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/Ya-KARAS/AgentControlPlane/main/userscript/agent-control-plane-web-bridge.user.js
// @acp-adapter-matches
// @connect      127.0.0.1
// @grant        GM_openInTab
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  // @acp-conversation-protocol

  const ROOT_ID = "acp-web-bridge-preview";
  const LOCAL_BASE_URL = "http://127.0.0.1:4318";
  const CANDIDATE_URL = `${LOCAL_BASE_URL}/v1/local-review/candidates`;
  const CAPABILITIES_URL = `${LOCAL_BASE_URL}/v1/local-review/capabilities`;
  const ADAPTERS = /* @acp-adapters */ [];
  const STAGE_TTL_MS = 10 * 60 * 1000;
  const STAGE_STORAGE_KEY = `acp-stage-v1:${window.location.origin}:${window.location.pathname}`;
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
  let launchPending = false;

  const saveStage = async () => {
    if (!staged) {
      await Promise.resolve(GM_deleteValue(STAGE_STORAGE_KEY));
      return;
    }
    await Promise.resolve(GM_setValue(STAGE_STORAGE_KEY, {
      version: 1,
      id: staged.id,
      envelope: staged.envelope,
      changes: staged.changes ?? [],
      changeConfirmed: staged.changeConfirmed === true,
      expiresAt: Date.now() + STAGE_TTL_MS,
    }));
  };

  const restoreStage = async () => {
    const saved = await Promise.resolve(GM_getValue(STAGE_STORAGE_KEY, null));
    if (
      !saved ||
      saved.version !== 1 ||
      Date.now() >= Number(saved.expiresAt ?? 0) ||
      envelopeId(saved.envelope) !== saved.id
    ) {
      await Promise.resolve(GM_deleteValue(STAGE_STORAGE_KEY));
      return;
    }
    try {
      candidateFromEnvelope(saved.envelope);
      staged = {
        id: saved.id,
        envelope: saved.envelope,
        changes: Array.isArray(saved.changes) ? saved.changes.slice(0, 6) : [],
        changeConfirmed: saved.changeConfirmed === true,
      };
      showStagedStatus("已恢复");
    } catch {
      await Promise.resolve(GM_deleteValue(STAGE_STORAGE_KEY));
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
    statusButton.title = `AgentControlPlane · ${text}\n点击打开本机派发设置`;
  };

  const showStagedStatus = (prefix = "") => {
    if (!staged) return;
    if (staged.changes?.length && !staged.changeConfirmed) {
      showStatus(`${prefix ? `${prefix} · ` : ""}配置变化：${staged.changes.join(", ")} · 回复“确认变更”`);
      return;
    }
    showStatus(`${prefix ? `${prefix} · ` : ""}${executionSummary(staged.envelope)} · 回复“执行”`);
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
    const taskId = String(body.task.id ?? "").slice(0, 8);
    const elapsed = tracking?.startedAt
      ? `${Math.max(0, Math.floor((Date.now() - tracking.startedAt) / 1000))}s`
      : null;
    const failureLabels = {
      insufficient_balance: "余额不足",
      usage_limit: "额度已用尽",
      rate_limited: "请求限流",
      authentication_failed: "认证失败",
      executor_unavailable: "执行器不可用",
      provider_unavailable: "模型服务不可用",
      task_failed: "工程任务失败",
    };
    const detail = body.task.status === "failed"
      ? failureLabels[body.task.failure_category] ?? "原因未知"
      : elapsed;
    return [labels[body.task.status] ?? "状态已更新", taskId, detail]
      .filter(Boolean)
      .join(" · ");
  };

  const readCapabilities = async () => {
    const response = await request({
      method: "GET",
      url: CAPABILITIES_URL,
      headers: { "x-acp-page-origin": window.location.origin },
    });
    const body = JSON.parse(response.responseText);
    if (
      response.status !== 200 ||
      !body.capabilities ||
      typeof body.capabilities !== "object" ||
      Array.isArray(body.capabilities)
    ) {
      throw new Error(body.error?.code ?? `http_${response.status}`);
    }
    return body.capabilities;
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
    if (activeEnvelope.changes?.length && !activeEnvelope.changeConfirmed) {
      showStagedStatus();
      return;
    }
    dispatchingEnvelopeId = activeEnvelope.id;
    showStatus("正在派发");
    try {
      const idempotencyKey = await stableIdempotencyKey(activeEnvelope);
      const response = await request({
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
      const body = JSON.parse(response.responseText);
      const candidateId = body.candidate?.id;
      if (
        response.status !== 201 ||
        typeof candidateId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(candidateId) ||
        typeof body.status_secret !== "string" ||
        !/^[A-Za-z0-9_-]{20,128}$/.test(body.status_secret)
      ) {
        throw new Error(body.error?.code ?? `http_${response.status}`);
      }
      const expiresAt = Date.parse(body.candidate.status_expires_at);
      if (!Number.isFinite(expiresAt)) {
        throw new Error("ACP returned an invalid status expiry");
      }
      staged = null;
      await saveStage();
      stopTracking();
      tracking = {
        id: candidateId,
        secret: body.status_secret,
        expiresAt,
        startedAt: Date.now(),
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
            : error.message === "candidate_route_cooldown"
              ? "所选模型暂时冷却"
              : "派发失败",
      );
      await saveStage();
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
      const changes = staged ? taskEnvelopeChanges(staged.envelope, envelope) : [];
      staged = {
        id,
        envelope,
        changes,
        changeConfirmed: changes.length === 0,
      };
      saveStage();
      showStagedStatus();
    } catch {
      showStatus("任务格式无效");
    }
  };

  const scheduleInspection = () => {
    if (inspectTimer) clearTimeout(inspectTimer);
    inspectTimer = setTimeout(inspectConversation, 250);
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
    } else {
      const button = findSendButton();
      if (!button || !(event.target instanceof Node) || !button.contains(event.target)) return;
    }

    const text = readComposer(composer);
    const launch = parseLaunchCommand(text);
    if (launch) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (launchPending) return;
      if (!launch.request && !latestText(adapter.user) && !latestText(adapter.assistant)) {
        showStatus("请在 @AgentControlPlane 后描述任务");
        return;
      }
      launchPending = true;
      showStatus("正在读取本机可选配置");
      try {
        const capabilities = await readCapabilities();
        writeComposer(controllerPrompt(launch.request, capabilities), composer);
        showStatus("网页 AI 正在整理任务");
        await submitComposer();
      } catch (error) {
        showStatus(
          error.message === "timeout"
            ? "连接本机超时"
            : error.message === "network_error"
              ? "本机 ACP 未连接"
              : "无法读取本机配置",
        );
      } finally {
        launchPending = false;
      }
      return;
    }

    if (staged?.changes?.length && !staged.changeConfirmed) {
      if (isChangeConfirmation(text)) {
        staged.changeConfirmed = true;
        saveStage();
        showStagedStatus("变更已确认");
      } else if (isConfirmation(text)) {
        showStagedStatus();
      }
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
  restoreStage().finally(scheduleInspection);
})();
