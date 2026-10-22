import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  browserCompanionFiles,
  packageBrowserCompanion,
  packageSource,
} from "../scripts/package-release.js";
import { createSha256Manifest } from "../scripts/sha256-manifest.js";
import { createZip, listZipEntryNames } from "../scripts/lib/zip-store.js";

test("ZIP output is byte-identical for the same entries", () => {
  const entries = [
    { name: "b.txt", data: Buffer.from("two") },
    { name: "a.txt", data: Buffer.from("one") },
  ];
  assert.deepEqual(createZip(entries), createZip([...entries].reverse()));
  assert.deepEqual(listZipEntryNames(createZip(entries)), ["a.txt", "b.txt"]);
});

test("browser companion archive contains the exact public payload", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-browser-zip-"));
  try {
    const target = path.join(temp, "companion.zip");
    packageBrowserCompanion(root, target);
    assert.deepEqual(
      listZipEntryNames(fs.readFileSync(target)),
      browserCompanionFiles(root),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("source archive contains tracked files under one versioned root", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-source-zip-"));
  try {
    // Installed source archives intentionally have no .git directory. Exercise
    // real Git tracking in an isolated fixture, not the enclosing checkout.
    const root = path.join(temp, "fixture");
    const files = {
      ".gitignore": "config/local.json\nnode_modules/\ndist/\n.env\n.runtime/\n.agent-control/\n",
      "package.json": JSON.stringify({ name: "acp-release-fixture", version: "1.0.0" }),
      "config/default.json": "{}\n",
      "src/index.js": "export const marker = 'tracked source';\n",
      "config/local.json": "{\"fixture\":\"not for distribution\"}\n",
      "node_modules/fixture/index.js": "local dependency\n",
      "dist/previous.zip": "previous build\n",
      ".env": "SYNTHETIC_FIXTURE_ONLY=true\n",
      ".runtime/fixture.json": "{}\n",
      ".agent-control/state.json": "{}\n",
    };
    for (const [relative, contents] of Object.entries(files)) {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents, "utf8");
    }
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "--", "."], { cwd: root });
    const target = path.join(temp, "source.zip");
    packageSource(root, target, "test");
    const names = listZipEntryNames(fs.readFileSync(target));
    assert.deepEqual(names, [
      "AgentControlPlane-vtest/.gitignore",
      "AgentControlPlane-vtest/config/default.json",
      "AgentControlPlane-vtest/package.json",
      "AgentControlPlane-vtest/src/index.js",
    ]);
    assert.ok(names.includes("AgentControlPlane-vtest/package.json"));
    assert.ok(names.every((name) => name.startsWith("AgentControlPlane-vtest/")));
    assert.equal(names.some((name) => name.includes("config/local.json")), false);
    assert.equal(names.some((name) => name.includes("node_modules/")), false);
    assert.equal(names.some((name) => name.includes("dist/")), false);
    assert.equal(names.some((name) => name.includes("/.git/")), false);
    assert.equal(names.some((name) => name.endsWith("/.env")), false);
    assert.equal(names.some((name) => name.includes("/.runtime/")), false);
    assert.equal(names.some((name) => name.includes("/.agent-control/")), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("SHA256 manifest uses stable filename ordering and known hashes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-sha256-"));
  try {
    const alpha = path.join(temp, "alpha.txt");
    const beta = path.join(temp, "beta.txt");
    fs.writeFileSync(alpha, "alpha");
    fs.writeFileSync(beta, "beta");
    const manifest = createSha256Manifest([beta, alpha]);
    const alphaHash = crypto.createHash("sha256").update("alpha").digest("hex");
    assert.equal(manifest.split("\n")[0], `${alphaHash}  alpha.txt`);
    assert.match(manifest, /beta\.txt\n$/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("SHA256 manifest rejects missing files and directories", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-sha256-invalid-"));
  try {
    assert.throws(() => createSha256Manifest([path.join(temp, "missing.zip")]), /does not exist/);
    assert.throws(() => createSha256Manifest([temp]), /not a file/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
