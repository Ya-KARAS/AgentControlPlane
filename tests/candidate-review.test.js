import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CandidateReviewService } from "../src/core/candidate-review.js";

function serviceHarness(overrides = {}) {
  const dispatched = [];
  const audits = [];
  let currentTime = Date.parse("2026-08-23T12:00:00.000Z");
  const service = new CandidateReviewService({
    dispatch(request) {
      dispatched.push(request);
      return { id: "task-1", status: "queued" };
    },
    validateApproval(selection) {
      if (selection.workspace !== "C:\\allowed") throw new Error("workspace denied");
      return { ...selection };
    },
    audit(type, payload) {
      audits.push({ type, payload });
    },
    now: () => currentTime,
    ttlMs: 60_000,
    statusTtlMs: 120_000,
    ...overrides,
  });
  return {
    service,
    dispatched,
    audits,
    advance(ms) {
      currentTime += ms;
    },
  };
}

function createCandidate(service, extra = {}) {
  return service.create(
    {
      objective: "Create a local review test",
      constraints: ["Touch one file"],
      source: "userscript-preview",
      ...extra,
    },
    { pageOrigin: "https://chatgpt.com" },
  );
}

test("candidate fields cannot select local execution options", () => {
  const { service, dispatched } = serviceHarness();
  assert.throws(
    () => createCandidate(service, { workspace: "C:\\allowed" }),
    (error) =>
      error.code === "candidate_fields_denied" &&
      error.details.fields.includes("workspace"),
  );
  assert.equal(dispatched.length, 0);
});

test("candidate stages bounded execution preferences for later validation", () => {
  const { service, dispatched } = serviceHarness();
  const created = createCandidate(service, {
    execution: {
      workspace: "C:\\allowed",
      executor: "opencode",
      profile: "economy",
      model: "opencode-go/deepseek-v4-pro",
      reasoning_effort: "high",
    },
  });
  assert.deepEqual(created.candidate.execution, {
    workspace: "C:\\allowed",
    executor: "opencode",
    profile: "economy",
    model: "opencode-go/deepseek-v4-pro",
    reasoning_effort: "high",
  });
  assert.equal(dispatched.length, 0);
  assert.throws(
    () => createCandidate(service, { execution: { api_key: "secret" } }),
    (error) => error.code === "candidate_execution_fields_denied",
  );
});

test("fresh approval applies staged execution preferences", () => {
  const { service, dispatched, audits } = serviceHarness();
  const created = createCandidate(service, {
    execution: {
      executor: "opencode",
      model: "opencode-go/deepseek-v4-pro",
      reasoning_effort: "high",
    },
  });
  const review = service.beginReview(created.candidate.id, created.reviewSecret);
  service.approve(created.candidate.id, review.approvalSecret, {
    workspace: "C:\\allowed",
    executor: "codex",
    profile: "economy",
  });
  assert.deepEqual(dispatched[0], {
    objective: "Create a local review test",
    constraints: ["Touch one file"],
    workspace: "C:\\allowed",
    executor: "opencode",
    profile: "economy",
    model: "opencode-go/deepseek-v4-pro",
    reasoning_effort: "high",
  });
  assert.deepEqual(
    audits.find((entry) => entry.type === "candidate.approved")?.payload,
    {
      candidateId: created.candidate.id,
      workspace: "C:\\allowed",
      executor: "opencode",
      profile: "economy",
      model: "opencode-go/deepseek-v4-pro",
      reasoningEffort: "high",
    },
  );
});

test("trusted userscript idempotency key reaches the orchestrator without becoming public", () => {
  const { service, dispatched } = serviceHarness();
  const created = service.create(
    {
      objective: "Create a local review test",
      constraints: [],
      source: "userscript-preview",
    },
    {
      pageOrigin: "https://chatgpt.com",
      idempotencyKey: "userscript:0123456789abcdef",
    },
  );
  assert.equal("idempotencyKey" in created.candidate, false);
  service.dispatchTrusted(created.candidate.id, {
    workspace: "C:\\allowed",
    executor: "opencode",
    profile: "economy",
  });
  assert.equal(dispatched[0].idempotency_key, "userscript:0123456789abcdef");
});

test("a candidate cannot dispatch before local review creates an approval secret", () => {
  const { service, dispatched } = serviceHarness();
  const created = createCandidate(service);
  assert.throws(
    () =>
      service.approve(created.candidate.id, "attacker-controlled", {
        workspace: "C:\\allowed",
        executor: "opencode",
        profile: "economy",
      }),
    (error) => error.code === "candidate_state_conflict",
  );
  assert.equal(dispatched.length, 0);
});

test("only a fresh local approval dispatches a candidate once", () => {
  const { service, dispatched, audits } = serviceHarness();
  const created = createCandidate(service);
  assert.equal(dispatched.length, 0);
  assert.equal(created.candidate.status, "pending");
  assert.equal("reviewSecret" in created.candidate, false);

  const review = service.beginReview(
    created.candidate.id,
    created.reviewSecret,
  );
  assert.equal(dispatched.length, 0);
  const result = service.approve(
    created.candidate.id,
    review.approvalSecret,
    { workspace: "C:\\allowed", executor: "opencode", profile: "economy" },
  );
  assert.equal(result.candidate.status, "dispatched");
  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0], {
    objective: "Create a local review test",
    constraints: ["Touch one file"],
    workspace: "C:\\allowed",
    executor: "opencode",
    profile: "economy",
  });
  assert.throws(
    () =>
      service.approve(created.candidate.id, review.approvalSecret, {
        workspace: "C:\\allowed",
        executor: "opencode",
        profile: "economy",
      }),
    (error) => error.code === "candidate_state_conflict",
  );
  assert.equal(dispatched.length, 1);
  assert.ok(audits.some((entry) => entry.type === "candidate.dispatched"));
  assert.ok(audits.every((entry) => !("objective" in entry.payload)));
});

test("refreshing review invalidates the previous approval secret", () => {
  const { service, dispatched } = serviceHarness();
  const created = createCandidate(service);
  const first = service.beginReview(created.candidate.id, created.reviewSecret);
  const second = service.beginReview(created.candidate.id, created.reviewSecret);
  assert.throws(
    () =>
      service.approve(created.candidate.id, first.approvalSecret, {
        workspace: "C:\\allowed",
        executor: "opencode",
        profile: "economy",
      }),
    (error) => error.code === "candidate_approval_denied",
  );
  service.approve(created.candidate.id, second.approvalSecret, {
    workspace: "C:\\allowed",
    executor: "opencode",
    profile: "economy",
  });
  assert.equal(dispatched.length, 1);
});

test("local approval is invalidated when the reviewed project path revision changes", () => {
  let revision = 1;
  const projectId = "project:11111111-1111-4111-8111-111111111111";
  const { service, dispatched } = serviceHarness({
    captureApprovalContext: () => ({
      project_path_revisions: { [projectId]: revision },
    }),
    validateApproval(selection) {
      return {
        ...selection,
        workspace: "C:\\allowed",
        project_id: projectId,
        project_path_revision: revision,
      };
    },
  });
  const created = createCandidate(service);
  const review = service.beginReview(created.candidate.id, created.reviewSecret);
  revision = 2;
  assert.throws(
    () =>
      service.approve(created.candidate.id, review.approvalSecret, {
        workspace: projectId,
        executor: "opencode",
        profile: "economy",
      }),
    (error) => error.code === "candidate_project_revision_conflict",
  );
  assert.equal(dispatched.length, 0);
});

test("expired candidates cannot be reviewed or dispatched", () => {
  const { service, advance, dispatched } = serviceHarness();
  const created = createCandidate(service);
  advance(60_001);
  assert.throws(
    () => service.beginReview(created.candidate.id, created.reviewSecret),
    (error) => error.code === "candidate_expired",
  );
  assert.equal(dispatched.length, 0);
});

test("status access is origin-bound, secret-bound, and longer-lived than review", () => {
  const { service, advance } = serviceHarness({
    resolveTaskStatus: (taskId) => ({ id: taskId, status: "queued" }),
  });
  const created = createCandidate(service);
  assert.throws(
    () => service.readStatus(created.candidate.id, "wrong", {
      pageOrigin: "https://chatgpt.com",
    }),
    (error) => error.code === "candidate_status_denied",
  );
  assert.throws(
    () => service.readStatus(created.candidate.id, created.statusSecret, {
      pageOrigin: "https://attacker.example",
    }),
    (error) => error.code === "candidate_status_denied",
  );

  const pending = service.readStatus(
    created.candidate.id,
    created.statusSecret,
    { pageOrigin: "https://chatgpt.com" },
  );
  assert.equal(pending.candidate.status, "pending");
  assert.equal("objective" in pending.candidate, false);
  assert.equal(pending.task, null);

  advance(60_001);
  assert.throws(
    () => service.beginReview(created.candidate.id, created.reviewSecret),
    (error) => error.code === "candidate_expired",
  );
  assert.equal(
    service.readStatus(created.candidate.id, created.statusSecret, {
      pageOrigin: "https://chatgpt.com",
    }).candidate.status,
    "expired",
  );

  advance(60_000);
  assert.throws(
    () => service.readStatus(created.candidate.id, created.statusSecret, {
      pageOrigin: "https://chatgpt.com",
    }),
    (error) => error.code === "candidate_status_expired",
  );
});

test("candidate core remains independent from transports and executors", () => {
  const source = fs.readFileSync(
    path.resolve("src", "core", "candidate-review.js"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /(?:local-review|server\.js|orchestrator|executors?\/|\bwindow\b|\bdocument\b|GM_xmlhttpRequest|MCP)/i,
  );
});
