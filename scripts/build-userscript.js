import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAdapterRegistry } from "../userscript/src/adapter-registry.js";

const root = path.resolve("userscript");
const adaptersDir = path.join(root, "src", "adapters");
const runtimePath = path.join(root, "src", "runtime.user.js");
const protocolPath = path.join(root, "src", "conversation-protocol.js");
const i18nPath = path.join(root, "src", "i18n.js");
const stageStatePath = path.join(root, "src", "stage-state.js");
const outputPath = path.join(root, "agent-control-plane-web-bridge.user.js");
const metaOutputPath = path.join(root, "agent-control-plane-web-bridge.meta.js");

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
const publicAdapters = registry.adapters.map(({
  id,
  displayName,
  origins,
  composer,
  send,
  assistant,
  user,
}) => ({
  id,
  displayName,
  origins,
  composer,
  send,
  assistant,
  user,
}));

const runtime = fs.readFileSync(runtimePath, "utf8");
const protocolModule = fs
  .readFileSync(protocolPath, "utf8")
  .replace(/^export\s+/gm, "")
  .trim();
const i18nModule = fs
  .readFileSync(i18nPath, "utf8")
  .replace(/^export\s+/gm, "")
  .trim();
const stageStateModule = fs
  .readFileSync(stageStatePath, "utf8")
  .replace(/^export\s+/gm, "")
  .trim();
const built = runtime
  .replace("// @acp-adapter-matches", matchLines)
  .replace(
    "const ADAPTERS = /* @acp-adapters */ [];",
    `const ADAPTERS = Object.freeze(${JSON.stringify(publicAdapters)});`,
  )
  .replace("// @acp-i18n", i18nModule)
  .replace("// @acp-conversation-protocol", protocolModule)
  .replace("// @acp-stage-state", stageStateModule);
if (built === runtime) throw new Error("Userscript build markers were not replaced");
const headerEndMarker = "// ==/UserScript==";
const headerEnd = built.indexOf(headerEndMarker);
if (headerEnd < 0) throw new Error("Userscript metadata header is missing");
const meta = `${built.slice(0, headerEnd + headerEndMarker.length)}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  const currentMeta = fs.existsSync(metaOutputPath)
    ? fs.readFileSync(metaOutputPath, "utf8")
    : "";
  if (current !== built || currentMeta !== meta) {
    console.error("Generated userscript is stale. Run npm run userscript:build.");
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(outputPath, built, "utf8");
  fs.writeFileSync(metaOutputPath, meta, "utf8");
  console.log(
    `Built ${path.relative(process.cwd(), outputPath)} and ${path.relative(process.cwd(), metaOutputPath)} with ${registry.adapters.length} adapters.`,
  );
}
