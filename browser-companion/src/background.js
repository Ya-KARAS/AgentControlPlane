const DEFAULTS = {
  baseUrl: "http://127.0.0.1:4318",
  token: null,
  clientId: null,
  pendingPairing: null,
  seenEnvelopes: [],
  activeTasks: [],
  settings: {
    workspace: "",
    profile: "auto",
    executor: "auto",
    model: "auto",
    reasoning_effort: "auto",
    confirmWords: "",
    autoSubmitResults: false,
  },
};

async function state() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    ...DEFAULTS,
    ...stored,
    settings: { ...DEFAULTS.settings, ...(stored.settings ?? {}) },
  };
}

async function update(patch) {
  await chrome.storage.local.set(patch);
  return state();
}

async function api(path, { method = "GET", body, paired = true } = {}) {
  const current = await state();
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (paired && current.token) headers.authorization = `Bearer ${current.token}`;
  const response = await fetch(`${current.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && paired) {
      await update({ token: null, clientId: null });
    }
    throw new Error(payload?.error?.message ?? `ACP request failed (${response.status}) 请求失败 (${response.status})`);
  }
  return payload;
}

async function startPairing(label) {
  const payload = await api("/v1/companion/pairings", {
    method: "POST",
    body: { label: label || "AgentControlPlane browser companion 浏览器伴侣" },
    paired: false,
  });
  await update({
    pendingPairing: {
      id: payload.pairing_id,
      secret: payload.pairing_secret,
      code: payload.code,
      expiresAt: payload.expires_at,
    },
  });
  await chrome.tabs.create({ url: payload.approval_url, active: true });
  return {
    status: "pending",
    code: payload.code,
    expires_at: payload.expires_at,
  };
}

async function checkPairing() {
  const current = await state();
  const pairing = current.pendingPairing;
  if (!pairing) return { status: current.token ? "connected" : "idle" };
  if (Date.parse(pairing.expiresAt) <= Date.now()) {
    await update({ pendingPairing: null });
    return { status: "expired" };
  }
  const response = await fetch(
    `${current.baseUrl}/v1/companion/pairings/${encodeURIComponent(pairing.id)}`,
    {
      headers: { "x-acp-pairing-secret": pairing.secret },
      cache: "no-store",
      credentials: "omit",
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Pairing status failed");
  }
  if (payload.status === "approved") {
    await update({
      token: payload.token,
      clientId: payload.client_id,
      pendingPairing: null,
    });
    return { status: "connected" };
  }
  if (payload.status === "claimed") {
    const latest = await state();
    return { status: latest.token ? "connected" : "claimed" };
  }
  return { status: "pending", code: pairing.code };
}

async function claimEnvelope(pageUrl, envelopeId) {
  const current = await state();
  const key = `${String(pageUrl).slice(0, 2048)}#${String(envelopeId).slice(0, 64)}`;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const seen = current.seenEnvelopes.filter((entry) => entry.at >= cutoff);
  if (seen.some((entry) => entry.key === key)) return { claimed: false };
  seen.push({ key, at: Date.now() });
  await update({ seenEnvelopes: seen.slice(-500) });
  return { claimed: true };
}

async function releaseEnvelope(pageUrl, envelopeId) {
  const current = await state();
  const key = `${String(pageUrl).slice(0, 2048)}#${String(envelopeId).slice(0, 64)}`;
  await update({
    seenEnvelopes: current.seenEnvelopes.filter((entry) => entry.key !== key),
  });
  return { released: true };
}

async function rememberActiveTask(pageUrl, taskId) {
  const current = await state();
  const active = current.activeTasks.filter((entry) => entry.taskId !== taskId);
  active.push({ pageUrl: String(pageUrl).slice(0, 2048), taskId, at: Date.now() });
  await update({ activeTasks: active.slice(-100) });
}

async function forgetActiveTask(taskId) {
  const current = await state();
  await update({
    activeTasks: current.activeTasks.filter((entry) => entry.taskId !== taskId),
  });
}

async function enableSite(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS sites are supported 仅支持 HTTPS 站点");
  const pattern = `${parsed.origin}/*`;
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) return { granted: false };
  const id = `acp-${Array.from(parsed.hostname)
    .reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619), 2166136261)
    .toString(16)}`;
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  await chrome.scripting.registerContentScripts([
    { id, matches: [pattern], js: ["src/content.js"], runAt: "document_idle" },
  ]);
  return { granted: true, pattern };
}

async function handle(message) {
  switch (message?.type) {
    case "ACP_STATE": {
      const current = await state();
      return {
        connected: Boolean(current.token),
        pending: current.pendingPairing
          ? { code: current.pendingPairing.code, expiresAt: current.pendingPairing.expiresAt }
          : null,
        settings: current.settings,
        baseUrl: current.baseUrl,
      };
    }
    case "ACP_SETTINGS": {
      const current = await state();
      const settings = { ...current.settings, ...(message.patch ?? {}) };
      await update({ settings });
      return { settings };
    }
    case "ACP_PAIR_START":
      return startPairing(message.label);
    case "ACP_PAIR_STATUS":
      return checkPairing();
    case "ACP_OPTIONS":
      return api("/v1/companion/options");
    case "ACP_DISPATCH":
      {
        const result = await api("/v1/companion/tasks", {
          method: "POST",
          body: message.request,
        });
        await rememberActiveTask(message.pageUrl, result.task.id);
        return result;
      }
    case "ACP_TASK_STATUS": {
      const result = await api(
        `/v1/companion/tasks/${encodeURIComponent(message.taskId)}`,
      );
      if (result.task?.terminal) await forgetActiveTask(message.taskId);
      return result;
    }
    case "ACP_TASK_LIST": {
      const params = new URLSearchParams();
      params.set("limit", String(Math.min(50, Number(message.limit) || 20)));
      if (message.query) params.set("query", String(message.query));
      if (message.status) params.set("status", String(message.status));
      return api(`/v1/companion/tasks?${params.toString()}`);
    }
    case "ACP_RECOMMEND": {
      const params = new URLSearchParams();
      params.set("objective", String(message.objective ?? ""));
      if (message.profile) params.set("profile", String(message.profile));
      if (message.executor) params.set("executor", String(message.executor));
      if (message.model) params.set("model", String(message.model));
      return api(`/v1/recommendations?${params.toString()}`);
    }
    case "ACP_FOLLOW_UP":
      return api(`/v1/companion/tasks/${encodeURIComponent(message.taskId)}/follow-up`, {
        method: "POST",
        body: message.request,
      });
    case "ACP_CANCEL":
      return api(`/v1/companion/tasks/${encodeURIComponent(message.taskId)}/cancel`, {
        method: "POST",
      });
    case "ACP_ENABLE_SITE":
      return enableSite(message.url);
    case "ACP_CLAIM_ENVELOPE":
      return claimEnvelope(message.pageUrl, message.envelopeId);
    case "ACP_RELEASE_ENVELOPE":
      return releaseEnvelope(message.pageUrl, message.envelopeId);
    case "ACP_ACTIVE_TASKS": {
      const current = await state();
      return {
        task_ids: current.activeTasks
          .filter((entry) => entry.pageUrl === message.pageUrl)
          .map((entry) => entry.taskId),
      };
    }
    case "ACP_DISCONNECT": {
      if ((await state()).token) {
        await api("/v1/companion/session", { method: "DELETE" });
      }
      await update({ token: null, clientId: null, pendingPairing: null });
      return { disconnected: true };
    }
    default:
      throw new Error("Unknown AgentControlPlane companion request 未知的 AgentControlPlane 伴侣请求");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await state();
  await chrome.storage.local.set(current);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
