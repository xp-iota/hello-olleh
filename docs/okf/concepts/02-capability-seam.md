---
type: Harness Concept
title: "能力缝的三角色"
description: DSH 的可替换能力由 Definition、Provider、Consumer 三个角色构成；示例工程通过两个未提供默认后端的扩展点说明这一点。
tags: [okf, dsh-example, seam, extensibility]
status: stable
sources:
  - id: harness-ts
    resource: "dsh-example/runtime/harness.ts"
    title: 装配清单与未提供默认后端的注释
  - id: m03-provider
    resource: "dsh-example/runtime/llm.ts"
    title: M03 的 LlmAdapter 实现（AnthropicCompatAdapter）
  - id: m02-compaction
    resource: "dsh-example/M02-context-assembly-economics/impl/03-compaction-provider.ts"
    title: M02 的 CompactionEngine provider
  - id: m07-sandbox
    resource: "dsh-example/M07-execution-backends/impl/03-sandbox-seam.ts"
    title: M07 的 SandboxProvider provider
  - id: dsh-03
    resource: "docs/hello-dsh/03-capability-seams-and-services.md"
    title: 能力缝与服务全景分析
generated: { by: kiro/gpt-5.6-sol, at: 2026-09-12T12:25:04Z }
verified: { by: "process:archify-showcase", at: 2026-09-12T12:29:00Z }
stale_after: 2026-12-31T00:00:00Z
---
# 能力缝的三角色

## 结论

DSH 里每个可替换的能力都是一条**缝（seam）**，由三个角色组成：

| 角色 | 含义 | 例子 |
|:-----|:-----|:-----|
| Definition | 抽象契约，通常是一个抽象类或接口 | `LlmAdapter` |
| Provider | 契约的具体实现，注册进某条路由 | `AnthropicCompatAdapter` |
| Consumer | 通过服务门面使用能力，不感知具体实现 | `agent-loop` 调 `ctx.llm` |

判断「这是不是一条缝」的实操标准：**能不能在不改 Consumer 的前提下换掉 Provider**。
LLM 能力满足这一点，所以 [换成真实推理服务](03-provider-swap.md) 不需要改任何示例代码。

## 示例工程如何演示这一点

`createHarness` 装配 18 个服务，以下两个服务的后端由对应模块提供：

| 留空的缝 | 真实产品里的后端 | 由谁在示例里补上 |
|:---------|:-----------------|:-----------------|
| `CompactionEngine` | `@deepseek-ai/dsh-compaction-basic` | M02 `impl/03-compaction-provider.ts` |
| `SandboxProvider` | `@deepseek-ai/dsh-sandbox-local` | M07 `impl/03-sandbox-seam.ts` |

留空是有意的教学设计：如果默认后端已经装好，示例就只能演示「调用」，
无法演示「成为 provider」。缺了后端，示例必须自己实现契约，三角色才完整露出来。

这一结构在拓扑图右下角以虚线标出：

![示例工程拓扑](../../hello-dsh/diagrams/12-example-topology.svg)

交互版：[12-example-topology.html](../../hello-dsh/diagrams/12-example-topology.html)　·　
IR 源：[12-example-topology.architecture.json](../../hello-dsh/diagrams/12-example-topology.architecture.json)

## 注册是 effect-based 的

缝上的注册全部走 cordis effect，因此天然可逆：插件 fiber 销毁后注册自动回收。
M01 的工具注册阶段用卸载前后输出演示了这件事——`fiber.dispose()` 之后工具集合变空，
不需要手写任何反注册代码。这也是「同一条路由只能有一个适配器，重复注册会抛错」
这类约束能被可靠执行的原因。

## 什么时候这条结论会失效

- 示例工程改为装载真实的 compaction 或 sandbox 后端（留空的教学价值消失）。
- 上游把某条缝的 Definition 从抽象类改为纯函数式契约（三角色的表述需要调整）。

## 相关

- [装配枢纽 createHarness](01-assembly-hub.md)
- [推理服务可替换](03-provider-swap.md)
- 长文分析：[03 能力缝与服务全景](../../hello-dsh/03-capability-seams-and-services.md)

上一层：[Concepts](index.md)。
