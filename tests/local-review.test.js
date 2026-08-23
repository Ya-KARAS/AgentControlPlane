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

  getModels() {
    return [];
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
    await callback({ baseUrl: `http://127.0.0.1:${port}`, orchestrator });
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
    assert.equal(orchestrator.requests.length, 0);
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
