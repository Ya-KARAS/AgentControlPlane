import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../src/core/config.js";
import { discoverExecutors } from "../src/executors/discovery.js";
import { checkDemoPreflight, selectExecutor } from "./demo-preflight.js";

export { selectExecutor } from "./demo-preflight.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const marker = "AgentControlPlane demo OK";
const terminalStatuses = new Set([
  "completed",
  "partial",
  "blocked",
  "failed",
  "cancelled",
  "interrupted",
]);

export function parseArgs(argv) {
  const requireValue = (flag, index) => {
    const value = argv[index];
    if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
    return value;
  };
  const options = {
    executor: "auto",
    model: null,
    yes: false,
    check: false,
    timeoutSeconds: 600,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--executor") options.executor = requireValue(arg, ++index);
    else if (arg === "--model") options.model = requireValue(arg, ++index);
    else if (arg === "--timeout-seconds") {
      options.timeoutSeconds = Number(requireValue(arg, ++index));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.executor) throw new Error("--executor requires a value");
  if (options.model === undefined) throw new Error("--model requires a value");
  if (
    !Number.isInteger(options.timeoutSeconds) ||
    options.timeoutSeconds < 30 ||
    options.timeoutSeconds > 3600
  ) {
    throw new Error("--timeout-seconds must be an integer from 30 to 3600");
  }
  return options;
}

export function verifiesMarker(content) {
  return String(content).replace(/\r\n/g, "\n").trimEnd() === marker;
}

async function discoverDemoCandidates(config, requested) {
  const { buildExecutor, buildExecutors } = await import("../src/server.js");
  const builtIns = new Set([
    "codex",
    "openai-compatible",
    "deepseek",
    "claude",
    "opencode",
  ]);
  if (requested !== "auto" && builtIns.has(requested)) {
    const candidates = new Map([[requested, buildExecutor(config, requested)]]);
    return { candidates, discovery: await discoverExecutors(candidates) };
  }
  if (requested === "auto") {
    const opencode = new Map([["opencode", buildExecutor(config, "opencode")]]);
    const opencodeDiscovery = await discoverExecutors(opencode);
    if (
      opencodeDiscovery.opencode?.available === true &&
      opencodeDiscovery.opencode?.status !== "degraded"
    ) {
      return { candidates: opencode, discovery: opencodeDiscovery };
    }
  }
  const candidates = buildExecutors(config);
  return { candidates, discovery: await discoverExecutors(candidates) };
}

function usageLine(task) {
  const usage = task?.usage ?? {};
  const total = Number(usage.total_tokens ?? 0);
  return total > 0 ? `${total.toLocaleString("en-US")} tokens reported` : "usage unavailable";
}

function printHelp() {
  console.log(`AgentControlPlane live demo

Usage:
  npm run demo
  npm run demo -- --check
  npm run demo -- --yes
  npm run demo -- --executor opencode --model <model> --yes

The demo sends one small engineering task through MCP to a ready local
executor. The selected executor may consume account, subscription, or API
quota. The generated workspace remains on disk for inspection.

Options:
  --check              Check prerequisites without tasks, network, or quota use
  --executor <id>       Executor id; default: auto (prefers OpenCode)
  --model <id>          Optional executor model override
  --timeout-seconds <n> Wait from 30 to 3600 seconds; default: 600
  --yes, -y             Confirm quota use without an interactive prompt
  --help, -h            Show this help

Preflight exit codes: 0 = passive prerequisites found, 1 = missing prerequisite,
2 = invalid arguments. Authentication, models, and connectivity are not checked.
`);
}

function createDemoWorkspace(config) {
  const allowedRoot = config.workspaceRoots.find((root) => {
    const relative = path.relative(root, projectRoot);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  const base = allowedRoot
    ? path.join(projectRoot, ".acp-demo")
    : path.join(config.workspaceRoots[0], "AgentControlPlane-demo");
  fs.mkdirSync(base, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(base, "run-"));
  fs.writeFileSync(
    path.join(workspace, "README.md"),
    "# AgentControlPlane demo workspace\n\nThis directory was created by `npm run demo`.\n",
    "utf8",
  );
  return workspace;
}

async function confirmLiveRun(executor, options) {
  if (options.yes) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Interactive confirmation is unavailable. Re-run with --yes after reviewing quota use.");
    return false;
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      `Send one small live task to ${executor.display_name ?? executor.id}? This may use configured quota. [y/N] `,
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function waitForTerminal(baseUrl, taskId, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/v1/tasks/${taskId}`);
    if (!response.ok) {
      throw new Error(`Task status request failed with HTTP ${response.status}`);
    }
    const body = await response.json();
    if (terminalStatuses.has(body.task.status)) return body.task;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Task ${taskId} exceeded ${timeoutSeconds} seconds`);
}

async function run(options) {
  const [{ Client }, { StreamableHTTPClientTransport }, { createApplication }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    import("../src/server.js"),
  ]);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-demo-state-"));
  process.env.AGENT_CONTROL_STATE_DIR = stateDir;
  let app = null;
  let client = null;
  try {
    const config = loadConfig();
    config.server.authToken = null;
    if (config.limits?.rateLimit) config.limits.rateLimit.enabled = false;

    const { candidates, discovery } = await discoverDemoCandidates(
      config,
      options.executor,
    );
    const publicExecutors = [...candidates.entries()].map(([id, candidate]) => ({
      id,
      display_name: candidate.displayName ?? id,
      ready:
        discovery[id]?.available === true && discovery[id]?.status !== "degraded",
      discovery: discovery[id] ?? null,
    }));
    const executor = selectExecutor(
      publicExecutors,
      options.executor,
      config.executor?.provider === "auto" ? null : config.executor?.provider,
    );
    if (!executor) {
      const ready = publicExecutors
        .filter((entry) => entry.ready)
        .map((entry) => entry.id);
      throw new Error(
        `No ready executor matches '${options.executor}'. Ready executors: ${ready.join(", ") || "none"}. Run npm run doctor for details.`,
      );
    }

    console.log("AgentControlPlane live demo");
    console.log(`executor: ${executor.id}`);
    if (options.model) console.log(`model: ${options.model}`);
    if (!(await confirmLiveRun(executor, options))) {
      console.log("Demo cancelled before dispatch.");
      return;
    }

    app = await createApplication({
      config,
      executors: new Map([[executor.id, candidates.get(executor.id)]]),
      defaultProvider: executor.id,
    });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    client = new Client({
      name: "agent-control-plane-demo",
      version: config.version,
    });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);
    const workspace = createDemoWorkspace(config);
    console.log(`workspace: ${workspace}`);
    const request = {
      workspace,
      executor: executor.id,
      objective:
        `Create hello.txt in the workspace root containing only the line '${marker}'. ` +
        "Read the file after writing it and report the verification evidence.",
      constraints: [
        "Modify hello.txt only.",
        "Do not use the network.",
        "Do not ask follow-up questions.",
      ],
      acceptance_criteria: [
        "hello.txt exists in the workspace root.",
        `The only non-whitespace content is ${marker}.`,
        "The result reports the changed file and verification evidence.",
      ],
      profile: "economy",
      max_subagents: 0,
      token_budget: 30000,
      kind: "smoke",
      idempotency_key: `public-demo-${path.basename(workspace)}`,
    };
    if (options.model) request.model = options.model;

    const dispatched = await client.callTool({
      name: "dispatch_project",
      arguments: request,
    });
    if (dispatched.isError || !dispatched.structuredContent?.task?.id) {
      throw new Error(`Dispatch failed: ${JSON.stringify(dispatched.content)}`);
    }
    const taskId = dispatched.structuredContent.task.id;
    console.log(`task: ${taskId}`);
    console.log("status: running");
    const task = await waitForTerminal(baseUrl, taskId, options.timeoutSeconds);
    const outputPath = path.join(workspace, "hello.txt");
    const content = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;
    const verified = task.status === "completed" && content !== null && verifiesMarker(content);

    console.log(`status: ${task.status}`);
    console.log(`usage: ${usageLine(task)}`);
    console.log(`file: ${outputPath}`);
    console.log(`verified: ${verified}`);
    if (!verified) {
      const detail = task.error?.message ?? task.result?.summary ?? "marker verification failed";
      throw new Error(`Demo did not pass: ${detail}`);
    }
    console.log("DEMO PASS: MCP dispatch, local execution, file verification, and result persistence completed.");
  } finally {
    await client?.close().catch(() => {});
    await app?.close().catch(() => {});
    const resolvedState = path.resolve(stateDir);
    const tempRoot = path.resolve(os.tmpdir());
    const relative = path.relative(tempRoot, resolvedState);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      fs.rmSync(resolvedState, { recursive: true, force: true });
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error("Run `npm run demo -- --help` for usage.");
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }
  if (options.check) {
    const result = await checkDemoPreflight(options);
    console.log("AgentControlPlane demo preflight");
    for (const entry of result.checks) {
      (entry.ok ? console.log : console.error)(`[${entry.ok ? "ok" : "fail"}] ${entry.name}: ${entry.detail}`);
    }
    for (const executor of result.executors) {
      const state = executor.discovery;
      console.log(`${executor.id}: ${state.status}${state.reason ? ` (${state.reason})` : ""}`);
    }
    console.log("Passive checks only: authentication, models, and connectivity are not checked. No task was started.");
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  await run(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`DEMO FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
