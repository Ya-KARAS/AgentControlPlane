import { createRequire } from "node:module";
import { loadConfig } from "../src/core/config.js";
import { resolveExecutable } from "../src/executors/discovery.js";
import { resolveZCodeInvocation } from "../src/executors/zcode-executor.js";

const require = createRequire(import.meta.url);

async function buildPreflightCandidates(config, requested) {
  const { buildExecutor, buildExecutors } = await import("../src/server.js");
  const builtIns = ["codex", "openai-compatible", "deepseek", "claude", "opencode", "kimi", "zcode"];
  if (requested !== "auto" && builtIns.includes(requested)) {
    return new Map([[requested, buildExecutor(config, requested)]]);
  }
  const filteredConfig = requested === "auto" ? config : {
    ...config,
    executor: {
      ...config.executor,
      relays: (config.executor?.relays ?? []).filter((relay) => relay.id === requested),
    },
  };
  return buildExecutors(filteredConfig);
}

export function selectExecutor(executors, requested = "auto", defaultId = null) {
  const ready = executors.filter(
    (entry) => entry.ready && entry.discovery?.available !== false,
  );
  if (requested !== "auto") {
    return ready.find((entry) => entry.id === requested) ?? null;
  }
  return (
    ready.find((entry) => entry.id === "opencode") ??
    ready.find((entry) => entry.id === defaultId) ??
    ready[0] ??
    null
  );
}

// Active adapter probes may send model requests or prepare credential-bearing
// runtimes. Preflight only inspects installation/configuration, never readiness.
export function discoverPreflightExecutors(executors, {
  resolveCommand = resolveExecutable,
  resolveZCode = resolveZCodeInvocation,
} = {}) {
  return [...executors.entries()].map(([id, candidate]) => {
    let available = false;
    let status = "unavailable";
    let reason = "command_not_found";
    if (candidate.kind === "model-endpoint") {
      let endpoint;
      try { endpoint = new URL(candidate.baseUrl); } catch { /* Invalid configuration. */ }
      if (!endpoint || !["http:", "https:"].includes(endpoint.protocol)) {
        reason = "invalid_base_url";
      } else if (
        !["127.0.0.1", "localhost", "::1", "[::1]"].includes(endpoint.hostname)
        && !candidate.apiKey
      ) {
        reason = "missing_api_key";
      } else {
        available = true;
        status = "configured";
        reason = null;
      }
    } else {
      available = Boolean(id === "zcode"
        ? resolveZCode({ command: candidate.command })
        : resolveCommand(candidate.command));
      if (available) {
        status = "installed";
        reason = null;
      }
    }
    return {
      id,
      ready: available,
      discovery: { available, status, reason },
    };
  });
}

export async function checkDemoPreflight(options, {
  nodeVersion = process.versions.node,
  loadConfiguration = loadConfig,
  resolveDependency = (specifier) => require.resolve(specifier),
  buildCandidates = buildPreflightCandidates,
  discover = discoverPreflightExecutors,
} = {}) {
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail });
  const supportedNode = Number(nodeVersion.split(".")[0]) >= 22;
  record("Node.js", supportedNode, supportedNode
    ? nodeVersion : `Node.js 22 or newer is required; found ${nodeVersion}.`);

  let config;
  try {
    config = loadConfiguration();
    record("Configuration", true, "loaded");
  } catch {
    // JSON parser messages can contain snippets of secret-bearing local config.
    record("Configuration", false,
      "Could not load configuration. Check config/default.json, config/local.json and AGENT_CONTROL_CONFIG.");
  }

  for (const [name, specifier] of [
    ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/client/index.js"],
    ["zod", "zod"],
  ]) {
    try {
      resolveDependency(specifier);
      record(name, true, "installed");
    } catch {
      record(name, false, "Dependency is missing. Run npm ci in the project directory.");
    }
  }

  let executors = [];
  let selected = null;
  if (checks.every((entry) => entry.ok)) {
    try {
      const candidates = await buildCandidates(config, options.executor);
      executors = discover(options.executor === "auto" ? candidates : new Map(
        [...candidates.entries()].filter(([id]) => id === options.executor),
      ));
      selected = selectExecutor(executors, options.executor,
        config.executor?.provider === "auto" ? null : config.executor?.provider);
      record("Executor discovery", Boolean(selected), selected
        ? `selected ${selected.id} (${selected.discovery.status})`
        : `No installed/configured executor matches '${options.executor}'. Install or configure an executor, then retry --check.`);
    } catch {
      record("Executor discovery", false,
        "Could not load executor configuration or dependencies. Check executor settings and run npm ci.");
    }
  }
  return { ok: checks.every((entry) => entry.ok), checks, executors, selected };
}
