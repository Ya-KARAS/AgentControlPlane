import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RemoteRelayCredentials, normalizeRelayUrl } from "../src/remote-relay/credentials.js";
import { RemoteRelayWorker } from "../src/remote-relay/worker.js";

test("remote relay accepts HTTPS and loopback HTTP only", () => {
  assert.equal(normalizeRelayUrl("https://acp.example.com/"), "https://acp.example.com");
  assert.equal(normalizeRelayUrl("http://127.0.0.1:8787/"), "http://127.0.0.1:8787");
  assert.throws(() => normalizeRelayUrl("http://example.com"), /HTTPS/);
});

test("pairing stores the bearer credential locally but never exposes it", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-remote-"));
  const calls = [];
  const credentials = new RemoteRelayCredentials({
    stateDir,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ client_id: "client-1", token: "a".repeat(48) }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const current = await credentials.pair({
    baseUrl: "https://acp.example.com/",
    code: "ABCD-1234",
    label: "Desk",
  });
  assert.deepEqual(current, {
    configured: true,
    base_url: "https://acp.example.com",
    client_id: "client-1",
    label: "Desk",
  });
  assert.doesNotMatch(JSON.stringify(current), /a{20}/);
  assert.match(await credentials.authorization(), /^Bearer a{48}$/);
  assert.equal(JSON.parse(calls[0].options.body).kind, "executor");
});

test("paired devices refresh short-lived access tokens without exposing the refresh credential", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-remote-rolling-"));
  const refreshToken = `acpr_${"r".repeat(48)}`;
  const firstAccess = `acpa_${"a".repeat(40)}.${"s".repeat(40)}`;
  const secondAccess = `acpa_${"b".repeat(40)}.${"t".repeat(40)}`;
  const calls = [];
  const credentials = new RemoteRelayCredentials({
    stateDir,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/pairings/claim")) {
        return new Response(JSON.stringify({
          client_id: "client-rolling",
          token: refreshToken,
          refresh_token: refreshToken,
          access_token: firstAccess,
          access_token_expires_at: "2020-01-01T00:00:00.000Z",
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/tokens/refresh")) {
        return new Response(JSON.stringify({
          access_token: secondAccess,
          access_token_expires_at: "2999-01-01T00:00:00.000Z",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  await credentials.pair({ baseUrl: "https://acp.example.com", code: "ABCD-1234", label: "Desk" });
  assert.equal(await credentials.authorization(), `Bearer ${secondAccess}`);
  assert.equal(calls[1].options.headers.authorization, `Bearer ${refreshToken}`);
  assert.doesNotMatch(JSON.stringify(credentials.current()), /acpr_|acpa_/);
});

test("worker claims, dispatches, and uploads only the safe projection", async () => {
  const requests = [];
  const localTask = {
    id: "local-1",
    status: "completed",
    project_id: "project:calc",
    executor: "opencode",
    policy: { name: "economy", model: "deepseek/x", effort: "low" },
    result: { status: "completed", changed_files: ["calculator.js"], tests: [{ status: "passed", detail: "# tests 8\n# pass 8\n# fail 0" }], blockers: [] },
    updatedAt: "2026-08-23T10:00:00.000Z",
    completedAt: "2026-08-23T10:00:00.000Z",
  };
  let claimCount = 0;
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/claim")) {
      claimCount += 1;
      return new Response(JSON.stringify({
        task: {
          id: "remote-1",
          candidate: {
            objective: "Run calculator tests",
            constraints: [],
            execution: { workspace: "project:calc" },
          },
        },
        lease_token: "lease-1",
      }), { status: 200 });
    }
    if (url.endsWith("/complete")) return new Response("{}", { status: 200 });
    throw new Error(`unexpected ${url}`);
  };
  const created = [];
  const worker = new RemoteRelayWorker({
    credentials: {
      current: () => ({ configured: true, base_url: "https://acp.example.com" }),
      authorization: () => "Bearer token",
    },
    candidateReview: {
      create(candidate, context) {
        created.push({ candidate, context });
        return { candidate: { id: "candidate-1" } };
      },
      dispatchTrusted() {
        return { task: { id: "local-1" } };
      },
    },
    settings: { autoDispatchSelection: () => ({ workspace: "project:calc", executor: "opencode", profile: "economy" }) },
    store: { getTask: () => localTask },
    fetchImpl,
  });
  await worker.tick();
  await worker.tick();
  assert.equal(claimCount, 1);
  assert.equal(created[0].candidate.source, "userscript-preview");
  assert.equal(created[0].context.idempotencyKey, "remote:remote-1");
  const completion = requests.find((entry) => entry.url.endsWith("/complete"));
  const body = JSON.parse(completion.options.body);
  assert.equal(body.result.changed_files_count, 1);
  assert.equal(body.result.test_cases.total, 8);
  assert.doesNotMatch(completion.options.body, /calculator\.js/);
});
