// ==UserScript==
// @name         AgentControlPlane Web Bridge Preview
// @name:zh-CN   AgentControlPlane 网页桥接预览
// @namespace    https://github.com/Ya-KARAS/AgentControlPlane
// @version      0.8.0
// @description  Use natural-language web AI conversations to stage and dispatch local engineering tasks.
// @description:zh-CN 通过网页 AI 自然语言对话暂存和派发本地工程任务。
// @author       Ya-KARAS
// @downloadURL  https://raw.githubusercontent.com/Ya-KARAS/AgentControlPlane/refs/heads/main/userscript/releases/0.8.0/agent-control-plane-web-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/Ya-KARAS/AgentControlPlane/refs/heads/main/userscript/agent-control-plane-web-bridge.meta.js
// @match        https://chatgpt.com/*
// @match        https://chat.deepseek.com/*
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
