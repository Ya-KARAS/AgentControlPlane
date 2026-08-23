import { loadConfig } from "../src/core/config.js";
import { discoverExecutors } from "../src/executors/discovery.js";
import { buildExecutors } from "../src/server.js";

function pass(message) {
  console.log(`[ok] ${message}`);
}

function info(message) {
  console.log(`[--] ${message}`);
}

function fail(message) {
  console.error(`[fail] ${message}`);
  process.exitCode = 1;
}

const major = Number(process.versions.node.split(".")[0]);
if (major >= 22) pass(`Node.js ${process.versions.node}`);
else fail(`Node.js 22 or newer is required; found ${process.versions.node}`);

let config;
try {
  config = loadConfig();
  pass(`Configuration loaded for ${config.server.host}:${config.server.port}`);
} catch (error) {
  fail(`Configuration error: ${error.message}`);
}

if (config) {
  const executors = buildExecutors(config);
  const discovery = await discoverExecutors(executors);
  const order = [
    ...(config.executor?.routing?.order ?? []),
    ...executors.keys(),
  ];
  const uniqueOrder = [...new Set(order)];
  for (const id of uniqueOrder) {
    const state = discovery[id];
    if (!state) continue;
    const detail = state.available
      ? state.version ?? state.status
      : state.reason ?? state.status;
    if (state.available && state.status === "degraded") {
      info(`${id}: installed but degraded (${state.reason})`);
    } else if (state.available) pass(`${id}: ${detail}`);
    else info(`${id}: unavailable (${detail})`);
  }

  const requested = config.executor?.provider ?? "auto";
  const selected =
    requested === "auto"
      ? uniqueOrder.find(
          (id) =>
            discovery[id]?.available && discovery[id]?.status !== "degraded",
        ) ?? uniqueOrder.find((id) => discovery[id]?.available)
      : discovery[requested]?.available
        ? requested
        : null;
  if (selected) {
    pass(`Default executor: ${selected}`);
    console.log("AgentControlPlane is ready for local use.");
  } else {
    fail(
      requested === "auto"
        ? "No supported engineering executor was discovered"
        : `Configured executor is unavailable: ${requested}`,
    );
  }
}
