import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OpenAICompatibleExecutor } from "../src/executors/openai-compatible-executor.js";
import { publicModels } from "../src/core/profiles.js";

const PING_MARKER = "Call the ping tool exactly once.";

function startServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : {};
    requests.push({ method: req.method, url: req.url, body });
    res.setHeader("content-type", "application/json");
    await handler(req, res, body, requests);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        requests,
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      });
    });
  });
}

function responseWithToolCall(name) {
  return {
    output: [
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name,
        arguments: "{}",
        status: "completed",
      },
    ],
    usage: {
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function chatWithToolCall(name) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name, arguments: "{}" },
            },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: 3,
      completion_tokens: 2,
      total_tokens: 5,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

test("auto protocol prefers responses when its tool loop works", async () => {
  const { server, baseUrl } = await startServer(async (req, res, body) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "probe-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      res.end(JSON.stringify(responseWithToolCall("ping")));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  try {
    const executor = new OpenAICompatibleExecutor({
      baseUrl,
      protocol: "auto",
    });
    const discovery = await executor.probe();
    assert.equal(discovery.available, true);
    assert.equal(discovery.protocols.selected, "responses");
    assert.equal(discovery.protocols.responses.toolLoop, true);
    await executor.stop();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("auto protocol falls back to chat when responses is absent", async () => {
  const { server, baseUrl } = await startServer(async (req, res, body) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "probe-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      res.end(JSON.stringify(chatWithToolCall("ping")));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  try {
    const executor = new OpenAICompatibleExecutor({
      baseUrl,
      protocol: "auto",
    });
    const discovery = await executor.probe();
    assert.equal(discovery.available, true);
    assert.equal(discovery.protocols.selected, "chat");
    assert.equal(discovery.protocols.chat.toolLoop, true);
    await executor.stop();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("auto protocol falls back to chat when responses lacks tool calling", async () => {
  const { server, baseUrl } = await startServer(async (req, res, body) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "probe-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      res.end(
        JSON.stringify({
          output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      res.end(JSON.stringify(chatWithToolCall("ping")));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  try {
    const executor = new OpenAICompatibleExecutor({
      baseUrl,
      protocol: "auto",
    });
    const discovery = await executor.probe();
    assert.equal(discovery.protocols.selected, "chat");
    assert.equal(discovery.protocols.responses.available, true);
    assert.equal(discovery.protocols.responses.toolLoop, false);
    await executor.stop();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("auto protocol reports degraded when no tool loop works", async () => {
  const { server, baseUrl } = await startServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "probe-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      res.end(
        JSON.stringify({
          output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "pong" } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  try {
    const executor = new OpenAICompatibleExecutor({
      baseUrl,
      protocol: "auto",
    });
    const discovery = await executor.probe();
    assert.equal(discovery.available, false);
    assert.equal(discovery.status, "degraded");
    assert.equal(discovery.protocols.selected, null);
    await executor.stop();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("protocol detection runs once and is cached", async () => {
  const { server, baseUrl, requests } = await startServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "probe-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      res.end(JSON.stringify(responseWithToolCall("ping")));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  try {
    const executor = new OpenAICompatibleExecutor({
      baseUrl,
      protocol: "auto",
    });
    const first = await executor.probe();
    const requestsAfterFirst = requests.length;
    const second = await executor.probe();
    assert.deepEqual(second, first);
    assert.equal(requests.length, requestsAfterFirst);
    await executor.stop();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("auto protocol completes a full chat tool loop turn", async () => {
  let chatRounds = 0;
  const { server, baseUrl } = await startServer(async (req, res, body) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "probe-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const userText = String(body?.messages?.[0]?.content ?? "");
      if (userText === PING_MARKER) {
        res.end(JSON.stringify(chatWithToolCall("ping")));
        return;
      }
      chatRounds += 1;
      if (chatRounds === 1) {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "write_file",
                        arguments: JSON.stringify({
                          path: "hello.txt",
                          content: "hi auto",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 3,
              completion_tokens: 2,
              total_tokens: 5,
              prompt_tokens_details: { cached_tokens: 0 },
              completion_tokens_details: { reasoning_tokens: 0 },
            },
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  status: "completed",
                  summary: "Wrote hello.txt",
                  changed_files: ["hello.txt"],
                  tests: [],
                  blockers: [],
                  next_action: null,
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 2,
            total_tokens: 6,
            prompt_tokens_details: { cached_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 0 },
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-auto-work-"));
  const executor = new OpenAICompatibleExecutor({
    baseUrl,
    protocol: "auto",
    workspaceRoots: [workspace],
  });
  try {
    await executor.start();
    const notifications = [];
    executor.on("notification", (message) => notifications.push(message));

    const { thread } = await executor.startThread({ cwd: workspace });
    await executor.setGoal({
      threadId: thread.id,
      objective: "Write hello.txt",
      tokenBudget: 5000,
    });
    await executor.startTurn({
      threadId: thread.id,
      input: [{ type: "text", text: "Write hello.txt" }],
      model: "probe-model",
      cwd: workspace,
      outputSchema: {},
    });

    const deadline = Date.now() + 2000;
    while (
      !notifications.some((entry) => entry.method === "turn/completed") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const completed = notifications.find(
      (entry) => entry.method === "turn/completed",
    );
    assert.ok(completed, "turn completed");
    assert.equal(executor.protocol, "chat");
    assert.equal(
      fs.readFileSync(path.join(workspace, "hello.txt"), "utf8"),
      "hi auto",
    );
    const report = JSON.parse(completed.params.turn.items[0].text);
    assert.equal(report.status, "completed");
  } finally {
    await executor.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("explicit protocols skip detection requests", async () => {
  const { server, baseUrl, requests } = await startServer(async (req, res, body) => {
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  status: "completed",
                  summary: "Done",
                  changed_files: [],
                  tests: [],
                  blockers: [],
                  next_action: null,
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 3,
            completion_tokens: 2,
            total_tokens: 5,
            prompt_tokens_details: { cached_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 0 },
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  const executor = new OpenAICompatibleExecutor({
    baseUrl,
    protocol: "chat",
  });
  try {
    await executor.start();
    const { thread } = await executor.startThread({ cwd: os.tmpdir() });
    await executor.setGoal({
      threadId: thread.id,
      objective: "x",
      tokenBudget: 5000,
    });
    await executor.startTurn({
      threadId: thread.id,
      input: [{ type: "text", text: "x" }],
      model: "m",
      cwd: os.tmpdir(),
      outputSchema: {},
    });
    const deadline = Date.now() + 2000;
    while (
      !requests.some((entry) => entry.url === "/v1/chat/completions") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(
      requests.filter((entry) => entry.url === "/v1/responses").length,
      0,
    );
    assert.equal(
      requests.filter(
        (entry) =>
          entry.body?.messages?.[0]?.content === PING_MARKER,
      ).length,
      0,
    );
  } finally {
    await executor.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("catalog preferred_protocol=chat probes chat first and selects it", async () => {
  const { server, baseUrl, requests } = await startServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(
        JSON.stringify({
          data: [{ id: "probe-model", preferred_protocol: "chat" }],
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      res.end(JSON.stringify(responseWithToolCall("ping")));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      res.end(JSON.stringify(chatWithToolCall("ping")));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  try {
    const executor = new OpenAICompatibleExecutor({
      baseUrl,
      protocol: "auto",
    });
    const discovery = await executor.probe();
    assert.equal(discovery.protocols.selected, "chat");
    assert.equal(discovery.protocols.preferred_protocol, "chat");
    assert.deepEqual(discovery.protocols.probe_order, ["chat", "responses"]);
    assert.equal(discovery.protocols.responses.toolLoop, null);
    const firstProbe = requests.find(
      (entry) =>
        entry.url === "/v1/chat/completions" || entry.url === "/v1/responses",
    );
    assert.equal(firstProbe.url, "/v1/chat/completions");
    assert.equal(
      requests.filter((entry) => entry.url === "/v1/responses").length,
      0,
    );
    await executor.stop();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("model catalog passes provider routing metadata", async () => {
  const { server, baseUrl } = await startServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(
        JSON.stringify({
          data: [
            {
              id: "m1",
              capabilities: { chat: true, tools: true },
              preferred_protocol: "chat",
              route_health: "healthy",
              latency: { p50_ms: 1200 },
              pricing: { input_per_mtok: 0.4 },
              status: "available",
              context: 128000,
              tier: "pro",
            },
          ],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  const executor = new OpenAICompatibleExecutor({
    baseUrl,
    protocol: "chat",
  });
  try {
    const catalog = await executor.listModels();
    const model = catalog.data[0];
    assert.equal(model.preferred_protocol, "chat");
    assert.equal(model.route_health, "healthy");
    assert.deepEqual(model.latency, { p50_ms: 1200 });
    assert.deepEqual(model.pricing, { input_per_mtok: 0.4 });
    assert.equal(model.status, "available");
    assert.equal(model.context, 128000);
    assert.equal(model.tier, "pro");

    const public_ = publicModels(catalog.data);
    assert.equal(public_[0].preferred_protocol, "chat");
    assert.equal(public_[0].route_health, "healthy");
    assert.equal(public_[0].tier, "pro");
  } finally {
    await executor.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("chat turns send task attribution headers", async () => {
  const captured = [];
  const { server, baseUrl } = await startServer(async (req, res, body) => {
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      captured.push(req.headers);
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  status: "completed",
                  summary: "Done",
                  changed_files: [],
                  tests: [],
                  blockers: [],
                  next_action: null,
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 3,
            completion_tokens: 2,
            total_tokens: 5,
            prompt_tokens_details: { cached_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 0 },
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-attr-ws-"));
  const attributedWorkspace = path.join(workspace, "本地");
  const executor = new OpenAICompatibleExecutor({
    id: "relay-x",
    baseUrl,
    protocol: "chat",
    workspaceRoots: [workspace],
  });
  try {
    await executor.start();
    const notifications = [];
    executor.on("notification", (message) => notifications.push(message));
    const { thread } = await executor.startThread({ cwd: workspace });
    await executor.setGoal({
      threadId: thread.id,
      objective: "x",
      tokenBudget: 5000,
    });
    await executor.startTurn({
      threadId: thread.id,
      input: [{ type: "text", text: "x" }],
      model: "m",
      cwd: workspace,
      outputSchema: {},
      attribution: { taskId: "task-123", workspace: attributedWorkspace },
    });
    const deadline = Date.now() + 2000;
    while (
      !notifications.some((entry) => entry.method === "turn/completed") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(captured.length > 0, "chat request captured");
    assert.equal(captured[0]["x-acp-task-id"], "task-123");
    assert.equal(captured[0]["x-acp-project"], encodeURIComponent("本地"));
    assert.equal(captured[0]["x-acp-executor"], "relay-x");
  } finally {
    await executor.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("model catalog passes provider capabilities and probe cache through", async () => {
  const { server, baseUrl } = await startServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(
        JSON.stringify({
          data: [
            {
              id: "declared-model",
              capabilities: { chat: true, tools: true, reasoning: true },
              metadata: { featured: true, routeTier: "pro" },
            },
            { id: "bare-model" },
          ],
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      res.end(JSON.stringify(responseWithToolCall("ping")));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  const executor = new OpenAICompatibleExecutor({
    baseUrl,
    protocol: "auto",
  });
  try {
    const catalog = await executor.listModels();
    const declared = catalog.data.find((model) => model.id === "declared-model");
    assert.deepEqual(declared.capabilities, {
      chat: true,
      responses: null,
      tools: true,
      reasoning: true,
      vision: null,
    });
    assert.equal(declared.featured, true);
    assert.equal(declared.route_tier, "pro");

    const bare = catalog.data.find((model) => model.id === "bare-model");
    assert.equal(bare.capabilities, null);

    const public_ = publicModels(catalog.data);
    assert.equal(
      public_.find((model) => model.id === "declared-model").capabilities.chat,
      true,
    );
    assert.equal(
      public_.find((model) => model.id === "declared-model").featured,
      true,
    );
    assert.equal(
      public_.find((model) => model.id === "bare-model").capabilities,
      null,
    );
  } finally {
    await executor.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});
