# 路线图：后续阶段的接口设计

AgentControlPlane 提供执行基础设施；Provider 提供模型基础设施。本文档固定
Phase 2-4 的接口形状，让后续工作接在稳定契约上。Phase 1 交付这些阶段所依赖
的 provider-agnostic 能力层。

## Phase 2 —— 任务感知的模型路由（只推荐，不自动切换）

输入：任务需求（档位、目标难度、所需能力）、带能力标注的执行器模型目录、
以及 Phase 3 的按模型统计。

```json
{
  "recommend": [
    {
      "executor": "asterroute",
      "model": "deepseek-v4-pro-official",
      "profile": "balanced",
      "reasons": ["tools_verified", "reasoning_high", "within_budget"],
      "estimated_cost": 0.012,
      "estimated_minutes": 5
    }
  ],
  "selected": null
}
```

规则：

- 推荐永不自行更换模型。用户或网页 AI 显式选择；派发把真实 model id 记入任务。
- `reasons` 引用可核查的事实：探测到的能力、实测令牌成本、记录的任务时长。
- 档位语义：economy 在满足必需能力的前提下选最便宜的模型；balanced 综合能力、
  可靠性、价格与延迟；deep 优先推理强度。
- MCP 接口：`recommend_models`（只读）+ `dispatch_project` 新增可选 `models`
  字段，必须匹配推荐列表中的一项。

## Phase 3 —— Usage Intelligence

任务记录已经带 executor、model、workspace、usage、status 与时间戳。聚合层
在这份数据上增加维度：

```json
{
  "by": "model",
  "since": "2026-08-01",
  "rows": [
    {
      "executor": "asterroute",
      "model": "deepseek-v4-pro-official",
      "workspace": "C:\\work\\acp",
      "tasks": 12,
      "succeeded": 10,
      "input_tokens": 420000,
      "cached_input_tokens": 90000,
      "output_tokens": 61000,
      "reasoning_output_tokens": 18000,
      "estimated_cost": 0.41,
      "minutes": 34.2
    }
  ]
}
```

契约：

- `usage_report` 保持现有总量形状；新增 `usage_report_dimensions`（或同一工具
  的 `by`/`since` 参数）返回维度行。
- `estimated_cost` 是依据目录中 provider 公布的价格计算的估算；provider 的账单
  才是计费真值。ACP 把所用的价格元数据与估算一起存下。
- 成败与时长来自已存任务记录；聚合本身不需要新增持久化。

## Phase 4 —— 成本感知的模型选择器

`estimate_cost` 和 `latency_stats` 是只读事实。选择器界面尚未实现。
两者都不会选择或切换模型。

选择器用事实展示候选：

```text
Task: Refactor authentication
Recommended models:
  Model A — est. $0.02 · tools verified · reasoning high · recent p95 45s
  Model B — est. $0.01 · tools verified · reasoning low  · recent p95 30s
[Cheapest] [Balanced] [Best]
```

契约：

- `estimate_cost(task_requirements, model)` 返回公式及其输入。缺失的价格，或估算所需的缺失输入/输出单价，保持未知并列出缺失的单价，不按零计算。
- `latency_stats(model, window)` 从已记录任务时长返回 count、p50、p95。
- 选择器里每个标签都陈述可测量的事实；选择器永不静默换模型。
