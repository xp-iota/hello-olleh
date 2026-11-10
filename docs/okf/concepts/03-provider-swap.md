---
type: Harness Concept
title: "推理服务可替换"
description: 通过 provider 路由与协议适配器接入推理服务，工具定义和主循环共用。
tags: [okf, dsh-lab, llm, provider, minimax]
status: stable
sources:
  - id: anthropic-compat
    resource: "dsh-lab/src/llm/anthropic-compat/index.ts"
    title: Anthropic 兼容适配器（MiniMax / Fuyao 共用）
  - id: patch-yml
    resource: "dsh-lab/cordis.patch.yml"
    title: 两条 provider 路由的挂载与默认选路
  - id: m03-module
    resource: "dsh-lab/M03-inference-service-access/index.ts"
    title: M03 的真实 provider 访问路径
  - id: wire-test
    resource: "dsh-lab/src/llm/anthropic-compat.test.ts"
    title: 对 Anthropic wire format 的纯函数回归测试
generated: { by: mcode/minimax-m3.1-flash, at: 2026-10-23T10:00:00Z }
verified:
  - { by: "process:local-sse-stub", at: 2026-09-07T23:45:00Z }
  - { by: "mcode/minimax-m3.1-flash", at: 2026-10-23T10:00:00Z }
stale_after: 2027-04-30T00:00:00Z
---
# 推理服务可替换

## 结论

LLM 服务通过适配器连接推理后端。新协议需要实现适配器并注册 provider 路由；
同协议的兼容端点可通过配置切换，工具定义、提示装配和主循环共用。

| 路由 | 适配器 | 特性 |
|:-----|:-------|:-----|
| `anthropic-compat` | `AnthropicCompatAdapter`（`src/llm/anthropic-compat/index.ts`） | 真实 HTTP 与 SSE，需 `LLM_API_KEY` |
| `deepseek-official` | `@deepseek-ai/dsh-llm-deepseek-api-key` | 官方原生路由，需 `DEEPSEEK_API_KEY` |

`dsh-lab/` 在 `cordis.patch.yml` 里挂载这两条路由，agent 的默认路由由
`agent-default-model` 行决定，取 `DSH_MODEL_PROVIDER`（缺省 `anthropic-compat`），
模型名取 `DSH_MODEL` / `LLM_MODEL`（缺省 `MiniMax-M3`）。

缺少 `LLM_API_KEY` 时**不是启动期失败**：适配器把凭据解析放在每次请求里
（`resolveApiKey()` 先问 credentials 服务，再读环境变量），只在真正调用模型时抛
`MISSING_CREDENTIAL`，并且报错信息指明要设哪个环境变量。这样 `dsh-lab sessions` /
`dsh-lab traj` 这类纯本地读操作在没有 key 时也能用。

路由名描述的是**协议**而不是厂商：适配器讲的是 Anthropic Messages wire format，所以
把 `LLM_BASE_URL` 指向任何同等兼容的端点（默认 `https://api.minimaxi.com/anthropic`）
即可换服务，不必改路由名。这也是三个变量名不带厂商前缀的原因。

## 协议转换

`AnthropicCompatAdapter` 继承真实包里的 `LlmAdapter`，`stream()` 是唯一必需方法；
另外覆写了 `providerInfo()` / `listModels()` / `resolveModel()`，让路由能被选择器发现。
它做的是**双向翻译**：

- 出方向：provider-neutral 的消息与工具 schema → Anthropic Messages wire format。
- 入方向：SSE 的 `text` / `thinking` / `tool_use` 块 → dsh 的 `StreamChunk` 协议。

流事件遵循以下顺序与字段约束：

- 先 `usage` 再 `finish`，`finish` 之后不再发任何 chunk。
- 同一 block 的所有 delta 复用同一 `index`。
- 不支持的请求字段要抛错，不能静默丢弃——例如该网关没有与 `reasoningEffort`
  对应的档位，适配器直接 fail loud。
- `thinking` 块映射成 `reasoning`，不进入文本面；回放时缺 signature 会拒绝。

认证走 `x-api-key` 头，密钥只从环境变量读，`.env` 被 gitignore，**永不入库**。

0.2.1 相对 0.1.5 有两处契约变化，适配器的文件头逐条记着：工具结果现在是独立的
`role: 'tool'` 消息（序列化时折叠回 Anthropic 的 `tool_result` block）；
每个 provider 请求都必须带 `attributionHeaders()` 归属头。

## 验证到什么程度

| 层次 | 手段 | 状态 |
|:-----|:-----|:-----|
| wire format 映射 | `src/llm/anthropic-compat.test.ts` 的纯函数测试 | 已有 |
| 整条工具调用回路 | 脚本化适配器探针跑真实 turn | 已验证，见 [一次工具调用等于两步](04-tool-call-round-trip.md) |
| 真实端点连通性 | 需显式提供 `LLM_API_KEY`（`dsh-lab/.env`） | 本文记录的测试未覆盖外部端点 |

已知失败点：`M03.3` 显式传 `maxTokens: 200`，fuyao 网关的模型把预算花光在 `thinking`
块上，`stop_reason` 变成 `max_tokens`，于是没有 `text` 块，阶段报「模型没有返回任何文本」。
这是阶段代码里写死的预算与具体网关的输出习惯不匹配，Node 与 Bun 以完全相同的方式失败。

## 什么时候这条结论会失效

- MiniMax 调整其 Anthropic 兼容端点的事件类型或字段（需更新协议回归测试）。
- 上游 `@deepseek-ai/dsh-llm` 修改 `StreamChunk` 协议或 `LlmAdapter` 的必需方法。

## 相关

- [能力缝的三角色](02-capability-seam.md)
- [一次工具调用等于两步](04-tool-call-round-trip.md)
- 长文分析：[07 请求管线：LLM、工具与提示](../../hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)

上一层：[Concepts](index.md)。
