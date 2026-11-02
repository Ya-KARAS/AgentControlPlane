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
状态按 Codex 状态读取。项目重新链接后，旧位置保存的线程全部失效，下一次
运行会开启新会话，而不会恢复记录在旧路径上的线程。

`idempotency_key` 是可选字段，可包含 8–200 个字母、数字、点、下划线、冒号或
连字符。相同 key 和相同规范化派发内容会返回原任务；相同 key 携带不同内容时
返回 `idempotency_conflict`。该 key 只属于一种操作：在 dispatch、continue
和 handoff 之间复用也会返回 `idempotency_conflict`。浏览器伴侣根据页面 URL
和规范化请求生成该 key。

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
  package 中的每个文本字段都有长度上限，序列化后的 package 也会被限制，
  使 handoff 提示不超过 `limits.maxBriefCharacters`。

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
会话，并保留已保存的项目线程给后续任务使用。如果基础设施 reroute 之后又
移动了这次 handoff，回退执行器会开启新会话，不会恢复它已保存的项目线程。

## Token 预算

用量测量和中断精度取决于执行器的遥测数据。Codex 暴露实时的线程目标，可以在运行期间轮询。CLI 适配器可能只在最终事件中报告累计用量，因此它们的预算也作为策略指导发送，但无法始终以相同的粒度强制执行。Provider 在两次测量之间可能会消耗额外的 token。

## 执行节点建议（可选）

`execution_nodes({requested_node_id?,executor_id?})` 读取本地/云节点登记和主机
缓存的新鲜观测。默认关闭；缺失观测为未知，显式指定的不可用节点不会自动回退。
始终返回 `advisory_only:true`、`execution_authorized:false`，不分配任务或授予执行权。
客户端不能提供可信观测或批准。[配置、信任和 PR4 门槛](EXECUTION-NODES.md)。

## 可选控制器所有权（PR1）

`controllers.enabled` 默认 `false`；旧 dispatch/continue/handoff 调用无需新增参数。
启用后，新任务仅归属明确的 `local-operator`。当前共享 bearer/本地传输无法分别
认证私人 Agent；`caller_id`、`controller_id`、`controller` 和提示词均不能自证身份。
原有传输授权和用户取消能力保持不变。

新增只读 MCP 工具 `list_controllers`，可选 `limit` 为 1–100 的整数（默认 20），
表示检查最近多少条任务。返回 `enabled`、`mode`、`lease_ttl_seconds`、
`identity_scope: "local_operator"`、公开 `controllers`（`id`、`kind`、
`display_name`）及这些任务中的 `task_owners`。所有权摘要仅包含 `task_id`、
`owner`、`generation`、`expires_at` 和 `lease_state`（`active`、`expired`、
`released`），不包含 principal 绑定、凭据、路径、提示词、事件或执行器数据，也不
续租。原端点认证仍有效；未配置 token 的 loopback 端点可读取同一安全视图。
不新增可修改所有权的 claim/renew/release/takeover 工具或路由。

任务新增可选 `controller`（`id`、`kind`、`mode`）和 `control_lease`（`owner`、
`generation`、`expires_at`）；旧记录和功能关闭时创建的任务均规范化为 `null`。
释放保留 `owner: null` 和最后的 generation，重领必须递增以避免 ABA。释放后的
`controller.id` 是最后的 actor，不代表活跃所有者；当前控制权以 lease 为准。
配置、模式及边界详见 [控制器说明](CONTROLLERS.md)。

## 仅主机内部的节点恢复

受管理任务增加可选 `execution_node_id` / `node_recovery`，旧记录默认为 null。
恢复写入和准入凭证仅供主机内部使用，不增加 MCP 写工具；客户端自称停止不能
授予新执行权。[状态转移、故障和依赖顺序](NODE-RECOVERY.md)。

## 统一本地消息（可选）

`post_message` / `list_messages` 与受保护的 `/v1/messages` 共用日志；显式
`POST /v1/messages/dispatch` 使用服务器消息键调用原派单/续作，跨通道重放
不会重复执行。[边界、身份、重试与生命周期](MESSAGES.md)。不自动消费消息。

## 交付观测（PR3）

只读 `delivery_status(task_id)` 和 GET `/v1/tasks/:id/delivery` 返回任务的可选
交付元数据，与执行 `status` 分开；缺失或损坏数据返回 null。手工报告单列为
`reported_checks` / `reported_review_state`，已验证 `checks` / `review_state`
保持 `unknown`。`approval_supported` 为 false；客户端自称用户、模型建议或
绿色 CI 均不能设置 approved/merged。既有认证不变，无修改交付的工具或路由。
详见 [交付契约与离线操作](DELIVERY.md)。

## 可信验收、日报和归档（可选）

`archive_task` / 受保护归档 POST 仅接受任务标识；必须已有可信用户验收、检查通过、
执行器不活跃。`list_active_tasks` / 活动视图只筛选已完成日报/归档的记录，原任务
历史列表不变。`daily_report` 和按日期读取接口返回安全日报数据。
[顺序、重试、历史保留和真实验收门槛](WORKFLOW-ARCHIVE.md)。

## 离线对话接口

See [offline project conversations](CONVERSATIONS.md) for protected scoped message,
continuation and safe stop interfaces, default-off authorization and browser limits.
The original single queue and human approval boundary remain authoritative.
