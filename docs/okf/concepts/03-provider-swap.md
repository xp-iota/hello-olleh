---
type: Harness Concept
title: "推理服务可替换"
description: 从离线 mock 换到真实 MiniMax，只改 provider 路由与模型名，业务代码与工具定义一行都不用动。
tags: [okf, dsh-example, llm, provider, minimax]
status: stable
sources:
  - id: llm-minimax
    resource: "dsh-example/runtime/llm-minimax.ts"
    title: MiniMax 的 Anthropic 兼容适配器
  - id: harness-routes
    resource: "dsh-example/runtime/harness.ts"
    title: 两条 provider 路由的注册与默认选路
  - id: run-minimax
    resource: "dsh-example/M01-tool-pipeline/real/word-count-minimax.ts"
    title: M01 工具调用回路的真实推理服务版
  - id: m03-real
    resource: "dsh-example/M03-inference-service-access/real/llm-adapter-minimax.ts"
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

LLM 是一条标准能力缝，所以**换推理服务的代价接近于零**：注册一条新路由，
把 agent 的 `provider` 指过去即可。工具定义、提示装配、agent 主循环都不用改。

| 路由 | 适配器 | 特性 |
|:-----|:-------|:-----|
| `mock` | `MockAdapter` / `ToolCallingMockAdapter` | 离线、不要密钥，`npm run all` 因此恒绿 |
| `minimax-m3` | `MinimaxAnthropicAdapter` | 真实 HTTP 与 SSE，需 `MINIMAX_API_KEY` |

选路优先级：显式入参 `provider` > 环境变量 `DSH_PROVIDER` > 默认 `mock`。
`minimax-m3` 路由只在检测到 `MINIMAX_API_KEY` 时才注册——没有密钥就干脆不存在这条路由，
而不是注册一个会在运行时失败的空壳。

## 适配器真正的工作

`MinimaxAnthropicAdapter` 继承真实包里的 `LlmAdapter`，`stream()` 是唯一必需方法。
它做的是**双向翻译**：

- 出方向：provider-neutral 的消息与工具 schema → Anthropic Messages wire format。
- 入方向：SSE 的 `text` / `thinking` / `tool_use` 块 → dsh 的 `StreamChunk` 协议。

必须守住的协议契约（写错就会让上层静默错乱）：

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
| 真实端点连通性 | 需显式提供 `MINIMAX_API_KEY` | **A5 未执行**（A5 默认离线，不发外网请求） |

把「未验证」如实写在这里，是为了让后续读者不误以为真实计费链路已经跑通过。

## 什么时候这条结论会失效

- MiniMax 调整其 Anthropic 兼容端点的事件类型或字段（`llm-minimax.test.ts` 会先红）。
- 上游 `@deepseek-ai/dsh-llm` 修改 `StreamChunk` 协议或 `LlmAdapter` 的必需方法。

## 相关

- [能力缝的三角色](02-capability-seam.md)
- [一次工具调用等于两步](04-tool-call-round-trip.md)
- 长文分析：[07 请求管线：LLM、工具与提示](../../hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)

上一层：[Concepts](index.md)。
