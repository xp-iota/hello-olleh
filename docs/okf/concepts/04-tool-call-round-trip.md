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
    resource: "dsh-example/M01-tool-pipeline/steps/01-word-count.ts"
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

这不是实现细节，而是可观测的事实——`step` 数由会话日志里的 `step/start` 事件计数得出，
实测值正好是 2。

![一次 word_count 工具调用的完整回路](../../hello-dsh/diagrams/12-example-minimax-loop.svg)

交互版：[12-example-minimax-loop.html](../../hello-dsh/diagrams/12-example-minimax-loop.html)　·　
IR 源：[12-example-minimax-loop.sequence.json](../../hello-dsh/diagrams/12-example-minimax-loop.sequence.json)

- **工具没有为对接模型改一行**：01 注册的 `defineTool` 原样复用；只把 provider 从 mock 换成 `anthropic-compat`；schema 汇入提示由 `systemPrompt` 负责。
- **证据取自会话日志**：`tool-call` 与 `tool-result` 都从 `session.events` 读；不依赖适配器自报调用成功；模型不调工具时脚本直接抛错。
- **一次工具调用等于两步**：第一步模型只发调用意图；结果回灌后才有第二步收尾；实测 step 数正好是 2。

## 怎么验证「模型真的调了工具」

关键在于**不信任适配器的自我报告**，而是读会话日志：模型发起的 `tool-call` 与回灌的
`tool-result` 都以消息块形式落在 `session.events` 上，扫描这些块即可拿到事实。

实测输出（本地 SSE 桩，非估算）：

| 观测点 | 值 |
|:-------|:---|
| 模型可见工具 | `[ 'word_count' ]` |
| 模型发起的调用 | `word_count {"text":"DeepSeek Harness makes every tool call observable"}` |
| 工具执行结果 | `isError=false`，规范值 `words 7` / `chars 49` |
| 本轮 step 数 | 2 |
| 两次请求是否都带 tools | 是 |

设计 query 时有一个实用技巧：**让调用工具成为答对的唯一路径**。
给一句英文并明确禁止模型自己数，工具是否被选中就变成可判定的，
而不是一句可有可无的客套话。

## fail loud 的位置

脚本在结尾断言 `word_count` 出现在调用列表里，否则抛错。理由是：
这个示例的全部意义就是「模型自己调了工具」——没调到说明链路未被验证，
让它静默通过等于假绿。同理，缺 `LLM_API_KEY` 时脚本以非零码退出并给出配置提示，
不会偷偷退回 mock 假装成功。

## 什么时候这条结论会失效

- 上游 agent-loop 改变 step 的划分口径（例如把工具执行并入同一 step）。
- 工具被配置为需要审批：审批会在 `tool/call` 与 `tool/result` 之间插入
  `approval/asked` 与 `approval/decided`，事件序列变长（步数口径仍按 `step/start` 计）。

## 相关

- [推理服务可替换](03-provider-swap.md)
- [能力缝的三角色](02-capability-seam.md)
- 可运行示例：[M01 工具管线](../../../dsh-example/M01-tool-pipeline/README.md)

上一层：[Concepts](index.md)。
