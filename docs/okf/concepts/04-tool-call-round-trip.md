---
type: Harness Concept
title: "一次工具调用等于两步"
description: 模型调用一个工具会让本轮产生两个 step：第一步只发调用意图，结果回灌后才有第二步收尾。
tags: [okf, dsh-example, tools, agent-loop, evidence]
status: stable
sources:
  - id: run-minimax
    resource: "dsh-example/M01-tool-pipeline/real/word-count-minimax.ts"
    title: 从会话日志提取工具调用证据的运行脚本
  - id: tool-def
    resource: "dsh-example/M01-tool-pipeline/impl/01-word-count.ts"
    title: word_count 工具的三件套定义
  - id: harness-summarize
    resource: "dsh-example/runtime/harness.ts"
    title: runTurn 与 summarize：step 数由 step/start 事件计数得出
generated: { by: kiro/gpt-5.6-sol, at: 2026-09-12T12:25:04Z }
verified: { by: "process:local-sse-stub", at: 2026-09-07T23:45:00Z }
stale_after: 2026-12-31T00:00:00Z
---
# 一次工具调用等于两步

## 结论

模型调用一次工具，本轮会产生**两个 step**：

1. 第一步：模型只发出调用意图（`stop_reason` 为 `tool_use`），不产出最终文本。
2. 第二步：工具结果回灌成模型可见内容后，模型才基于结果收尾。

该示例的会话日志包含 2 个 `step/start` 事件，对应上述两次模型请求。

![一次 word_count 工具调用的完整回路](../../hello-dsh/diagrams/12-example-minimax-loop.svg)

交互版：[12-example-minimax-loop.html](../../hello-dsh/diagrams/12-example-minimax-loop.html)　·　
IR 源：[12-example-minimax-loop.sequence.json](../../hello-dsh/diagrams/12-example-minimax-loop.sequence.json)

- **工具定义复用**：01 注册的 `defineTool` 原样复用；provider 固定 `anthropic-compat`；schema 汇入提示由 `systemPrompt` 负责。
- **证据取自会话日志**：`tool-call` 与 `tool-result` 都从 `session.events` 读；未发现工具调用时脚本抛错。
- **一次工具调用等于两步**：第一步模型只发调用意图；结果回灌后才有第二步收尾；实测 step 数正好是 2。

## 怎么验证「模型真的调了工具」

模型发起的 `tool-call` 与回灌的 `tool-result` 都以消息块形式写入
`session.events`，可以据此检查工具名称、参数和结果。

本地 SSE 桩测试输出：

| 观测点 | 值 |
|:-------|:---|
| 模型可见工具 | `[ 'word_count' ]` |
| 模型发起的调用 | `word_count {"text":"DeepSeek Harness makes every tool call observable"}` |
| 工具执行结果 | `isError=false`，规范值 `words 7` / `chars 49` |
| 本轮 step 数 | 2 |
| 两次请求是否都带 tools | 是 |

请求要求模型使用 `word_count` 统计给定英文句子，脚本通过会话日志检查是否调用了该工具。

## 错误处理

调用列表中没有 `word_count` 时，脚本抛错。连接模型服务时若缺少 `LLM_API_KEY`，
脚本以非零状态退出并提示配置方法。

## 什么时候这条结论会失效

- 上游 agent-loop 改变 step 的划分口径（例如把工具执行并入同一 step）。
- 工具被配置为需要审批：审批会在 `tool/call` 与 `tool/result` 之间插入
  `approval/asked` 与 `approval/decided`，事件序列变长（步数口径仍按 `step/start` 计）。

## 相关

- [推理服务可替换](03-provider-swap.md)
- [能力缝的三角色](02-capability-seam.md)
- 可运行示例：[M01 工具管线](../../../dsh-example/M01-tool-pipeline/README.md)

上一层：[Concepts](index.md)。
