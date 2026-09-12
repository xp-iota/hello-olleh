---
layout: content
type: Harness Concept
title: 装配枢纽 createHarness
description: 示例工程把全部装配成本集中在一个函数里，因此每个示例可以只写自己那一个扩展点。
tags: [okf, dsh-example, cordis, architecture]
status: stable
sources:
  - id: harness-ts
    resource: "dsh-example/runtime/harness.ts"
    title: 示例工程的装配层（createHarness 在 L136）
  - id: graphify-measure
    resource: "docs/okf/references/graphify-dsh-example.md"
    title: graphify 建图测量值
  - id: dsh-05
    resource: "docs/hello-dsh/05-启动与Cordis落地.md"
    title: DSH 启动链路与 Cordis 落地分析
generated: { by: kiro/gpt-5.6-sol, at: 2026-09-12T12:25:04Z }
verified: { by: "process:graphify-0.9.53", at: 2026-09-12T12:25:04Z }
stale_after: 2026-12-31T00:00:00Z
---

# 装配枢纽 createHarness

## 结论

`dsh-example/` 不是 12 套各自重复装配的小工程，而是**一个装配枢纽加 12 个方向模块、58 个细粒度步骤**。
`createHarness()`（`runtime/harness.ts` L136）承担了真实产品里 bundle 或 profile 的角色：
把 18 个真实服务按依赖顺序装进同一棵 cordis `Context`，并逐个等待 fiber 变为 ACTIVE。

![示例工程的真实拓扑](../../hello-dsh/diagrams/12-example-topology.svg)

交互版：[12-example-topology.html](../../hello-dsh/diagrams/12-example-topology.html)　·　
IR 源：[12-example-topology.architecture.json](../../hello-dsh/diagrams/12-example-topology.architecture.json)

- **星形结构是 graphify 量出来的**：584 节点、744 边、45 社区；`createHarness` 是唯一匹配节点，度数 66；739 条边 `EXTRACTED`，5 条 `INFERRED`。
- **示例为什么能这么短**：装配成本一次性付在 runtime 层；示例只写自己那一个扩展点；换真实模型不改业务代码，只改 provider。
- **两个缝故意留空**：压缩与沙箱不给默认后端，逼示例自己实现 provider，这正是能力缝三角色的最小演示。

## 证据

`createHarness` 的邻接极不对称（详见 [graphify 建图结果](../references/graphify-dsh-example.md)）：

- 入边 62 条：59 条 `imports`、2 条 `calls`、1 条 `contains`。
- 59 条 import 入边来自模块 phases、真实 provider 路径与测试等直接依赖者，不能误写成“每模块一条”。
- 出边 4 条：`MinimaxAnthropicAdapter`、`MockAdapter`、`entryOf` 与 `Harness.loadPlugin`。

这个形状意味着：想理解任何一个示例，只需要读它自己的 `index.ts` 加这一个枢纽，
不必在 12 个模块之间横向追踪重复装配。

## 为什么这样设计

真实产品里，服务装配由 `@deepseek-ai/dsh-base` 这类 bundle 或 profile 负责。示例工程
没有引入 bundle，而是手写一份等价装配，好处有两个：

1. 装配顺序变成**可读的一段代码**而不是黑盒配置——`agent-loop` 必须最后装，
   因为它注入 `agents`、`sessions`、`llm`、`tools`、`systemPrompt`。
2. cordis 的注入是异步的：`static inject` 未满足时 fiber 停在 PENDING。
   枢纽里逐个 `await fiber.await()`，否则访问 `ctx.tools` 会拿到空值。

## 什么时候这条结论会失效

- 示例工程改为直接依赖真实 bundle（届时枢纽会变薄甚至消失）。
- 新增示例不再经由 `createHarness` 自行装配服务（星形会退化成多中心）。

复核方式：按 [graphify 重建步骤](../references/graphify-dsh-example.md#重建) 重跑，
看 `createHarness` 是否仍是 `god_nodes()` 口径下最大度的非文件节点、入边构成是否仍保持单中心。

## 相关

- [能力缝的三角色](capability-seam.md)
- [推理服务可替换](provider-swap.md)
- 长文分析：[05 启动与 Cordis 落地](../../hello-dsh/05-启动与Cordis落地.md)

上一层：[Concepts](index.md)。
