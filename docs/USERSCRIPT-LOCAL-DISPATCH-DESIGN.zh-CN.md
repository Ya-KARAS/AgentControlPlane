# 油猴自然语言派发设计

状态：桌面版 ChatGPT 与 DeepSeek 适配器、任务信封暂存、用户确认派发、本机执行设置、
来源绑定状态查询和可选安全结果回传均已实现。

## 目标

用户在网页 AI 的原生对话中规划和控制工程任务。网页 AI 负责补齐需求并生成精简任务信封；
AgentControlPlane 使用本机保存的执行选择和策略派发任务。所有者开启结果回传后，ACP 会把
经过裁剪的结果发回同一段网页对话。

## 范围

本阶段支持连接 `127.0.0.1:4318` 的桌面浏览器。ChatGPT 与 DeepSeek 使用独立适配器。
手机访问、设备配对、中转传输和未知网页自动识别属于后续工作。

## 信任与确认边界

网页、AI 回复、页面脚本和 DOM 都是不可信输入。`<ACP_TASK>` 只是一份待暂存的数据，
不构成派发授权。

派发必须来自一次新的用户操作：用户在已支持的网页输入框中填写简短确认词并按下发送。
DOM 变化、页面加载、页面跳转、AI 生成文字或历史用户消息都不能代替这次确认。关闭自动
派发后，ACP 还会打开一次性本机审核页。

工作区根目录、执行器就绪状态、模型能力、凭据、速率限制、审计记录和执行器策略均由
本机 ACP 管理。网页可以请求工作区、执行器、Profile、已公布模型和已公布推理等级，
但 ACP 会在本机重新校验每个值。凭据和未支持字段不会进入候选。

## 用户流程

1. 用户发送 `@AgentControlPlane`，并在后面描述工程需求。
2. 脚本读取受限的本机能力摘要，再把这条命令展开成控制提示词，发送给网页 AI。
3. 网页 AI 继续对话，询问缺失信息。
4. 信息齐全后，网页 AI 在 `<ACP_TASK>` 标签之间输出一个 JSON 对象。
5. 脚本校验并暂存任务，状态入口提示等待用户回复“执行”。
6. 用户在网页输入框中发送简短确认词。
7. ACP 创建候选并校验网页请求的执行选择。本机设置决定是使用校验后的选择直接派发，
   还是打开一次性审核页；没有指定的字段使用已保存默认值。
8. 脚本使用短期、来源绑定的能力令牌查询任务状态。
9. 如果本机已开启结果回传，任务结束后会把 `<ACP_RESULT>` 投影发送到同一段对话。

## 网页到 ACP 的数据契约

网页任务信封可以包含：

```json
{
  "objective": "明确的工程目标",
  "context": "工程执行需要的上下文",
  "constraints": ["重要约束"],
  "acceptance_criteria": ["可观察的完成条件"],
  "execution": {
    "workspace": "已登记项目别名",
    "executor": "opencode",
    "profile": "economy",
    "model": "opencode-go/deepseek-v4-pro",
    "reasoning_effort": "high"
  }
}
```

脚本把它转换为现有候选契约：

```json
{
  "objective": "字符串",
  "constraints": ["受长度限制的字符串"],
  "execution": {
    "workspace": "受长度限制的字符串",
    "executor": "受长度限制的字符串",
    "profile": "受长度限制的字符串",
    "model": "受长度限制的字符串",
    "reasoning_effort": "受长度限制的字符串"
  },
  "source": "userscript-preview"
}
```

`execution` 是可选对象。脚本只复制上述五个字段，ACP 再根据本机配置校验。候选不包含
凭据、完整对话、浏览器标识或本机文件内容。

规划前，`GET /v1/local-review/capabilities` 只返回工作区目录名、已就绪执行器 ID、
Profile ID、模型 ID 和推理等级 ID，不返回配置根路径、凭据、日志或文件内容。

## ACP 到网页的数据契约

可选结果投影只包含：

```json
{
  "task_id": "字符串",
  "status": "completed",
  "changed_files_count": 0,
  "tests": { "total": 0, "passed": 0, "failed": 0 },
  "blocker_count": 0,
  "execution": {
    "executor": "opencode",
    "profile": "economy",
    "model": "opencode-go/deepseek-v4-pro",
    "reasoning_effort": "high"
  }
}
```

结果不会包含目标、总结、路径、文件名、日志、凭据、执行器原始输出或错误原文。脚本只在
网页输入框为空时发送结果，并在限定时间后放弃等待。

## 模块边界

- `userscript/src/conversation-protocol.js` 负责解析启动命令、任务信封、确认词和安全结果投影。
- `userscript/src/adapters/` 保存纯数据网页适配器。
- `userscript/src/adapter-registry.js` 校验适配器元数据和选择器。
- `userscript/src/runtime.user.js` 负责网页交互和本机 HTTP 请求。
- `src/core/candidate-review.js` 负责候选状态、过期、一次性批准、重放拒绝和派发回调。
- `src/local-review/settings.js` 保存本机执行选择，以及自动派发和结果回传两个独立开关。
- `src/local-review/router.js` 负责回环 HTTP、来源校验、请求大小限制和响应裁剪。

油猴脚本不能导入服务器、编排器、执行器、工作区或 MCP 模块。候选服务不依赖浏览器和
网页适配器。

## 验收门槛

1. 协议测试覆盖精确提及、有限任务提取、确认词、受限执行选择、稳定任务标识和结果脱敏。
2. 静态测试要求原生对话协议标记，并禁止任务表单、浏览器存储、凭据、原始任务 API 和
   HTML 注入。
3. 本机集成测试证明自动派发与结果回传默认关闭，设置写入需要一次性本机表单令牌。
4. 候选测试拒绝未知字段、未知来源、本机白名单外选择、重复派发、过期能力和缺少确认。
5. 完整 `npm run verify` 必须通过，且测试不得调用真实模型。

## 如何反馈

请在 [GitHub Discussions](https://github.com/Ya-KARAS/AgentControlPlane/discussions)
讨论交互流程。可复现需求请提交
[功能建议](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=feature_request.yml)。
请勿公开凭据、本机路径、私有日志或安全绕过说明。
