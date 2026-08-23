import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAdapterRegistry } from "../userscript/src/adapter-registry.js";

const root = path.resolve("userscript");
const adaptersDir = path.join(root, "src", "adapters");
const runtimePath = path.join(root, "src", "runtime.user.js");
const outputPath = path.join(root, "agent-control-plane-web-bridge.user.js");

const adapterFiles = fs.readdirSync(adaptersDir)
  .filter((name) => name.endsWith(".js"))
  .sort();
const adapters = [];
for (const fileName of adapterFiles) {
  const moduleUrl = pathToFileURL(path.join(adaptersDir, fileName));
  const module = await import(moduleUrl.href);
  adapters.push(module.default);
}
const registry = createAdapterRegistry(adapters);
const matchLines = registry.adapters
  .flatMap((adapter) => adapter.matches)
  .map((match) => `// @match        ${match}`)
  .join("\n");
const publicAdapters = registry.adapters.map(({ id, displayName, origins }) => ({
  id,
  displayName,
  origins,
}));

const runtime = fs.readFileSync(runtimePath, "utf8");
const built = runtime
  .replace("// @acp-adapter-matches", matchLines)
  .replace(
    "const ADAPTERS = /* @acp-adapters */ [];",
    `const ADAPTERS = Object.freeze(${JSON.stringify(publicAdapters)});`,
  );
if (built === runtime) throw new Error("Userscript build markers were not replaced");

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== built) {
    console.error("Generated userscript is stale. Run npm run userscript:build.");
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(outputPath, built, "utf8");
  console.log(`Built ${path.relative(process.cwd(), outputPath)} with ${registry.adapters.length} adapters.`);
}
