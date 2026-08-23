import {
  localReviewText,
  normalizeLocalReviewLanguage,
} from "./i18n.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function option(value, label, selected = false) {
  return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function executorOptions(executors, selected, t) {
  return [
    option("auto", t("autoRecommended"), selected === "auto"),
    ...executors.map((entry) =>
      option(
        entry.id,
        entry.display_name ?? entry.id,
        entry.id === selected,
      ),
    ),
  ].join("");
}

function profileOptions(profiles, selected, t) {
  return [
    option("auto", t("autoRecommended"), selected === "auto"),
    ...profiles.map((entry) => option(entry, entry, entry === selected)),
  ].join("");
}

function modelOptions(models, selected, t) {
  const groups = Object.entries(models ?? {}).map(([executor, entries]) => {
    const rows = entries.map((entry) =>
      option(
        entry.id ?? entry.model,
        entry.display_name ?? entry.id ?? entry.model,
        (entry.id ?? entry.model) === selected,
      ),
    ).join("");
    return rows ? `<optgroup label="${escapeHtml(executor)}">${rows}</optgroup>` : "";
  });
  return [
    option("auto", t("autoRecommended"), selected === "auto"),
    ...groups,
  ].join("");
}

function reasoningOptions(efforts, selected, t) {
  return [
    option("auto", t("autoRecommended"), selected === "auto"),
    ...efforts.map((effort) => option(effort, effort, effort === selected)),
  ].join("");
}

function page(title, body, language = "zh-CN") {
  const lang = normalizeLocalReviewLanguage(language);
  return `<!doctype html>
<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font:16px system-ui;margin:0;background:#0d1117;color:#e6edf3;display:grid;min-height:100vh;place-items:center}.card{width:min(900px,calc(100% - 40px));padding:28px;border:1px solid #30363d;border-radius:14px;background:#161b22}.muted{color:#8b949e;overflow-wrap:anywhere}.objective{white-space:pre-wrap;padding:14px;border-radius:8px;background:#0d1117}label{display:grid;gap:6px;margin:16px 0}select,input{font:inherit;padding:9px;border:1px solid #484f58;border-radius:7px;background:#0d1117;color:#e6edf3}button{font:600 16px system-ui;padding:11px 18px;border:0;border-radius:8px;background:#238636;color:white;cursor:pointer}button:disabled{background:#484f58;cursor:not-allowed}button.secondary{background:#30363d}button.danger{background:#b62324}.ok{color:#3fb950}.warn{color:#d29922}.error{color:#f85149}.project{border:1px solid #30363d;border-radius:10px;padding:16px;margin-top:12px}.project-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.actions form{margin:0}.actions button{padding:8px 12px}.inline{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.inline label{flex:1;min-width:220px;margin:8px 0}.inline button{margin:8px 0}.roots{font-family:ui-monospace,monospace;font-size:13px}.advanced{margin-top:18px;border-top:1px solid #30363d;padding-top:16px}.advanced>summary{cursor:pointer;font-weight:650}.advanced-body{padding:8px 0 0}.count{display:inline-block;min-width:1.5em;text-align:center;border-radius:999px;background:#30363d;padding:2px 7px}.language{display:flex;justify-content:flex-end;align-items:center;gap:9px;margin:0 0 18px}.language label{display:flex;align-items:center;gap:9px;margin:0}.language select{min-width:140px}</style></head>
<body><main class="card">${body}</main></body></html>`;
}

export function reviewPage({ candidate, approvalSecret, options, settings = {} }) {
  const language = normalizeLocalReviewLanguage(settings.language);
  const t = (key, values) => localReviewText(language, key, values);
  const workspaceEntries = options.workspaceEntries ?? (options.workspaces ?? []).map((entry) => ({ value: entry, label: entry }));
  const workspaces = workspaceEntries.map((entry) => entry.value);
  const executors = (options.executors ?? []).filter((entry) => entry.ready !== false);
  const profiles = options.profiles ?? [];
  const canDispatch = workspaces.length > 0 && executors.length > 0 && profiles.length > 0;
  const constraints = candidate.constraints.length
    ? `<ul>${candidate.constraints.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`
    : `<p class="muted">${escapeHtml(t("noConstraints"))}</p>`;
  const requestedExecution = candidate.execution
    ? `<h2>${escapeHtml(t("executionChoices"))}</h2><ul>${Object.entries(candidate.execution)
        .map(([key, value]) => `<li>${escapeHtml(key)}: ${escapeHtml(value)}</li>`)
        .join("")}</ul><p class="muted">${escapeHtml(t("executionValidationHint"))}</p>`
    : `<p class="muted">${escapeHtml(t("executionDefaultsHint"))}</p>`;
  const form = canDispatch
    ? `<form method="post" action="/local-review/confirm" autocomplete="off">
<input type="hidden" name="id" value="${escapeHtml(candidate.id)}">
<input type="hidden" name="approval_secret" value="${escapeHtml(approvalSecret)}">
<label>${escapeHtml(t("workspace"))}<select name="workspace" required>${workspaceEntries.map((entry, index) => option(entry.value, entry.label, index === 0)).join("")}</select></label>
<label>${escapeHtml(t("executor"))}<select name="executor" required>${executorOptions(executors, settings.executor ?? "auto", t)}</select></label>
<label>${escapeHtml(t("profile"))}<select name="profile" required>${profileOptions(profiles, settings.profile ?? "auto", t)}</select></label>
<label>${escapeHtml(t("model"))}<select name="model" required>${modelOptions(options.models, settings.model ?? "auto", t)}</select></label>
<label>${escapeHtml(t("reasoning"))}<select name="reasoning_effort" required>${reasoningOptions(options.reasoningEfforts ?? [], settings.reasoning_effort ?? "auto", t)}</select></label>
<button type="submit">${escapeHtml(t("confirmDispatch"))}</button>
</form>`
    : `<p class="error">${escapeHtml(t("noDispatchOptions"))}</p>`;
  return page(
    t("reviewCandidate"),
    `<p><a href="/local-review/settings">${escapeHtml(t("dispatchSettings"))}</a></p>
<h1>${escapeHtml(t("reviewCandidate"))}</h1>
<p>${escapeHtml(t("reviewSource", { origin: candidate.page_origin }))}</p>
<h2>${escapeHtml(t("objective"))}</h2><div class="objective">${escapeHtml(candidate.objective)}</div>
<h2>${escapeHtml(t("constraints"))}</h2>${constraints}
${requestedExecution}
<p class="muted">${escapeHtml(t("candidateExpiry", { expiresAt: candidate.expires_at }))}</p>${form}`,
    language,
  );
}

export function settingsPage({
  settings,
  formSecret,
  options,
  saved = false,
  projectNotice = null,
}) {
  const language = normalizeLocalReviewLanguage(settings.language);
  const t = (key, values) => localReviewText(language, key, values);
  const workspaceEntries = options.workspaceEntries ?? (options.workspaces ?? []).map((entry) => ({ value: entry, label: entry }));
  const workspaces = workspaceEntries.map((entry) => entry.value);
  const executors = (options.executors ?? []).filter((entry) => entry.ready !== false);
  const profiles = options.profiles ?? [];
  const canSave = workspaces.length > 0 && executors.length > 0 && profiles.length > 0;
  const savedNotice = saved ? `<p class="ok">${escapeHtml(t("settingsSaved"))}</p>` : "";
  const projectMessage = projectNotice
    ? `<p class="ok">${escapeHtml(projectNotice)}</p>`
    : "";
  const missingNotice = settings.workspaceStatus !== "available"
    ? `<p class="warn">${escapeHtml(t("missingProject"))}</p>`
    : "";
  const form = canSave
    ? `<form method="post" action="/local-review/settings" autocomplete="off">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}">
<div class="language"><label>${escapeHtml(t("language"))}<select name="language">${option("zh-CN", t("chinese"), language === "zh-CN")}${option("en", t("english"), language === "en")}</select></label></div>
<label>${escapeHtml(t("defaultWorkspace"))}<select name="workspace" required>${workspaceEntries.map((entry) => option(entry.value, entry.label, entry.value === settings.workspace)).join("")}</select></label>
<label>${escapeHtml(t("defaultExecutor"))}<select name="executor" required>${executorOptions(executors, settings.executor, t)}</select></label>
<label>${escapeHtml(t("defaultProfile"))}<select name="profile" required>${profileOptions(profiles, settings.profile, t)}</select></label>
<label>${escapeHtml(t("defaultModel"))}<select name="model" required>${modelOptions(options.models, settings.model, t)}</select></label>
<label>${escapeHtml(t("defaultReasoning"))}<select name="reasoning_effort" required>${reasoningOptions(options.reasoningEfforts ?? [], settings.reasoning_effort, t)}</select></label>
<p class="muted">${escapeHtml(t("autoHint"))}</p>
<label><span><input type="checkbox" name="auto_dispatch"${settings.autoDispatch ? " checked" : ""}> ${escapeHtml(t("autoDispatch"))}</span></label>
<label><span><input type="checkbox" name="return_result_to_chat"${settings.returnResultToChat ? " checked" : ""}> ${escapeHtml(t("returnResult"))}</span></label>
<button type="submit">${escapeHtml(t("saveSettings"))}</button>
</form>`
    : `<p class="error">${escapeHtml(t("noCompleteOptions"))}</p>`;
  const roots = options.discoveryRoots ?? [];
  const projects = options.projects ?? [];
  const availableProjects = projects.filter((project) => project.status === "available");
  const unavailableProjects = projects.filter((project) => project.status !== "available");
  const availableRows = availableProjects.map((project) => `
<section class="project">
<div class="project-head"><div><strong>${escapeHtml(project.name)}</strong> <span class="ok">${escapeHtml(t("available"))}</span>${project.category === "未分类" ? "" : ` <span class="muted">${escapeHtml(project.category)}</span>`}</div>
<div class="actions">${settings.workspace === project.id
    ? `<span class="ok">${escapeHtml(t("currentDefault"))}</span>`
    : `<form method="post" action="/local-review/projects"><input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="set_default"><input type="hidden" name="project_id" value="${escapeHtml(project.id)}"><button type="submit">${escapeHtml(t("setDefault"))}</button></form>`}</div></div>
</section>`).join("");
  const unavailableRows = unavailableProjects.map((project) => {
    const candidateCount = Number(project.relink_candidate_count ?? 0);
    const statusText = candidateCount === 1
      ? t("oneNewLocation")
      : candidateCount > 1
        ? t("manyNewLocations", { count: candidateCount })
        : t("noOriginalLocation");
    return `<section class="project">
<div class="project-head"><div><strong>${escapeHtml(project.name)}</strong> <span class="warn">${escapeHtml(statusText)}</span></div>
<div class="actions">
${candidateCount === 1 ? `<form method="post" action="/local-review/projects"><input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="relink_suggested"><input type="hidden" name="project_id" value="${escapeHtml(project.id)}"><button type="submit">${escapeHtml(t("confirmNewLocation"))}</button></form>` : ""}
<form method="post" action="/local-review/projects"><input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="remove"><input type="hidden" name="project_id" value="${escapeHtml(project.id)}"><button class="danger" type="submit">${escapeHtml(t("removeRecord"))}</button></form>
</div></div>
<details><summary>${escapeHtml(t("enterNewLocation"))}</summary><form class="inline" method="post" action="/local-review/projects" autocomplete="off">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="relink"><input type="hidden" name="project_id" value="${escapeHtml(project.id)}">
<label>${escapeHtml(t("projectFolderPath"))}<input name="path" placeholder="D:\\Development\\Project" required></label><button type="submit">${escapeHtml(t("relink"))}</button>
</form></details>
</section>`;
  }).join("");
  const advancedProjectRows = projects.map((project) => `<section class="project">
<strong>${escapeHtml(project.alias)}</strong>
<form class="inline" method="post" action="/local-review/projects" autocomplete="off">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="update_category"><input type="hidden" name="project_id" value="${escapeHtml(project.id)}">
<label>${escapeHtml(t("category"))}<input name="category" maxlength="64" value="${escapeHtml(project.category)}" required></label><button class="secondary" type="submit">${escapeHtml(t("updateCategory"))}</button>
</form></section>`).join("");
  const projectLibrary = `<h2>${escapeHtml(t("projectLibrary"))}</h2>
<p>${escapeHtml(t("projectLibraryDescription"))}</p>
<form class="inline" method="post" action="/local-review/projects" autocomplete="off">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}">
<input type="hidden" name="action" value="add_project">
<label>${escapeHtml(t("projectFolderPath"))}<input name="path" placeholder="D:\\Development\\Project" required></label>
<button type="submit">${escapeHtml(t("addProject"))}</button>
</form>
<h3>${escapeHtml(t("availableProjects"))}</h3>${availableRows || `<p class="muted">${escapeHtml(t("noAvailableProjects"))}</p>`}
${unavailableProjects.length ? `<details class="advanced"><summary>${escapeHtml(t("projectsNeedAttention"))} <span class="count">${unavailableProjects.length}</span></summary><div class="advanced-body">${unavailableRows}</div></details>` : ""}
<details class="advanced"><summary>${escapeHtml(t("projectTools"))}</summary><div class="advanced-body">
<p class="muted">${escapeHtml(t("projectToolsHint"))}</p>
<div class="roots">${roots.length ? roots.map((root) => `<div>${escapeHtml(root)}</div>`).join("") : `<span class="muted">${escapeHtml(t("noDiscoveryRoots"))}</span>`}</div>
<form class="inline" method="post" action="/local-review/projects" autocomplete="off">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="add_root">
<label>${escapeHtml(t("scanRoot"))}<input name="path" placeholder="D:\\Development" required></label><button class="secondary" type="submit">${escapeHtml(t("addAndScan"))}</button>
</form><form method="post" action="/local-review/projects">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}">
<input type="hidden" name="action" value="scan">
<button class="secondary" type="submit">${escapeHtml(t("rescanProjects"))}</button>
</form>
<h3>${escapeHtml(t("projectCategories"))}</h3>${advancedProjectRows || `<p class="muted">${escapeHtml(t("noProjectsForCategory"))}</p>`}</div></details>`;
  return page(
    t("settingsTitle"),
    `${savedNotice}${projectMessage}${missingNotice}<h1>${escapeHtml(t("settingsHeading"))}</h1>
<p>${escapeHtml(t("settingsIntro"))}</p>
<p class="muted">${escapeHtml(t("safeResultHint"))}</p>${form}${projectLibrary}`,
    language,
  );
}

export function dispatchedPage({ candidate, task }, { language = "zh-CN" } = {}) {
  const normalizedLanguage = normalizeLocalReviewLanguage(language);
  const t = (key, values) => localReviewText(normalizedLanguage, key, values);
  return page(
    `AgentControlPlane ${t("dispatchedTitle")}`,
    `<h1 class="ok">${escapeHtml(t("dispatchedTitle"))}</h1><p>${escapeHtml(t("taskId"))}: <code>${escapeHtml(task.id)}</code></p><p>${escapeHtml(t("status"))}: ${escapeHtml(task.status)}</p><p class="muted">${escapeHtml(t("candidateConsumed", { candidateId: candidate.id }))}</p>`,
    normalizedLanguage,
  );
}

export function reviewErrorPage(error, {
  projectAction = false,
  language = "zh-CN",
} = {}) {
  const normalizedLanguage = normalizeLocalReviewLanguage(language);
  const t = (key) => localReviewText(normalizedLanguage, key);
  if (projectAction) {
    return page(
      `AgentControlPlane ${t("projectActionFailed")}`,
      `<h1 class="error">${escapeHtml(t("projectActionFailed"))}</h1><p>${escapeHtml(error?.message ?? "Unknown error")}</p><p><a href="/local-review/settings">${escapeHtml(t("backToProjectLibrary"))}</a></p>`,
      normalizedLanguage,
    );
  }
  return page(
    `AgentControlPlane ${t("reviewFailed")}`,
    `<h1 class="error">${escapeHtml(t("reviewFailed"))}</h1><p>${escapeHtml(error?.message ?? "Unknown error")}</p><p class="muted">${escapeHtml(t("closeAndRetry"))}</p>`,
    normalizedLanguage,
  );
}
