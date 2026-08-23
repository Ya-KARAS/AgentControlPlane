# AgentControlPlane

<div align="center">

[![CI](https://github.com/Ya-KARAS/AgentControlPlane/actions/workflows/ci.yml/badge.svg)](https://github.com/Ya-KARAS/AgentControlPlane/actions/workflows/ci.yml)
[![version](https://img.shields.io/github/v/release/Ya-KARAS/AgentControlPlane?label=version&color=536af5)](https://github.com/Ya-KARAS/AgentControlPlane/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-AGPL--3.0-d22128)](LICENSE)

<img src="docs/assets/social-preview.svg" width="100%" alt="AgentControlPlane sends web AI briefs through a local control plane to coding executors and returns persisted evidence." />

Turn a web-AI conversation into a verified local coding task.

AgentControlPlane sends a compact brief to OpenCode, Codex, Claude Code,
Kimi Code, ZCode, or an OpenAI-compatible executor, then returns status,
changed files, test evidence, usage, and continuation state.

[Run the live demo](#run-the-live-demo) · [Connect a web AI](#connect-a-web-ai) ·
[Architecture](docs/ARCHITECTURE.md) · [中文文档](README.zh-CN.md)

</div>

> Local-first, single-user preview. Current certified release: v0.9.0.

## Feedback and registration

Join the public test and send feedback:

- [Discuss questions, workflows, and ideas in GitHub Discussions](https://github.com/Ya-KARAS/AgentControlPlane/discussions)
- [Register a relay email and testing needs](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=relay_registration.yml)
- [Report a bug](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=feature_request.yml)
- [Read the public cross-device roadmap](docs/CROSS-DEVICE-ROADMAP.md)
- [Try the desktop userscript preview](userscript/README.md)

Do not post passwords, API keys, access tokens, private logs, or other sensitive data
in public Issues or Discussions. Email-registration Issues are public by default;
contact the maintainer if you need private registration.

## Run the live demo

Requirements: Node.js 22 or newer and one configured executor. OpenCode is the
default demo choice when it is ready.

```powershell
git clone https://github.com/Ya-KARAS/AgentControlPlane.git
cd AgentControlPlane
npm.cmd ci
npm.cmd run doctor
npm.cmd run demo
```

`npm run demo` starts an isolated loopback service, asks for confirmation, and
sends one small task through MCP. The selected executor may use account,
subscription, or API quota. A successful run creates `hello.txt`, reads it back,
persists the task, and prints evidence like this:

```text
AgentControlPlane live demo
executor: opencode
task: <task-id>
status: completed
file: <workspace>\hello.txt
verified: true
DEMO PASS: MCP dispatch, local execution, file verification, and result persistence completed.
```

Use `npm run demo -- --help` for executor, model, timeout, and unattended-run
options. The generated workspace remains available for inspection.

Release assets include a Windows source archive, a load-unpacked browser
companion ZIP, a 90-second verified demo video, and `SHA256SUMS`. Download them
from the [v0.9.0 release](https://github.com/Ya-KARAS/AgentControlPlane/releases/tag/v0.9.0).

## What it does

```text
web AI  -> compact brief -> AgentControlPlane -> local executor
web AI <- result/evidence <- persisted task  <- local executor
```

- Structured delegation: the web conversation produces an objective,
  constraints, acceptance criteria, profile, executor, and optional model.
- Executor routing: automatic discovery selects a ready executor; each task
  can select OpenCode, Codex, Claude Code, Kimi Code, ZCode, or a configured
  model endpoint.
- Persistent results: tasks record status, changed files, test evidence,
  token usage, executor history, and continuation packages.
- Cross-executor continuation: an explicit follow-up can select a compatible
  executor while preserving the logical task lineage. Automatic infrastructure
  rerouting is available as an opt-in policy and ships disabled.
- Local controls: loopback binding, workspace allowlists, rate limits,
  optional bearer authentication, and append-only audit records constrain the
  control-plane boundary.

## Connect a web AI

The MCP interface exposes the same tools to every compatible client. ChatGPT
custom apps are documented in
[docs/CHATGPT-CONNECTION.md](docs/CHATGPT-CONNECTION.md).

The [browser companion](docs/BROWSER-COMPANION.md) adds a local panel to
ChatGPT, DeepSeek, Claude, and an optional generic HTTPS chat site. The panel
keeps the selected workspace on the local machine, pairs once with ACP, and
dispatches the structured envelope produced by the web conversation.

The [desktop userscript preview](userscript/README.md) keeps task planning in
the native ChatGPT or DeepSeek conversation. Start with `@ACP` (the
`@acp` and `@AgentControlPlane` forms are also accepted),
let the web AI clarify the task and select a project alias or workspace path, executor,
profile, advertised model, and reasoning effort in natural language. Reply with
`执行` to dispatch. Omitted choices use local defaults. Automatic dispatch and
safe result return are separate local opt-ins. The result sent to the webpage
contains status, counts, and the non-secret execution ids.

The local settings page provides an Auto option for executor, task profile,
model, and reasoning effort. The web AI recommends a concrete value for each
automatic field, and ACP validates it against the live executor catalog, model
capabilities, and route status. Concrete settings remain defaults; a value the
user explicitly names in the web conversation applies to that task.

The [project registry](docs/PROJECT-REGISTRY.md) assigns stable project IDs and
supports multiple cross-drive discovery roots, logical categories, move
detection, and locally confirmed relinking. A browser conversation can continue
after a project moves from one drive to another while absolute paths remain
local.

```text
ChatGPT / DeepSeek / Claude
              |
     MCP or browser companion
              |
      AgentControlPlane :4318
              |
 OpenCode / Codex / Claude Code / Kimi Code / ZCode / model endpoint
```

## Supported executors

| Executor | Interface | Readiness requirement |
|---|---|---|
| OpenCode | CLI | installed CLI with a configured model |
| Codex | App Server | installed client, account quota, and Windows sandbox readiness |
| Claude Code | CLI | Claude Pro/Max login or an Anthropic API key |
| Kimi Code | CLI | installed CLI with a Kimi login and configured model |
| ZCode | bundled CLI | installed ZCode desktop with an enabled BigModel or Z.ai model provider |
| OpenCodex | OpenAI-compatible endpoint | reachable endpoint, configured model, and verified tool capability |
| DeepSeek Harness | OpenAI-compatible endpoint | DeepSeek API configuration and verified tool capability |

Run `npm run doctor` to list discovery status and the automatic default. A task
can set `executor: "opencode"`, `"codex"`, `"claude"`, `"kimi"`, `"zcode"`,
`"openai-compatible"`, or `"deepseek"`.

Kimi Code can use its managed membership login or a provider configured with a
Kimi Platform API key. ACP reads readiness from the installed Kimi CLI and does
not store either credential in the repository. See the
[official Kimi provider guide](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/providers).

ZCode is discovered from the official Windows desktop installation even when
`zcode` is not on `PATH`. ACP reads the active desktop provider and model
catalog, writes only non-secret CLI model metadata, and passes the desktop
credential to the child process in memory. For a desktop Start Plan that
requires interactive verification, ACP prefers an available Coding Plan
credential for headless work. ZCode currently uses its configured reasoning
default because the bundled headless CLI does not expose a working effort flag.
See the [official ZCode model setup guide](https://zcode.z.ai/en/docs/configuration).

## Dispatch from a connected web AI

Ask the connected conversation:

```text
Use the balanced profile and automatic executor selection. Inspect the project,
implement a tested GET /hello endpoint, verify it, and return changed files plus
test evidence. If execution reports a blocker or misunderstanding, correct the
brief and continue the same project.
```

The client calls `dispatch_project`, polls `task_status`, and calls
`continue_project` for a correction or follow-up.

## Profiles and usage

| Profile | Task scope | Effort | Subagents | Token budget |
|---|---|---|---:|---:|
| economy | Small, defined edits | low | 0 | 30k |
| balanced | Feature and fix work | high | up to 2 | 90k |
| deep | Architecture and broad refactors | ultra | up to 4 | 220k |

Profiles supply policy defaults. A dispatch can set model, effort, subagent,
and budget overrides. OpenCode and Claude use their configured default model
when a dispatch omits `model`. Usage precision follows the telemetry reported
by the selected executor.

The committed benchmark workflow records direct and controlled task duration,
success, input, cached input, output, reasoning, and total tokens. See
[docs/BENCHMARKING.md](docs/BENCHMARKING.md) and the raw files in
[`benchmark/`](benchmark).

## MCP tools

| Tool | Purpose |
|---|---|
| `dispatch_project` | Queue a brief with automatic or explicit executor routing |
| `dispatch_opencode` | Dispatch through the OpenCode compatibility shortcut |
| `task_status` | Read state, result, evidence, usage, lineage, and optional events |
| `continue_project` | Send a correction or follow-up to the same logical project |
| `cancel_task` | Stop queued or active work |
| `list_tasks` | List recent tasks |
| `list_executors` | List discovery, readiness, capabilities, and default route |
| `list_profiles` | List execution policies |
| `list_models` | List an executor's cached model catalog |
| `usage_report` | Aggregate measured engineering usage |

## Provider configuration

AgentControlPlane accepts any OpenAI-compatible relay or model endpoint as a
model-endpoint executor. Provider-specific presets are registry data and remain
optional.

[AsterRoute](docs/PROVIDER-ASTERROUTE.md) is an optional preset with request
attribution and read-only usage reconciliation. AsterRoute access and billing
are operated separately from this repository.

## Safety and limits

- Legacy workspaces resolve inside configured allowlisted roots; project
  discovery roots are never executable workspaces themselves.
- The HTTP service accepts loopback binding only.
- Codex uses workspace-write with network access disabled and checks Windows
  sandbox readiness before execution.
- Other CLI and model-endpoint adapters run with the local user's privileges;
  use trusted workspaces.
- `AGENT_CONTROL_TOKEN` enables bearer authentication.
- State and append-only audit records remain outside project workspaces.
- Each executor uses its own account, subscription, API configuration, and
  provider limits. AgentControlPlane does not convert chat allowance into
  engineering quota.

Use an authenticated private tunnel or a separately hardened relay for remote
access. Direct public-Internet exposure is outside the supported preview scope.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, pull request checks, and
executor adapter requirements. Usage questions and early design proposals
belong in [GitHub Discussions](https://github.com/Ya-KARAS/AgentControlPlane/discussions).
Reproducible bugs and scoped changes belong in
[GitHub Issues](https://github.com/Ya-KARAS/AgentControlPlane/issues).

## License and commercial use

The current source is available under the
[GNU Affero General Public License 3.0](LICENSE). Releases v0.1.0 through v0.4.2
remain available under Apache License 2.0 as recorded in
[docs/LEGACY-LICENSE-APACHE-2.0.md](docs/LEGACY-LICENSE-APACHE-2.0.md).

Operating AgentControlPlane as part of a commercial service requires a separate
written agreement with the copyright holder. The `AgentControlPlane` name and
logo are trademarks and carry no license. See
[docs/COMMERCIALIZATION.md](docs/COMMERCIALIZATION.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Protocol](docs/PROTOCOL.md)
- [Browser companion](docs/BROWSER-COMPANION.md)
- [ChatGPT connection](docs/CHATGPT-CONNECTION.md)
- [Benchmarking](docs/BENCHMARKING.md)
- [Security review](docs/SECURITY-REVIEW.md)
- [Development and handoffs](docs/DEVELOPMENT.md)
- [Roadmap](docs/ROADMAP.md)
- [Release checklist](docs/RELEASE-CHECKLIST.md)
- [GitHub launch checklist](docs/GITHUB-LAUNCH-CHECKLIST.md)
- [Cross-device roadmap](docs/CROSS-DEVICE-ROADMAP.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

Machine-specific paths and credentials belong in `config/local.json` or
environment variables. `config/local.json` is excluded from Git.
