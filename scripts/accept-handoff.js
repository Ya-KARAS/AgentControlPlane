import { pathToFileURL } from "node:url";
import { runHandoffAcceptance } from "./lib/handoff-acceptance.js";

export function parseArgs(argv) {
  const options = { json: false, help: false };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new TypeError(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2), {
  write = (line) => console.log(line), runAcceptance = runHandoffAcceptance,
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    write("Usage: node scripts/accept-handoff.js [--json] [--help]\nOffline handoff acceptance using recording fixtures; no keys, CLI executors or network.");
    return { passed: true, help: true };
  }
  const report = await runAcceptance({ onScenario: (scenario) => {
    if (!options.json) write(`${scenario.passed ? "PASS" : "FAIL"} ${scenario.id}: ${scenario.name}${scenario.error ? ` — ${scenario.error}` : ""}`);
  } });
  if (options.json) write(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((report) => {
    if (!report.passed) process.exitCode = 1;
  }).catch((error) => {
    if (process.argv.includes("--json")) console.log(JSON.stringify({ passed: false, error: error.message }));
    else console.error(error.message);
    process.exitCode = 1;
  });
}
