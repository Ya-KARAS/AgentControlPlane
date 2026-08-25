# Beta 接入指南（邀请制付费 Beta）

本文档覆盖 AsterRoute × AgentControlPlane 邀请制付费 Beta 的两条接入路径。
Beta 面向 3–5 名受邀用户，不提供企业 SLA，不支持自助注册。

## 路径 A —— AsterRoute API Beta

1. 向运营方申请邀请。每位用户获得独立的项目与 API Key；Key 不在用户间共享。
2. Base URL：`https://asterroute.com/v1`（OpenAI-compatible）。
3. 模型目录：`GET /v1/models`；实时目录与线路状态以请求时刻为准。
4. 补全示例：

   ```bash
   curl https://asterroute.com/v1/chat/completions \
     -H "Authorization: Bearer $ASTERROUTE_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-5.6-sol-economy","messages":[{"role":"user","content":"Reply with OK"}]}'
   ```

5. 每个 Key 由运营方配置模型白名单、RPM、日限额与月预算。

分步骤的供应商教程见 [docs/PROVIDER-ASTERROUTE.zh-CN.md](PROVIDER-ASTERROUTE.zh-CN.md)；AsterRoute 在其集成指南
[`https://asterroute.com/integrations/agentcontrolplane?utm_source=agentcontrolplane&utm_medium=docs&utm_campaign=asterroute-acp`](https://asterroute.com/integrations/agentcontrolplane?utm_source=agentcontrolplane&utm_medium=docs&utm_campaign=asterroute-acp)
中发布了同一套步骤。

## 路径 B —— AsterRoute + ACP 协助安装

1. 在自己的机器上安装 ACP（Node.js 22 及以上）：

   ```bash
   git clone https://github.com/Ya-KARAS/AgentControlPlane.git
   cd AgentControlPlane
   npm install
   ```

2. 如果使用 AsterRoute 模型线路，Key 不进文件：

   - 设置环境变量 `ASTERROUTE_API_KEY`。在 Windows 上，持久位置是用户环境
     （注册表）；启动脚本从那里读取。
   - 在 `config/local.json` 里添加官方 preset relay：

     ```json
     {
       "executor": {
         "relays": [
           { "id": "asterroute", "preset": "asterroute", "reconcileUrl": "https://asterroute.com" }
         ]
       }
     }
     ```

3. 启动服务：`npm start`。服务只绑定 `127.0.0.1:4318`，不是公网端点。
   在 Windows 自带 PowerShell 中运行
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-server.ps1`，
   脚本会在后台启动、等待 `/health`，并打印 pid 与健康响应体。AsterRoute
   模型 Key 是可选项；手机/网页设备中继使用配对后保存的设备凭据，不要求
   配置模型 Key。若需开机自动启动，运行
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-autostart.ps1`。
4. 首次派发会执行 `protocol:auto` 探测并保存所选协议；推荐列表只作参考，
   绝不替换你选定的模型。

## 常见错误

- `401 invalid_api_key`：Key 缺失、输错或已撤销；通过运营方轮换。
- `402 / insufficient balance`：项目余额或月预算耗尽；联系运营方。
- `429 rate_limit_exceeded`：Key 的 RPM 或日限额已达；窗口过后重试。
- `5xx`：网关或上游故障；查看
  [状态页](https://asterroute.com/status?utm_source=agentcontrolplane&utm_medium=error&utm_campaign=asterroute-acp)
  与运营方事故公告入口。

## Key 轮换

需要时向运营方申请新 Key。更新 `ASTERROUTE_API_KEY` 环境变量，重启 ACP，
并请运营方撤销旧 Key。在 Windows 上，更新用户环境（注册表）中的值，
先停止服务（`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/stop-server.ps1`），再用
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-server.ps1` 启动。

## 支持

运营方联系方式随邀请发放。事故通过运营方状态页公告。
