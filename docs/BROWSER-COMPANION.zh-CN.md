# 浏览器伴侣

> [English](BROWSER-COMPANION.md)

当网页产品未提供可用的自定义 MCP 连接时，AgentControlPlane 浏览器伴侣将普通的网页 AI 对话连接到本地控制面。它不会复用、导出或绕过模型配额。网页 AI 规划任务；所选本地执行器使用自己的账户或提供商配置执行工程工作。

## 受支持的页面

- ChatGPT（`chatgpt.com`）
- DeepSeek（`chat.deepseek.com`）
- Claude（`claude.ai`）
- 其他 HTTPS 聊天页面（需显式的可选站点权限）

通用适配器使用无障碍与输入框启发式规则。网页的 DOM 随时可能变化，因此应优先使用内置适配器；适配器失败时会在页面面板中报告，而不会静默提交文本。

## 本地测试安装

1. 启动 AgentControlPlane：

   ```powershell
   cd C:\Users\YOUR_USER\Documents\Github\AgentControlPlane
   npm.cmd start
   ```

2. 打开 `chrome://extensions` 或 `edge://extensions`。
3. 启用开发者模式。
4. 选择 **Load unpacked**，并选择仓库的 `browser-companion` 目录。
5. 打开受支持的网页 AI 页面，点击浮动 **ACP** 按钮。
6. 点击 **Pair**，比对六位代码，并批准本地页面。
7. 选择已知工作区。执行器、任务档位、模型和推理等级可以选择“自动”或具体值。
   网页 AI 为“自动”字段推荐具体值，ACP 按实时能力目录完成本机校验。

不会将任何 API 密钥或控制面主 bearer 令牌复制到浏览器中。已配对的扩展会收到一个独立的、作用域受限的凭据，该凭据只能访问该扩展创建的任务。

## 对话协议

点击 **Teach web AI**，将控制器指令放入当前的输入框中。网页 AI 澄清意图并输出一个可直接实施的块：

```text
<ACP_TASK>
{
  "workspace": "DEFAULT",
  "objective": "Implement and verify the requested change",
  "context": "Only execution-relevant context",
  "constraints": ["Preserve compatibility"],
  "acceptance_criteria": ["Automated tests pass"],
  "profile": "balanced",
  "executor": "auto"
}
</ACP_TASK>
```

`DEFAULT` 在扩展内部解析，使本地文件系统路径不会进入网页对话。任务块始终先暂存：网页 AI 输出信封后，伴侣暂存并提示，用户回复确认词（如「执行 / 是否派发」）或点「派发」按钮后才派发；期间网页 AI 输出新信封会覆盖暂存。伴侣随后监控任务，并插入一个紧凑的最终结果块：

```text
<ACP_RESULT>
{
  "task_id": "...",
  "status": "completed",
  "executor": "opencode",
  "executor_session_id": "ses_...",
  "result": { "summary": "...", "changed_files": [], "tests": [] },
  "error": null,
  "usage": { "total_tokens": 0 }
}
</ACP_RESULT>
```

`executor_session_id` 是执行器自身的会话 ID（例如 opencode 的 `ses_...`），可用于在执行器界面中回看该场完整对话。

自动结果提交默认禁用，因为任务结果可能包含本地文件名或代码细节。仅当所选网页 AI 对话受信任、可以接收这些结果时，才按浏览器 `profile` 启用它。

## 配对与安全模型

- 配对创建与批准仅通过回环（loopback）接受。
- 请求默认在 10 分钟后过期。
- 批准页面同时显示代码与确切的扩展源。
- 客户端令牌只返回一次，并由浏览器扩展存储保存。
- AgentControlPlane 仅存储客户端令牌的 SHA-256 哈希。
- 该令牌绑定到确切的扩展源。
- 已配对的客户端只能读取、跟进或取消它自己创建的任务。
- 已知的 AI 源在 manifest 中授予权限；其他每个 HTTPS 站点都需要单独的可选权限。
- 该扩展不会读取 cookie、浏览器历史记录、密码或页面存储。

配对状态以 `companion-clients.json` 的形式存储在所配置的 AgentControlPlane 状态目录中。在服务停止时删除该文件，将撤销所有浏览器伴侣会话。

## 验证

运行：

```powershell
npm.cmd test
npm.cmd run companion:check
```

测试套件验证源限制、一次性令牌投递、凭据哈希持久化、按客户端划分的任务所有权、协议解析、适配器选择、manifest 权限，以及作用域受限的派发/状态/跟进流程。

## Web AI + 多执行器端到端验证

完成设置后，从每个受支持的网页验证真正的端到端集成：

1. 在测试 `profile` 中启动 AgentControlPlane：

   ```powershell
   cd C:\Users\YOUR_USER\Documents\Github\AgentControlPlane
   npm.cmd start
   ```

2. 在目标页面上打开 ACP 面板，并将浏览器配对一次（一次性批准代码）。

3. 在网页输入框中，让网页 AI 严格遵循以下 schema 来设置执行目标：

   - 常规路由使用 `executor: "auto"`。
   - 使用 `executor: "opencode"` 强制使用本地 Opencode CLI。
   - 使用 `executor: "deepseek"` 强制走 MCP deepseek 路由。
   - 使用 `executor: "claude"` 强制走 Claude CLI 路由（如果本地配置中可用）。

4. 使用确定性的目标：

   ```text
   Please emit ACP task block for a tiny local change:
   {
     "workspace": "acp-live-test",
     "objective": "Create C:\\Users\\<user>\\Documents\\Github\\acp-live-test\\acp-hello.txt with exact text: ACP_WEB_AI_OK",
     "context": "local smoke task",
     "acceptance_criteria": ["file exists", "exact text is ACP_WEB_AI_OK"],
     "executor": "opencode"
   }
   ```

5. 在终端中验证：

   - 任务状态返回 `completed`
   - `changed_files` 包含 `acp-hello.txt`
   - 文件内容恰好为 `ACP_WEB_AI_OK`

### 各站点的验收

- ChatGPT（`chatgpt.com`）：同时验证浏览器伴侣消息捕获与 MCP 回退路径。
- DeepSeek（`chat.deepseek.com`）：在第二个网站上验证适配器按钮行为与任务块传输。
- Claude（`claude.ai`）：验证跨提供商 UI 兼容性。

要进行一轮完整的多执行器测试，请用上述每个 `executor` 值重复步骤 4，并在一个简短表格中为每次运行记录一行：

- `executor`
- 使用的页面
- `task_id`
- `status`
- `changed_files`
- `result.summary`
- 耗时（秒）
