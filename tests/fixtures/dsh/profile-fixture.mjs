import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
export const digest = (value) => createHash("sha256").update(value).digest("hex");

// Entirely synthetic local files; no installed CLI, authentication or model.
export function profileFixture(t, model = "fixture-model") {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acp-dsh-profile-"));
  t.after(() => fs.rmSync(runRoot, { recursive: true, force: true }));
  const workspace = path.join(runRoot, "workspace");
  const clientHome = path.join(runRoot, "home");
  const agentsHome = path.join(runRoot, "agents-home");
  const profileDir = path.join(clientHome, "profiles", "headless");
  for (const dir of [workspace, agentsHome, profileDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "profile.yml"), "synthetic: true\n");
  const guardPath = path.join(runRoot, "guard.mjs");
  fs.writeFileSync(guardPath, "// synthetic guard, never loaded\nexport function apply() {}\n");
  const marker = "ACP_DSH_SYNTHETIC_MARKER";
  const expectedTool = { name: "pwsh", command: `Write-Output '${marker}'`, marker, maxTimeoutMs: 5000 };
  const effective = { provider: "deepseek-account", model, effort: "low", authentication: "client-owned-route",
    credentialFallback: "not-used-by-selected-route", fileEffects: "read-only", readIsolation: "not-enforced",
    networkIsolation: "not-enforced", toolPolicy: "fixed-command", maxSubagents: 0, approvalPolicy: "never" };
  const patch = [
    { id: "agent-default-model", config: { provider: effective.provider, model, reasoningEffort: effective.effort } },
    { id: "sandbox-policy", config: { mode: "read-only", workspaceRoot: workspace } },
    { id: "approval", config: { policy: "never" } },
    { id: "tools", config: { mode: "native" } },
    { id: "tool-pwsh", disabled: false, config: { enableRunInBackground: false, promoteOnTimeout: false } },
    { id: "credentials", disabled: false, config: { path: path.join(clientHome, ".credentials.yaml"), watch: false } },
    { id: "authorization", disabled: false },
    { id: "deepseek-account", disabled: false, config: { platformOrigin: "https://platform.deepseek.com", inferenceOrigin: "https://api.deepseek.com" } },
    { id: "llm-deepseek-account", disabled: false, config: { baseURL: "https://api.deepseek.com/anthropic", thinking: "enabled", reasoningEffort: "low", maxTokens: 256, modelOverrides: { [model]: { maxTokens: 256 } } } },
    ...["llm-deepseek", "llm-pi-ai", "llm-retry", "session-title-llm", "session-telemetry-otel", "tool-bash", "tool-web", "web-search-deepseek", "tool-subagent", "tool-subagent-fork"].map((id) => ({ id, disabled: true })),
    { insert: [{ id: "acp-marker-guard", name: guardPath, inject: ["tools"] }] },
  ];
  const patchPath = path.join(runRoot, "profile.patch.json");
  fs.writeFileSync(patchPath, JSON.stringify(patch));
  const runtime = { command: path.join(runRoot, "installed", "DeepSeek Harness.exe"),
    cliEntry: path.join(runRoot, "installed", "app.asar", "cli.js"),
    jobEntry: path.join(runRoot, "installed", "app.asar", "runner.js"),
    fingerprint: digest("SYNTHETIC-RUNTIME"), version: "0.2.1-rc.2" };
  const proofPath = path.join(runRoot, "profile-proof.json");
  const route = { entryId: "llm-deepseek-account", accountEntryId: "deepseek-account", baseURL: "https://api.deepseek.com/anthropic",
    platformOrigin: "https://platform.deepseek.com", inferenceOrigin: "https://api.deepseek.com", maxOutputTokens: 256 };
  const contract = { reviewReference: "SYNTHETIC-NOT-A-REAL-REVIEW", profile: "headless", runRoot, workspace,
    clientHome, agentsHome, patchPath, guardPath, proofPath, route, ...effective };
  let proof;
  function refresh() {
    proof = { schemaVersion: 1, source: "native-config-preflight", runtimeFingerprint: runtime.fingerprint,
      profile: contract.profile, runRoot, workspace, clientHome, agentsHome, effective, route,
      patchSha256: digest(fs.readFileSync(patchPath)), guardSha256: digest(fs.readFileSync(guardPath)), expectedTool,
      nativeChecks: { schemaExitCode: 0, configExitCode: 0, credentialsAbsentAtPreflight: true },
      nativeValidation: { jsonSchema: true },
      profileFiles: { "profile.yml": digest(fs.readFileSync(path.join(profileDir, "profile.yml"))) } };
    fs.writeFileSync(proofPath, JSON.stringify(proof));
    contract.proofSha256 = digest(fs.readFileSync(proofPath));
  }
  refresh();
  return { contract, runtime, patch, effective, expectedTool, refresh, get proof() { return proof; } };
}
