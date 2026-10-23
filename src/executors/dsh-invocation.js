import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveWorkspace } from "../core/workspace.js";
import { ControlPlaneError } from "../core/errors.js";

const fail = (code) => new ControlPlaneError(code,
  code === "dsh_output_limit" ? "DSH output exceeded the configured limit" : "DSH protocol or installation is unsupported",
  { safeToReroute: false });
const counter = (value) => Number.isSafeInteger(value) && value >= 0;
const identifier = (value) => counter(value) ||
  (typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value));
const launcher = '@echo off\nsetlocal DisableDelayedExpansion\nset "ELECTRON_RUN_AS_NODE=1"\n"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*\nexit /b %errorlevel%';

const hash = (value) => createHash("sha256").update(value).digest("hex");
const runtimeCache = new Map();
// Protocol pins for the installed 0.2.1-rc.2 runner, its Win32 ABI owner and
// selected-route authentication evidence. This is client metadata, not an API call.
const pinnedModules = Object.freeze({
  "dsh-subprocess-local/lib/runner.js": "4e21528dfdb3e92bdce2340945dc4dcb202e4a4af0bbeb8b97585f67735d30c1",
  "dsh-subprocess-local/lib/runner-launch-B2zsQ1Dz.js": "6df08adc4a27f278878a5f4cde8b551b51e647b922ac7d6591fd62d272ced153",
  "dsh-win32-process/lib/index.js": "622bc3a9e97c46e784fe41c9a0a8535da2808019e4ac3f66d17cdad70c9ac0c9",
  "dsh-llm-deepseek-account/lib/index.js": "f4f9d77e82a6800b56884f8d31e4f21d18214e3625368ae2572c1cf35a4200d4",
  "dsh-base/cordis.patch.yml": "a2cc57868a4d016609801e28781262515483dde29b41c2742d9a3b27a6f52f77",
  "dsh-headless/cordis.patch.yml": "f4d5f53f070089a7fc5209bd47c9ae4e85b99d042cbe76be88ab1ed63dfb8fc8",
  "dsh-agent-default-model/lib/index.js": "3685a0d4665007cfd377f6555a2a0eeea061cd9e7eb87102430771858ac0bbcb",
  "dsh-tools/lib/index.js": "1e53932e7c4213ea24a7d87f06960b7a7702cb21f8a5741c97242b4a470a442a",
});
const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel);
};
const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
function boundedFile(file, limit = 1048576) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw fail("dsh_profile_drift");
  return fs.readFileSync(file);
}
function fileHash(file) {
  const digest = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1048576);
    let count;
    while ((count = fs.readSync(fd, buffer)) > 0) digest.update(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return digest.digest("hex");
}
function archiveMetadata(archive) {
  const fd = fs.openSync(archive, "r");
  const read = (length, position) => {
    const data = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const n = fs.readSync(fd, data, offset, length - offset, position + offset);
      if (!n) throw fail("dsh_installation_unsupported");
      offset += n;
    }
    return data;
  };
  try {
    const header = read(16, 0);
    const length = header.readUInt32LE(12);
    if (length < 2 || length > 67108864) throw fail("dsh_installation_unsupported");
    const tree = JSON.parse(read(length, 16).toString("utf8"));
    const base = 8 + header.readUInt32LE(4);
    const entry = (short) => {
      let node = tree;
      for (const part of (`dsh/node_modules/@deepseek-ai/${short}`).split("/")) node = node.files[part];
      if (node.unpacked || !Number.isSafeInteger(node.size) || node.size > 8388608) throw fail("dsh_installation_unsupported");
      const position = base + Number(node.offset);
      if (!Number.isSafeInteger(position) || position < base) throw fail("dsh_installation_unsupported");
      return read(node.size, position);
    };
    const version = JSON.parse(entry("dsh/package.json")).version;
    if (version !== "0.2.1-rc.2") throw fail("dsh_installation_unsupported");
    const modules = Object.fromEntries(Object.keys(pinnedModules).map((name) => [name, hash(entry(name))]));
    if (Object.entries(pinnedModules).some(([name, digest]) => modules[name] !== digest)) throw fail("dsh_runner_drift");
    return { version, modules };
  } finally { fs.closeSync(fd); }
}

export function inspectDshInstallation(installationRoot) {
  if (!installationRoot || !path.isAbsolute(installationRoot)) throw fail("dsh_installation_unavailable");
  try {
    const root = fs.realpathSync.native(installationRoot);
    const command = path.join(root, "DeepSeek Harness.exe");
    const resources = path.join(root, "resources");
    const shimPath = path.join(resources, "runtime", "cli", "bin", "dsh.cmd");
    const shim = boundedFile(shimPath, 16384);
    if (shim.toString("utf8").replaceAll("\r\n", "\n").trim() !== launcher) throw fail("dsh_launcher_unsupported");
    const archive = path.join(resources, "app.asar");
    const stat = fs.statSync(archive, { bigint: true });
    const executableStat = fs.statSync(command, { bigint: true });
    if (!stat.isFile() || !executableStat.isFile()) throw fail("dsh_installation_unavailable");
    const cacheKey = `${archive}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${hash(shim)}:${executableStat.size}:${executableStat.mtimeNs}:${executableStat.ctimeNs}`;
    const cached = runtimeCache.get(cacheKey);
    if (cached) return cached;
    const metadata = archiveMetadata(archive);
    const fingerprint = hash(JSON.stringify({ archive: fileHash(archive), executable: fileHash(command), shim: hash(shim), ...metadata }));
    const currentArchive = fs.statSync(archive, { bigint: true });
    const currentExe = fs.statSync(command, { bigint: true });
    if (currentArchive.mtimeNs !== stat.mtimeNs || currentArchive.ctimeNs !== stat.ctimeNs || currentArchive.size !== stat.size ||
        currentExe.mtimeNs !== executableStat.mtimeNs || currentExe.ctimeNs !== executableStat.ctimeNs || currentExe.size !== executableStat.size) throw fail("dsh_runner_drift");
    const runtime = Object.freeze({ command, fingerprint, version: metadata.version,
      cliEntry: path.join(archive, "dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "cli.js"),
      jobEntry: path.join(archive, "dsh", "node_modules", "@deepseek-ai", "dsh-subprocess-local", "lib", "runner.js") });
    runtimeCache.clear(); runtimeCache.set(cacheKey, runtime);
    return runtime;
  } catch (error) {
    if (error instanceof ControlPlaneError) throw error;
    throw fail("dsh_installation_unsupported");
  }
}

export function dshProfileFiles(directory) {
  const files = {};
  function visit(dir, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue; // Client-owned dependency resolution; archive is pinned separately.
      const relative = `${prefix}${entry.name}`;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink() || /^(?:\.env|\.?credentials)/i.test(entry.name)) throw fail("dsh_profile_drift");
      if (entry.isDirectory()) visit(full, `${relative}/`);
      else files[relative] = hash(boundedFile(full));
    }
  }
  visit(directory);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

// This checks immutable local artifacts from a no-credential/native-config
// preflight. It does not authenticate or claim kernel read/network isolation.
export function verifyDshProfile(contract, { runtime, installationRoot, workspaceRoots = [] } = {}) {
  if (!contract || typeof contract.reviewReference !== "string" || !contract.reviewReference.trim() ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(contract.profile) || !/^[a-f0-9]{64}$/.test(contract.proofSha256)) {
    throw fail("dsh_client_contract_required");
  }
  try {
    const rt = runtime ?? inspectDshInstallation(installationRoot);
    const root = resolveWorkspace(contract.runRoot, workspaceRoots);
    const dirs = ["workspace", "clientHome", "agentsHome"];
    for (const field of dirs) {
      if (!path.isAbsolute(contract[field])) throw fail("dsh_profile_drift");
      const actual = fs.realpathSync.native(contract[field]);
      if (!inside(root, actual)) throw fail("dsh_profile_drift");
      for (const other of dirs.filter((x) => x !== field)) {
        const target = path.resolve(contract[other]);
        if (same(actual, target) || inside(actual, target)) throw fail("dsh_profile_drift");
      }
    }
    for (const field of ["patchPath", "proofPath", "guardPath"]) {
      if (!inside(root, fs.realpathSync.native(contract[field]))) throw fail("dsh_profile_drift");
    }
    for (const dir of [root, contract.workspace, contract.clientHome]) {
      if (fs.existsSync(path.join(dir, ".env"))) throw fail("dsh_profile_drift");
    }
    if (fs.existsSync(path.join(contract.clientHome, "cordis.patch.yml"))) throw fail("dsh_profile_drift");
    const proofBytes = boundedFile(contract.proofPath);
    if (hash(proofBytes) !== contract.proofSha256) throw fail("dsh_profile_drift");
    const proof = JSON.parse(proofBytes);
    if (proof.schemaVersion !== 1 || proof.source !== "native-config-preflight" || proof.runtimeFingerprint !== rt.fingerprint ||
        proof.profile !== contract.profile || proof.nativeChecks?.schemaExitCode !== 0 || proof.nativeChecks?.configExitCode !== 0 ||
        proof.nativeChecks?.credentialsAbsentAtPreflight !== true || proof.nativeValidation?.jsonSchema !== true) throw fail("dsh_profile_drift");
    for (const field of ["runRoot", ...dirs]) {
      if (typeof proof[field] !== "string" || !same(path.resolve(proof[field]), path.resolve(contract[field]))) throw fail("dsh_profile_drift");
    }
    const effective = proof.effective;
    if (typeof effective?.provider !== "string" || !effective.provider.trim() || typeof effective.model !== "string" || !effective.model.trim() ||
        !["off", "low", "high", "max"].includes(effective.effort)) throw fail("dsh_profile_drift");
    for (const field of ["provider", "model", "effort", "authentication", "credentialFallback", "fileEffects",
      "readIsolation", "networkIsolation", "toolPolicy", "maxSubagents", "approvalPolicy"]) {
      if (effective?.[field] !== contract[field]) throw fail("dsh_profile_drift");
    }
    if (effective.authentication !== "client-owned-route" || effective.credentialFallback !== "not-used-by-selected-route" ||
        effective.fileEffects !== "read-only" || effective.readIsolation !== "not-enforced" || effective.networkIsolation !== "not-enforced" ||
        effective.toolPolicy !== "fixed-command" || effective.maxSubagents !== 0 || effective.approvalPolicy !== "never") throw fail("dsh_profile_drift");
    const patchBytes = boundedFile(contract.patchPath);
    if (hash(patchBytes) !== proof.patchSha256 || hash(boundedFile(contract.guardPath, 65536)) !== proof.guardSha256) throw fail("dsh_profile_drift");
    const profileFiles = dshProfileFiles(path.join(contract.clientHome, "profiles", contract.profile));
    if (JSON.stringify(profileFiles) !== JSON.stringify(proof.profileFiles)) throw fail("dsh_profile_drift");
    const patch = JSON.parse(patchBytes); // Deliberate JSON subset of YAML: no !!js, tags, anchors or hidden merges.
    if (!Array.isArray(patch)) throw fail("dsh_profile_drift");
    function rejectSecrets(node) {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (["__jsExpr", "__proto__", "prototype"].includes(key)) throw fail("dsh_profile_drift");
        if (/^(?:apiKey|apiKeyEnv|accessToken|refreshToken|password|requestHeaders|accountRequestHeaders)$/i.test(key) &&
            value != null && value !== "" && !(typeof value === "object" && Object.keys(value).length === 0)) throw fail("dsh_profile_drift");
        rejectSecrets(value);
      }
    }
    rejectSecrets(patch);
    const rows = new Map();
    for (const row of patch) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw fail("dsh_profile_drift");
      if (row.id) {
        if (Object.keys(row).some((key) => !["id", "config", "disabled"].includes(key)) || rows.has(row.id)) throw fail("dsh_profile_drift");
        rows.set(row.id, row);
      } else if (Object.keys(row).length !== 1 || !Array.isArray(row.insert)) throw fail("dsh_profile_drift");
    }
    const selection = rows.get("agent-default-model")?.config;
    const policy = rows.get("sandbox-policy")?.config;
    const shell = rows.get("tool-pwsh");
    const credentials = rows.get("credentials");
    if (selection?.provider !== effective.provider || selection?.model !== effective.model || selection?.reasoningEffort !== effective.effort ||
        policy?.mode !== "read-only" || !same(path.resolve(policy.workspaceRoot), path.resolve(contract.workspace)) ||
        rows.get("approval")?.config?.policy !== "never" || rows.get("tools")?.config?.mode !== "native" ||
        shell?.disabled !== false || shell.config?.enableRunInBackground !== false || shell.config?.promoteOnTimeout !== false ||
        credentials?.disabled !== false || credentials.config?.watch !== false ||
        !same(path.resolve(credentials.config?.path), path.join(contract.clientHome, ".credentials.yaml"))) throw fail("dsh_profile_drift");
    for (const id of ["llm-deepseek", "llm-pi-ai", "llm-retry", "session-title-llm", "session-telemetry-otel",
      "tool-bash", "tool-web", "web-search-deepseek", "tool-subagent", "tool-subagent-fork"]) {
      if (rows.get(id)?.disabled !== true) throw fail("dsh_profile_drift");
    }
    const route = proof.route;
    for (const key of ["entryId", "accountEntryId", "baseURL", "platformOrigin", "inferenceOrigin", "maxOutputTokens"]) {
      if (route?.[key] !== contract.route?.[key]) throw fail("dsh_profile_drift");
    }
    if (!route || !Number.isInteger(route.maxOutputTokens) || route.maxOutputTokens < 1 || route.maxOutputTokens > 256) throw fail("dsh_profile_drift");
    for (const key of ["baseURL", "platformOrigin", "inferenceOrigin"]) {
      const url = new URL(route[key]);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
          (key !== "baseURL" && url.origin !== route[key])) throw fail("dsh_profile_drift");
    }
    const adapter = rows.get(route.entryId);
    const account = rows.get(route.accountEntryId);
    if (adapter?.disabled !== false || account?.disabled !== false || rows.get("authorization")?.disabled !== false ||
        adapter.config?.baseURL !== route.baseURL || adapter.config?.maxTokens !== route.maxOutputTokens ||
        adapter.config?.modelOverrides?.[effective.model]?.maxTokens !== route.maxOutputTokens ||
        adapter.config?.reasoningEffort !== effective.effort || adapter.config?.thinking !== (effective.effort === "off" ? "disabled" : "enabled") ||
        account.config?.platformOrigin !== route.platformOrigin || account.config?.inferenceOrigin !== route.inferenceOrigin ||
        new URL(route.baseURL).origin !== route.inferenceOrigin) throw fail("dsh_profile_drift");
    const guard = patch.flatMap((row) => row.insert ?? []).filter((row) => row.id === "acp-marker-guard");
    const expected = proof.expectedTool;
    if (patch.flatMap((row) => row.insert ?? []).length !== (proof.compatibility ? 2 : 1) || guard.length !== 1 ||
        guard[0].name !== contract.guardPath || guard[0].disabled === true ||
        expected?.name !== "pwsh" || !/^ACP_[A-Z0-9_]{1,100}$/.test(expected.marker) ||
        expected.command !== `Write-Output '${expected.marker}'` || !Number.isInteger(expected.maxTimeoutMs) ||
        expected.maxTimeoutMs < 1 || expected.maxTimeoutMs > 5000) throw fail("dsh_profile_drift");
    if (proof.compatibility || contract.compatibility) {
      const c = contract.compatibility;
      const fields = ["modulePath", "moduleSha256", "pwshPath", "pwshSha256", "pwshVersion", "command", "cliEntry"];
      if (!c || fields.some((key) => c[key] !== proof.compatibility?.[key]) || Object.keys(c).some((key) => !fields.includes(key)) ||
          !inside(root, fs.realpathSync.native(c.modulePath)) || hash(boundedFile(c.modulePath, 65536)) !== c.moduleSha256 ||
          !path.isAbsolute(c.pwshPath) || hash(boundedFile(c.pwshPath, 16777216)) !== c.pwshSha256 ||
          !/^7\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?$/.test(c.pwshVersion) || c.command !== expected.command || c.cliEntry !== rt.cliEntry) throw fail("dsh_profile_drift");
      const candidates = patch.flatMap((row) => row.insert ?? []).filter((row) => row.id === "acp-pwsh-compat");
      const row = candidates[0];
      const config = { cliEntry: c.cliEntry, pwshPath: c.pwshPath, pwshSha256: c.pwshSha256, pwshVersion: c.pwshVersion, command: c.command };
      if (rows.get("pwsh-sandbox")?.disabled !== true || candidates.length !== 1 || row?.disabled !== false ||
          row.name !== c.modulePath || Object.keys(row).some((key) => !["id", "name", "disabled", "config"].includes(key)) ||
          Object.keys(row.config ?? {}).length !== Object.keys(config).length ||
          Object.entries(config).some(([key, value]) => row.config?.[key] !== value)) throw fail("dsh_profile_drift");
    }
    return Object.freeze({ ...contract, expectedTool: Object.freeze({ ...expected }), runtime: rt,
      proofHash: contract.proofSha256, runtimeVerified: false });
  } catch (error) {
    if (error instanceof ControlPlaneError && error.code === "dsh_client_contract_required") throw error;
    throw fail("dsh_profile_drift");
  }
}

// Inspect the installed public launcher, never execute help or initialize a profile.
// The exact supported launcher is expanded to argv rather than invoking cmd.exe.
export function buildDshInvocation({ installationRoot, clientContract, workspaceRoots = [], sessionId = null,
  environment = process.env } = {}, { inspectInstallation = inspectDshInstallation } = {}) {
  const runtime = inspectInstallation(installationRoot);
  const verified = verifyDshProfile(clientContract, { runtime, workspaceRoots });
  const { profile } = verified;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(profile) ||
      (sessionId != null && !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId))) throw fail("dsh_invalid_argument");
  const env = {};
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "userprofile", "home",
    "localappdata", "appdata", "temp", "tmp", "pathext"]);
  for (const [name, value] of Object.entries(environment)) {
    if (allowed.has(name.toLowerCase()) && typeof value === "string") env[name] = value;
  }
  env.ELECTRON_RUN_AS_NODE = "1";
  env.DSH_HOME = verified.clientHome;
  env.DSH_AGENTS_HOME = verified.agentsHome;
  const args = ["--expose-internals", runtime.cliEntry, "--profile", profile, "--patch", verified.patchPath,
    "--json", ...(sessionId ? ["--session-id", sessionId] : []), "-"];
  return { command: runtime.command, args, profileProofHash: verified.proofHash, expectedTool: verified.expectedTool,
    options: { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env },
    owner: { command: runtime.command, args: ["--expose-internals", runtime.jobEntry, "--", runtime.command, ...args],
      env: { ...env, DSH_SUBPROCESS_RUNNER: "windows" } } };
}

// This is a projection, not an event recording. Thinking, text deltas, tool
// arguments/results and native error messages are deliberately discarded.
export class DshJsonStream {
  constructor({ maxLineBytes = 524288, maxFinalBytes = 262144, maxOutputBytes = 2097152, expectedTool = null } = {}) {
    for (const limit of [maxLineBytes, maxFinalBytes, maxOutputBytes]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw fail("dsh_invalid_limit");
    }
    Object.assign(this, { maxLineBytes, maxFinalBytes, maxOutputBytes });
    this.pending = Buffer.alloc(0);
    this.bytes = 0;
    this.steps = new Set();
    this.knownSteps = 0;
    this.totals = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    this.sessionId = null;
    this.cwd = null;
    this.finalText = null;
    this.reason = null;
    this.nativeError = false;
    this.currentTurn = null;
    this.currentStep = null;
    this.seenTurns = new Set();
    this.expectedTool = expectedTool;
    this.toolCallId = null;
    this.toolVerified = false;
    this.toolInvalid = false;
  }

  push(chunk) {
    if (this.finished) throw fail("dsh_protocol_error");
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.bytes += bytes.length;
    if (this.bytes > this.maxOutputBytes) throw fail("dsh_output_limit");
    this.pending = Buffer.concat([this.pending, bytes]);
    let end;
    while ((end = this.pending.indexOf(10)) >= 0) {
      if (end > this.maxLineBytes) throw fail("dsh_output_limit");
      this.line(this.pending.subarray(0, end));
      this.pending = this.pending.subarray(end + 1);
    }
    if (this.pending.length > this.maxLineBytes) throw fail("dsh_output_limit");
  }

  line(bytes) {
    if (!bytes.length || bytes.toString("ascii") === "\r") return;
    let event;
    try { event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw fail("dsh_protocol_error"); }
    if (!event || typeof event !== "object" || Array.isArray(event)) throw fail("dsh_protocol_error");
    if (this.finalText !== null || (!this.sessionId && !["session", "error"].includes(event.type))) {
      throw fail("dsh_protocol_error");
    }
    switch (event.type) {
      case "session":
        if (this.sessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(event.sessionId) ||
            typeof event.cwd !== "string" || event.cwd.length > 32768) throw fail("dsh_protocol_error");
        this.sessionId = event.sessionId;
        this.cwd = event.cwd;
        break;
      case "status":
        if (!identifier(event.turn)) throw fail("dsh_protocol_error");
        if (event.phase === "turn_end") {
          if (this.currentTurn !== event.turn || this.currentStep !== null ||
              typeof event.reason?.kind !== "string") throw fail("dsh_protocol_error");
          this.reason = event.reason.kind === "completed" ? "completed" : "non_completed";
          this.currentTurn = null;
        } else if (event.phase === "step_end") {
          const id = `${event.turn}:${event.step}`;
          if (this.steps.has(id) || this.currentTurn !== event.turn || this.currentStep !== event.step ||
              !identifier(event.step)) throw fail("dsh_protocol_error");
          this.steps.add(id);
          this.currentStep = null;
          const u = event.usage;
          if (u && counter(u.inputTokens) && counter(u.outputTokens) &&
              (u.totalTokens == null || u.totalTokens === u.inputTokens + u.outputTokens) &&
              counter(u.inputTokens + u.outputTokens)) {
            this.knownSteps++;
            this.totals.input_tokens += u.inputTokens;
            this.totals.output_tokens += u.outputTokens;
            this.totals.total_tokens += u.inputTokens + u.outputTokens;
            if (!counter(this.totals.total_tokens)) throw fail("dsh_protocol_error");
          }
        } else if (event.phase === "turn_start") {
          if (this.currentTurn !== null || this.seenTurns.has(event.turn)) throw fail("dsh_protocol_error");
          this.currentTurn = event.turn;
          this.seenTurns.add(event.turn);
          this.reason = null;
        } else if (event.phase === "step_start") {
          if (this.currentTurn !== event.turn || this.currentStep !== null || !identifier(event.step) ||
              this.steps.has(`${event.turn}:${event.step}`)) throw fail("dsh_protocol_error");
          this.currentStep = event.step;
        } else throw fail("dsh_protocol_error");
        break;
      case "final":
        if (!this.reason || this.currentTurn !== null || this.currentStep !== null ||
            typeof event.text !== "string") throw fail("dsh_protocol_error");
        if (Buffer.byteLength(event.text) > this.maxFinalBytes) throw fail("dsh_output_limit");
        this.finalText = event.text;
        break;
      case "error": this.nativeError = true; break;
      case "tool_call":
        if (this.expectedTool) {
          const a = event.input;
          if (this.toolCallId || event.tool !== this.expectedTool.name || typeof event.callId !== "string" || event.callId.length > 128 ||
              a?.command !== this.expectedTool.command || a.run_in_background === true || a.sandbox_permissions != null ||
              a.justification != null || !Number.isFinite(a.timeoutMs) || a.timeoutMs <= 0 || a.timeoutMs > this.expectedTool.maxTimeoutMs) {
            this.toolInvalid = true;
          } else this.toolCallId = event.callId;
        }
        break;
      case "tool_result":
        if (this.expectedTool) {
          if (this.toolVerified || !this.toolCallId || event.callId !== this.toolCallId || event.status !== "completed" ||
              typeof event.result !== "string" || event.result.trim() !== this.expectedTool.marker) {
            this.toolInvalid = true;
          } else this.toolVerified = true;
        }
        break;
      case "thinking": case "text": break;
      default: throw fail("dsh_protocol_error");
    }
  }

  usageEvidence(complete = false) {
    const known = this.knownSteps ? { ...this.totals, cached_input_tokens: null,
      uncached_input_tokens: null, reasoning_output_tokens: null } : null;
    const state = complete && this.steps.size > 0 && this.knownSteps === this.steps.size ? "complete" :
      this.knownSteps ? "partial" : "unknown";
    return { state, usage: state === "complete" ? known : null, knownUsage: known,
      observedSteps: this.steps.size, missingSteps: this.steps.size - this.knownSteps };
  }

  finish(code, signal = null) {
    if (this.finished) throw fail("dsh_protocol_error");
    if (this.pending.length) this.line(this.pending);
    this.pending = Buffer.alloc(0);
    this.finished = true;
    const toolComplete = !this.expectedTool || (this.toolVerified && !this.toolInvalid);
    const complete = code === 0 && !signal && this.sessionId && this.reason === "completed" &&
      this.finalText !== null && !this.nativeError && toolComplete;
    return { status: complete ? "completed" : "failed", sessionId: this.sessionId, cwd: this.cwd,
      finalText: complete ? this.finalText : "", safeToReroute: false,
      toolEvidence: this.expectedTool ? { verified: Boolean(toolComplete), commandSha256: hash(this.expectedTool.command) } : null,
      usageEvidence: this.usageEvidence(Boolean(complete)),
      error: complete ? null : { code: this.nativeError ? "dsh_native_error" : !toolComplete ? "dsh_tool_execution_unconfirmed" : "dsh_incomplete_run",
        message: "DSH did not confirm a successful completed run", details: { safeToReroute: false } } };
  }
}
