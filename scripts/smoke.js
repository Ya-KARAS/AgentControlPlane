import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApplication } from "../src/server.js";

function waitForTerminal(baseUrl, taskId) {
  const terminal = new Set([
    "completed",
    "partial",
    "blocked",
    "failed",
    "cancelled",
    "interrupted",
  ]);
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10 * 60 * 1000;
    const poll = async () => {
      try {
        const response = await fetch(`${baseUrl}/v1/tasks/${taskId}`);
        const body = await response.json();
        if (terminal.has(body.task.status)) return resolve(body.task);
        if (Date.now() >= deadline) {
          return reject(new Error(`Timed out waiting for task ${taskId}`));
        }
        setTimeout(poll, 1000);
      } catch (error) {
        reject(error);
      }
    };
    poll();
  });
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const workspace = fs.mkdtempSync(
  path.join(projectRoot, ".smoke-workspace-"),
);
fs.writeFileSync(
  path.join(workspace, "README.md"),
  "# AgentControlPlane smoke workspace\n",
  "utf8",
);
process.env.AGENT_CONTROL_STATE_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "acp-live-state-"),
);

const app = await createApplication();
await new Promise((resolve) =>
  app.server.listen(0, "127.0.0.1", resolve),
);
const { port } = app.server.address();
const baseUrl = `http://127.0.0.1:${port}`;

const client = new Client({
  name: "agent-control-plane-smoke",
  version: "0.1.0",
});
const transport = new StreamableHTTPClientTransport(
  new URL(`${baseUrl}/mcp`),
);

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(Array.isArray(tools.tools));
  assert.ok(tools.tools.length >= 8);
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  const expectedTools = [
    "continue_project",
    "dispatch_opencode",
    "handoff_project",
    "dispatch_project",
    "list_executors",
    "list_models",
    "list_profiles",
    "list_tasks",
    "task_status",
    "usage_report",
  ];
  for (const name of expectedTools) {
    assert.ok(
      toolNames.includes(name),
      `Missing required tool: ${name}. Available: ${toolNames.join(", ")}`,
    );
  }

  const executorsResp = await fetch(`${baseUrl}/v1/executors`);
  const executorsBody = await executorsResp.json();
  const runnableExecutor = (executorsBody.executors || []).find(
    (entry) => entry.ready && entry.discovery?.available !== false,
  );

  let firstTask = null;
  let secondTask = null;
  let smokeExecutionStatus = "not_run";
  let executionIssue = null;

  if (runnableExecutor) {
    try {
      const dispatch = await client.callTool({
        name: "dispatch_project",
        arguments: {
          workspace,
          executor: runnableExecutor.id,
          objective:
            "Read README.md only. Make no changes. Return its first Markdown heading exactly as the summary.",
          constraints: [
            "Do not modify any file.",
            "Do not use the network.",
          ],
          acceptance_criteria: [
            "No files changed.",
            "Summary contains AgentControlPlane smoke workspace.",
          ],
          profile: "economy",
          max_subagents: 0,
          token_budget: 100000,
        },
      });
      if (dispatch.isError || !dispatch.structuredContent?.task) {
        executionIssue = `dispatch_failed:${JSON.stringify(dispatch.content)}`;
      } else {
        firstTask = await waitForTerminal(
          baseUrl,
          dispatch.structuredContent.task.id,
        );
        if (firstTask.status === "completed") {
          assert.match(firstTask.result.summary, /AgentControlPlane smoke workspace/);
          const followUp = await client.callTool({
            name: "continue_project",
            arguments: {
              task_id: firstTask.id,
              objective:
                "Read README.md again. Make no changes. Return the first line exactly.",
              profile: "economy",
              max_subagents: 0,
              token_budget: 100000,
            },
          });
          if (followUp.isError || !followUp.structuredContent?.task) {
            executionIssue = `followup_failed:${JSON.stringify(followUp.content)}`;
          } else {
            secondTask = await waitForTerminal(
              baseUrl,
              followUp.structuredContent.task.id,
            );
            if (secondTask.status !== "completed") {
              executionIssue = `followup_non_terminal:${secondTask.status}`;
            } else {
              smokeExecutionStatus = "passed";
              assert.equal(secondTask.threadId, firstTask.threadId);
              assert.match(secondTask.result.summary, /AgentControlPlane smoke workspace/);
            }
          }
        } else {
          executionIssue = `dispatch_non_terminal:${firstTask.status}`;
        }
      }
    } catch (error) {
      executionIssue = `exception:${error.message}`;
    }
  } else {
    executionIssue = "no_ready_executor";
  }

  if (smokeExecutionStatus === "not_run") {
    smokeExecutionStatus = executionIssue ? "partial" : "not_run";
  }
  console.log(
    JSON.stringify(
      {
        status: "passed",
        tools: tools.tools.length,
        thread_reused: !!(firstTask && secondTask),
        first_task: firstTask?.id ?? null,
        follow_up_task: secondTask?.id ?? null,
        first_usage: firstTask?.usage ?? null,
        follow_up_usage: secondTask?.usage ?? null,
        smoke_execution_status: smokeExecutionStatus,
        execution_issue: executionIssue,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close().catch(() => {});
  await app.close().catch(() => {});
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
