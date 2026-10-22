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
    json: false,
    timeoutSeconds: 600,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--executor") options.executor = requireValue(arg, ++index);
    else if (arg === "--model") options.model = requireValue(arg, ++index);
    else if (arg === "--timeout-seconds") {
      options.timeoutSeconds = Number(requireValue(arg, ++index));
    } else {
      throw new Error("Unknown argument. Run --help for usage.");
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

function helpText() {
  return `AgentControlPlane live demo

Usage:
  npm run demo
  npm run demo -- --check
  npm run demo -- --yes
  npm run --silent demo -- --json --yes
  npm run demo -- --executor opencode --model <model> --yes

The demo sends one small engineering task through MCP to a ready local
executor. The selected executor may consume account, subscription, or API
quota. The generated workspace remains on disk for inspection.

Options:
  --check              Check prerequisites without tasks, network, or quota use
  --json               Write one JSON result to stdout; progress goes to stderr
  --executor <id>       Executor id; default: auto (prefers OpenCode)
  --model <id>          Optional executor model override
  --timeout-seconds <n> Wait from 30 to 3600 seconds; default: 600
  --yes, -y             Confirm quota use without an interactive prompt
  --help, -h            Show this help

Preflight exit codes: 0 = passive prerequisites found, 1 = missing prerequisite,
2 = invalid arguments. Authentication, models, and connectivity are not checked.
JSON mode returns non-zero on failure or cancellation. Combine --check --json
for passive preflight JSON. Use npm run --silent demo to suppress npm's banner.
`;
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

export async function confirmLiveRun(executor, options) {
  if (options.yes) return true;
  const output = options.json ? process.stderr : process.stdout;
  if (!process.stdin.isTTY || !output.isTTY) {
    console.error("Interactive confirmation is unavailable. Re-run with --yes after reviewing quota use.");
    return false;
  }
  const prompt = readline.createInterface({
    input: process.stdin,
    output,
  });
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

async function loadDemoRuntime() {
  const [{ Client }, { StreamableHTTPClientTransport }, { createApplication }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    import("../src/server.js"),
  ]);
  return { Client, StreamableHTTPClientTransport, createApplication };
}

function emptyResult(options = {}) {
  return {
    executor: options.executor && options.executor !== "auto" ? options.executor : null,
    model: options.model ?? null,
    task_id: null,
    status: "failed",
    workspace: null,
    file: null,
    verified: false,
    usage: null,
  };
}

function publicUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const entries = [
    "input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens",
    "cached_input_tokens", "uncached_input_tokens", "cache_read_input_tokens",
    "cache_creation_input_tokens",
  ].filter((key) => Number.isFinite(usage[key]) && usage[key] >= 0)
    .map((key) => [key, usage[key]]);
  return entries.length ? Object.fromEntries(entries) : null;
}

const failureMessages = {
  dependencies: "Could not load demo dependencies. Run npm ci in the project directory.",
  configuration: "Could not load demo configuration. Check the local configuration and workspace roots.",
  executor_discovery: "No ready executor could be selected. Install/configure the requested executor, then retry.",
  confirmation: "Could not confirm quota use. Review the demo help before using --yes.",
  application: "Could not start the isolated local demo service.",
  connection: "Could not connect the demo MCP client to the local service.",
  workspace: "Could not create the demo workspace. Check the allowed workspace roots.",
  dispatch: "The local service did not accept the demo task.",
  task: "Could not retrieve a terminal task result before the demo timeout.",
  verification: "The task did not complete with the expected hello.txt marker. Inspect the demo workspace.",
  cleanup: "Could not close the local demo resources or remove temporary state. Inspect local processes and temporary files.",
};

export async function runDemo(options, {
  loadRuntime = loadDemoRuntime,
  loadConfiguration = loadConfig,
  discoverCandidates = discoverDemoCandidates,
  confirm = confirmLiveRun,
  createWorkspace = createDemoWorkspace,
  waitForTask = waitForTerminal,
  log = options.json ? console.error : console.log,
} = {}) {
  const result = emptyResult(options);
  const previousStateDir = process.env.AGENT_CONTROL_STATE_DIR;
  let stateDir = null;
  let stage = "dependencies";
  let app = null;
  let client = null;
  try {
    const { Client, StreamableHTTPClientTransport, createApplication } = await loadRuntime();
    stage = "configuration";
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-demo-state-"));
    process.env.AGENT_CONTROL_STATE_DIR = stateDir;
    const config = loadConfiguration();
    config.server.authToken = null;
    if (config.limits?.rateLimit) config.limits.rateLimit.enabled = false;

    stage = "executor_discovery";
    const { candidates, discovery } = await discoverCandidates(
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
      throw new Error("No ready executor");
    }
    result.executor = executor.id;
    result.model = options.model ?? candidates.get(executor.id)?.model ?? null;

    log("AgentControlPlane live demo");
    log(`executor: ${executor.id}`);
    if (options.model) log(`model: ${options.model}`);
    stage = "confirmation";
    if (!(await confirm(executor, options))) {
      log("Demo cancelled before dispatch.");
      result.status = "cancelled";
      result.error = { code: "demo_cancelled", message: "Demo cancelled before dispatch." };
      return result;
    }

    stage = "application";
    app = await createApplication({
      config,
      executors: new Map([[executor.id, candidates.get(executor.id)]]),
      defaultProvider: executor.id,
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      app.server.once?.("error", onError);
      app.server.listen(0, "127.0.0.1", () => {
        app.server.off?.("error", onError);
        resolve();
      });
    });
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    stage = "connection";
    client = new Client({
      name: "agent-control-plane-demo",
      version: config.version,
    });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);
    stage = "workspace";
    const workspace = createWorkspace(config);
    result.workspace = workspace;
    result.file = path.join(workspace, "hello.txt");
    log(`workspace: ${workspace}`);
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

    stage = "dispatch";
    const dispatched = await client.callTool({
      name: "dispatch_project",
      arguments: request,
    });
    if (dispatched.isError || !dispatched.structuredContent?.task?.id) {
      throw new Error("Dispatch failed");
    }
    const taskId = dispatched.structuredContent.task.id;
    result.task_id = taskId;
    log(`task: ${taskId}`);
    log("status: running");
    stage = "task";
    const task = await waitForTask(baseUrl, taskId, options.timeoutSeconds);
    result.status = terminalStatuses.has(task.status) ? task.status : "failed";
    result.model = task.policy?.model ?? result.model;
    result.usage = publicUsage(task.usage);
    stage = "verification";
    const outputPath = result.file;
    const content = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;
    const verified = task.status === "completed" && content !== null && verifiesMarker(content);
    result.verified = verified;
    if (!verified && result.status === "completed") result.status = "failed";

    log(`status: ${result.status}`);
    log(`usage: ${usageLine({ usage: result.usage })}`);
    log(`file: ${outputPath}`);
    log(`verified: ${verified}`);
    if (!verified) {
      throw new Error("Marker verification failed");
    }
  } catch {
    if (result.status === "completed") result.status = "failed";
    result.verified = false;
    result.error = { code: `${stage}_failed`, message: failureMessages[stage] };
  } finally {
    let cleanupFailed = false;
    for (const resource of [client, app]) {
      try { await resource?.close(); } catch { cleanupFailed = true; }
    }
    try {
      if (stateDir) {
        const resolvedState = path.resolve(stateDir);
        const tempRoot = path.resolve(os.tmpdir());
        const relative = path.relative(tempRoot, resolvedState);
        if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
          fs.rmSync(resolvedState, { recursive: true, force: true });
        }
      }
    } catch {
      cleanupFailed = true;
    } finally {
      if (previousStateDir === undefined) delete process.env.AGENT_CONTROL_STATE_DIR;
      else process.env.AGENT_CONTROL_STATE_DIR = previousStateDir;
    }
    if (cleanupFailed) {
      result.status = "failed";
      result.verified = false;
      result.error = { code: "cleanup_failed", message: failureMessages.cleanup };
    }
  }
  if (result.verified && !result.error) {
    log("DEMO PASS: MCP dispatch, local execution, file verification, and result persistence completed.");
  }
  return result;
}

export async function main(argv = process.argv.slice(2), {
  runLive = runDemo,
  preflight = checkDemoPreflight,
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (argv.includes("--json")) console.log(JSON.stringify({
      ...emptyResult(), error: { code: "invalid_arguments", message: error.message },
    }));
    else {
      console.error(error.message);
      console.error("Run `npm run demo -- --help` for usage.");
    }
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(options.json ? JSON.stringify({ mode: "help", help: helpText() }) : helpText());
    return;
  }
  if (options.check) {
    let result;
    try {
      result = await preflight(options);
    } catch {
      result = {
        ok: false, selected: null, executors: [], checks: [{
          name: "Preflight", ok: false,
          detail: "Preflight failed. Check the local configuration and dependencies, then retry.",
        }],
      };
    }
    if (options.json) {
      console.log(JSON.stringify({
        ...emptyResult(options),
        mode: "check",
        executor: result.selected?.id ?? null,
        status: result.ok ? "ready" : "blocked",
        checks: result.checks,
        executors: result.executors,
      }));
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
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
  let result;
  try {
    result = await runLive(options);
  } catch {
    result = { ...emptyResult(options), error: {
      code: "demo_failed", message: "Demo failed. Check the local configuration and executor, then retry.",
    } };
  }
  if (options.json) console.log(JSON.stringify(result));
  if (result.error && (options.json || result.status !== "cancelled")) {
    if (!options.json) console.error(`DEMO FAIL: ${result.error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    if (process.argv.includes("--json")) console.log(JSON.stringify({
      ...emptyResult(), error: { code: "demo_failed", message: "Demo failed before producing a result." },
    }));
    else console.error("DEMO FAIL: Demo failed before producing a result.");
    process.exitCode = 1;
  });
}
