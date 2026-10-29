# 跨执行器 handoff 离线验收

[English](HANDOFF-ACCEPTANCE.md)

安装 Node.js 22+ 和仓库依赖后运行：

```text
npm run accept:handoff
npm run --silent accept:handoff -- --json
node --test tests/handoff-e2e.test.js
```

命令逐个打印八个场景的 PASS/FAIL，任一失败则退出码非零。`--json` 输出单个报告，
包含整体 `passed`，以及每个场景的 `id`、`name`、`passed` 和失败时的 `error`。
一个场景失败后仍会运行其余场景。`--help` 显示参数说明。

覆盖 A 向 B 传递 compact 检查点（校验摘要长度，并排除源任务中实际存在的对话哨兵）、
默认复用目标会话与 `fresh_session` 的差别、交还 A 时恢复原会话、线程/会话和执行器历史隔离，
以及从同一状态目录重建 store/orchestrator 后继续 handoff/resume。
配额耗尽和运行时不可用分别触发自动改道，校验源检查点的文件、测试证据、摘要及下一步动作仍在。
显式选择已知不可用的目标会在创建任务前被拒绝；执行阶段才发生的基础设施故障才触发自动改道，
并为备用执行器建立新会话。此外还校验成本估算和延迟统计返回合理的只读结果，不调用执行器。

[共享场景模块](../scripts/lib/handoff-acceptance.js) 通过真实 orchestrator/store API，
复用现有 handoff 测试的进程内 recording fake 执行器，不覆盖 HTTP/MCP 传输或真实执行器适配器。
不启动执行器 CLI 或子进程，不请求网络、不消耗模型额度、不读取密钥、`.env` 或本地配置。
每个场景使用可跨平台的 Node.js 文件系统 API，在系统临时目录创建并清理自己的 workspace/state；
模拟控制面重启时保留 fake 执行器的会话。

[测试入口](../tests/handoff-e2e.test.js) 在 `npm test` 中运行同一套场景，
自动纳入现有 Ubuntu/Windows CI 矩阵。完整测试与检查门禁为 `npm run verify`。
