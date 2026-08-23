import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ControlPlaneError } from "./errors.js";
import { resolveRerouteConfig } from "./reroute.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..");

export function readPackageVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    );
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function versionParts(name) {
  const match = name.match(/^(\d+)\.(\d+)\.(\d+)-x86_64-pc-windows-msvc$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveCodexCommand(command) {
  if (/[\\/]/.test(command)) {
    const absolute = path.resolve(command);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new ControlPlaneError(
        "codex_not_found",
        `Configured Codex executable does not exist: ${absolute}`,
      );
    }
    return fs.realpathSync.native(absolute);
  }

  if (process.platform === "win32" && command === "codex") {
    const releases = path.join(
      os.homedir(),
      ".codex",
      "packages",
      "standalone",
      "releases",
    );
    if (fs.existsSync(releases)) {
      const candidates = fs
        .readdirSync(releases, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          version: versionParts(entry.name),
        }))
        .filter((entry) => entry.version)
        .sort((a, b) => compareVersions(b.version, a.version));

      for (const candidate of candidates) {
        const executable = path.join(releases, candidate.name, "bin", "codex.exe");
        const sandboxHelper = path.join(
          releases,
          candidate.name,
          "codex-resources",
          "codex-windows-sandbox-setup.exe",
        );
        if (fs.existsSync(executable) && fs.existsSync(sandboxHelper)) {
          return fs.realpathSync.native(executable);
        }
      }
    }
  }

  const pathEntries = String(process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const names =
    process.platform === "win32"
      ? [`${command}.exe`]
      : [command];
  for (const entry of pathEntries) {
    for (const name of names) {
      const candidate = path.resolve(entry, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) {
          return fs.realpathSync.native(candidate);
        }
      } catch {
        // Keep searching.
      }
    }
  }
  throw new ControlPlaneError(
    "codex_not_found",
    `Unable to resolve a trusted Codex executable: ${command}`,
  );
}

function merge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? merge(base?.[key] ?? {}, value)
        : value;
  }
  return result;
}

export function loadConfig(configPath = process.env.AGENT_CONTROL_CONFIG) {
  const defaultPath = path.join(projectRoot, "config", "default.json");
  const parseJsonFile = (target) =>
    JSON.parse(fs.readFileSync(target, "utf8").replace(/^\uFEFF/, ""));
  const defaults = parseJsonFile(defaultPath);
  let config = defaults;

  if (configPath) {
    const absolute = path.resolve(configPath);
    if (!fs.existsSync(absolute)) {
      throw new ControlPlaneError(
        "config_not_found",
        `Configuration file does not exist: ${absolute}`,
      );
    }
    config = merge(defaults, parseJsonFile(absolute));
  }

  const localPath = path.join(projectRoot, "config", "local.json");
  if (fs.existsSync(localPath)) {
    config = merge(config, parseJsonFile(localPath));
  }

  if (process.env.AGENT_CONTROL_PORT) {
    config.server.port = Number(process.env.AGENT_CONTROL_PORT);
  }
  if (process.env.AGENT_CONTROL_HOST) {
    config.server.host = process.env.AGENT_CONTROL_HOST;
  }
  config.server.authToken =
    process.env.AGENT_CONTROL_TOKEN ?? config.server.authToken ?? null;
  if (!Number.isInteger(config.server.port) || config.server.port < 1) {
    throw new ControlPlaneError("invalid_config", "server.port must be a valid port");
  }
  if (!Array.isArray(config.server.allowedOrigins)) {
    throw new ControlPlaneError(
      "invalid_config",
      "server.allowedOrigins must be an array",
    );
  }
  if (
    !Number.isInteger(config.server.maxMcpSessions) ||
    config.server.maxMcpSessions < 1 ||
    config.server.maxMcpSessions > 1024
  ) {
    throw new ControlPlaneError(
      "invalid_config",
      "server.maxMcpSessions must be an integer from 1 to 1024",
    );
  }
  if (
    !Number.isFinite(config.server.mcpSessionIdleMinutes) ||
    config.server.mcpSessionIdleMinutes < 1
  ) {
    throw new ControlPlaneError(
      "invalid_config",
      "server.mcpSessionIdleMinutes must be at least 1",
    );
  }
  if (typeof config.companion?.enabled !== "boolean") {
    throw new ControlPlaneError(
      "invalid_config",
      "companion.enabled must be a boolean",
    );
  }
  for (const [field, minimum, maximum] of [
    ["pairingTtlMinutes", 1, 60],
    ["maxClients", 1, 256],
    ["maxPending", 1, 128],
  ]) {
    const value = config.companion?.[field];
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new ControlPlaneError(
        "invalid_config",
        `companion.${field} must be an integer from ${minimum} to ${maximum}`,
      );
    }
  }
  if (typeof config.codex.networkAccess !== "boolean") {
    throw new ControlPlaneError(
      "invalid_config",
      "codex.networkAccess must be a boolean",
    );
  }
  for (const [field, minimum] of [
    ["maxBriefCharacters", 1],
    ["maxConcurrentTasks", 1],
    ["maxQueuedTasks", 1],
    ["maxTokenBudget", 1000],
    ["maxStoredTasks", 1],
    ["maxStoredEventsPerTask", 1],
    ["maxAuditBytes", 1024],
    ["maxTaskRuntimeMinutes", 1],
  ]) {
    if (!Number.isInteger(config.limits[field]) || config.limits[field] < minimum) {
      throw new ControlPlaneError(
        "invalid_config",
        `limits.${field} must be an integer of at least ${minimum}`,
      );
    }
  }
  if (
    config.limits.tokenUsagePollIntervalMs !== undefined &&
    (!Number.isInteger(config.limits.tokenUsagePollIntervalMs) ||
      config.limits.tokenUsagePollIntervalMs < 250)
  ) {
    throw new ControlPlaneError(
      "invalid_config",
      "limits.tokenUsagePollIntervalMs must be an integer of at least 250",
    );
  }
  const rateLimit = config.limits.rateLimit ?? { enabled: false };
  if (typeof rateLimit.enabled !== "boolean") {
    throw new ControlPlaneError(
      "invalid_config",
      "limits.rateLimit.enabled must be a boolean",
    );
  }
  if (
    rateLimit.enabled &&
    (!Number.isInteger(rateLimit.windowMs) || rateLimit.windowMs < 1000)
  ) {
    throw new ControlPlaneError(
      "invalid_config",
      "limits.rateLimit.windowMs must be an integer of at least 1000",
    );
  }
  if (
    rateLimit.enabled &&
    (!Number.isInteger(rateLimit.max) || rateLimit.max < 1)
  ) {
    throw new ControlPlaneError(
      "invalid_config",
      "limits.rateLimit.max must be an integer of at least 1",
    );
  }
  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!loopbackHosts.has(config.server.host)) {
    throw new ControlPlaneError(
      "loopback_required",
      "AgentControlPlane must bind to loopback; use a secure tunnel or TLS gateway for remote access",
    );
  }

  config.projectRoot = projectRoot;
  config.audit = {
    integrityKey:
      process.env.AGENT_CONTROL_AUDIT_KEY ?? config.audit?.integrityKey ?? null,
  };
  const configuredCodexCommand = config.codex.command;
  try {
    config.codex.command = resolveCodexCommand(configuredCodexCommand);
  } catch (error) {
    if ((config.executor?.provider ?? "auto") === "codex") throw error;
    config.codex.command = configuredCodexCommand;
    config.codex.discoveryError = error.message;
  }
  const routingOrder = config.executor?.routing?.order ?? [];
  if (
    !Array.isArray(routingOrder) ||
    routingOrder.some((provider) => typeof provider !== "string" || !provider)
  ) {
    throw new ControlPlaneError(
      "invalid_config",
      "executor.routing.order must be an array of executor ids",
    );
  }
  config.executor.reroute = resolveRerouteConfig(config.executor.reroute);
  if (!Array.isArray(config.workspaceRoots) || config.workspaceRoots.length === 0) {
    config.workspaceRoots = [path.dirname(projectRoot)];
  }
  config.workspaceRoots = config.workspaceRoots.map((root) => {
    const resolved = path.resolve(root);
    return fs.existsSync(resolved)
      ? fs.realpathSync.native(resolved)
      : resolved;
  });
  if (
    config.projectDiscoveryRoots !== undefined &&
    !Array.isArray(config.projectDiscoveryRoots)
  ) {
    throw new ControlPlaneError(
      "invalid_config",
      "projectDiscoveryRoots must be an array",
    );
  }
  config.projectDiscoveryRoots = (config.projectDiscoveryRoots ?? []).map((root) => {
    const resolved = path.resolve(root);
    return fs.existsSync(resolved)
      ? fs.realpathSync.native(resolved)
      : resolved;
  });
  const defaultStateDir =
    process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA ?? os.homedir(),
          "AgentControlPlane",
          "state",
        )
      : path.join(
          process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
          "agent-control-plane",
        );
  config.stateDir = path.resolve(
    process.env.AGENT_CONTROL_STATE_DIR ?? defaultStateDir,
  );
  config.version = readPackageVersion();
  if (
    [...config.workspaceRoots, ...config.projectDiscoveryRoots].some(
      (root) => isInside(root, config.stateDir) || isInside(config.stateDir, root),
    )
  ) {
    throw new ControlPlaneError(
      "unsafe_state_directory",
      "The state directory must be outside every allowed workspace root",
    );
  }
  if (
    path.isAbsolute(config.codex.command) &&
    config.workspaceRoots.some((root) => isInside(root, config.codex.command))
  ) {
    throw new ControlPlaneError(
      "unsafe_codex_command",
      "The Codex executable must be outside every allowed workspace root",
    );
  }
  return config;
}
