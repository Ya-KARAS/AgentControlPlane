import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectRegistry } from "../src/core/project-registry.js";

function project(root, relative) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.join(target, ".git"), { recursive: true });
  fs.writeFileSync(path.join(target, ".git", "config"), "[remote \"origin\"]\n  url = https://example.test/repo.git\n");
  return target;
}

test("project registry discovers projects without authorizing the scan root itself", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-projects-"));
  const stateDir = path.join(temp, "state");
  const root = path.join(temp, "D-drive");
  const target = project(root, path.join("open-source", "AgentControlPlane"));
  const registry = new ProjectRegistry({ stateDir, discoveryRoots: [root] });

  const [entry] = registry.publicProjects();
  assert.equal(entry.name, "AgentControlPlane");
  assert.equal(entry.status, "available");
  assert.equal(registry.resolve(entry.id).workspace, fs.realpathSync.native(target));
  assert.equal(registry.resolve(root), null);
});

test("project id survives a confirmed cross-root relink", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-project-move-"));
  const stateDir = path.join(temp, "state");
  const rootC = path.join(temp, "C-drive");
  const rootD = path.join(temp, "D-drive");
  const original = project(rootC, "calculator");
  fs.mkdirSync(rootD, { recursive: true });
  const registry = new ProjectRegistry({
    stateDir,
    discoveryRoots: [rootC, rootD],
  });
  const id = registry.publicProjects()[0].id;

  const moved = path.join(rootD, "calculator");
  fs.renameSync(original, moved);
  registry.refresh();
  assert.throws(() => registry.resolve(id), { code: "project_relink_required" });
  assert.equal(registry.publicProjects()[0].relink_candidate_count, 1);

  const relinked = registry.relink(id, moved);
  assert.equal(`project:${relinked.id}`, id);
  assert.equal(relinked.path_revision, 2);
  assert.equal(registry.resolve(id).workspace, fs.realpathSync.native(moved));
});

test("relink refuses paths outside trusted discovery roots", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-project-deny-"));
  const stateDir = path.join(temp, "state");
  const root = path.join(temp, "trusted");
  const outside = project(path.join(temp, "outside"), "project");
  project(root, "project");
  const registry = new ProjectRegistry({ stateDir, discoveryRoots: [root] });
  const id = registry.publicProjects()[0].id;
  assert.throws(() => registry.relink(id, outside), { code: "project_relink_denied" });
});

test("legacy workspace roots are registered and remain resolvable", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-project-legacy-"));
  const stateDir = path.join(temp, "state");
  const workspace = project(temp, "legacy-project");
  const registry = new ProjectRegistry({ stateDir, workspaceRoots: [workspace] });
  const reference = registry.referenceForPath(workspace);
  assert.match(reference, /^project:/);
  assert.equal(registry.resolve(reference).workspace, fs.realpathSync.native(workspace));
});

test("registry restarts when a configured project path has moved", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-project-restart-"));
  const stateDir = path.join(temp, "state");
  const rootC = path.join(temp, "C-drive");
  const rootD = path.join(temp, "D-drive");
  const original = project(rootC, "moving-project");
  fs.mkdirSync(rootD, { recursive: true });
  const first = new ProjectRegistry({
    stateDir,
    workspaceRoots: [original],
    discoveryRoots: [rootC, rootD],
  });
  const id = first.publicProjects()[0].id;
  fs.renameSync(original, path.join(rootD, "moving-project"));

  const restarted = new ProjectRegistry({
    stateDir,
    workspaceRoots: [original],
    discoveryRoots: [rootC, rootD],
  });
  const entry = restarted.publicProjects().find((candidate) => candidate.id === id);
  assert.equal(entry.status, "relink_required");
  assert.equal(entry.relink_candidate_count, 1);
});

test("registry refuses to inherit a project id when the original path is replaced", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-project-replaced-"));
  const stateDir = path.join(temp, "state");
  const root = path.join(temp, "projects");
  const original = project(root, "calculator");
  const registry = new ProjectRegistry({ stateDir, discoveryRoots: [root] });
  const id = registry.publicProjects()[0].id;

  fs.renameSync(original, path.join(root, "calculator-old"));
  fs.mkdirSync(path.join(original, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(original, ".git", "config"),
    '[remote "origin"]\n  url = https://example.test/different.git\n',
  );
  registry.refresh();

  const entry = registry.publicProjects().find((candidate) => candidate.id === id);
  assert.equal(entry.status, "relink_required");
  assert.throws(() => registry.resolve(id), { code: "project_relink_required" });
});

test("discovery stops after the configured directory budget", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-project-budget-"));
  const stateDir = path.join(temp, "state");
  const root = path.join(temp, "projects");
  fs.mkdirSync(path.join(root, "a-empty", "nested"), { recursive: true });
  project(root, "z-project");

  const registry = new ProjectRegistry({
    stateDir,
    discoveryRoots: [root],
    maxScannedDirectories: 1,
  });
  assert.equal(registry.publicProjects().length, 0);
});
