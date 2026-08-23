// ==UserScript==
// @name         AgentControlPlane Web Bridge Preview
// @namespace    https://github.com/Ya-KARAS/AgentControlPlane
// @version      0.3.0
// @description  Send a manual task candidate to local review and show a safe status summary.
// @author       Ya-KARAS
// @acp-adapter-matches
// @connect      127.0.0.1
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const ROOT_ID = "acp-web-bridge-preview";
  const LOCAL_BASE_URL = "http://127.0.0.1:4318";
  const CANDIDATE_URL = `${LOCAL_BASE_URL}/v1/local-review/candidates`;
  const ADAPTERS = /* @acp-adapters */ [];
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

  let tracking = null;
  let pollTimer = null;

  const element = (tag, options = {}) => {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text) node.textContent = options.text;
    if (options.type) node.type = options.type;
    return node;
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

  const root = document.createElement("section");
  root.id = ROOT_ID;
  root.setAttribute("aria-label", "AgentControlPlane web bridge preview");

  const style = document.createElement("style");
  style.textContent = `
    #${ROOT_ID} { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; font-family: system-ui, sans-serif; }
    #${ROOT_ID} button { border: 0; border-radius: 999px; background: #536af5; color: #fff; cursor: pointer; font: inherit; }
    #${ROOT_ID} .acp-trigger { box-shadow: 0 8px 24px rgba(28, 39, 102, .28); font-weight: 700; padding: 10px 16px; }
    #${ROOT_ID} .acp-panel { background: #fff; border: 1px solid #d8dcf6; border-radius: 12px; box-shadow: 0 12px 36px rgba(15, 23, 42, .22); color: #172033; margin-bottom: 10px; width: min(340px, calc(100vw - 40px)); padding: 16px; }
    #${ROOT_ID} .acp-panel[hidden] { display: none; }
    #${ROOT_ID} .acp-panel h2 { font-size: 15px; margin: 0 30px 8px 0; }
    #${ROOT_ID} .acp-panel p { font-size: 13px; line-height: 1.5; margin: 0 0 10px; }
    #${ROOT_ID} .acp-panel label { display: grid; font-size: 12px; gap: 4px; margin: 10px 0; }
    #${ROOT_ID} .acp-panel textarea { border: 1px solid #bcc4dc; border-radius: 7px; box-sizing: border-box; color: #172033; font: 13px system-ui, sans-serif; min-height: 72px; padding: 8px; resize: vertical; width: 100%; }
    #${ROOT_ID} .acp-panel .acp-submit { border-radius: 8px; padding: 9px 13px; width: 100%; }
    #${ROOT_ID} .acp-panel .acp-settings { background: #e9ecff; border-radius: 8px; color: #3447b8; margin-bottom: 10px; padding: 8px 12px; width: 100%; }
    #${ROOT_ID} .acp-panel .acp-submit:disabled { cursor: wait; opacity: .65; }
    #${ROOT_ID} .acp-status { color: #526079; min-height: 20px; }
    #${ROOT_ID} .acp-close { background: transparent; color: #526079; font-size: 18px; line-height: 1; padding: 2px 6px; position: absolute; right: 8px; top: 8px; }
  `;

  const panel = document.createElement("div");
  panel.className = "acp-panel";
  panel.hidden = true;

  const close = element("button", { className: "acp-close", text: "×", type: "button" });
  close.setAttribute("aria-label", "Close");
  const heading = element("h2", { text: `ACP 本机任务候选 · ${adapter.displayName}` });
  const notice = element("p", {
    text: "脚本不会读取当前对话。是否自动派发由本机设置决定。",
  });
  const settingsButton = element("button", {
    className: "acp-settings",
    text: "派发设置 Dispatch settings",
    type: "button",
  });
  const objectiveLabel = element("label", { text: "目标 Objective" });
  const objective = element("textarea");
  objective.required = true;
  objective.maxLength = 4000;
  objective.placeholder = "描述一个明确的工程目标";
  objectiveLabel.append(objective);
  const constraintsLabel = element("label", { text: "约束 Constraints（每行一项）" });
  const constraints = element("textarea");
  constraints.placeholder = "例如：只修改指定目录";
  constraintsLabel.append(constraints);
  const submit = element("button", {
    className: "acp-submit",
    text: "提交任务候选 Submit candidate",
    type: "button",
  });
  const status = element("p", { className: "acp-status" });
  status.setAttribute("role", "status");

  const statusText = (body) => {
    if (!body.task) {
      const labels = {
        pending: "候选待本机审核。",
        reviewing: "本机审核页已打开，等待确认。",
        dispatching: "正在派发任务。",
        failed: "任务派发失败，请在本机 ACP 查看详情。",
        expired: "候选已过期，请重新创建。",
      };
      return labels[body.candidate?.status] ?? "候选状态已更新。";
    }
    const task = body.task;
    if (task.status === "queued") return "任务已排队。";
    if (task.status === "running") return "任务正在执行。";
    if (task.status === "completed") {
      return `任务完成：${task.changed_files_count} 个文件，${task.tests.passed}/${task.tests.total} 项测试通过。`;
    }
    if (task.status === "cancelled") return "任务已取消。";
    if (task.status === "blocked") return "任务被阻塞，请在本机 ACP 查看详情。";
    if (task.status === "partial") return "任务部分完成，请在本机 ACP 查看详情。";
    return "任务失败，请在本机 ACP 查看详情。";
  };

  const stopTracking = () => {
    tracking = null;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };

  const pollStatus = async (activeTracking) => {
    if (tracking !== activeTracking) return;
    if (Date.now() >= activeTracking.expiresAt) {
      stopTracking();
      status.textContent = "状态查看已过期，请在本机 ACP 查看任务。";
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
      status.textContent = statusText(body);
      if (body.task && TERMINAL_TASK_STATUSES.has(body.task.status)) {
        stopTracking();
        return;
      }
    } catch (error) {
      if (tracking !== activeTracking) return;
      if (["candidate_status_expired", "candidate_status_denied"].includes(error.message)) {
        stopTracking();
        status.textContent = "无法继续查看状态，请在本机 ACP 查看任务。";
        return;
      }
      status.textContent = "状态暂时不可用，正在重试。";
    }
    if (tracking === activeTracking) {
      pollTimer = setTimeout(() => pollStatus(activeTracking), 2000);
    }
  };

  panel.append(
    close,
    heading,
    notice,
    settingsButton,
    objectiveLabel,
    constraintsLabel,
    submit,
    status,
  );

  const trigger = document.createElement("button");
  trigger.className = "acp-trigger";
  trigger.type = "button";
  trigger.textContent = "ACP";
  trigger.setAttribute("aria-expanded", "false");

  const setOpen = (open) => {
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  };

  trigger.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => setOpen(false));
  settingsButton.addEventListener("click", () => {
    GM_openInTab(`${LOCAL_BASE_URL}/local-review/settings`, {
      active: true,
      insert: true,
      setParent: true,
    });
  });
  submit.addEventListener("click", async () => {
    const enteredObjective = objective.value.trim();
    if (!enteredObjective) {
      status.textContent = "请先填写目标。Enter an objective first.";
      objective.focus();
      return;
    }
    const enteredConstraints = constraints.value
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 16);
    submit.disabled = true;
    status.textContent = "正在创建本机审核候选… Creating local review…";
    try {
      const response = await request({
        method: "POST",
        url: CANDIDATE_URL,
        headers: {
          "content-type": "application/json",
          "x-acp-client": "userscript-v1",
          "x-acp-page-origin": window.location.origin,
        },
        data: JSON.stringify({
          objective: enteredObjective,
          constraints: enteredConstraints,
          source: "userscript-preview",
        }),
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
      if (!Number.isFinite(expiresAt)) throw new Error("ACP returned an invalid status expiry");
      stopTracking();
      tracking = { id: candidateId, secret: body.status_secret, expiresAt };
      status.textContent = body.auto_dispatched
        ? "候选已按本机设置自动派发。"
        : "候选已创建，请在本机页面确认。";
      pollStatus(tracking);
      if (!body.auto_dispatched) {
        const reviewUrl = validatedReviewUrl(body.review_url, candidateId);
        GM_openInTab(reviewUrl, { active: true, insert: true, setParent: true });
      }
    } catch (error) {
      status.textContent = error.message === "timeout"
        ? "连接本机 ACP 超时。"
        : error.message === "network_error"
          ? "无法连接本机 ACP。请确认服务正在运行。"
          : `创建失败：${error.message}`;
    } finally {
      submit.disabled = false;
    }
  });

  root.append(style, panel, trigger);
  document.body.append(root);
})();
