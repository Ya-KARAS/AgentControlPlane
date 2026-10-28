# 控制面协议

> [English](PROTOCOL.md)

## 工程简报

```json
{
  "workspace": "D:\\Projects\\example",
  "idempotency_key": "web:conversation-123:task-4",
  "executor": "auto",
  "objective": "Add a tested GET /hello endpoint.",
  "constraints": ["Do not add a framework dependency."],
  "acceptance_criteria": [
    "GET /hello returns HTTP 200",
    "Response JSON equals {\"message\":\"hello\"}",
    "Automated tests pass"
  ],
  "context": ["The project already uses node:test."],
  "evidence_required": ["test command and result", "changed file list"],
  "profile": "balanced",
  "model": null,
  "reasoning_effort": null,
  "max_subagents": null,
  "token_budget": null
}
```

`executor` 可以是 `auto`、`opencode`、`codex`、`claude`、`openai-compatible` 或 `deepseek`。`auto` 会在任务持久化之前解析为实际的执行器，因此状态和审计记录始终显示工作实际运行在哪里。

持久项目线程按执行器分开保存。同一个工作区可以同时保留 Codex 线程和
OpenCode 会话。任务只会恢复属于自己执行器的线程。没有执行器归属的旧项目
状态按 Codex 状态读取。

`idempotency_key` 是可选字段，可包含 8–200 个字母、数字、点、下划线、冒号或
连字符。相同 key 和相同规范化派发内容会返回原任务；相同 key 携带不同内容时
返回 `idempotency_conflict`。浏览器伴侣根据页面 URL 和规范化请求生成该 key。

## 紧凑结果

```json
{
  "status": "completed",
  "summary": "Implemented and tested the endpoint.",
  "changed_files": ["server.js", "server.test.js"],
  "tests": [{"command": "npm test", "status": "passed"}],
  "blockers": [],
  "next_action": null,
  "usage": {
    "input_tokens": 0,
    "cached_input_tokens": 0,
    "output_tokens": 0,
    "reasoning_output_tokens": 0,
    "total_tokens": 0
  },
  "subagents": []
}
```

Web 控制器应轮询直到出现终态。当结果为 `blocked`、`partial` 或 `failed` 时，它应使用结构化的 `blocker` 和证据来修正简报，或解释为什么需要用户输入。这就是自动反馈回路，它取代了在两个对话之间复制输出的做法。

两种后续工具都只传递紧凑证据：

- `continue_project` 在未指定 `executor` 时保留原执行器和持久会话。指定
  `executor` 时，会在能力门禁通过后于同一逻辑链路开启一个新会话。
- `handoff_project` 要求源任务已经进入终态。它在同一逻辑链路上为所选执行器
  创建子任务，并且只传递紧凑 continuation package：源状态、摘要、变更文件、
  测试证据、阻塞项和错误文本。package 不包含网页对话，也不包含源执行器线程
  id。默认情况下，子任务恢复目标执行器自己已保存的项目线程。
  `fresh_session: true` 会为独立复查开启新会话，并且不替换已保存的项目线程。

## MCP 工具

- `dispatch_project` — 创建带 `auto` 或显式路由的异步任务。
- `dispatch_opencode` — 向后兼容的 OpenCode 快捷方式。
- `task_status` — 读取紧凑状态、结果、用量、执行器历史、最新 continuation
  package、reroute 原因和可选的最新事件。
- `continue_project` — 向同一项目发送更正或后续消息。可选的 `executor`
  会在能力门禁通过后使用另一个执行器继续；省略时保留原执行器和持久会话。
- `handoff_project` — 源任务进入终态后，把紧凑源证据交给所选执行器做复查或
  续接。可选的 `fresh_session: true` 会开启新的目标会话，而不是恢复该执行器
  已保存的项目线程。`POST /v1/tasks/:id/handoff` 接受同一请求体，包括
  `fresh_session`。
- `cancel_task` — 中断排队或进行中的工作。
- `list_tasks` — 列出最近的任务。
- `list_executors` — 检查发现结果、能力和当前默认值。
- `list_profiles` — 检查模型/预算策略。
- `list_models` — 检查一个执行器的缓存目录。
- `usage_report` — 聚合测得的工程用量。

## 跨执行器续接

每个任务都会暴露稳定的 `logical_task_id`。子续接任务继承该 id，并继续用
`parentTaskId` 表示直接父子关系。`executor_history` 只追加，记录每次获得的
执行器会话。出现允许自动切换的基础设施故障时，ACP 会保存紧凑的
`continuation` package，并可选择下一个兼容执行器。

自动 reroute 默认关闭。只有设置 `executor.reroute.enabled=true` 才启用，且受
`max_reroutes` 限制；允许原因仅包括 `quota_exhausted`、`rate_limited`、
`executor_unavailable`、`authentication_unavailable` 和
`provider_unavailable`。测试、构建、实现和验证失败不会切换执行器。没有兼容
执行器时任务进入 `blocked`，不会静默使用不兼容后端。

ACP 启动时会检查已持久化的 `queued` 和 `running` 任务。排队中的续接任务保留
follow-up 提示语义。排队中的 handoff 保留新简报提示，不会恢复源线程。恢复到
终态的 turn 会更新执行器历史；符合允许分类的基础设施故障可以进入同一套能力
门禁 reroute 流程。

`handoff_project` 不是自动 reroute。基础设施 reroute 仍遵循
`executor.reroute`，并开启新会话。handoff 是显式请求，只复用紧凑的终态证据。
默认只会恢复目标执行器已经保存的项目线程。`fresh_session: true` 强制开启新
会话，并保留已保存的项目线程给后续任务使用。

## Token 预算

用量测量和中断精度取决于执行器的遥测数据。Codex 暴露实时的线程目标，可以在运行期间轮询。CLI 适配器可能只在最终事件中报告累计用量，因此它们的预算也作为策略指导发送，但无法始终以相同的粒度强制执行。Provider 在两次测量之间可能会消耗额外的 token。
