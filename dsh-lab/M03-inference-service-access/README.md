# M03 · 推理服务接入

一次模型调用在 dsh 里只有一个入口：`ctx.llm.stream()`。适配器负责把某个 provider 的线协议翻译成 dsh 的 chunk 协议，`llm/stream` waterfall 负责环绕它。

本章的主角是本工程自带的 `anthropic-compat` 适配器——它是一条**真实可用**的路由，不是玩具。

## 学习目标

- 认识 `LlmAdapter` 的最小契约（只有 `stream()` 是必须实现的）；
- 理解为什么"适配器"和"路由"是两层；
- 看清 SSE 流如何变成 `text-delta` / `reasoning-delta` / `usage` chunk；
- 知道凭据为什么要在**每次请求**时解析。

## 运行

```bash
npm run M03        # M03.1、M03.2 不需要 key
npm run M03 -- 3   # M03.3 需要 LLM_API_KEY，会发起真实 HTTP 请求
```

M03.3 在缺少 key 时**故意失败**：

```text
✗ M03.3 真实调用一次模型（anthropic-compat）
    缺少 LLM_API_KEY：本阶段要发起真实的 provider 请求。在 dsh-lab/.env 里配置后重跑。
```

这是设计选择。一个"没有 key 也能显示成功"的示例工程，等于在教错误的验证方法。

## 配置

```bash
cp .env.example .env
# 然后填入 LLM_API_KEY
```

| 变量 | 作用 | 默认 |
|---|---|---|
| `LLM_API_KEY` | provider 密钥 | — |
| `LLM_BASE_URL` | Anthropic Messages 兼容端点 | `https://api.minimaxi.com/anthropic` |
| `LLM_MODEL` | 模型名 | `MiniMax-M3` |
| `LLM_VENDOR` | `minimax` 或 `fuyao` | `minimax` |
| `DSH_MODEL_PROVIDER` | 覆盖路由名 | `anthropic-compat` |

## 代码地图

```text
src/llm/anthropic-compat/index.ts     # 适配器插件（本章主角）
├─ Config                             # provider / baseURL / apiKeyEnv / model / vendor
├─ splitSystem()                      # 把 role:'system' 折进顶层 system 字段
├─ toAnthropicMessages()              # 0.2.x 消息模型 → Anthropic messages
├─ toAnthropicTool()                  # dsh 工具 schema → Anthropic tools
├─ tokenUsage()                       # Anthropic usage → dsh TokenUsage
└─ class AnthropicCompatAdapter extends LlmAdapter
   ├─ providerInfo / listModels / resolveModel
   └─ stream()                        # 发 HTTP、解析 SSE、产出 chunk
```

## 三个值得注意的地方

### 1. 工具结果不再是 user message 里的 block

0.2.x 把工具结果改成了独立的 `role: 'tool'` 消息（带 `toolCallId`）。而 Anthropic Messages API 要求 `tool_result` 放在 **user** 消息的 content 里。

所以 `toAnthropicMessages()` 必须做一次折叠：把连续的 `role: 'tool'` 消息合并进一条 user 消息的 `tool_result` block 数组。这是协议差异，不是设计缺陷——两边的模型不同，最优表示形式就不同。

### 2. 凭据在每次请求时解析

```ts
const key = await resolveApiKey()   // credentials 服务 → process.env → 抛 LlmError
```

不在构造时读一次，是因为：轮换密钥不该需要重启进程；而且 `credentials` 服务可能返回一个**短期**凭据。构造期缓存会把"密钥更新"变成"进程重启"。

解析不到时抛 `LlmError(..., 'MISSING_CREDENTIAL')`——带 code 的错误，上层可以据此给出可操作的提示。

### 3. `attributionHeaders()` 必须合并进每个请求

`@deepseek-ai/dsh-llm` 导出的 `attributionHeaders()` 携带产品归因信息。适配器作者的义务是把它合并进 provider 请求头，而不是只发自己的 `x-api-key`。

## `llm/stream` waterfall

M03.2 演示环绕点。监听可以：

- 先 `next()` 拿到流，再包一层（观察/记账/改写）；
- 或者不调 `next()`，直接返回自己的流（**拦截**）。

注意这个 waterfall 是**同步返回** `AsyncIterable`，不是返回 `Promise`。所以监听写成 `(options, next) => {...}` 而不是 `async (options, next) => {...}`——写成 async 会让类型不匹配，这是有意的约束：请求的建立必须是同步的。

## 排错

| 现象 | 原因 |
|---|---|
| `MISSING_CREDENTIAL` | `.env` 没填 `LLM_API_KEY`，或环境变量没导出 |
| `reasoningEffort` 相关抛错 | 该适配器不支持 reasoning effort，显式拒绝而不是静默忽略 |
| 模型收到空上下文 | `splitSystem` 把 system 折走了；确认 system 内容进了顶层字段 |
| 工具结果错位 | `role: 'tool'` 消息没折叠成 `tool_result` block |

## 练习

1. 给适配器加一个 `providerRetryPolicy`，对 429 做指数退避。观察它和 `llm-retry` 插件的关系。
2. 在 M03.2 的监听里统计 chunk 数量并打印——不改流的内容。
3. 把 `LLM_VENDOR` 设成 `fuyao`，观察哪些代码路径变了（提示：无签名 reasoning 的处理）。
