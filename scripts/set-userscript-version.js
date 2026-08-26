import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const versionIndex = args.indexOf("--version");
const version = versionIndex >= 0 ? args[versionIndex + 1] : "";

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: npm run userscript:release -- --version <major.minor.patch>");
  process.exit(2);
}

const runtimePath = path.resolve("userscript", "src", "runtime.user.js");
const runtime = fs.readFileSync(runtimePath, "utf8");
const versionPattern = /^\/\/ @version\s+\S+$/m;
if (!versionPattern.test(runtime)) {
  throw new Error("Userscript runtime version metadata is missing");
}

const nextRuntime = runtime.replace(versionPattern, `// @version      ${version}`);
if (nextRuntime !== runtime) fs.writeFileSync(runtimePath, nextRuntime, "utf8");

const result = spawnSync(process.execPath, ["scripts/build-userscript.js"], {
  cwd: process.cwd(),
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`Prepared AgentControlPlane userscript release ${version}.`);
