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

function page(title, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font:16px system-ui;margin:0;background:#0d1117;color:#e6edf3;display:grid;min-height:100vh;place-items:center}.card{width:min(680px,calc(100% - 40px));padding:28px;border:1px solid #30363d;border-radius:14px;background:#161b22}.muted{color:#8b949e;overflow-wrap:anywhere}.objective{white-space:pre-wrap;padding:14px;border-radius:8px;background:#0d1117}label{display:grid;gap:6px;margin:16px 0}select{font:inherit;padding:9px;border:1px solid #484f58;border-radius:7px;background:#0d1117;color:#e6edf3}button{font:600 16px system-ui;padding:11px 18px;border:0;border-radius:8px;background:#238636;color:white;cursor:pointer}button:disabled{background:#484f58;cursor:not-allowed}.ok{color:#3fb950}.error{color:#f85149}</style></head>
<body><main class="card">${body}</main></body></html>`;
}

export function reviewPage({ candidate, approvalSecret, options }) {
  const workspaces = options.workspaces ?? [];
  const executors = (options.executors ?? []).filter((entry) => entry.ready !== false);
  const profiles = options.profiles ?? [];
  const canDispatch = workspaces.length > 0 && executors.length > 0 && profiles.length > 0;
  const constraints = candidate.constraints.length
    ? `<ul>${candidate.constraints.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`
    : '<p class="muted">无约束 No constraints</p>';
  const form = canDispatch
    ? `<form method="post" action="/local-review/confirm" autocomplete="off">
<input type="hidden" name="id" value="${escapeHtml(candidate.id)}">
<input type="hidden" name="approval_secret" value="${escapeHtml(approvalSecret)}">
<label>工作区 Workspace<select name="workspace" required>${workspaces.map((entry, index) => option(entry, entry, index === 0)).join("")}</select></label>
<label>执行器 Executor<select name="executor" required>${executors.map((entry) => option(entry.id, entry.display_name ?? entry.id, entry.selected === true)).join("")}</select></label>
<label>配置 Profile<select name="profile" required>${profiles.map((entry) => option(entry, entry, entry === "economy")).join("")}</select></label>
<button type="submit">确认并派发 Confirm and dispatch</button>
</form>`
    : '<p class="error">本机没有可用的工作区、执行器或配置，无法派发。No local dispatch option is available.</p>';
  return page(
    "审核 AgentControlPlane 任务候选",
    `<h1>审核任务候选<br><span class="muted">Review task candidate</span></h1>
<p>此内容来自 <span class="muted">${escapeHtml(candidate.page_origin)}</span>。网页内容默认不可信；请在本机确认目标和执行选择。</p>
<h2>目标 Objective</h2><div class="objective">${escapeHtml(candidate.objective)}</div>
<h2>约束 Constraints</h2>${constraints}
<p class="muted">候选将在 ${escapeHtml(candidate.expires_at)} 过期。页面刷新会使旧确认表单失效。</p>${form}`,
  );
}

export function dispatchedPage({ candidate, task }) {
  return page(
    "AgentControlPlane 任务已派发",
    `<h1 class="ok">任务已派发 Dispatched</h1><p>任务 ID：<code>${escapeHtml(task.id)}</code></p><p>状态：${escapeHtml(task.status)}</p><p class="muted">候选 ${escapeHtml(candidate.id)} 已消费，不能再次派发。你可以关闭此标签页。</p>`,
  );
}

export function reviewErrorPage(error) {
  return page(
    "AgentControlPlane 审核失败",
    `<h1 class="error">无法完成审核 Review failed</h1><p>${escapeHtml(error?.message ?? "Unknown error")}</p><p class="muted">请关闭此页面，并从油猴面板重新创建候选。</p>`,
  );
}
