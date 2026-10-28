# 架构

> [English](ARCHITECTURE.md)

## 产品边界

AgentControlPlane 将工作分为两层：

1. **控制平面** —— 支持 MCP 的 Web AI 澄清意图、比较方案、发送一份紧凑简报并评估结果。
2. **执行平面** —— 被选中的本地工程代理编辑代码、运行工具、验证结果，并可选择地委派独立工作。

这减少了对话之间重复的上下文和手动转译。它不会绕过提供商限制；所选 `executor` 仍会消耗自身的额度或 API 用量。

## 数据流

```text
User
  -> web AI: broad request and discussion
  -> dispatch_project: compact EngineeringBrief
  -> Orchestrator: workspace, policy, and route validation
  -> TaskStore: queued task with resolved executor id
  -> executor adapter: thread/goal/turn lifecycle
  -> local engineering agent and optional subagents
  -> normalized result, evidence, events, and usage
  -> TaskStore + append-only audit log
  -> task_status: compact structured result
  -> web AI: accept, correct automatically, or request user input
```

## 双向适配器边界

北向边界是 MCP。任何能够调用已发布 MCP 工具的 Web AI 都可以充当控制器。产品特定的连接和权限步骤位于核心任务协议之外。

南向边界是 `src/executors/lifecycle.js` 中的语义生命周期契约：模型列表、就绪状态、持久化项目身份、目标、轮次、取消、事件和用量。

当前实现包括：

- `CodexExecutor`，用于 Codex app-server RPC；
- `OpenCodeExecutor`，用于 OpenCode 的 JSON 事件流；
- `ClaudeCodeExecutor`，用于 Claude Code 的 stream-json 输出；
- `OpenAICompatibleExecutor`，用于 responses/chat 端点及其受约束的本地 `read_file`、`write_file` 和 `shell` 工具循环。

## 发现与路由

启动时每个适配器执行一次只读探测。CLI 探测只解析可执行文件，不会启动它；本地兼容端点暴露 `/models`；远程兼容提供商必须配置凭据。发现过程不会发送工程提示词，也不会消耗模型轮次。

当 `executor.provider: "auto"` 时，路由遵循 `executor.routing.order`。健康条目优先于降级条目。解析出的 id 会持久化到任务上，因此继续执行、取消、审计和报告使用同一个 `executor`。任务上显式指定的 `executor` 会覆盖自动路由。

## 反馈循环与 token 效率

- `EngineeringBrief` 只包含目标、约束、验收标准、已知上下文和所请求的证据。
- 在 `executor` 支持持久会话的情况下，项目身份会被复用。线程按执行器保存，
  一个执行器不会恢复另一个执行器的 id。
- `handoff_project` 把紧凑 continuation package 交给另一个执行器做终态复查。
  它不会重放网页对话。
- 最终输出被规范化为紧凑摘要、文件、测试、阻塞项、下一步操作和用量。
- Web 控制器轮询任务，可以将结构化阻塞项转换为修正后的 `continue_project` 调用，无需用户复制文本。
- 原始事件保留在本地，仅在明确请求时返回。

用量精度取决于 `executor`。Codex 暴露实时目标用量；CLI 代理可能只在进程结束时报告累计用量。

## Profile 档位

| Profile | 用途 | 精力 | 子代理 | 默认预算 |
|---|---:|---:|---:|---:|
| economy | 小型、定义明确的修改 | low | 0 | 30k |
| balanced | 常规功能/缺陷修复工作 | high | up to 2 | 90k |
| deep | 架构、大规模重构、疑难调试 | ultra | up to 4 | 220k |

Profile 是策略默认值；任务可以在配置的限制范围内覆盖模型、精力、并发和预算。

## 持久化与信任

任务状态和项目关联存储在 workspace 之外。审计条目构成一条 append-only 的完整性链条。本地 HTTP 服务仅绑定到 loopback。

Codex 具有显式的 workspace-write 沙箱路径。CLI 和兼容端点适配器以宿主用户的权限执行，因此仅限于 allowlist 中的可信工作区。托管中继需要单独的多租户身份验证和设备信任设计；本地服务器不得直接暴露到公共互联网。
