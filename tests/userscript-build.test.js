import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repository = path.resolve(import.meta.dirname, "..");
const stableNames = [
  "agent-control-plane-web-bridge.user.js",
  "agent-control-plane-web-bridge.meta.js",
  "release-manifest.json",
];
const developmentVersion = "0.9.6-dev.20261022";

function fixture(t, version = developmentVersion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-userscript-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(repository, "userscript"), path.join(root, "userscript"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(
    path.join(repository, "scripts", "build-userscript.js"),
    path.join(root, "scripts", "build-userscript.js"),
  );
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  const runtime = path.join(root, "userscript", "src", "runtime.user.js");
  fs.writeFileSync(runtime, fs.readFileSync(runtime, "utf8")
    .replace(/^\/\/ @version\s+\S+$/m, `// @version      ${version}`));
  return root;
}

function build(root, check = false) {
  return spawnSync(process.execPath, [
    "scripts/build-userscript.js", ...(check ? ["--check"] : []),
  ], { cwd: root, encoding: "utf8" });
}

function snapshotStable(root) {
  return stableNames.map((name) => fs.readFileSync(path.join(root, "userscript", name)));
}

function assertManifest(root, manifestPath, version) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.version, version);
  for (const artifact of Object.values(manifest.artifacts)) {
    const bytes = fs.readFileSync(path.join(root, "userscript", artifact.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
  }
  return manifest;
}

test("development userscript build preserves every stable update artifact", (t) => {
  const root = fixture(t);
  const before = snapshotStable(root);
  const historical = path.join(root, "userscript", "releases", "0.9.5", stableNames[0]);
  const historicalBefore = fs.readFileSync(historical);
  const result = build(root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshotStable(root), before);
  assert.deepEqual(fs.readFileSync(historical), historicalBefore);
  const manifest = assertManifest(root,
    path.join(root, "userscript", "releases", developmentVersion, "release-manifest.json"),
    developmentVersion);
  for (const artifact of Object.values(manifest.artifacts)) {
    assert.ok(artifact.path.startsWith(`releases/${developmentVersion}/`));
  }
  assert.equal(build(root, true).status, 0);
});

for (const artifact of stableNames) {
  test(`development freshness check rejects stale isolated ${artifact}`, (t) => {
    const root = fixture(t);
    assert.equal(build(root).status, 0);
    const before = snapshotStable(root);
    const target = path.join(root, "userscript", "releases", developmentVersion, artifact);
    fs.writeFileSync(target, "stale artifact\n");
    const result = build(root, true);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Generated userscript is stale/);
    assert.deepEqual(snapshotStable(root), before);
  });
}

test("retained stable update manifest still matches its historical artifacts", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repository, "userscript", "release-manifest.json"), "utf8"));
  assertManifest(repository, path.join(repository, "userscript", "release-manifest.json"),
    manifest.version);
  assert.ok(!manifest.version.includes("-"));
  for (const name of stableNames.slice(0, 2)) {
    const metadata = fs.readFileSync(path.join(repository, "userscript", name), "utf8");
    assert.equal(metadata.match(/^\/\/ @version\s+(\S+)$/m)?.[1], manifest.version);
  }
  assert.deepEqual(
    fs.readFileSync(path.join(repository, "userscript", stableNames[0])),
    fs.readFileSync(path.join(repository, "userscript", manifest.artifacts.release.path)),
  );
});

test("stable version build retains the existing stable release workflow", (t) => {
  const version = "0.9.6";
  const root = fixture(t, version);
  const result = build(root);
  assert.equal(result.status, 0, result.stderr);
  const manifest = assertManifest(root,
    path.join(root, "userscript", "release-manifest.json"), version);
  assert.equal(manifest.artifacts.script.path, stableNames[0]);
  assert.equal(manifest.artifacts.metadata.path, stableNames[1]);
  assert.equal(manifest.artifacts.release.path, `releases/${version}/${stableNames[0]}`);
  assert.equal(build(root, true).status, 0);
});
