(async () => {
  if (globalThis.__ACP_COMPANION_LOADED__) return;
  globalThis.__ACP_COMPANION_LOADED__ = true;

  const base = chrome.runtime.getURL("src/");
  const [protocol, adapters, panelModule, i18n] = await Promise.all([
    import(`${base}protocol.js`),
    import(`${base}site-adapters.js`),
    import(`${base}panel.js`),
    import(`${base}i18n.js`),
  ]);
  const adapter = adapters.detectAdapter(location.href);
  const seen = new Set();
  let currentState = null;
  let monitorTimer = null;

  function t(key, params = {}) {
    return i18n.makeT(currentState?.settings?.language ?? "zh")(key, params);
  }

  function message(type, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error ?? "Companion request failed"));
          return;
        }
        resolve(response.result);
      });
    });
  }

  const panel = panelModule.createPanel({
    adapterId: adapter.id,
    handlers: {
      connect: () => connect().catch(reportError),
      teach: () => teach().catch(reportError),
      latest: () => useLatest().catch(reportError),
      dispatch: () => dispatchFromPanel().catch(reportError),
      confirmDispatch: () => confirmFromPanel().catch(reportError),
      disconnect: () => disconnect().catch(reportError),
      settings: (values) => saveSettings(values).catch(reportError),
      history: () => loadHistory().catch(reportError),
      historySearch: (query) => searchHistory(query),
      continueProject: (taskId) => startFollowUp(taskId),
      sendFollowUp: () => sendFollowUp().catch(reportError),
      recommendModels: () => recommendFromPanel().catch(reportError),
      selectRecommended: (modelId, executorId) =>
        selectRecommended(modelId, executorId).catch(reportError),
    },
  });

  function reportError(error) {
    panel.open();
    panel.setStatus(error.message, "error");
  }

  async function refreshState() {
    currentState = await message("ACP_STATE");
    panel.setLanguage(currentState.settings?.language ?? "zh");
    panel.setSettings(currentState.settings);
    if (!currentState.connected) {
      panel.setHint(t("hintUnpaired"));
      panel.setStatus(
        currentState.pending
          ? t("pairingCodeWait", { code: formatCode(currentState.pending.code) })
          : t("notPaired"),
      );
      return;
    }
    const options = await message("ACP_OPTIONS");
    currentState.options = options;
    panel.setOptions(options, currentState.settings);
    panel.setHint(t("hintConnected"));
    panel.setStatus(t("connected", { executor: options.default_executor }), "success");
    message("ACP_TASK_LIST", { limit: 20 })
      .then((response) => panel.setTasks(response.tasks ?? []))
      .catch(() => null);
  }

  async function loadHistory(query = "") {
    if (!currentState?.connected) await refreshState();
    if (!currentState?.connected) throw new Error(t("pairBeforeDispatch"));
    const response = await message("ACP_TASK_LIST", { limit: 20, query });
    const tasks = response.tasks ?? [];
    panel.setTasks(tasks);
    panel.open();
    panel.setStatus(t("historyLoaded", { count: tasks.length }), "success");
  }

  let historySearchTimer = null;
  let historySearchQuery = "";

  function searchHistory(query) {
    historySearchQuery = query;
    if (historySearchTimer) clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(() => {
      historySearchTimer = null;
      panel.setHistoryQuery(historySearchQuery);
      loadHistory(historySearchQuery).catch(reportError);
    }, 400);
  }

  let followUpTaskId = null;

  async function recommendFromPanel() {
    if (!currentState?.connected) await refreshState();
    if (!currentState?.connected) throw new Error(t("pairBeforeDispatch"));
    const values = panel.getValues();
    const objective = String(values.objective ?? "").trim();
    if (!objective) throw new Error(t("recommendNeedObjective"));
    const response = await message("ACP_RECOMMEND", {
      objective,
      profile: values.profile || undefined,
      executor: values.executor || undefined,
      model: values.model === "auto" ? undefined : values.model || undefined,
    });
    panel.setRecommendation(response.recommendation ?? null);
    panel.open();
  }

  async function selectRecommended(modelId, executorId) {
    const response = await message("ACP_SETTINGS", {
      patch: { model: modelId, executor: executorId },
    });
    currentState = { ...currentState, settings: response.settings };
    panel.setSettings(currentState.settings);
    panel.setStatus(t("modelSelected", { model: modelId }), "success");
  }

  function startFollowUp(taskId) {
    followUpTaskId = taskId;
    panel.open();
    panel.setFollowUpVisible(true);
    panel.setStatus(t("followUpPrompt"), "normal");
  }

  async function sendFollowUp() {
    if (!followUpTaskId) throw new Error(t("followUpEmpty"));
    const objective = String(panel.getValues().followUp ?? "").trim();
    if (!objective) throw new Error(t("followUpEmpty"));
    const response = await message("ACP_FOLLOW_UP", {
      taskId: followUpTaskId,
      request: { objective },
    });
    followUpTaskId = null;
    panel.setFollowUpVisible(false);
    panel.open();
    panel.setStatus(
      t("followUpQueued", { id: response.task.id.slice(0, 8) }),
      "success",
    );
    await pollTask(response.task.id);
    loadHistory().catch(() => null);
  }

  async function saveSettings(values) {
    const patch = {
      workspace: values.workspace,
      profile: values.profile,
      executor: values.executor,
      model: values.model ?? "",
      reasoning_effort: values.reasoning_effort ?? "auto",
      confirmWords: values.confirmWords,
      autoSubmitResults: values.autoSubmitResults,
      language: values.language,
    };
    const response = await message("ACP_SETTINGS", { patch });
    const languageChanged =
      values.language &&
      values.language !== (currentState?.settings?.language ?? "zh");
    currentState = { ...currentState, settings: response.settings };
    if (languageChanged && currentState.connected) {
      await refreshState().catch(reportError);
    }
  }

  async function connect() {
    const response = await message("ACP_PAIR_START", {
      label: `${adapter.id} on ${location.hostname}`,
    });
    panel.open();
    panel.setStatus(t("approveCode", { code: formatCode(response.code) }));
    const deadline = Date.parse(response.expires_at);
    while (Date.now() < deadline) {
      await delay(1500);
      const pairing = await message("ACP_PAIR_STATUS");
      if (pairing.status === "connected") {
        await refreshState();
        await autoTeach();
        return;
      }
      if (pairing.status === "expired") break;
    }
    throw new Error(t("pairingExpired"));
  }

  async function autoTeach() {
    try {
      await teach();
    } catch (error) {
      panel.setStatus(t("pairedButNoTeach", { message: error.message }), "error");
    }
  }

  async function disconnect() {
    await message("ACP_DISCONNECT");
    currentState = null;
    await refreshState();
    panel.setStatus(t("disconnected"), "normal");
  }

  async function teach() {
    await refreshState();
    const composer = adapters.findComposer(document, adapter);
    if (!composer) throw new Error(t("composerNotFound"));
    adapters.writeComposer(
      composer,
      protocol.controllerPrompt(
        currentState.settings,
        currentState.options?.executors ?? [],
        currentState.options?.models ?? {},
      ),
    );
    panel.setStatus(t("controllerInserted"), "success");
  }

  async function useLatest() {
    const text = adapters.latestAssistantText(document, adapter);
    if (!text) throw new Error(t("assistantReplyNotFound"));
    const envelope = protocol.extractTaskEnvelope(text);
    panel.setObjective(envelope ? JSON.stringify(envelope, null, 2) : text);
    panel.open();
    panel.setStatus(envelope ? t("envelopeLoaded") : t("latestLoaded"), "success");
  }

  async function dispatchFromPanel() {
    const values = panel.getValues();
    const envelope =
      protocol.extractTaskEnvelope(values.objective) ??
      tryJson(values.objective) ??
      { objective: values.objective };
    await dispatchEnvelope(envelope, values);
  }

  async function confirmFromPanel() {
    if (!pendingEnvelope) throw new Error(t("staged"));
    const envelope = pendingEnvelope;
    pendingEnvelope = null;
    panel.setConfirmVisible(false);
    await executeEnvelope(envelope);
  }

  async function dispatchEnvelope(envelope, settings = currentState?.settings) {
    if (!currentState?.connected) await refreshState();
    if (!currentState?.connected) throw new Error(t("pairBeforeDispatch"));
    const resolvedSettings = {
      ...currentState.settings,
      ...settings,
    };
    if (!resolvedSettings.workspace) {
      resolvedSettings.workspace = currentState.options?.workspaces?.[0] ?? "";
    }
    const resolvedEnvelope = { ...envelope };
    if (resolvedEnvelope.executor) {
      resolvedEnvelope.executor = protocol.resolveExecutorAlias(
        resolvedEnvelope.executor,
        currentState.options?.executors ?? [],
      );
    }
    resolvedSettings.executor = protocol.resolveExecutorAlias(
      resolvedSettings.executor,
      currentState.options?.executors ?? [],
    );
    const request = protocol.normalizeDispatch(resolvedEnvelope, resolvedSettings);
    request.idempotency_key =
      "companion:" +
      protocol.stableEnvelopeId({ page_url: location.href, request });
    const response = await message("ACP_DISPATCH", {
      request,
      pageUrl: location.href,
    });
    panel.open();
    const eta = response.task.estimated_minutes;
    panel.setStatus(
      eta != null
        ? t("taskQueuedEta", { id: response.task.id.slice(0, 8), eta })
        : t("taskQueued", { id: response.task.id.slice(0, 8) }),
    );
    await pollTask(response.task.id);
  }

  async function pollTask(taskId) {
    const deadline = Date.now() + 4 * 60 * 60 * 1000;
    let latest = null;
    let tickTimer = null;

    const clearTick = () => {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    };

    const renderTick = () => {
      if (!latest) return;
      const id = latest.id.slice(0, 8);
      const eta = latest.estimated_minutes;
      const session = latest.executor_session_id;
      const baseline = Date.parse(latest.started_at ?? latest.created_at);
      const elapsedMs = Number.isFinite(baseline)
        ? Math.max(0, Date.now() - baseline)
        : 0;
      const elapsed = formatElapsed(elapsedMs);
      const statusKey =
        eta != null
          ? session
            ? "taskStatusSessionEta"
            : "taskStatusEta"
          : session
            ? "taskStatusSession"
            : "taskStatus";
      let text = t(statusKey, {
        id,
        status: latest.status,
        eta,
        session,
        elapsed,
      });
      if (eta != null) {
        const percent = Math.min(
          99,
          Math.round((elapsedMs / (eta * 60 * 1000)) * 100),
        );
        text += ` · ${percent}%`;
        panel.setProgress(percent, true);
      } else {
        panel.setProgress(0, false);
      }
      panel.setStatus(text);
    };

    tickTimer = setInterval(renderTick, 1000);
    try {
      while (Date.now() < deadline) {
        const response = await message("ACP_TASK_STATUS", { taskId });
        latest = response.task;
        renderTick();
        if (latest.terminal) {
          clearTick();
          const id = latest.id.slice(0, 8);
          const result = protocol.formatTaskResult(latest);
          await returnResult(result);
          const minutes = latest.actual_minutes;
          panel.setProgress(0, false);
          panel.setStatus(
            minutes != null
              ? t("taskDoneActual", { id, status: latest.status, minutes })
              : t("taskStatus", { id, status: latest.status }),
            latest.status === "completed" ? "success" : "error",
          );
          message("ACP_TASK_LIST", { limit: 20 })
            .then((response) => panel.setTasks(response.tasks ?? []))
            .catch(() => null);
          return latest;
        }
        await delay(2000);
      }
    } finally {
      clearTick();
    }
    throw new Error(t("monitorTimeout"));
  }

  async function returnResult(text) {
    const composer = adapters.findComposer(document, adapter);
    if (!composer) throw new Error(t("taskFinishedNoComposer"));
    adapters.writeComposer(composer, text);
    if (currentState.settings.autoSubmitResults) {
      await delay(250);
      adapters.submitComposer(document, adapter, composer);
    }
  }

  const DEFAULT_CONFIRM_WORDS = [
    "yes", "y", "ok", "okay", "go", "run", "do it", "send", "execute",
    "confirm", "approve", "执行", "确认", "批准", "同意", "好的", "可以",
    "行", "干", "开始", "开工", "上", "走", "冲", "搞", "跑",
    "派发", "派发吗", "确认派发", "确认执行", "是否派发", "是", "对",
  ];

  function confirmWordsRegex(settings) {
    const extra = String(settings?.confirmWords ?? "")
      .split(/[,，\s]+/)
      .map((word) => word.trim())
      .filter(Boolean);
    const words = [...new Set([...DEFAULT_CONFIRM_WORDS, ...extra])];
    const escaped = words.map((word) =>
      word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    return new RegExp(`^(?:${escaped.join("|")})$`, "i");
  }

  function normalizeConfirmText(text) {
    return String(text ?? "")
      .replace(/[吧啊呀哦哈呢嘛咯]+[!！。.\s]*$/u, "")
      .replace(/[!！。.\s]+$/u, "")
      .trim();
  }

  let pendingEnvelope = null;
  let lastSubmittedText = "";
  let sendCaptureWired = false;

  function wireSendCapture() {
    if (sendCaptureWired) return;
    sendCaptureWired = true;
    const captureFromComposer = () => {
      const composer = adapters.findComposer(document, adapter);
      if (composer) {
        const text = adapters.readComposer(composer).trim();
        if (text) lastSubmittedText = text;
      }
    };
    const button = adapters.findSendButton(document, adapter);
    button?.addEventListener("click", captureFromComposer, true);
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        const composer = adapters.findComposer(document, adapter);
        if (composer && composer.contains(document.activeElement)) {
          captureFromComposer();
        }
      },
      true,
    );
  }

  async function inspectConversation() {
    monitorTimer = null;
    if (!currentState?.connected) return;

    const domUserText = adapters.latestUserText(document, adapter).trim();
    const userText = (domUserText || lastSubmittedText).trim();
    if (userText) {
      const normalized = normalizeConfirmText(userText);
      if (pendingEnvelope && confirmWordsRegex(currentState.settings).test(normalized)) {
        const envelope = pendingEnvelope;
        pendingEnvelope = null;
        await executeEnvelope(envelope).catch(reportError);
        return;
      }
      if (
        pendingEnvelope &&
        !confirmWordsRegex(currentState.settings).test(normalized) &&
        !protocol.extractTaskEnvelope(userText)
      ) {
        panel.open();
        panel.setStatus(t("notConfirmWord"), "error");
      }
    }

    const text = adapters.latestAssistantText(document, adapter);
    const envelope = protocol.extractTaskEnvelope(text);
    if (!envelope) return;
    const id = protocol.stableEnvelopeId(envelope);
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 100) seen.delete(seen.values().next().value);

    pendingEnvelope = envelope;
    panel.setObjective(JSON.stringify(envelope, null, 2));
    panel.setConfirmVisible(true);
    panel.open();
    panel.setStatus(t("staged"), "success");
  }

  async function executeEnvelope(envelope) {
    panel.setConfirmVisible(false);
    const id = protocol.stableEnvelopeId(envelope);
    const claim = await message("ACP_CLAIM_ENVELOPE", {
      pageUrl: location.href,
      envelopeId: id,
    });
    if (!claim.claimed) return;
    try {
      await dispatchEnvelope(envelope);
    } catch (error) {
      await message("ACP_RELEASE_ENVELOPE", {
        pageUrl: location.href,
        envelopeId: id,
      }).catch(() => null);
      panel.setObjective(JSON.stringify(envelope, null, 2));
      throw error;
    }
  }

  const observer = new MutationObserver(() => {
    if (monitorTimer) return;
    monitorTimer = setTimeout(inspectConversation, 800);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  wireSendCapture();

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function formatCode(code) {
    return `${String(code).slice(0, 3)}-${String(code).slice(3)}`;
  }

  function formatElapsed(milliseconds) {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  function tryJson(value) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  await refreshState().catch((error) => {
    panel.setStatus(t("localUnavailable", { message: error.message }), "error");
  });
  if (currentState?.connected) {
    const active = await message("ACP_ACTIVE_TASKS", {
      pageUrl: location.href,
    }).catch(() => ({ task_ids: [] }));
    for (const taskId of active.task_ids) pollTask(taskId).catch(reportError);
  }
  inspectConversation();
})().catch((error) => {
  console.warn("AgentControlPlane companion failed to initialize", error);
});
