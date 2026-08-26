import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createAdapterRegistry } from "../userscript/src/adapter-registry.js";

const root = path.resolve("userscript");
const adaptersDir = path.join(root, "src", "adapters");
const runtimePath = path.join(root, "src", "runtime.user.js");
const protocolPath = path.join(root, "src", "conversation-protocol.js");
const i18nPath = path.join(root, "src", "i18n.js");
const capabilitiesPath = path.join(root, "src", "capabilities.js");
const remoteTaskResponsePath = path.join(root, "src", "remote-task-response.js");
const floatingPositionPath = path.join(root, "src", "floating-position.js");
const stageStatePath = path.join(root, "src", "stage-state.js");
const resultDeliveryStatePath = path.join(root, "src", "result-delivery-state.js");
const outputPath = path.join(root, "agent-control-plane-web-bridge.user.js");
const metaOutputPath = path.join(root, "agent-control-plane-web-bridge.meta.js");
const releaseManifestPath = path.join(root, "release-manifest.json");
const stableDownloadUrl =
  "https://acp.asterroute.com/downloads/agent-control-plane-web-bridge.user.js";
const stableUpdateUrl =
  "https://acp.asterroute.com/downloads/agent-control-plane-web-bridge.meta.js";

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
const capabilitiesModule = fs
  .readFileSync(capabilitiesPath, "utf8")
  .replace(/^export\s+/gm, "")
  .trim();
const remoteTaskResponseModule = fs
  .readFileSync(remoteTaskResponsePath, "utf8")
  .replace(/^export\s+/gm, "")
  .trim();
const floatingPositionModule = fs
  .readFileSync(floatingPositionPath, "utf8")
  .replace(/^export\s+/gm, "")
  .trim();
const stageStateModule = fs
  .readFileSync(stageStatePath, "utf8")
  .replace(/^export\s+/gm, "")
  .trim();
const resultDeliveryStateModule = fs
  .readFileSync(resultDeliveryStatePath, "utf8")
  .replace(/^export\s+/gm, "")
  .trim();
const built = runtime
  .replace("// @acp-adapter-matches", matchLines)
  .replace(
    "const ADAPTERS = /* @acp-adapters */ [];",
    `const ADAPTERS = Object.freeze(${JSON.stringify(publicAdapters)});`,
  )
  .replace("// @acp-i18n", i18nModule)
  .replace("// @acp-capabilities", capabilitiesModule)
  .replace("// @acp-remote-task-response", remoteTaskResponseModule)
  .replace("// @acp-floating-position", floatingPositionModule)
  .replace("// @acp-conversation-protocol", protocolModule)
  .replace("// @acp-stage-state", stageStateModule)
  .replace("// @acp-result-delivery-state", resultDeliveryStateModule);
if (built === runtime) throw new Error("Userscript build markers were not replaced");
const headerEndMarker = "// ==/UserScript==";
const headerEnd = built.indexOf(headerEndMarker);
if (headerEnd < 0) throw new Error("Userscript metadata header is missing");
const meta = `${built.slice(0, headerEnd + headerEndMarker.length)}\n`;
const versionMatch = built.match(/^\/\/ @version\s+(\S+)$/m);
if (!versionMatch) throw new Error("Userscript version metadata is missing");
const releaseOutputPath = path.join(
  root,
  "releases",
  versionMatch[1],
  "agent-control-plane-web-bridge.user.js",
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const releaseManifest = `${JSON.stringify({
  schema_version: 1,
  version: versionMatch[1],
  download_url: stableDownloadUrl,
  update_url: stableUpdateUrl,
  artifacts: {
    script: {
      path: path.relative(root, outputPath).replaceAll("\\", "/"),
      sha256: sha256(built),
    },
    metadata: {
      path: path.relative(root, metaOutputPath).replaceAll("\\", "/"),
      sha256: sha256(meta),
    },
    release: {
      path: path.relative(root, releaseOutputPath).replaceAll("\\", "/"),
      sha256: sha256(built),
    },
  },
}, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  const currentMeta = fs.existsSync(metaOutputPath)
    ? fs.readFileSync(metaOutputPath, "utf8")
    : "";
  const currentRelease = fs.existsSync(releaseOutputPath)
    ? fs.readFileSync(releaseOutputPath, "utf8")
    : "";
  const currentManifest = fs.existsSync(releaseManifestPath)
    ? fs.readFileSync(releaseManifestPath, "utf8")
    : "";
  if (
    current !== built
    || currentMeta !== meta
    || currentRelease !== built
    || currentManifest !== releaseManifest
  ) {
    console.error("Generated userscript is stale. Run npm run userscript:build.");
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(outputPath, built, "utf8");
  fs.writeFileSync(metaOutputPath, meta, "utf8");
  fs.mkdirSync(path.dirname(releaseOutputPath), { recursive: true });
  fs.writeFileSync(releaseOutputPath, built, "utf8");
  fs.writeFileSync(releaseManifestPath, releaseManifest, "utf8");
  console.log(
    `Built ${path.relative(process.cwd(), outputPath)}, ${path.relative(process.cwd(), metaOutputPath)}, ${path.relative(process.cwd(), releaseOutputPath)}, and ${path.relative(process.cwd(), releaseManifestPath)} with ${registry.adapters.length} adapters.`,
  );
}
