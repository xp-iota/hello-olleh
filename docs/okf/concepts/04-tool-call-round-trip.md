---
type: Harness Concept
title: "一次工具调用等于两步"
description: 模型调用一个工具会让本轮产生两个 step：第一步只发调用意图，结果回灌后才有第二步收尾。
tags: [okf, dsh-lab, tools, agent-loop, evidence]
status: stable
sources:
  - id: probe-trajectory
    resource: "dsh-lab/scripts/probe-trajectory.ts"
    title: 用脚本化适配器跑一个真实 turn 并读取会话日志
  - id: m01-module
    resource: "dsh-lab/M01-tool-pipeline/index.ts"
    title: word_count 工具的三件套定义与工具管线演示
  - id: tools-helper
    resource: "dsh-lab/src/lab/tools.ts"
    title: 阶段脚本共用的工具调用辅助 callTool
  - id: m04-module
    resource: "dsh-lab/M04-agent-loop-intervention/index.ts"
    title: turn / step 边界的观察阶段
generated: { by: mcode/minimax-m3.1-flash, at: 2026-10-23T10:00:00Z }
verified:
  - { by: "process:local-sse-stub", at: 2026-09-07T23:45:00Z }
  - { by: "mcode/minimax-m3.1-flash", at: 2026-10-23T10:00:00Z }
stale_after: 2027-04-30T00:00:00Z
---
# 一次工具调用等于两步

## 结论

模型调用一次工具，本轮会产生**两个 step**：

1. 第一步：模型只发出调用意图（`stop_reason` 为 `tool_use`），不产出最终文本。
2. 第二步：工具结果回灌成模型可见内容后，模型才基于结果收尾。

dsh-lab 的探针脚本 `scripts/probe-trajectory.ts` 用一个脚本化 `LlmAdapter` 跑完一个真实
turn：第一个 step 产出 `working_directory` 的 tool-call，第二个 step 给最终文本。
渲染出来的 turn 大纲是「步 2 / 工具 1」。

![一次工具调用的完整回路](../../hello-dsh/diagrams/12-example-minimax-loop.svg)

交互版：[12-example-minimax-loop.html](../../hello-dsh/diagrams/12-example-minimax-loop.html)　·
IR 源：[12-example-minimax-loop.sequence.json](../../hello-dsh/diagrams/12-example-minimax-loop.sequence.json)

> 这张图已按 `dsh-lab` 重画：`AnthropicCompatAdapter`、`anthropic-compat` 路由、
> `ctx.llm.stream` 入口、`tool/call` 与 `tool/result` 落 JSONL——与本文的接缝名一致。
> 图里「第二次请求带上工具结果」那一步，就是本文说的第二步。

- **工具定义复用**：M01 用 `defineTool` 注册 `word_count`，原样复用；默认路由是 `anthropic-compat`（`cordis.patch.yml` 的 `agent-default-model` 行）；schema 汇入提示由 `systemPrompt` 负责。
- **证据取自会话日志**：`tool/call` 与 `tool/result` 都从会话事件读；探针在拿不到
  `turn/start`、`tool/call`、`assistant/message` 时直接抛错。
- **一次工具调用等于两步**：第一步模型只发调用意图；结果回灌后才有第二步收尾。

## 怎么验证「模型真的调了工具」

模型发起的 `tool/call` 与回灌的 `tool/result` 都以消息块形式写入会话日志，
可以据此检查工具名称、参数和结果。

dsh-lab 里的读法是 `ctx.sessionQuery.readSession(sessionId)`——官方异步读，
已弃用的同步快照接口不再使用：

```ts
const { events } = await lab.ctx.sessionQuery.readSession(sessionId)
const toolCalls = events.filter((event) => event.type === 'tool/call').length
```

不需要模型时，阶段脚本可以直接调工具：`src/lab/tools.ts` 的 `callTool()` 把
`ctx.tools.execute()` 的返回压成一行可打印的文本，绕开模型也照样能验工具本身。

## 错误处理

缺少 `LLM_API_KEY` 时，模型类阶段（M03.3、M04.1、M04.2）**明确失败**并说明
要配哪个环境变量，不静默降级，也没有 mock 或离线回退。工具执行本身失败时
（异常、预算耗尽、中止等），`@deepseek-ai/dsh-tools` 的执行管线会把它转成
带 `isError=true` 的结构化结果，阶段断言随即失败。

## 什么时候这条结论会失效

- 上游 agent-loop 改变 step 的划分口径（例如把工具执行并入同一 step）。
- 工具被配置为需要审批：审批会在会话日志里追加 `approval/asked` 与
  `approval/decided` 一对审计事件（0.2.1 的事件名，见
  `@deepseek-ai/dsh-user-approval`），事件序列变长（步数口径仍按 `step/start` 计）。

## 相关

- [推理服务可替换](03-provider-swap.md)
- [能力缝的三角色](02-capability-seam.md)
- 可运行示例：[M01 工具管线](../../../dsh-lab/M01-tool-pipeline/README.md)

上一层：[Concepts](index.md)。
