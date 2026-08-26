import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/server.js";
import { TaskStore } from "../src/core/store.js";

class StubCodex extends EventEmitter {
  constructor() {
    super();
    this.ready = true;
  }

  stop() {}
}

class ReviewOrchestrator {
  constructor() {
    this.requests = [];
  }

  dispatch(request) {
    this.requests.push(request);
    return { id: `task-${this.requests.length}`, status: "queued" };
  }

  getExecutors() {
    return [
      { id: "opencode", display_name: "OpenCode", ready: true, selected: true },
    ];
  }

  getModels(executorId) {
    if (executorId !== "opencode") return [];
    return [
      {
        id: "opencode-go/deepseek-v4-pro",
        model: "opencode-go/deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        supportedReasoningEfforts: [
          { reasoningEffort: "high" },
          { reasoningEffort: "max" },
        ],
      },
    ];
  }

  getRuntimeHealth() {
    return {};
  }
}

function reviewConfig() {
  return {
    version: "9.9.9-test",
    server: {
      host: "127.0.0.1",
      port: 0,
      authToken: "protected-api-token",
      allowedOrigins: [],
      maxMcpSessions: 32,
      mcpSessionIdleMinutes: 30,
    },
    workspaceRoots: ["C:\\allowed"],
    stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "acp-review-state-")),
    limits: { maxStoredEventsPerTask: 20 },
    profiles: {
      economy: {
        model: "test-model",
        effort: "low",
        maxSubagents: 0,
        tokenBudget: 3000,
        summary: "concise",
      },
    },
  };
}

async function withReviewServer(callback) {
  const config = reviewConfig();
  const store = new TaskStore(config.stateDir, 20);
  const orchestrator = new ReviewOrchestrator();
  const app = await createApplication({
    config,
    store,
    codex: new StubCodex(),
    orchestrator,
    startCodex: false,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address();
  try {
    await callback({ baseUrl: `http://127.0.0.1:${port}`, orchestrator, store });
  } finally {
    await app.close();
  }
}

async function createCandidate(baseUrl, body, origin = "https://chatgpt.com") {
  return fetch(`${baseUrl}/v1/local-review/candidates`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-acp-page-origin": origin,
    },
    body: JSON.stringify(body),
  });
}

const validCandidate = {
  objective: "Create <script>alert(1)</script> safely",
  constraints: ["Touch one file"],
  source: "userscript-preview",
};

test("capability summary exposes safe natural-language choices", async () => {
  await withReviewServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/v1/local-review/capabilities`, {
      headers: {
        origin: "https://chatgpt.com",
        "x-acp-page-origin": "https://chatgpt.com",
      },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.capabilities.current.workspace, "allowed");
    assert.deepEqual(body.capabilities.current, {
      workspace: "allowed",
      executor: "auto",
      profile: "auto",
      model: "auto",
      reasoning_effort: "auto",
    });
    assert.deepEqual(body.capabilities.workspaces, ["allowed"]);
    assert.deepEqual(body.capabilities.models.opencode[0], {
      id: "opencode-go/deepseek-v4-pro",
      display_name: "DeepSeek V4 Pro",
      reasoning_efforts: ["high", "max"],
      status: "available",
    });
    assert.deepEqual(body.capabilities.route_health, { providers: {} });
    assert.doesNotMatch(JSON.stringify(body), /C:\\\\allowed/);

    const denied = await fetch(`${baseUrl}/v1/local-review/capabilities`, {
      headers: {
        origin: "https://attacker.example",
        "x-acp-page-origin": "https://attacker.example",
      },
    });
    assert.equal(denied.status, 403);
  });
});

test("candidate creation cannot dispatch or override local choices", async () => {
  await withReviewServer(async ({ baseUrl, orchestrator }) => {
    const rejected = await createCandidate(baseUrl, {
      ...validCandidate,
      workspace: "C:\\allowed",
    });
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).error.code, "candidate_fields_denied");
    assert.equal(orchestrator.requests.length, 0);

    const created = await createCandidate(baseUrl, validCandidate);
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("access-control-allow-origin"), "https://chatgpt.com");
    const body = await created.json();
    assert.match(body.review_url, /^http:\/\/127\.0\.0\.1:\d+\/local-review\/review/);
    assert.match(body.status_secret, /^[A-Za-z0-9_-]{20,128}$/);
    assert.equal(body.auto_dispatched, false);
    assert.equal(body.return_result_to_chat, false);
    assert.equal(orchestrator.requests.length, 0);
  });
});

test("candidate status needs its capability secret and returns only a safe projection", async () => {
  await withReviewServer(async ({ baseUrl }) => {
    const createdResponse = await createCandidate(baseUrl, validCandidate);
    const created = await createdResponse.json();
    const statusUrl = `${baseUrl}/v1/local-review/candidates/${created.candidate.id}/status`;
    const denied = await fetch(statusUrl, {
      headers: {
        origin: "https://chatgpt.com",
        "x-acp-page-origin": "https://chatgpt.com",
        "x-acp-status-secret": "wrong",
      },
    });
    assert.equal(denied.status, 403);

    const allowed = await fetch(statusUrl, {
      headers: {
        origin: "https://chatgpt.com",
        "x-acp-page-origin": "https://chatgpt.com",
        "x-acp-status-secret": created.status_secret,
      },
    });
    assert.equal(allowed.status, 200);
    const body = await allowed.json();
    assert.equal(body.candidate.status, "pending");
    assert.equal(body.task, null);
    assert.equal("objective" in body.candidate, false);
    assert.equal("constraints" in body.candidate, false);
    assert.equal("page_origin" in body.candidate, false);
  });
});

test("local settings can opt in to userscript-only automatic dispatch", async () => {
  await withReviewServer(async ({ baseUrl, orchestrator }) => {
    const settingsResponse = await fetch(`${baseUrl}/local-review/settings`);
    assert.equal(settingsResponse.status, 200);
    const settingsHtml = await settingsResponse.text();
    const formSecret = settingsHtml.match(/name="form_secret" value="([^"]+)"/)?.[1];
    assert.ok(formSecret);

    const saved = await fetch(`${baseUrl}/local-review/settings`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: baseUrl,
      },
      body: new URLSearchParams({
        form_secret: formSecret,
        workspace: "C:\\allowed",
        executor: "opencode",
        profile: "economy",
        auto_dispatch: "on",
        return_result_to_chat: "on",
      }),
    });
    assert.equal(saved.status, 200);
    assert.match(await saved.text(), /设置已保存/);

    const ordinary = await createCandidate(baseUrl, validCandidate);
    assert.equal((await ordinary.json()).auto_dispatched, false);
    assert.equal(orchestrator.requests.length, 0);

    const automatic = await fetch(`${baseUrl}/v1/local-review/candidates`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://chatgpt.com",
        "x-acp-client": "userscript-v1",
        "x-acp-page-origin": "https://chatgpt.com",
      },
      body: JSON.stringify(validCandidate),
    });
    assert.equal(automatic.status, 201);
    const automaticBody = await automatic.json();
    assert.equal(automaticBody.auto_dispatched, true);
    assert.equal(automaticBody.return_result_to_chat, true);
    assert.equal(automaticBody.review_url, null);
    assert.equal(automaticBody.candidate.status, "dispatched");
    assert.equal(orchestrator.requests.length, 1);
    assert.deepEqual(orchestrator.requests[0], {
      objective: validCandidate.objective,
      constraints: validCandidate.constraints,
      workspace: "C:\\allowed",
      executor: "opencode",
      profile: "economy",
    });

    const overridden = await fetch(`${baseUrl}/v1/local-review/candidates`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://chatgpt.com",
        "x-acp-client": "userscript-v1",
        "x-acp-idempotency-key": "userscript:0123456789abcdef",
        "x-acp-page-origin": "https://chatgpt.com",
      },
      body: JSON.stringify({
        ...validCandidate,
        execution: {
          workspace: "allowed",
          executor: "opencode",
          profile: "economy",
          model: "opencode-go/deepseek-v4-pro",
          reasoning_effort: "high",
        },
      }),
    });
    assert.equal(overridden.status, 201);
    assert.equal((await overridden.json()).auto_dispatched, true);
    assert.deepEqual(orchestrator.requests[1], {
      objective: validCandidate.objective,
      constraints: validCandidate.constraints,
      workspace: "C:\\allowed",
      executor: "opencode",
      profile: "economy",
      model: "opencode-go/deepseek-v4-pro",
      reasoning_effort: "high",
      idempotency_key: "userscript:0123456789abcdef",
    });

    const preflight = await fetch(`${baseUrl}/v1/local-review/candidates`, {
      method: "OPTIONS",
      headers: {
        origin: "https://chatgpt.com",
        "x-acp-page-origin": "https://chatgpt.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-acp-client,x-acp-page-origin",
      },
    });
    assert.doesNotMatch(
      preflight.headers.get("access-control-allow-headers") ?? "",
      /x-acp-client/i,
    );
  });
});

test("local settings language control uses a CSP-compatible external script", async () => {
  await withReviewServer(async ({ baseUrl }) => {
    const settingsResponse = await fetch(`${baseUrl}/local-review/settings`);
    assert.equal(settingsResponse.status, 200);
    assert.match(
      settingsResponse.headers.get("content-security-policy") ?? "",
      /script-src 'self'/,
    );
    const settingsHtml = await settingsResponse.text();
    assert.match(settingsHtml, /<script src="\/local-review\/settings\.js" defer><\/script>/);
    assert.doesNotMatch(settingsHtml, /onchange=/);

    const scriptResponse = await fetch(`${baseUrl}/local-review/settings.js`);
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get("content-type") ?? "", /^text\/javascript/);
    const script = await scriptResponse.text();

    let changeHandler = null;
    let submissions = 0;
    const languageSelect = {
      form: { requestSubmit: () => { submissions += 1; } },
      addEventListener(event, handler) {
        if (event === "change") changeHandler = handler;
      },
    };
    Function("document", script)({
      querySelector: (selector) => selector === 'select[name="language"]'
        ? languageSelect
        : null,
    });
    assert.equal(typeof changeHandler, "function");
    changeHandler();
    assert.equal(submissions, 1);
  });
});

test("unapproved page origins cannot create candidates", async () => {
  await withReviewServer(async ({ baseUrl, orchestrator }) => {
    const response = await createCandidate(
      baseUrl,
      validCandidate,
      "https://attacker.example",
    );
    assert.equal(response.status, 403);
    assert.equal(orchestrator.requests.length, 0);
  });
});

test("opaque browser origins can submit only a token-protected local review", async () => {
  await withReviewServer(async ({ baseUrl, orchestrator }) => {
    const response = await fetch(`${baseUrl}/local-review/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "null",
      },
      body: new URLSearchParams({
        id: "invalid",
        approval_secret: "invalid",
        workspace: "C:\\allowed",
        executor: "opencode",
        profile: "economy",
      }),
    });
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assert.equal(orchestrator.requests.length, 0);

    const candidate = await createCandidate(
      baseUrl,
      validCandidate,
      "null",
    );
    assert.equal(candidate.status, 403);
    assert.equal(orchestrator.requests.length, 0);
  });
});

test("local review escapes page content and dispatches exactly once", async () => {
  await withReviewServer(async ({ baseUrl, orchestrator }) => {
    const created = await createCandidate(baseUrl, validCandidate);
    const { review_url: reviewUrl } = await created.json();
    const review = await fetch(reviewUrl);
    assert.equal(review.status, 200);
    assert.match(review.headers.get("content-security-policy"), /form-action 'self'/);
    const html = await review.text();
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const approvalSecret = html.match(
      /name="approval_secret" value="([^"]+)"/,
    )?.[1];
    const candidateId = html.match(/name="id" value="([^"]+)"/)?.[1];
    assert.ok(approvalSecret);
    assert.ok(candidateId);
    assert.equal(orchestrator.requests.length, 0);

    const form = new URLSearchParams({
      id: candidateId,
      approval_secret: approvalSecret,
      workspace: "C:\\allowed",
      executor: "opencode",
      profile: "economy",
    });
    const confirmed = await fetch(`${baseUrl}/local-review/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: baseUrl,
      },
      body: form,
    });
    assert.equal(confirmed.status, 200);
    assert.match(await confirmed.text(), /任务已派发/);
    assert.equal(orchestrator.requests.length, 1);
    assert.deepEqual(orchestrator.requests[0], {
      objective: validCandidate.objective,
      constraints: validCandidate.constraints,
      workspace: "C:\\allowed",
      executor: "opencode",
      profile: "economy",
    });

    const duplicate = await fetch(`${baseUrl}/local-review/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: baseUrl,
      },
      body: form,
    });
    assert.equal(duplicate.status, 409);
    assert.equal(orchestrator.requests.length, 1);
  });
});

test("local review rejects a workspace not selected from local configuration", async () => {
  await withReviewServer(async ({ baseUrl, orchestrator }) => {
    const created = await createCandidate(baseUrl, validCandidate);
    const { review_url: reviewUrl } = await created.json();
    const html = await (await fetch(reviewUrl)).text();
    const approvalSecret = html.match(/name="approval_secret" value="([^"]+)"/)?.[1];
    const candidateId = html.match(/name="id" value="([^"]+)"/)?.[1];
    const denied = await fetch(`${baseUrl}/local-review/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: baseUrl,
      },
      body: new URLSearchParams({
        id: candidateId,
        approval_secret: approvalSecret,
        workspace: "C:\\outside",
        executor: "opencode",
        profile: "economy",
      }),
    });
    assert.equal(denied.status, 403);
    assert.equal(orchestrator.requests.length, 0);
  });
});
