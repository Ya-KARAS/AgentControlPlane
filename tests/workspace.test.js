import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveWorkspace } from "../src/core/workspace.js";

test("resolveWorkspace allows directories inside configured roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-root-"));
  const child = path.join(root, "project");
  fs.mkdirSync(child);
  assert.equal(resolveWorkspace(child, [root]), fs.realpathSync.native(child));
});

test("resolveWorkspace rejects directories outside configured roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "acp-outside-"));
  assert.throws(
    () => resolveWorkspace(outside, [root]),
    (error) => error.code === "workspace_denied",
  );
});

test("resolveWorkspace ignores a stale root when another configured root is valid", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-root-live-"));
  const child = fs.mkdtempSync(path.join(root, "project-"));
  const missing = path.join(os.tmpdir(), "acp-root-that-moved-away");
  assert.equal(
    resolveWorkspace(child, [missing, root]),
    fs.realpathSync.native(child),
  );
});
