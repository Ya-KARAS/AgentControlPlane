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

function executorOptions(executors, selected) {
  return [
    option("auto", "自动 · 网页 AI 推荐（本机校验）", selected === "auto"),
    ...executors.map((entry) =>
      option(
        entry.id,
        entry.display_name ?? entry.id,
        entry.id === selected,
      ),
    ),
  ].join("");
}

function profileOptions(profiles, selected) {
  return [
    option("auto", "自动 · 网页 AI 推荐（本机校验）", selected === "auto"),
    ...profiles.map((entry) => option(entry, entry, entry === selected)),
  ].join("");
}

function modelOptions(models, selected) {
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
    option("auto", "自动 · 网页 AI 推荐（本机校验）", selected === "auto"),
    ...groups,
  ].join("");
}

function reasoningOptions(efforts, selected) {
  return [
    option("auto", "自动 · 网页 AI 推荐（本机校验）", selected === "auto"),
    ...efforts.map((effort) => option(effort, effort, effort === selected)),
  ].join("");
}

function page(title, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font:16px system-ui;margin:0;background:#0d1117;color:#e6edf3;display:grid;min-height:100vh;place-items:center}.card{width:min(900px,calc(100% - 40px));padding:28px;border:1px solid #30363d;border-radius:14px;background:#161b22}.muted{color:#8b949e;overflow-wrap:anywhere}.objective{white-space:pre-wrap;padding:14px;border-radius:8px;background:#0d1117}label{display:grid;gap:6px;margin:16px 0}select,input{font:inherit;padding:9px;border:1px solid #484f58;border-radius:7px;background:#0d1117;color:#e6edf3}button{font:600 16px system-ui;padding:11px 18px;border:0;border-radius:8px;background:#238636;color:white;cursor:pointer}button:disabled{background:#484f58;cursor:not-allowed}button.secondary{background:#30363d}button.danger{background:#b62324}.ok{color:#3fb950}.warn{color:#d29922}.error{color:#f85149}.project{border:1px solid #30363d;border-radius:10px;padding:16px;margin-top:12px}.project-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.actions form{margin:0}.actions button{padding:8px 12px}.inline{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.inline label{flex:1;min-width:220px;margin:8px 0}.inline button{margin:8px 0}.roots{font-family:ui-monospace,monospace;font-size:13px}.advanced{margin-top:18px;border-top:1px solid #30363d;padding-top:16px}.advanced>summary{cursor:pointer;font-weight:650}.advanced-body{padding:8px 0 0}.count{display:inline-block;min-width:1.5em;text-align:center;border-radius:999px;background:#30363d;padding:2px 7px}</style></head>
<body><main class="card">${body}</main></body></html>`;
}

export function reviewPage({ candidate, approvalSecret, options, settings = {} }) {
  const workspaceEntries = options.workspaceEntries ?? (options.workspaces ?? []).map((entry) => ({ value: entry, label: entry }));
  const workspaces = workspaceEntries.map((entry) => entry.value);
  const executors = (options.executors ?? []).filter((entry) => entry.ready !== false);
  const profiles = options.profiles ?? [];
  const canDispatch = workspaces.length > 0 && executors.length > 0 && profiles.length > 0;
  const constraints = candidate.constraints.length
    ? `<ul>${candidate.constraints.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`
    : '<p class="muted">无约束 No constraints</p>';
  const requestedExecution = candidate.execution
    ? `<h2>网页对话选择 Execution choices</h2><ul>${Object.entries(candidate.execution)
        .map(([key, value]) => `<li>${escapeHtml(key)}: ${escapeHtml(value)}</li>`)
        .join("")}</ul><p class="muted">这些选择将在派发时由本机白名单和执行器能力再次校验；未列出的字段使用下方本机选择。</p>`
    : '<p class="muted">网页对话未指定执行覆盖项，将使用下方本机选择。</p>';
  const form = canDispatch
    ? `<form method="post" action="/local-review/confirm" autocomplete="off">
<input type="hidden" name="id" value="${escapeHtml(candidate.id)}">
<input type="hidden" name="approval_secret" value="${escapeHtml(approvalSecret)}">
<label>工作区 Workspace<select name="workspace" required>${workspaceEntries.map((entry, index) => option(entry.value, entry.label, index === 0)).join("")}</select></label>
<label>执行器 Executor<select name="executor" required>${executorOptions(executors, settings.executor ?? "auto")}</select></label>
<label>任务档位 Profile<select name="profile" required>${profileOptions(profiles, settings.profile ?? "auto")}</select></label>
<label>模型 Model<select name="model" required>${modelOptions(options.models, settings.model ?? "auto")}</select></label>
<label>推理等级 Reasoning<select name="reasoning_effort" required>${reasoningOptions(options.reasoningEfforts ?? [], settings.reasoning_effort ?? "auto")}</select></label>
<button type="submit">确认并派发 Confirm and dispatch</button>
</form>`
    : '<p class="error">本机没有可用的工作区、执行器或配置，无法派发。No local dispatch option is available.</p>';
  return page(
    "审核 AgentControlPlane 任务候选",
    `<p><a href="/local-review/settings">派发设置 Dispatch settings</a></p>
<h1>审核任务候选<br><span class="muted">Review task candidate</span></h1>
<p>此内容来自 <span class="muted">${escapeHtml(candidate.page_origin)}</span>。网页内容默认不可信；请在本机确认目标和执行选择。</p>
<h2>目标 Objective</h2><div class="objective">${escapeHtml(candidate.objective)}</div>
<h2>约束 Constraints</h2>${constraints}
${requestedExecution}
<p class="muted">候选将在 ${escapeHtml(candidate.expires_at)} 过期。页面刷新会使旧确认表单失效。</p>${form}`,
  );
}

export function settingsPage({
  settings,
  formSecret,
  options,
  saved = false,
  projectNotice = null,
}) {
  const workspaceEntries = options.workspaceEntries ?? (options.workspaces ?? []).map((entry) => ({ value: entry, label: entry }));
  const workspaces = workspaceEntries.map((entry) => entry.value);
  const executors = (options.executors ?? []).filter((entry) => entry.ready !== false);
  const profiles = options.profiles ?? [];
  const canSave = workspaces.length > 0 && executors.length > 0 && profiles.length > 0;
  const savedNotice = saved ? '<p class="ok">设置已保存 Settings saved</p>' : "";
  const projectMessage = projectNotice
    ? `<p class="ok">${escapeHtml(projectNotice)}</p>`
    : "";
  const missingNotice = settings.workspaceStatus !== "available"
    ? '<p class="warn">当前项目的位置已失效。自动派发已暂停，请在下方重新关联项目。</p>'
    : "";
  const form = canSave
    ? `<form method="post" action="/local-review/settings" autocomplete="off">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}">
<label>默认工作区 Workspace<select name="workspace" required>${workspaceEntries.map((entry) => option(entry.value, entry.label, entry.value === settings.workspace)).join("")}</select></label>
<label>默认执行器 Executor<select name="executor" required>${executorOptions(executors, settings.executor)}</select></label>
<label>默认任务档位 Profile<select name="profile" required>${profileOptions(profiles, settings.profile)}</select></label>
<label>默认模型 Model<select name="model" required>${modelOptions(options.models, settings.model)}</select></label>
<label>默认推理等级 Reasoning<select name="reasoning_effort" required>${reasoningOptions(options.reasoningEfforts ?? [], settings.reasoning_effort)}</select></label>
<p class="muted">选择“自动”后，网页 AI 会按任务目标推荐具体值；ACP 会用本机能力目录和可用状态校验推荐。具体值作为默认值，网页对话中的明确指令可为单次任务指定其他值。</p>
<label><span><input type="checkbox" name="auto_dispatch"${settings.autoDispatch ? " checked" : ""}> 在网页对话中确认后自动派发 Auto-dispatch after chat confirmation</span></label>
<label><span><input type="checkbox" name="return_result_to_chat"${settings.returnResultToChat ? " checked" : ""}> 任务结束后把安全结果发回网页 AI 对话 Return safe result to web AI</span></label>
<button type="submit">保存设置 Save settings</button>
</form>`
    : '<p class="error">本机没有完整的工作区、执行器或配置选项，暂时无法保存。</p>';
  const roots = options.discoveryRoots ?? [];
  const projects = options.projects ?? [];
  const availableProjects = projects.filter((project) => project.status === "available");
  const unavailableProjects = projects.filter((project) => project.status !== "available");
  const availableRows = availableProjects.map((project) => `
<section class="project">
<div class="project-head"><div><strong>${escapeHtml(project.name)}</strong> <span class="ok">可用</span>${project.category === "未分类" ? "" : ` <span class="muted">${escapeHtml(project.category)}</span>`}</div>
<div class="actions">${settings.workspace === project.id
    ? '<span class="ok">当前默认</span>'
    : `<form method="post" action="/local-review/projects"><input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="set_default"><input type="hidden" name="project_id" value="${escapeHtml(project.id)}"><button type="submit">设为默认</button></form>`}</div></div>
</section>`).join("");
  const unavailableRows = unavailableProjects.map((project) => {
    const candidateCount = Number(project.relink_candidate_count ?? 0);
    const statusText = candidateCount === 1
      ? "已找到一个新位置"
      : candidateCount > 1
        ? `找到 ${candidateCount} 个可能位置`
        : "找不到原位置";
    return `<section class="project">
<div class="project-head"><div><strong>${escapeHtml(project.name)}</strong> <span class="warn">${escapeHtml(statusText)}</span></div>
<div class="actions">
${candidateCount === 1 ? `<form method="post" action="/local-review/projects"><input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="relink_suggested"><input type="hidden" name="project_id" value="${escapeHtml(project.id)}"><button type="submit">确认新位置</button></form>` : ""}
<form method="post" action="/local-review/projects"><input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="remove"><input type="hidden" name="project_id" value="${escapeHtml(project.id)}"><button class="danger" type="submit">移除记录</button></form>
</div></div>
<details><summary>填写新位置</summary><form class="inline" method="post" action="/local-review/projects" autocomplete="off">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="relink"><input type="hidden" name="project_id" value="${escapeHtml(project.id)}">
<label>项目文件夹路径<input name="path" placeholder="D:\\Development\\Project" required></label><button type="submit">重新关联</button>
</form></details>
</section>`;
  }).join("");
  const advancedProjectRows = projects.map((project) => `<section class="project">
<strong>${escapeHtml(project.alias)}</strong> <span class="muted">revision ${escapeHtml(project.path_revision)}</span>
<form class="inline" method="post" action="/local-review/projects" autocomplete="off">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="update_category"><input type="hidden" name="project_id" value="${escapeHtml(project.id)}">
<label>分类<input name="category" maxlength="64" value="${escapeHtml(project.category)}" required></label><button class="secondary" type="submit">更新分类</button>
</form></section>`).join("");
  const projectLibrary = `<h2>项目库 Project library</h2>
<p>代码仓库、资料目录和空文件夹都可以加入项目库。ACP 会保存项目身份；项目移动到其他文件夹或磁盘后，可在这里重新关联并继续原对话。</p>
<form class="inline" method="post" action="/local-review/projects" autocomplete="off">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}">
<input type="hidden" name="action" value="add_project">
<label>项目文件夹路径<input name="path" placeholder="D:\\Development\\Project" required></label>
<button type="submit">添加项目</button>
</form>
<h3>可用项目</h3>${availableRows || '<p class="muted">项目库中还没有可用项目。</p>'}
${unavailableProjects.length ? `<details class="advanced"><summary>需要处理的项目 <span class="count">${unavailableProjects.length}</span></summary><div class="advanced-body">${unavailableRows}</div></details>` : ""}
<details class="advanced"><summary>高级设置</summary><div class="advanced-body">
<p class="muted">扫描根目录用于查找项目。任务只会进入已登记的项目文件夹。</p>
<div class="roots">${roots.length ? roots.map((root) => `<div>${escapeHtml(root)}</div>`).join("") : '<span class="muted">尚未添加扫描根目录</span>'}</div>
<form class="inline" method="post" action="/local-review/projects" autocomplete="off">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}"><input type="hidden" name="action" value="add_root">
<label>扫描根目录<input name="path" placeholder="D:\\Development" required></label><button class="secondary" type="submit">添加并扫描</button>
</form><form method="post" action="/local-review/projects">
<input type="hidden" name="form_secret" value="${escapeHtml(formSecret)}">
<input type="hidden" name="action" value="scan">
<button class="secondary" type="submit">重新扫描项目</button>
</form>
<h3>分类与版本</h3>${advancedProjectRows || '<p class="muted">添加项目后可设置分类。</p>'}</div></details>`;
  return page(
    "AgentControlPlane 派发设置",
    `${savedNotice}${projectMessage}${missingNotice}<h1>派发设置<br><span class="muted">Dispatch settings</span></h1>
<p>设置只保存在本机。网页 AI 整理任务后，你需要在对话中明确回复“执行”；开启自动派发后，ACP 会使用下面的选择创建任务。</p>
<p class="muted">安全结果只包含任务状态、文件数量、测试数量和阻塞项数量，不包含本机路径、日志、密钥或原始错误。</p>${form}${projectLibrary}`,
  );
}

export function dispatchedPage({ candidate, task }) {
  return page(
    "AgentControlPlane 任务已派发",
    `<h1 class="ok">任务已派发 Dispatched</h1><p>任务 ID：<code>${escapeHtml(task.id)}</code></p><p>状态：${escapeHtml(task.status)}</p><p class="muted">候选 ${escapeHtml(candidate.id)} 已消费，不能再次派发。你可以关闭此标签页。</p>`,
  );
}

export function reviewErrorPage(error, { projectAction = false } = {}) {
  if (projectAction) {
    return page(
      "AgentControlPlane 项目操作未完成",
      `<h1 class="error">项目操作未完成</h1><p>${escapeHtml(error?.message ?? "Unknown error")}</p><p><a href="/local-review/settings">返回项目库</a></p>`,
    );
  }
  return page(
    "AgentControlPlane 审核失败",
    `<h1 class="error">无法完成审核 Review failed</h1><p>${escapeHtml(error?.message ?? "Unknown error")}</p><p class="muted">请关闭此页面，并从油猴面板重新创建候选。</p>`,
  );
}
