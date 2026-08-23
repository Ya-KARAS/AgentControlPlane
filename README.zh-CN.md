# AgentControlPlane

<div align="center">

[![CI](https://github.com/Ya-KARAS/AgentControlPlane/actions/workflows/ci.yml/badge.svg)](https://github.com/Ya-KARAS/AgentControlPlane/actions/workflows/ci.yml)
[![version](https://img.shields.io/github/v/release/Ya-KARAS/AgentControlPlane?label=version&color=536af5)](https://github.com/Ya-KARAS/AgentControlPlane/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-AGPL--3.0-d22128)](LICENSE)

<img src="docs/assets/social-preview.svg" width="100%" alt="AgentControlPlane 把网页 AI 简报发送给本地编码执行器，并返回持久化执行证据。" />

把网页 AI 对话转成经过验证的本地工程任务。

AgentControlPlane 将精简简报发送给 OpenCode、Codex、Claude Code、Kimi Code、
ZCode 或 OpenAI-compatible 执行器，再返回状态、变更文件、测试证据、用量和延续状态。

[运行真实 Demo](#运行真实-demo) · [连接网页 AI](#连接网页-ai) ·
[架构](docs/ARCHITECTURE.zh-CN.md) · [English](README.md)

</div>

> 本地优先、面向单用户的预览版本。当前认证版本：v0.9.0。

## 用户反馈与登记

欢迎参与测试和反馈：

- [进入 GitHub Discussions 讨论疑问、使用方法和想法](https://github.com/Ya-KARAS/AgentControlPlane/discussions)
- [登记中转站邮箱和测试需求](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=relay_registration.yml)
- [提交 Bug](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=bug_report.yml)
- [提交功能建议](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=feature_request.yml)
- [查看公开的跨设备路线图](docs/CROSS-DEVICE-ROADMAP.zh-CN.md)
- [试用桌面油猴预览脚本](userscript/README.md)

请不要在公开 Issue 或 Discussion 中发布密码、API Key、访问 Token、私有日志或其他敏感信息。
邮箱登记 Issue 默认公开；如果不希望公开邮箱，请联系维护者使用私有方式登记。

## 运行真实 Demo

前置条件：Node.js 22 或更新版本，以及一个已配置的执行器。OpenCode 就绪时，
Demo 默认选择 OpenCode。

```powershell
git clone https://github.com/Ya-KARAS/AgentControlPlane.git
cd AgentControlPlane
npm.cmd ci
npm.cmd run doctor
npm.cmd run demo
```

`npm run demo` 启动隔离的回环服务，询问一次确认，并通过 MCP 发送一个小型
工程任务。所选执行器可能消耗账户、订阅或 API 额度。成功运行会创建并读回
`hello.txt`、保存任务，然后输出以下证据：

```text
AgentControlPlane live demo
executor: opencode
task: <task-id>
status: completed
file: <workspace>\hello.txt
verified: true
DEMO PASS: MCP dispatch, local execution, file verification, and result persistence completed.
```

执行 `npm run demo -- --help` 可以查看执行器、模型、超时和无人值守参数。Demo
工作区会保留在磁盘上，供用户检查。

发布资产包括 Windows 源码包、可直接加载的浏览器 Companion ZIP、90 秒验证
演示视频和 `SHA256SUMS`。下载地址：[v0.9.0 Release](https://github.com/Ya-KARAS/AgentControlPlane/releases/tag/v0.9.0)。

## 项目功能

```text
网页 AI -> 精简简报 -> AgentControlPlane -> 本地执行器
网页 AI <- 结果/证据 <- 持久化任务      <- 本地执行器
```

- 结构化委派：网页对话生成目标、约束、验收标准、配置档、执行器和可选模型。
- 执行器路由：自动发现会选择就绪执行器；每项任务也可以指定 OpenCode、Codex、
  Claude Code、Kimi Code、ZCode 或已配置的模型端点。
- 持久化结果：任务记录状态、变更文件、测试证据、Token 用量、执行器历史和
  延续包。
- 跨执行器延续：显式跟进可以选择兼容执行器，并保留逻辑任务链路。基础设施
  故障的自动改道采用显式启用策略，发行版默认关闭。
- 本地控制：回环绑定、工作区允许列表、速率限制、可选 bearer 鉴权和只追加
  审计记录约束控制平面边界。

## 连接网页 AI

MCP 接口向每个兼容客户端提供同一组工具。ChatGPT 自定义应用连接步骤见
[docs/CHATGPT-CONNECTION.zh-CN.md](docs/CHATGPT-CONNECTION.zh-CN.md)。

[浏览器伴侣](docs/BROWSER-COMPANION.zh-CN.md)为 ChatGPT、DeepSeek、Claude
和一个可选的通用 HTTPS 聊天站点添加本地面板。面板把所选工作区保留在本机，
与 ACP 完成一次配对，并派发网页对话生成的结构化任务封装。

[桌面油猴预览脚本](userscript/README.md)把任务规划保留在 ChatGPT 或 DeepSeek
的原生对话中。发送 `@ACP` 后，可以用自然语言选择项目别名、工作区路径、
执行器、Profile、已公布模型和推理等级。`@acp` 和 `@AgentControlPlane` 也是有效触发词。
回复“执行”后才会派发；没有指定的项目使用
本机默认值。自动派发与安全结果回传是两个独立的本机开关。返回网页的结果只包含状态、
数量和非敏感执行标识。

本机设置页为执行器、任务档位、模型和推理等级提供“自动”选项。网页 AI 会为标记为
“自动”的字段推荐具体值，ACP 会按实时执行器目录、模型能力和路由状态完成本机校验。
具体值作为默认值；用户在网页对话中明确指定的值适用于该次任务。

[项目库](docs/PROJECT-REGISTRY.md)为项目分配稳定 ID，并支持多个跨盘扫描根目录、
逻辑分类、项目移动检测和本地重新关联。项目从 C 盘移动到 D 盘后，原网页对话可以继续；
完整路径仍只保存在本机。

```text
ChatGPT / DeepSeek / Claude
              |
       MCP 或浏览器伴侣
              |
      AgentControlPlane :4318
              |
 OpenCode / Codex / Claude Code / Kimi Code / ZCode / 模型端点
```

## 支持的执行器

| 执行器 | 接口 | 就绪条件 |
|---|---|---|
| OpenCode | CLI | 已安装 CLI，并配置可用模型 |
| ZCode | 桌面版内置 CLI | 已安装 ZCode 桌面版，并启用 BigModel 或 Z.ai 模型通道 |
| Codex | App Server | 已安装客户端、账户额度和 Windows 沙箱就绪 |
| Claude Code | CLI | Claude Pro/Max 登录或 Anthropic API 密钥 |
| Kimi Code | CLI | 已安装 CLI，已登录 Kimi，并配置可用模型 |
| OpenCodex | OpenAI-compatible 端点 | 端点可访问、模型已配置、工具能力已验证 |
| DeepSeek Harness | OpenAI-compatible 端点 | DeepSeek API 已配置、工具能力已验证 |

运行 `npm run doctor` 可查看发现状态和自动默认项。任务可以设置
`executor: "opencode"`、`"codex"`、`"claude"`、`"kimi"`、`"zcode"`、
`"openai-compatible"` 或 `"deepseek"`。

ACP 即使在 `PATH` 中找不到 `zcode`，也会发现官方 Windows 桌面版附带的
ZCode CLI。ACP 读取桌面版当前的模型目录，只把不含密钥的模型信息写入
ZCode CLI 配置；凭据仅通过子进程内存环境传递。若桌面 Start Plan 要求交互式
验证码，而本机已有 Coding Plan 凭据，ACP 会优先使用可无界面调用的 Coding
Plan。当前 ZCode 无界面 CLI 不提供可用的推理等级参数，因此任务使用 ZCode
自身配置的默认推理等级。配置方法见
[ZCode 官方模型接入说明](https://zcode.z.ai/en/docs/configuration)。

## 从网页 AI 派发

向已连接的网页 AI 发送：

```text
使用 balanced 配置档和自动执行器选择。检查项目，实现带测试的 GET /hello
接口，完成验证，并返回变更文件和测试证据。如果执行器报告阻塞或理解偏差，
修正简报并继续同一个项目。
```

客户端调用 `dispatch_project`，轮询 `task_status`，并通过
`continue_project` 发送修正或后续任务。

## 配置档与用量

| 配置档 | 任务范围 | 投入 | 子代理 | Token 预算 |
|---|---|---|---:|---:|
| economy | 小范围、明确的修改 | low | 0 | 30k |
| balanced | 功能与修复工作 | high | 最多 2 | 90k |
| deep | 架构与大范围重构 | ultra | 最多 4 | 220k |

配置档提供策略默认值。派发请求可以覆盖模型、投入、子代理和预算。请求省略
`model` 时，OpenCode 和 Claude 使用各自配置的默认模型。用量精度取决于所选
执行器报告的遥测数据。

仓库内的基准流程记录直接任务与受控任务的耗时、成功状态、输入、缓存输入、
输出、推理和总 Token。详见
[docs/BENCHMARKING.zh-CN.md](docs/BENCHMARKING.zh-CN.md)和
[`benchmark/`](benchmark)中的原始文件。

## MCP 工具

| 工具 | 用途 |
|---|---|
| `dispatch_project` | 使用自动或显式执行器路由，将简报加入队列 |
| `dispatch_opencode` | 通过 OpenCode 兼容快捷入口派发 |
| `task_status` | 读取状态、结果、证据、用量、链路和可选事件 |
| `continue_project` | 向同一逻辑项目发送修正或后续任务 |
| `cancel_task` | 停止排队中或执行中的任务 |
| `list_tasks` | 列出近期任务 |
| `list_executors` | 列出发现、就绪、能力和默认路由 |
| `list_profiles` | 列出执行策略 |
| `list_models` | 列出执行器缓存的模型目录 |
| `usage_report` | 汇总已测量的工程用量 |

## 供应商配置

任何 OpenAI-compatible 中转站或模型端点都可以作为模型端点执行器。供应商
专用 preset 以注册表数据保存，并保持可选。

[AsterRoute](docs/PROVIDER-ASTERROUTE.zh-CN.md)是一个可选 preset，支持请求
归因和只读用量对账。AsterRoute 的访问和计费由该服务独立运营。

## 安全与限制

- 旧式工作区解析到配置的允许列表根目录内；项目库扫描根目录本身不能执行。
- HTTP 服务只接受回环地址绑定。
- Codex 使用 workspace-write、关闭网络访问，并在执行前检查 Windows 沙箱。
- 其他 CLI 和模型端点适配器以本地用户权限运行；请使用可信工作区。
- `AGENT_CONTROL_TOKEN` 可以启用 bearer 鉴权。
- 状态和只追加审计记录保存在项目工作区之外。
- 每个执行器使用自己的账户、订阅、API 配置和供应商限制。AgentControlPlane
  不会把聊天额度转换成工程额度。

远程访问需要经认证的私有隧道或独立加固的中继。预览版支持范围不包含直接
公网暴露。

## 参与贡献

[CONTRIBUTING.md](CONTRIBUTING.md)记录环境设置、PR 检查和执行器适配要求。
使用问题与早期设计提案可以发布到
[GitHub Discussions](https://github.com/Ya-KARAS/AgentControlPlane/discussions)，
可复现问题和范围明确的修改可以发布到
[GitHub Issues](https://github.com/Ya-KARAS/AgentControlPlane/issues)。

## 许可与商业使用

当前源码按 [GNU Affero General Public License 3.0](LICENSE)提供。v0.1.0
至 v0.4.2 版本继续按 Apache License 2.0 提供，记录见
[docs/LEGACY-LICENSE-APACHE-2.0.md](docs/LEGACY-LICENSE-APACHE-2.0.md)。

将 AgentControlPlane 作为商业服务运营需要与版权方另行签署书面协议。
`AgentControlPlane` 名称和标志属于商标，源码许可不包含商标授权。详见
[docs/COMMERCIALIZATION.zh-CN.md](docs/COMMERCIALIZATION.zh-CN.md)。

## 文档

- [架构](docs/ARCHITECTURE.zh-CN.md)
- [协议](docs/PROTOCOL.zh-CN.md)
- [浏览器伴侣](docs/BROWSER-COMPANION.zh-CN.md)
- [ChatGPT 连接](docs/CHATGPT-CONNECTION.zh-CN.md)
- [基准测试](docs/BENCHMARKING.zh-CN.md)
- [安全审查](docs/SECURITY-REVIEW.zh-CN.md)
- [开发与交接](docs/DEVELOPMENT.md)
- [路线图](docs/ROADMAP.zh-CN.md)
- [发布检查](docs/RELEASE-CHECKLIST.md)
- [GitHub 发布检查](docs/GITHUB-LAUNCH-CHECKLIST.md)
- [跨设备路线图](docs/CROSS-DEVICE-ROADMAP.zh-CN.md)
- [安全策略](SECURITY.zh-CN.md)
- [变更记录](CHANGELOG.md)

机器专用路径和凭据应写入 `config/local.json` 或环境变量。
`config/local.json` 已被 Git 排除。
