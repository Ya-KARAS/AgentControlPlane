import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { settingsPage } from "../src/local-review/page.js";
import { LocalReviewSettings } from "../src/local-review/settings.js";

const projects = [
  {
    id: "project:available",
    name: "AgentControlPlane",
    category: "开源",
    alias: "开源/AgentControlPlane",
    status: "available",
    path_revision: 2,
    relink_candidate_count: 0,
  },
  {
    id: "project:available-2",
    name: "calculator",
    category: "未分类",
    alias: "未分类/calculator",
    status: "available",
    path_revision: 1,
    relink_candidate_count: 0,
  },
  {
    id: "project:moved",
    name: "moved-project",
    category: "未分类",
    alias: "未分类/moved-project",
    status: "relink_required",
    path_revision: 1,
    relink_candidate_count: 1,
  },
];

function options() {
  return {
    workspaces: ["project:available", "project:available-2"],
    workspaceEntries: [
      { value: "project:available", label: "开源/AgentControlPlane" },
      { value: "project:available-2", label: "未分类/calculator" },
    ],
    projects,
    discoveryRoots: ["D:\\Development"],
    executors: [{ id: "opencode", display_name: "OpenCode", ready: true }],
    profiles: ["economy"],
  };
}

test("project library keeps routine actions visible and management controls advanced", () => {
  const html = settingsPage({
    settings: {
      workspace: "project:available",
      executor: "opencode",
      profile: "economy",
      autoDispatch: false,
      returnResultToChat: false,
      workspaceStatus: "available",
    },
    formSecret: "local-secret",
    options: options(),
  });

  assert.match(html, /项目文件夹路径/);
  assert.match(html, /value="add_project"/);
  assert.match(html, /当前默认/);
  assert.match(html, /value="set_default"/);
  assert.match(html, /需要处理的项目/);
  assert.match(html, /确认新位置/);
  assert.match(html, /value="remove"/);
  assert.match(html, /<summary>高级设置<\/summary>/);
  assert.match(html, /value="add_root"/);
  assert.match(html, /revision 2/);
});

test("setting one project as default preserves the remaining dispatch settings", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-project-settings-"));
  const settings = new LocalReviewSettings({
    stateDir,
    getOptions: options,
    validateSelection: (selection) => selection,
  });

  settings.save(settings.issueFormSecret(), {
    workspace: "project:available",
    executor: "opencode",
    profile: "economy",
    auto_dispatch: "on",
    return_result_to_chat: "on",
  });
  const saved = settings.setWorkspace(
    settings.issueFormSecret(),
    "project:available-2",
  );

  assert.equal(saved.workspace, "project:available-2");
  assert.equal(saved.executor, "opencode");
  assert.equal(saved.profile, "economy");
  assert.equal(saved.autoDispatch, true);
  assert.equal(saved.returnResultToChat, true);
});
