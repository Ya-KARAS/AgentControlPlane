// ==UserScript==
// @name         AgentControlPlane Web Bridge Preview
// @namespace    https://github.com/Ya-KARAS/AgentControlPlane
// @version      0.2.0
// @description  Send a manually entered candidate to the local AgentControlPlane review page.
// @author       Ya-KARAS
// @match        https://chatgpt.com/*
// @match        https://chat.deepseek.com/*
// @connect      127.0.0.1
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const ROOT_ID = "acp-web-bridge-preview";
  const CANDIDATE_URL = "http://127.0.0.1:4318/v1/local-review/candidates";
  if (document.getElementById(ROOT_ID)) return;

  const element = (tag, options = {}) => {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text) node.textContent = options.text;
    if (options.type) node.type = options.type;
    return node;
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
    #${ROOT_ID} .acp-panel .acp-submit:disabled { cursor: wait; opacity: .65; }
    #${ROOT_ID} .acp-status { color: #526079; min-height: 20px; }
    #${ROOT_ID} .acp-close { background: transparent; color: #526079; font-size: 18px; line-height: 1; padding: 2px 6px; position: absolute; right: 8px; top: 8px; }
  `;

  const panel = document.createElement("div");
  panel.className = "acp-panel";
  panel.hidden = true;

  const close = element("button", { className: "acp-close", text: "×", type: "button" });
  close.setAttribute("aria-label", "Close");
  const heading = element("h2", { text: "ACP 本机任务候选" });
  const notice = element("p", {
    text: "手动填写候选后，必须在本机 ACP 页面再次确认。脚本不会读取当前对话。",
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
    text: "打开本机审核页 Open local review",
    type: "button",
  });
  const status = element("p", { className: "acp-status" });
  status.setAttribute("role", "status");

  panel.append(
    close,
    heading,
    notice,
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
  submit.addEventListener("click", () => {
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
    GM_xmlhttpRequest({
      method: "POST",
      url: CANDIDATE_URL,
      headers: {
        "content-type": "application/json",
        "x-acp-page-origin": window.location.origin,
      },
      data: JSON.stringify({
        objective: enteredObjective,
        constraints: enteredConstraints,
        source: "userscript-preview",
      }),
      timeout: 10000,
      onload(response) {
        submit.disabled = false;
        try {
          const body = JSON.parse(response.responseText);
          if (response.status !== 201 || !body.review_url) {
            throw new Error(body.error?.message ?? `ACP returned ${response.status}`);
          }
          status.textContent = "候选已创建，请在本机页面确认。Review locally to dispatch.";
          GM_openInTab(body.review_url, { active: true, insert: true, setParent: true });
        } catch (error) {
          status.textContent = `创建失败：${error.message}`;
        }
      },
      onerror() {
        submit.disabled = false;
        status.textContent = "无法连接本机 ACP。请确认服务正在运行。";
      },
      ontimeout() {
        submit.disabled = false;
        status.textContent = "连接本机 ACP 超时。";
      },
    });
  });

  root.append(style, panel, trigger);
  document.body.append(root);
})();
