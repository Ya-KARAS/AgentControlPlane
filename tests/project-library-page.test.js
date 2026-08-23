import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reviewErrorPage, settingsPage } from "../src/local-review/page.js";
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
    models: {
      opencode: [
        {
          id: "deepseek/deepseek-v4-flash",
          display_name: "DeepSeek V4 Flash",
          reasoning_efforts: ["low", "high"],
        },
      ],
    },
    reasoningEfforts: ["low", "high"],
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
  assert.match(html, /资料目录和空文件夹都可以加入项目库/);
  assert.match(html, /默认执行器/);
  assert.match(html, /默认任务档位/);
  assert.match(html, /默认模型/);
  assert.match(html, /默认推理等级/);
  assert.equal((html.match(/网页 AI 推荐（本机校验）/g) ?? []).length, 4);
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

test("project action errors return to the local project library", () => {
  const html = reviewErrorPage(new Error("Project folder is unavailable"), {
    projectAction: true,
  });
  assert.match(html, /项目操作未完成/);
  assert.match(html, /href="\/local-review\/settings"/);
  assert.match(html, /返回项目库/);
  assert.doesNotMatch(html, /油猴面板/);
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
      model: "auto",
      reasoning_effort: "auto",
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
  assert.equal(saved.model, "auto");
  assert.equal(saved.reasoning_effort, "auto");
  assert.equal(saved.autoDispatch, true);
  assert.equal(saved.returnResultToChat, true);
});
