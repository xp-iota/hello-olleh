---
type: Harness Concept
title: "能力缝的三角色"
description: DSH 的可替换能力由 Definition、Provider、Consumer 三个角色构成；dsh-lab 用一条自写 provider 与两条官方后端说明这一点。
tags: [okf, dsh-lab, seam, extensibility]
status: stable
sources:
  - id: patch-yml
    resource: "dsh-lab/cordis.patch.yml"
    title: 装配清单：官方后端行与本工程自写 provider 行
  - id: anthropic-compat
    resource: "dsh-lab/src/llm/anthropic-compat/index.ts"
    title: M03 的 LlmAdapter 实现（AnthropicCompatAdapter）
  - id: m02-module
    resource: "dsh-lab/M02-context-assembly-economics/index.ts"
    title: M02 上下文装配与经济学阶段
  - id: m07-module
    resource: "dsh-lab/M07-execution-backends/index.ts"
    title: M07 执行后端与边界阶段
  - id: dsh-03
    resource: "docs/hello-dsh/03-capability-seams-and-services.md"
    title: 能力缝与服务全景分析
generated: { by: mcode/minimax-m3.1-flash, at: 2026-10-23T10:00:00Z }
verified:
  - { by: "process:archify-showcase", at: 2026-09-12T12:29:00Z }
  - { by: "mcode/minimax-m3.1-flash", at: 2026-10-23T10:00:00Z }
stale_after: 2027-04-30T00:00:00Z
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
LLM 能力满足这一点，所以 [换成真实推理服务](03-provider-swap.md) 不需要改任何阶段代码。

## dsh-lab 如何演示这一点

dsh-lab 的取舍是：**全工程只有一处自己写 provider**，其余 11 个模块全部使用官方包。

| 缝 | 真实产品里的后端 | dsh-lab 里的来源 |
|:---------|:-----------------|:-----------------|
| Anthropic Messages 兼容协议 | 官方只发布 DeepSeek 原生路由与 pi-ai 多路由转发 | 本工程自写 `src/llm/anthropic-compat/index.ts`（M03） |
| `CompactionEngine` | `@deepseek-ai/dsh-compaction-basic` | `cordis.patch.yml` 的 `compaction-basic` 行 |
| `SandboxProvider` | `@deepseek-ai/dsh-sandbox-local` | `cordis.patch.yml` 的 `sandbox` 行 |

与旧工程相比，这里少了一层「留空待补」的教学设计，但多了一层更贴近产品的观察：
**provider 的归属由装配清单决定，而不是由某个模块的源码决定**。`cordis.patch.yml`
里的 `llm-anthropic-compat` 行指向工程内的 `./src/llm/anthropic-compat/index.ts`，
其余行指向 `@deepseek-ai/*` 官方包——两者在 cordis 眼里没有区别，都是「挂一条行」。

自写 provider 的理由写在 `src/llm/anthropic-compat/index.ts` 的文件头：官方没有发布
直接讲 Anthropic Messages + SSE 协议的适配器，而 MiniMax、Fuyao 这类兼容网关很常见，
亲手写一遍才能真正理解「模型接入层」这条接缝。

这一点在拓扑图里是单独的一块（`自写 provider：只有一处`）：

![dsh-lab 的真实拓扑：一份装配清单驱动一棵 cordis 服务树](../../hello-dsh/diagrams/12-example-topology.svg)

交互版：[12-example-topology.html](../../hello-dsh/diagrams/12-example-topology.html)　·
IR 源：[12-example-topology.architecture.json](../../hello-dsh/diagrams/12-example-topology.architecture.json)

## 注册是 effect-based 的

缝上的注册全部走 cordis effect，因此天然可逆：插件 fiber 销毁后注册自动回收。
M01.1 用 `ctx.plugin(wordCountPlugin)` 装载 `word_count` 工具插件，阶段末尾
`fiber.dispose()` 之后工具集合变空，不需要手写任何反注册代码。这也是「同一条路由
只能有一个适配器，重复注册会抛错」这类约束能被可靠执行的原因。

## 什么时候这条结论会失效

- dsh-lab 改为装载官方发布的 Anthropic 兼容路由（自写 provider 的教学价值消失）。
- 上游把某条缝的 Definition 从抽象类改为纯函数式契约（三角色的表述需要调整）。

## 相关

- [装配枢纽：cordis.patch.yml 装配清单](01-assembly-hub.md)
- [推理服务可替换](03-provider-swap.md)
- 长文分析：[03 能力缝与服务全景](../../hello-dsh/03-capability-seams-and-services.md)

上一层：[Concepts](index.md)。
