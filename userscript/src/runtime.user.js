// ==UserScript==
// @name         AgentControlPlane Web Bridge Preview
// @name:zh-CN   AgentControlPlane 网页桥接预览
// @namespace    https://github.com/Ya-KARAS/AgentControlPlane
// @version      0.8.2
// @description  Use natural-language web AI conversations to stage and dispatch local engineering tasks.
// @description:zh-CN 通过网页 AI 自然语言对话暂存和派发本地工程任务。
// @author       Ya-KARAS
// @downloadURL  https://raw.githubusercontent.com/Ya-KARAS/AgentControlPlane/refs/heads/main/userscript/releases/0.8.2/agent-control-plane-web-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/Ya-KARAS/AgentControlPlane/refs/heads/main/userscript/agent-control-plane-web-bridge.meta.js
// @acp-adapter-matches
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

  // @acp-i18n
  // @acp-conversation-protocol
  // @acp-stage-state
  // @acp-result-delivery-state

  const ROOT_ID = "acp-web-bridge-preview";
  const LOCAL_BASE_URL = "http://127.0.0.1:4318";
  const CANDIDATE_URL = `${LOCAL_BASE_URL}/v1/local-review/candidates`;
  const CAPABILITIES_URL = `${LOCAL_BASE_URL}/v1/local-review/capabilities`;
  const REMOTE_RELAY_KEY = "acp-remote-relay-v1";
  const DEFAULT_REMOTE_RELAY_URL = "https://acp.asterroute.com";
  const ADAPTERS = /* @acp-adapters */ [];
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
  const TAB_ID = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let revisionSequence = 0;
  let activeScope = conversationScope(window.location);
  let planningBaseline = null;
  let remoteRelay = null;

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
      await Promise.resolve(GM_deleteValue(currentStorageKey()));
      return;
    }
    if (saved.state === "planning") {
      staged = null;
      planningBaseline = saved.baselineEnvelope ?? null;
      showStatus(t("planning"));
      return;
    }
    if (saved.state === "dispatched") {
      staged = null;
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
      showStagedStatus("restored");
    } catch {
      await Promise.resolve(GM_deleteValue(currentStorageKey()));
    }
  };

  const ensureConversationScope = async () => {
    const scope = conversationScope(window.location);
    if (scope === activeScope) return;
    activeScope = scope;
    staged = null;
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
  const findSendButton = () => visibleElements(adapter.send).at(-1) ?? null;
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
  root.setAttribute("aria-label", t("ariaLabel"));

  const style = document.createElement("style");
  style.textContent = `
    #${ROOT_ID} { align-items: center; bottom: 20px; display: flex; font-family: system-ui, sans-serif; gap: 7px; position: fixed; right: 20px; z-index: 2147483647; }
    #${ROOT_ID} button { background: #536af5; border: 0; border-radius: 999px; box-shadow: 0 8px 24px rgba(28, 39, 102, .28); color: #fff; cursor: pointer; font: 700 12px system-ui, sans-serif; max-width: min(360px, calc(100vw - 40px)); overflow: hidden; padding: 9px 13px; text-overflow: ellipsis; transition: background-color .18s ease, box-shadow .18s ease; white-space: nowrap; }
    #${ROOT_ID} button[data-state="completed"] { background: #16803d; box-shadow: 0 8px 24px rgba(22, 128, 61, .3); }
    #${ROOT_ID} select { appearance: auto; background: #161b22; border: 1px solid #536af5; border-radius: 999px; color: #fff; cursor: pointer; font: 700 12px system-ui, sans-serif; padding: 8px 9px; }
  `;
  const statusButton = document.createElement("button");
  statusButton.type = "button";
  statusButton.textContent = `ACP · ${t("ready")}`;
  statusButton.title = t("openSettings");
  statusButton.addEventListener("click", () => {
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
    statusButton.title = t("openSettings");
    registerLanguageMenu();
  };

  const showStatus = (text, detail = text, state = "default") => {
    statusButton.textContent = `ACP · ${text}`;
    statusButton.title = `AgentControlPlane\n${detail}\n${t("openSettings")}`;
    statusButton.dataset.state = state;
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
    return withStageLock(async () => {
      const observation = latestTaskObservation();
      const stored = await readStoredStage();
      if (!observation) return { observation: null, stored, conflict: false };
      candidateFromEnvelope(observation.envelope);

      if (observationWaitsBehindBarrier(stored, observation)) {
        staged = null;
        planningBaseline = stored.baselineEnvelope ?? null;
        return { observation, stored, conflict: false };
      }

      if (observationWasDispatched(stored, observation)) {
        staged = null;
        planningBaseline = null;
        dispatchingEnvelopeId = stored.id;
        return { observation, stored, conflict: false };
      }

      if (stored?.state === "staged" && stored.id === observation.id) {
        staged = stageFromRecord(stored);
        planningBaseline = null;
        return { observation, stored, conflict: false };
      }

      if (
        !observationCanReplace(stored, observation) ||
        (stored && document.visibilityState === "hidden")
      ) {
        if (stored?.state === "staged") staged = stageFromRecord(stored);
        else staged = null;
        showStageConflict();
        return { observation, stored, conflict: true };
      }

      const baseline = stored?.state === "planning"
        ? stored.baselineEnvelope
        : stored?.envelope ?? staged?.envelope ?? planningBaseline;
      const changes = baseline ? taskEnvelopeChanges(baseline, observation.envelope) : [];
      staged = {
        id: observation.id,
        revision: nextRevision(),
        ownerId: TAB_ID,
        envelope: observation.envelope,
        changes,
        changeConfirmed: changes.length === 0,
        assistantOrdinal: observation.assistantOrdinal,
      };
      planningBaseline = null;
      await saveStage();
      showStagedStatus();
      return { observation, stored, conflict: false };
    });
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
        expiresAt: Date.now() + STAGE_TTL_MS,
      });
      await Promise.resolve(GM_setValue(currentStorageKey(), record));
      staged = null;
      planningBaseline = baselineEnvelope;
    });
  };

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

  const readCapabilities = async () => {
    let response;
    try {
      response = await request({
        method: "GET",
        url: CAPABILITIES_URL,
        headers: { "x-acp-page-origin": window.location.origin },
      });
    } catch (localError) {
      if (!remoteRelay) throw localError;
      response = await request({
        method: "GET",
        url: `${remoteRelay.baseUrl}/api/acp/capabilities`,
        headers: await remoteHeaders(),
      });
    }
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
      const body = JSON.parse(response.responseText);
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
      showStatus(t("localStatusUnavailable"));
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
        let usedRemote = false;
        try {
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
        } catch (localError) {
          if (!remoteRelay) throw localError;
          usedRemote = true;
          response = await request({
            method: "POST",
            url: `${remoteRelay.baseUrl}/api/acp/tasks`,
            headers: await remoteHeaders({
              "content-type": "application/json",
              "x-acp-idempotency-key": idempotencyKey,
            }),
            data: JSON.stringify({ candidate: candidateFromEnvelope(activeEnvelope.envelope) }),
          });
        }
        const body = JSON.parse(response.responseText);
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
        showStatus(
          error.message === "timeout"
            ? t("connectionTimeout")
            : error.message === "network_error"
              ? t("localDisconnected")
              : error.message === "stage_lock_unavailable"
                ? t("browserDispatchUnsupported")
            : error.message === "candidate_route_cooldown"
              ? t("routeCooldown")
              : t("dispatchFailed"),
      );
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
        showStatus(
          error.message === "timeout"
            ? t("connectionTimeout")
            : error.message === "network_error"
              ? t("localDisconnected")
              : t("readConfigFailed"),
        );
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
    .finally(() => restoreStage().finally(scheduleInspection));
})();
