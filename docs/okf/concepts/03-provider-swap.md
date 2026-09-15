---
type: Harness Concept
title: "推理服务可替换"
description: 通过 provider 路由与协议适配器接入推理服务，工具定义和主循环共用。
tags: [okf, dsh-example, llm, provider, minimax]
status: stable
sources:
  - id: llm-minimax
    resource: "dsh-example/runtime/llm.ts"
    title: Anthropic 兼容适配器（MiniMax / Fuyao 共用）
  - id: harness-routes
    resource: "dsh-example/runtime/harness.ts"
    title: 两条 provider 路由的注册与默认选路
  - id: run-minimax
    resource: "dsh-example/M01-tool-pipeline/real/word-count-minimax.ts"
    title: M01 工具调用回路的真实推理服务版
  - id: m03-real
    resource: "dsh-example/runtime/llm.ts"
    title: M03 的真实 provider 访问路径
  - id: wire-test
    resource: "dsh-example/runtime/llm-minimax.test.ts"
    title: 对 Anthropic wire format 的 fixture 回归测试
generated: { by: kiro/gpt-5.6-sol, at: 2026-09-12T12:25:04Z }
verified: { by: "process:local-sse-stub", at: 2026-09-07T23:45:00Z }
stale_after: 2026-12-31T00:00:00Z
---
# 推理服务可替换

## 结论

LLM 服务通过适配器连接推理后端。新协议需要实现适配器并注册 provider 路由；
同协议的兼容端点可通过配置切换，工具定义、提示装配和主循环共用。

| 路由 | 适配器 | 特性 |
|:-----|:-------|:-----|
| `anthropic-compat` | `AnthropicCompatAdapter`（`runtime/llm.ts`） | 真实 HTTP 与 SSE，需 `LLM_API_KEY` |

`dsh-example/` 注册 `anthropic-compat` 路由。缺少 `LLM_API_KEY` 时，
`realConfig()` 抛错并提示配置来源。

路由名描述的是**协议**而不是厂商：适配器讲的是 Anthropic Messages wire format，所以
把 `LLM_BASE_URL` 指向任何同等兼容的端点（默认 `https://api.minimaxi.com/anthropic`）
即可换服务，不必改路由名。这也是三个变量名不带厂商前缀的原因。

## 协议转换

`MinimaxAnthropicAdapter` 继承真实包里的 `LlmAdapter`，`stream()` 是唯一必需方法。
它做的是**双向翻译**：

- 出方向：provider-neutral 的消息与工具 schema → Anthropic Messages wire format。
- 入方向：SSE 的 `text` / `thinking` / `tool_use` 块 → dsh 的 `StreamChunk` 协议。

流事件遵循以下顺序与字段约束：

- 先 `usage` 再 `finish`，`finish` 之后不再发任何 chunk。
- 同一 block 的所有 delta 复用同一 `index`。
- 不支持的请求字段要抛错，不能静默丢弃——例如 MiniMax 的兼容接口没有与
  `reasoningEffort` 对应的档位，适配器直接 fail loud。
- `thinking` 块映射成 `reasoning`，不进入文本面；回放时缺 signature 会拒绝。

认证走 `x-api-key` 头，密钥只从环境变量读，`.env` 被 gitignore，**永不入库**。

## 验证到什么程度

| 层次 | 手段 | 状态 |
|:-----|:-----|:-----|
| wire format 映射 | `runtime/llm-minimax.test.ts` 的 fixture 测试 | 已有 |
| 整条工具调用回路 | 本地 SSE 桩 + 真实 agent-loop | 已验证，见 [一次工具调用等于两步](04-tool-call-round-trip.md) |
| 真实端点连通性 | 需显式提供 `LLM_API_KEY` | 本文记录的测试未覆盖外部端点 |

## 什么时候这条结论会失效

- MiniMax 调整其 Anthropic 兼容端点的事件类型或字段（需更新协议回归测试）。
- 上游 `@deepseek-ai/dsh-llm` 修改 `StreamChunk` 协议或 `LlmAdapter` 的必需方法。

## 相关

- [能力缝的三角色](02-capability-seam.md)
- [一次工具调用等于两步](04-tool-call-round-trip.md)
- 长文分析：[07 请求管线：LLM、工具与提示](../../hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)

上一层：[Concepts](index.md)。
