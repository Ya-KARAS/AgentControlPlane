import { makeT } from "./i18n.js";

export function createPanel({ adapterId, handlers, language = "zh" }) {
  let lang = language === "en" ? "en" : "zh";
  let t = makeT(lang);
  let currentStatus = { text: t("checking"), kind: "normal" };
  let currentHint = t("hintUnpaired");
  let currentOptions = null;
  let currentSettings = null;
  let currentObjective = "";

  const host = document.createElement("div");
  host.id = "agent-control-plane-companion";
  host.style.cssText = "all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  document.documentElement.append(host);

  let fields = {};
  let panel = null;
  let status = null;
  let hint = null;
  let badge = null;
  let confirmButton = null;
  let progressBar = null;
  let progressFill = null;
  let progressPercent = 0;
  let tasksBox = null;
  let followUpBlock = null;
  let currentTasks = [];
  let continueTaskId = null;
  let versionEl = null;
  let currentVersion = "";
  let currentHistoryQuery = "";
  let recommendationBox = null;
  let currentRecommendation = null;

  function render() {
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box}button,input,select,textarea{font:inherit}.launcher{width:52px;height:52px;border:0;border-radius:50%;background:#238636;color:white;font:700 14px system-ui;box-shadow:0 5px 18px #0006;cursor:pointer}.panel{display:none;width:min(390px,calc(100vw - 36px));max-height:min(680px,calc(100vh - 96px));overflow:auto;margin-bottom:10px;padding:16px;border:1px solid #30363d;border-radius:14px;background:#0d1117;color:#e6edf3;font:14px system-ui;box-shadow:0 12px 36px #0008}.panel.open{display:block}.row{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:9px 0}.stack{display:grid;gap:6px;margin:9px 0}label{color:#8b949e;font-size:12px}input,select,textarea{width:100%;padding:8px;border:1px solid #30363d;border-radius:7px;background:#161b22;color:#e6edf3}textarea{min-height:86px;resize:vertical}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.actions button{padding:8px 10px;border:1px solid #30363d;border-radius:7px;background:#21262d;color:#e6edf3;cursor:pointer}.actions .primary{background:#238636;border-color:#238636}.status{padding:8px;border-radius:7px;background:#161b22;color:#8b949e;overflow-wrap:anywhere}.progress{display:none;height:5px;margin:6px 2px 2px;border-radius:4px;background:#161b22;overflow:hidden}.progress .fill{height:100%;background:#3fb950;transition:width .4s linear}.hint{padding:8px;border-radius:7px;background:#161b22;color:#8b949e;font-size:12px;line-height:1.8}.advanced{margin:9px 0}.advanced summary{cursor:pointer;color:#58a6ff;font-size:13px}.toggle{display:flex;align-items:center;gap:7px;color:#c9d1d9}.toggle input{width:auto}.title{display:flex;justify-content:space-between;align-items:center;gap:8px}.title select{width:auto;padding:4px 6px;font-size:12px}.badge{font:12px ui-monospace;color:#58a6ff}.version{font:12px ui-monospace;color:#8b949e}.tasks{display:grid;gap:7px;margin:9px 0}.task-row{padding:9px;border:1px solid #30363d;border-radius:8px;background:#161b22}.task-line1{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:12px;color:#8b949e}.task-line2{overflow-wrap:anywhere;margin-top:4px;color:#c9d1d9;font-size:13px}.task-line3{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:5px;font-size:12px;color:#8b949e}.task-line3 button{padding:3px 9px;border:1px solid #30363d;border-radius:6px;background:#21262d;color:#e6edf3;cursor:pointer}.task-line3 .primary{border-color:#238636;background:#238636}.ts{color:#8b949e}.ts.running{color:#58a6ff}.ts.completed{color:#3fb950}.ts.partial,.ts.blocked{color:#d29922}.ts.failed,.ts.interrupted{color:#f85149}
      </style>
      <section class="panel">
        <div class="title"><strong>AgentControlPlane</strong><span class="badge"></span><span class="version"></span><select data-field="language"><option value="zh">中文</option><option value="en">English</option></select></div>
        <div class="status"></div>
        <div class="progress"><div class="fill"></div></div>
        <p class="hint"></p>
        <div class="actions"><button class="primary" data-action="confirmDispatch" hidden>${t("confirmDispatch")}</button></div>
        <div class="actions"><button class="primary" data-action="connect">${t("pair")}</button><button data-action="teach">${t("teach")}</button><button data-action="dispatch">${t("dispatch")}</button></div>
        <details class="advanced"><summary>${t("advancedSummary")}</summary>
          <p class="hint">${t("defaultsHint")}</p>
          <div class="actions"><button data-action="latest">${t("useLatest")}</button><button data-action="disconnect">${t("disconnect")}</button></div>
          <div class="stack"><label>${t("workspaceLabel")}</label><select data-field="workspace"><option value="">${t("selectAfterPairing")}</option></select></div>
          <div class="row"><div><label>${t("profileLabel")}</label><select data-field="profile"><option value="auto">${t("profileAuto")}</option><option value="economy">${t("profileEconomy")}</option><option value="balanced">${t("profileBalanced")}</option><option value="deep">${t("profileDeep")}</option></select></div><div><label>${t("executorLabel")}</label><select data-field="executor"><option value="auto">${t("executorAuto")}</option></select></div></div>
          <div class="row"><div><label>${t("modelLabel")}</label><select data-field="model"><option value="auto">${t("modelAuto")}</option></select></div><div><label>${t("reasoningLabel")}</label><select data-field="reasoning_effort"><option value="auto">${t("reasoningAuto")}</option></select></div></div>
          <div class="actions"><button data-action="recommendModels">${t("recommendModelsButton")}</button></div>
          <div class="recommendation"></div>
          <div class="stack"><label>${t("objectiveLabel")}</label><textarea data-field="objective" placeholder="${t("objectivePlaceholder")}"></textarea></div>
          <div class="stack"><label>${t("confirmLabel")}</label><input data-field="confirmWords" placeholder="${t("confirmPlaceholder")}"></div>
          <label class="toggle"><input type="checkbox" data-field="autoSubmitResults"> ${t("autoSubmitLabel")}</label>
        </details>
        <details class="advanced"><summary>${t("historySummary")}</summary>
          <p class="hint">${t("historyHint")}</p>
          <div class="actions"><button data-action="history">${t("historyRefresh")}</button></div>
          <input type="text" data-field="historyQuery" placeholder="${t("historySearch")}">
          <div class="tasks"></div>
          <div class="stack followup" hidden>
            <label>${t("followUpLabel")}</label>
            <textarea data-field="followUp" placeholder="${t("followUpPlaceholder")}"></textarea>
            <div class="actions"><button class="primary" data-action="sendFollowUp">${t("sendFollowUp")}</button></div>
          </div>
        </details>
      </section>
      <button class="launcher" title="${t("launcherTitle")}">ACP</button>`;

    panel = shadow.querySelector(".panel");
    status = shadow.querySelector(".status");
    hint = shadow.querySelector(".hint");
    badge = shadow.querySelector(".badge");
    confirmButton = shadow.querySelector('[data-action="confirmDispatch"]');
    progressBar = shadow.querySelector(".progress");
    progressFill = shadow.querySelector(".progress .fill");
    tasksBox = shadow.querySelector(".tasks");
    followUpBlock = shadow.querySelector(".followup");
    versionEl = shadow.querySelector(".version");
    recommendationBox = shadow.querySelector(".recommendation");
    fields = Object.fromEntries(
      [...shadow.querySelectorAll("[data-field]")].map((element) => [
        element.dataset.field,
        element,
      ]),
    );
    badge.textContent = adapterId;

    shadow.querySelector(".launcher").addEventListener("click", () => {
      panel.classList.toggle("open");
    });
    for (const button of shadow.querySelectorAll("[data-action]")) {
      button.addEventListener("click", () => handlers[button.dataset.action]?.());
    }
    if (fields.executor && fields.model) {
      fields.executor.addEventListener("change", () => {
        if (currentOptions) {
          refreshModelOptions(currentOptions);
          refreshReasoningOptions(currentOptions);
        }
      });
      fields.model.addEventListener("change", () => {
        if (currentOptions) refreshReasoningOptions(currentOptions);
      });
    }
    for (const name of ["workspace", "profile", "executor", "model", "reasoning_effort", "confirmWords", "autoSubmitResults"]) {
      fields[name].addEventListener("change", () => handlers.settings?.(getValues()));
    }
    if (fields.historyQuery) {
      fields.historyQuery.addEventListener("input", () =>
        handlers.historySearch?.(fields.historyQuery.value.trim()),
      );
    }
    fields.language.addEventListener("change", () => {
      setLanguage(fields.language.value);
      handlers.settings?.({ language: lang });
    });

    status.textContent = currentStatus.text;
    status.style.color =
      currentStatus.kind === "error"
        ? "#f85149"
        : currentStatus.kind === "success"
          ? "#3fb950"
          : "#8b949e";
    hint.innerHTML = currentHint;
    if (currentOptions) applyOptions(currentOptions, currentSettings);
    else applySettings(currentSettings);
    fields.objective.value = currentObjective;
    if (fields.historyQuery) fields.historyQuery.value = currentHistoryQuery;
    if (versionEl) versionEl.textContent = currentVersion ? `v${currentVersion}` : "";
    renderTasks();
    renderRecommendation();
    if (continueTaskId && followUpBlock) followUpBlock.hidden = false;
  }

  function getValues() {
    return {
      workspace: fields.workspace.value,
      profile: fields.profile.value,
      executor: fields.executor.value,
      model: fields.model ? fields.model.value : "auto",
      reasoning_effort: fields.reasoning_effort
        ? fields.reasoning_effort.value
        : "auto",
      confirmWords: fields.confirmWords.value,
      autoSubmitResults: fields.autoSubmitResults.checked,
      language: lang,
      objective: fields.objective.value,
      followUp: fields.followUp ? fields.followUp.value : "",
    };
  }

  function renderRecommendation() {
    if (!recommendationBox) return;
    const recommendation = currentRecommendation;
    if (!recommendation) {
      recommendationBox.innerHTML = "";
      return;
    }
    const usd6 = (microusd) =>
      microusd == null ? null : (microusd / 1e6).toFixed(6);
    const strategyRows = Object.entries({
      cheapest: t("strategyCheapest"),
      balanced: t("strategyBalanced"),
      best: t("strategyBest"),
    })
      .map(([key, label]) => {
        const entry = recommendation.strategies?.[key];
        if (!entry) {
          return `<div class="task-row"><div class="task-line1"><span class="ts completed">${escapeText(label)}</span></div><div class="task-line2">—</div></div>`;
        }
        const range = entry.estimated_cost_range;
        const cost = range
          ? `est $${usd6(range.low_microusd)}–$${usd6(range.high_microusd)} ${range.currency}`
          : t("recCostUnknown");
        return `<div class="task-row" data-rec-model="${escapeAttribute(entry.model)}" data-rec-executor="${escapeAttribute(entry.executor)}">
          <div class="task-line1"><span class="ts completed">${escapeText(label)}</span><span>${escapeText(cost)}</span></div>
          <div class="task-line2">${escapeText(entry.model)}</div>
          <div class="task-line3"><span>${escapeText(entry.executor)}</span></div>
        </div>`;
      })
      .join("");
    const rows = (recommendation.ranked ?? [])
      .map((entry) => {
        const range = entry.estimated_cost_range;
        const cost = range
          ? `est $${usd6(range.low_microusd)}–$${usd6(range.high_microusd)} ${range.currency}`
          : t("recCostUnknown");
        const warnings = entry.warnings?.length
          ? ` · ${t("recWarnings", { count: entry.warnings.length })}`
          : "";
        return `<div class="task-row" data-rec-model="${escapeAttribute(entry.model)}" data-rec-executor="${escapeAttribute(entry.executor)}">
          <div class="task-line1"><span class="ts completed">${escapeText(t("recScore", { score: entry.score }))}</span><span>${escapeText(cost)}</span>${escapeText(warnings)}</div>
          <div class="task-line2">${escapeText(entry.model)}</div>
          <div class="task-line3"><span>${escapeText(entry.executor)}</span></div>
        </div>`;
      })
      .join("");
    const excluded =
      recommendation.excluded?.length > 0
        ? `<div class="task-line3">${escapeText(t("recExcludedCount", { count: recommendation.excluded.length }))}</div>`
        : "";
    recommendationBox.innerHTML =
      `<p class="hint">${t("recSelectHint")}</p>` + strategyRows + rows + excluded;
    for (const row of recommendationBox.querySelectorAll("[data-rec-model]")) {
      row.addEventListener("click", () => {
        handlers.selectRecommended?.(
          row.dataset.recModel,
          row.dataset.recExecutor,
        );
      });
    }
  }

  function renderTasks() {
    if (!tasksBox) return;
    if (!currentTasks.length) {
      tasksBox.innerHTML = `<div class="hint">${t("historyEmpty")}</div>`;
      return;
    }
    tasksBox.innerHTML = currentTasks
      .map((task) => {
        const statusKey = `status${task.status.charAt(0).toUpperCase()}${task.status.slice(1)}`;
        const statusLabel = t(statusKey);
        const created = new Date(task.created_at);
        const time = [created.getHours(), created.getMinutes()]
          .map((value) => String(value).padStart(2, "0"))
          .join(":");
        const minutes =
          task.actual_minutes != null
            ? t("historyMinutes", { minutes: task.actual_minutes })
            : "";
        const usage = task.usage ?? {};
        const tokens =
          usage.total_tokens != null
            ? t("historyTokens", {
                "in": (usage.input_tokens ?? 0).toLocaleString(),
                out: (usage.output_tokens ?? 0).toLocaleString(),
              })
            : "";
        const summary =
          (task.result && task.result.summary) || task.objective || task.id;
        const meta = [task.executor, task.model, task.profile]
          .filter(Boolean)
          .join(" · ");
        const continueButton = task.terminal
          ? `<button class="primary" data-continue="${escapeAttribute(task.id)}">${t("continueProject")}</button>`
          : "";
        return `<div class="task-row">
          <div class="task-line1"><span class="ts ${escapeAttribute(task.status)}">${escapeText(statusLabel)}</span><span>${time}</span><span>${escapeText(task.id.slice(0, 8))}</span><span>${escapeText(minutes)}</span></div>
          <div class="task-line2">${escapeText(summary)}</div>
          <div class="task-line3"><span>${escapeText(meta)}</span><span>${escapeText(tokens)}</span>${continueButton}</div>
        </div>`;
      })
      .join("");
    for (const button of tasksBox.querySelectorAll("[data-continue]")) {
      button.addEventListener("click", () => {
        continueTaskId = button.dataset.continue;
        if (followUpBlock) followUpBlock.hidden = false;
        handlers.continueProject?.(continueTaskId);
      });
    }
  }

  function modelsForExecutor(options, executorValue) {
    if (executorValue !== "auto") return options?.models?.[executorValue] ?? [];
    return Object.entries(options?.models ?? {}).flatMap(([executorId, entries]) =>
      entries.map((entry) => ({ ...entry, executorId })),
    );
  }

  function refreshModelOptions(options) {
    const executorValue = fields.executor.value;
    const list = modelsForExecutor(options, executorValue);
    const previous = fields.model.value;
    fields.model.innerHTML = [
      `<option value="auto">${t("modelAuto")}</option>`,
      ...list.map((entry) => {
        const id = entry.id ?? entry.model;
        const label = entry.executorId ? `${id} · ${entry.executorId}` : id;
        return `<option value="${escapeAttribute(id)}">${escapeText(label)}</option>`;
      }),
    ].join("");
    if (previous && list.some((entry) => (entry.id ?? entry.model) === previous)) {
      fields.model.value = previous;
    } else {
      fields.model.value = "auto";
    }
  }

  function refreshReasoningOptions(options) {
    if (!fields.reasoning_effort) return;
    const executorValue = fields.executor.value;
    const modelValue = fields.model.value;
    const models = modelsForExecutor(options, executorValue);
    const selectedModel = models.find(
      (entry) => (entry.id ?? entry.model) === modelValue,
    );
    const efforts = selectedModel
      ? selectedModel.supported_reasoning_efforts ?? []
      : [...new Set(models.flatMap((entry) => entry.supported_reasoning_efforts ?? []))];
    const previous = fields.reasoning_effort.value;
    fields.reasoning_effort.innerHTML = [
      `<option value="auto">${t("reasoningAuto")}</option>`,
      ...efforts.map(
        (effort) =>
          `<option value="${escapeAttribute(effort)}">${escapeText(effort)}</option>`,
      ),
    ].join("");
    fields.reasoning_effort.value = efforts.includes(previous)
      ? previous
      : "auto";
  }

  function applySettings(settings) {
    currentSettings = settings;
    if (!fields.workspace) return;
    for (const name of ["workspace", "profile", "executor", "confirmWords"]) {
      if (settings?.[name] != null) fields[name].value = settings[name];
    }
    fields.language.value = lang;
    fields.autoSubmitResults.checked = Boolean(settings?.autoSubmitResults);
    refreshModelOptions(currentOptions);
    if (fields.model) {
      const modelList = modelsForExecutor(currentOptions, fields.executor.value);
      const model = settings?.model || "auto";
      if (
        model === "auto" ||
        modelList.some((entry) => (entry.id ?? entry.model) === model)
      ) {
        fields.model.value = model;
      }
    }
    refreshReasoningOptions(currentOptions);
    if (fields.reasoning_effort) {
      const effort = settings?.reasoning_effort || "auto";
      if ([...fields.reasoning_effort.options].some((entry) => entry.value === effort)) {
        fields.reasoning_effort.value = effort;
      }
    }
  }

  function applyOptions(options, settings) {
    currentOptions = options;
    currentSettings = settings;
    if (options?.version) currentVersion = String(options.version);
    if (versionEl) versionEl.textContent = currentVersion ? `v${currentVersion}` : "";
    const workspaces = options?.workspaces ?? [];
    fields.workspace.innerHTML = workspaces
      .map(
        (value) =>
          `<option value="${escapeAttribute(value)}">${escapeText(value)}</option>`,
      )
      .join("");
    fields.profile.innerHTML = [
      `<option value="auto">${t("profileAuto")}</option>`,
      ...Object.keys(options?.profiles ?? {})
      .map(
        (value) =>
          `<option value="${escapeAttribute(value)}">${escapeText(t(`profile${value[0].toUpperCase()}${value.slice(1)}`) ?? value)}</option>`,
      ),
    ].join("");
    const executors = options?.executors ?? [];
    const ENDPOINT_IDS = new Set(["openai-compatible", "deepseek"]);
    const isEndpoint = (entry) =>
      entry.kind === "model-endpoint" || ENDPOINT_IDS.has(entry.id);
    const optionFor = (entry, disabled = false) => {
      const label =
        (entry.display_name ?? entry.id) +
        (entry.official ? ` · ${t("officialTag")}` : "");
      return disabled
        ? `<option value="${escapeAttribute(entry.id)}" disabled>${escapeText(label)}（${t("executorUnavailable")}）</option>`
        : `<option value="${escapeAttribute(entry.id)}">${escapeText(label)}</option>`;
    };
    const group = (ids) =>
      executors
        .filter((entry) => ids.has(entry.id))
        .flatMap((entry) => [
          optionFor(entry, entry.discovery?.available === false),
        ]);
    fields.executor.innerHTML = [
      `<option value="auto">${t("executorAuto")}</option>`,
      `<optgroup label="${t("executorGroupAgents")}">`,
      ...group(
        new Set(
          executors
            .filter((entry) => !isEndpoint(entry))
            .map((entry) => entry.id),
        ),
      ),
      `</optgroup>`,
      `<optgroup label="${t("executorGroupEndpoints")}">`,
      ...group(
        new Set(executors.filter((entry) => isEndpoint(entry)).map((entry) => entry.id)),
      ),
      `</optgroup>`,
    ].join("");
    refreshModelOptions(options);
    refreshReasoningOptions(options);
    applySettings(settings);
  }

  function setLanguage(next) {
    const resolved = next === "en" ? "en" : "zh";
    if (resolved === lang) return;
    lang = resolved;
    t = makeT(lang);
    render();
  }

  render();

  return {
    getValues,
    setSettings(settings) {
      applySettings(settings);
    },
    setOptions(options, settings) {
      applyOptions(options, settings);
    },
    setLanguage,
    setObjective(value) {
      currentObjective = value ?? "";
      if (fields.objective) fields.objective.value = currentObjective;
    },
    setStatus(value, kind = "normal") {
      currentStatus = { text: value, kind };
      if (!status) return;
      status.textContent = value;
      status.style.color =
        kind === "error" ? "#f85149" : kind === "success" ? "#3fb950" : "#8b949e";
    },
    setHint(html) {
      currentHint = html;
      if (hint) hint.innerHTML = html;
    },
    setConfirmVisible(visible) {
      if (confirmButton) confirmButton.hidden = !visible;
    },
    setProgress(percent, visible) {
      progressPercent = Math.max(0, Math.min(100, Math.round(percent)));
      if (progressFill) {
        progressFill.style.width = `${progressPercent}%`;
      }
      if (progressBar) {
        progressBar.style.display = visible ? "block" : "none";
      }
    },
    setTasks(tasks) {
      currentTasks = tasks ?? [];
      renderTasks();
    },
    setHistoryQuery(value) {
      currentHistoryQuery = value ?? "";
      if (fields.historyQuery) fields.historyQuery.value = currentHistoryQuery;
    },
    setRecommendation(recommendation) {
      currentRecommendation = recommendation ?? null;
      renderRecommendation();
    },
    setFollowUpVisible(visible) {
      if (followUpBlock) followUpBlock.hidden = !visible;
    },
    open() {
      panel?.classList.add("open");
    },
  };
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}
