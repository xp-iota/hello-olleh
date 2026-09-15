---
title: "请求管线：LLM、工具与 SystemPrompt"
---
# 请求管线：LLM、工具与 SystemPrompt

> **本篇回答**：一次模型请求是怎么被组装、发出、再把结果收回来的。三段接起来就是完整管线：`ctx.llm`（`LlmAdapter` 只有一个必需方法、`llm/stream` waterfall、模型路由三段解析）→ `ctx.tools`（三段 waterfall 的六条契约、并行/独占分组、Code Mode）→ `ctx.systemPrompt`（四类可注册对象、`assemble()` 九步、`complete` 独占节、作用域遮蔽）。
> **路径缩写**：`P/` = `packages/`，`L/` = `packages/llm/llm/src/`，`T/` = `packages/core/tools/src/`，`AL/` = `packages/core/agent-loop/src/`，`SP/` = `packages/core/system-prompt/src/`。行号对应快照 `fb2c4b9e`。
>
> 🧭 **本篇导览**：7.1–7.8 LLM 适配与流式接缝 → 7.9–7.17 工具契约与执行管线 → 7.18–7.27 SystemPrompt 与运行时上下文。
>

## 7.1 `llm` 组的 5 个包

| 包 | 行数 | 角色 |
|---|---|---|
| **`llm`** | **2625** | Service Definition：消息与流的词汇表 + 适配器接缝 |
| `llm-pi-ai` | 2706 | Provider（最大的一个） |
| `llm-deepseek` | 1216 | Provider（DeepSeek 官方） |
| `token-meter` | 999 | token 计量 |
| `llm-retry` | 494 | 重试策略（`agent/request-error` 的消费者） |

`docs/architecture.md` 对它的定位：

> `llm/llm` — Message and stream vocabulary plus the adapter seam — `ctx.llm`

💡 **`llm-pi-ai` 比定义包还大**（2706 vs 2625）。"pi-ai" 应该是一个聚合型 provider（对应 `.github/workflows/pi-ai-provider-e2e.yml` 有专门的 e2e）。

## 7.2 `LlmAdapter`：只有一个必需方法

> 📐 **配套可跑示例**：[`AnthropicCompatAdapter`](../../dsh-example/runtime/llm.ts) 只实现 `stream()` 这一个方法就接上了整条链
> （MiniMax / Fuyao 的 Anthropic 兼容端点 → 同一份 StreamChunk 协议）；`npm run M03`
> 用同一个消费循环消费 `anthropic-compat` 路由。


`L/index.ts:180-233` 是抽象基类，**只有 `stream()` 是 abstract**，其余四个都有默认实现：

![LLM 适配器只有一个必需方法](diagrams/07-adapter-surface.svg)

**LLM 适配器只有一个必需方法** — [交互版](diagrams/07-adapter-surface.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-adapter-surface.architecture.json)

- **抽象基类的位置**：L/index.ts:180-233 是适配器基类 · 只有 stream 是 abstract · 其余四个方法都给了默认实现
- **必须遵守 signal**：调用方随时可能取消 · 适配器要在 signal abort 时停止产出 · 否则取消语义会在流层失效
- **覆写的常见理由**：providerInfo 用于在界面上显示友好名称 · providerRetryPolicy 用于适配服务方的限流策略 · 模型发现用于动态列出可用模型

💡 **`listModels` 的"建议性"约定值得强调**（`L/index.ts:200-205` 注释）：

> The result is advisory: an adapter may accept unlisted model ids, and consumers must not turn absence into request rejection.

这避免了"模型列表没更新导致新模型不可用"这类常见问题。

## 7.3 `llm/stream`：waterfall 接缝

> 📐 **配套可跑示例**：[`M03.1 · llm-stream`](../../dsh-example/M03-inference-service-access/impl/llm-stream.ts) 注册两个监听器包在真实适配器外侧 ——
> 外侧改写 `text-delta`、内侧统计 chunk 与 usage：
>
> ```ts
> ctx.on('llm/stream', (options, next) => (async function* () {
>   for await (const chunk of next()) yield chunk.type === 'text-delta'
>     ? { ...chunk, text: chunk.text.toUpperCase() } : chunk
> })())
> ```


`L/index.ts:64` 声明（在 `declare module '@deepseek-ai/cordis'` 里）：

```ts
'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
```

![llm/stream 是一条可插拔的流水线](diagrams/07-llm-stream-waterfall.svg)

**llm/stream 是一条可插拔的流水线** — [交互版](diagrams/07-llm-stream-waterfall.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-llm-stream-waterfall.architecture.json)

- **waterfall 的 this 是 LlmRuntime**：不是 Scope，因此拿不到 agent 级作用域 · 需要 agent 上下文的逻辑要从 options 里取 · 这是与 tools 三段 waterfall 的重要差异
- **能做什么**：计量 token 与延迟 · 替换或录制整个流 · 按条件改写 request 后再放行
- **兜底是最内层**：所有监听器都不短路时才真正调适配器 · 于是 mock 与回放不需要改适配器 · 这与 cordis waterfall 的语义一致

💡 **waterfall 返回 `AsyncIterable` 而非 Promise**——监听器可以包装流（逐 chunk 加工）而不必等整个流结束。这是“流式可拦截”的关键（对照 [cordis 06 § 6.3](../hello-cordis/06-event-system-and-waterfall.md)，waterfall 的返回类型由事件签名决定）。

💡 **waterfall 的通用原理不在本篇展开**：两侧契约、执行语义与踩坑集中在 [cordis 06 § 6.3](../hello-cordis/06-event-system-and-waterfall.md)；本篇的三处 waterfall（§ 7.3 / § 7.11 / § 7.26）只讲各条缝自己的约定。

## 7.4 `LlmRuntime`：服务本体

`L/index.ts:284`（947 行文件里的主类），`extends Service` → `ctx.llm`。

![LlmRuntime 的注册与查询面](diagrams/07-llm-runtime-api.svg)

**LlmRuntime 的注册与查询面** — [交互版](diagrams/07-llm-runtime-api.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-llm-runtime-api.architecture.json)

- **注册都返回 handle**：handle 本身是 disposer，符合 cordis effect 模型 · 插件卸载时适配器自动注销 · 支持同一适配器实例的原子路由替换
- **查询面服务于配置界面**：listConfigurableProviders 给出可选项 · discoverModels 动态拉取模型列表 · 于是界面不需要硬编码模型名
- **重试策略一定有值**：providerRetryPolicy 保证返回已解析的策略 · 调用方不需要处理缺省情况 · 这是 fail-closed 在配置面的体现

💡 **`prepareCall` 的存在解释了 [06 § 6.6](06-agent-loop-and-session-log.md) 里那行代码**：

```ts
const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)
```

有 `preparedCall` 时用它的 stream（**已绑定到解析出精确模型默认值的那个适配器注册**），否则走通用路径。`buildRequest()` 的 JSDoc 说的"bind it to the adapter registration that resolved its exact-model defaults"就是这个。

💡 **`AdapterRegistrationHandle` 支持原子路由替换**（`L/index.ts:239-245`）。一个适配器实例可能注册多条 provider 路由（如 `openai`、`azure-openai`），换配置时需要原子替换整组而不是逐个 dispose/register——否则中间态会有"部分路由消失"的窗口。

## 7.5 模型路由的三段解析

这是 DSH 里比较绕的一块。

![请求路由的四级解析](diagrams/07-routing-resolution.svg)

**请求路由的四级解析** — [交互版](diagrams/07-routing-resolution.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-routing-resolution.architecture.json)

- **为什么要四级**：声明层给默认值，可被用户设置覆盖 · header 层让同一会话内的选择可持久 · waterfall 层允许插件按内容动态改写
- **header 是折叠出来的**：日志里可能有多条 request/header 事件 · requestHeader() 把它们折叠成一个 EpochHeader · 于是最后一次设置生效
- **这是本篇最绕的一块**：四级来源都可能提供同一字段 · 优先级由 requestProposal 统一裁决 · 调试时先打印最终配置再回溯来源

相关文件：

| 文件 | 行数 | 作用 |
|---|---|---|
| `L/call-config.ts` | 117 | `LlmCallConfig`、`LlmCallConfigAdapterDefaults`、`callConfigEquals`、`isAgentLoopRequest` / `markAgentLoopRequest` |
| `S/request-header.ts` | 71 | `EpochHeader` |
| `P/core/agent/src/model-selection.ts` | 75 | 模型选择（引用 `'agent/request'`，`:55`） |

💡 **`markAgentLoopRequest` / `isAgentLoopRequest`（`L/index.ts:43`）** 用来标记"这个请求来自 agent 主循环"，区别于其它用途的 LLM 调用（如生成会话标题、压缩摘要）。这让 `token-meter` 等能分类计量。

## 7.6 `L/` 逐文件

| 文件 | 行数 | 职责 |
|---|---|---|
| **`index.ts`** | **947** | `LlmRuntime`、`LlmAdapter`、`LlmError`、`llm/stream` 声明 |
| `types.ts` | 356 | `GenerateOptions`、`StreamChunk`、`Message`、`LlmModelInfo` 等 |
| `message.ts` | 261 | 消息构造（`createAssistantMessage` 等） |
| `retry-policy.ts` | 191 | `ResolvedRetryPolicy` |
| **`assembler.ts`** | **164** | **`BlockAssembler`** —— 把 chunk 流装成 block |
| `error.ts` | 163 | `LlmError`、`HarnessError` |
| `call-config.ts` | 117 | `LlmCallConfig` |
| `invariant.ts` | 112 | 不变量 |
| `adapter-failure.ts` | 104 | `LlmFailure` |
| `attribution.ts` | 68 | 归因 |
| `brand.ts` | 64 | 品牌类型（nominal typing） |
| `api-key.ts` | 41 | `assertUsableApiKey`（`L/index.ts:137`） |
| `never.ts` | 21 | |
| `content.ts` | 16 | |

### `BlockAssembler`：流 → 块

`L/assembler.ts`（164 行）。用法在 [06 § 6.6](06-agent-loop-and-session-log.md)：

```ts
const assembler = new BlockAssembler()
for await (const chunk of stream) { assembler.push(chunk) }
const finish = assembler.finish          // ← 'error' | 'aborted' | 'max-tokens' | 正常
const blocks = assembler.blocks()        // → ContentBlock[]
const usage = assembler.usage            // → TokenUsage | undefined
const replayState = assembler.replayState // → 可选的回放状态
```

💡 **`assembler.replayState`** 会被塞进 `assistant/message` 的 `source` 里（`AL/agent.ts:373-380`）。这是为了让"回放"能精确复现流式过程——配合 `test-support/llm-replay` 包（用于测试）。

## 7.7 错误模型

![结构化错误模型](diagrams/07-error-model.svg)

**结构化错误模型** — [交互版](diagrams/07-error-model.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-error-model.architecture.json)

- **为什么要结构化**：重试策略需要按 code 判断是否可重试 · 界面需要区分限流、鉴权与内容拦截 · 纯字符串消息无法可靠解析
- **失败事实与异常分离**：LlmFailure 只描述发生了什么 · LlmError 负责把它作为异常抛出 · 于是同一事实可用于日志、遥测与展示
- **降级路径明确**：非 LlmError 的异常不会被强行解析 · turn 里用 instanceof 判断后分流 · 保留原始错误不掩盖真实原因

💡 **重试策略有三个来源**：
1. 适配器自己的 `providerRetryPolicy(provider)`（`L/index.ts:195`）
2. `LlmRuntime.providerRetryPolicy(provider)`（`:566`）保证返回非空
3. `agent/request-error` 的 payload 带 `retryPolicy`，`llm-retry` 据此决策

## 7.8 API Key 的处理

`assertUsableApiKey(raw, pkg, ref)`（`L/index.ts:137`）+ `L/api-key.ts`（41 行）。

💡 **签名带 `pkg` 与 `ref` 参数**——出错时能报出"是哪个包、哪个引用"的 key 不可用。这类"错误信息里带来源"的设计在 DSH 里很常见（对照 [05 § 5.5](05-startup-and-cordis-runtime.md) 的 `binName` 参数）。

💡 **凭据本身在 `credentials` 组**（`credentials` + `credentials-local`，1819 行）——`llm` 只负责校验拿到的 key 可用。

---

> 📎 **以下承接原「08 工具注册与执行管线」。**
> 本篇讲 `ctx.tools`（`P/core/tools`，5620 行，全 core 最大）：作用域化注册表、三段 waterfall、并行/独占分组、以及 Code Mode。
> 路径缩写：`P/` = `packages/`，`T/` = `packages/core/tools/src/`，`AL/` = `packages/core/agent-loop/src/`。行号对应快照 `fb2c4b9e`。

## 7.9 `tools` 包的 10 个文件

| 文件 | 行数 | 职责 |
|---|---|---|
| **`index.ts`** | **1946** | `ToolRuntime` + 三段 waterfall 声明 + 全部类型 |
| `py-types.ts` | 818 | JSON Schema → **Python 类型**（`jsonSchemaToPy` / `renderToolsSdkPy`） |
| **`code-mode.ts`** | **673** | **Code Mode**：让模型写代码调工具而非发 tool_call |
| `json-schema.ts` | 656 | JSON Schema 处理 |
| `schema.ts` | 617 | `ToolSchema` |
| `presentation.ts` | 389 | 工具呈现方式 |
| `ts-types.ts` | 293 | JSON Schema → **TypeScript 类型**（`jsonSchemaToTs` / `renderToolsSdk`） |
| `invariant.ts` | 128 | 不变量 |
| `types.ts` | 58 | `CodeDispatchEventData` 等 |
| `testing.ts` | 42 | `defineContentToolFixture` |

💡 **同时生成 TS 与 Python 类型**（`ts-types.ts` + `py-types.ts` 共 1111 行）是为 Code Mode 服务的：模型要写代码调工具，就需要工具的类型定义。这也解释了 `python/sdk` 的存在（[04 篇](04-extensions-and-ecosystem.md)）。

## 7.10 `ToolDefinition`：工具的契约

> 📐 **配套可跑示例**：[`M01.1 · tool-wordcount`](../../dsh-example/M01-tool-pipeline/impl/01-word-count.ts) 是这份契约的最小实现。
> 两个真实 DSL 硬要求容易踩：object 型 `output.schema` **必须**显式写 `additionalProperties`，
> 必填字段写在**每个 property 上**（`required: true`），不是 JSON Schema 的 `required` 数组 ——
> 写错在 `defineTool` 就抛 `JsonSchemaError`。


`T/index.ts:222-290`（`extends ToolSchema`）：

![ToolDefinition 的必需与可选](diagrams/07-tool-definition.svg)

**ToolDefinition 的必需与可选** — [交互版](diagrams/07-tool-definition.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-tool-definition.architecture.json)

- **超时不由工具自己实现**：由 dsh-tool-call-timeout-policy 统一施加 · 它是一个 tools/execute wrapper · 于是所有工具的超时行为一致
- **output 定义的作用**：声明工具返回值的结构 · 用于生成类型与校验实际输出 · 也决定界面如何呈现结果
- **只有 execute 必需**：其余字段都可省略或由策略补齐 · 写一个新工具的最小成本很低 · 复杂行为通过 waterfall 叠加

### `ToolRunContext`：工具能做的两件"越权"事

`T/index.ts:404-425`（`extends ToolExecution`）：

| 方法 | 行号 | 作用 |
|---|---|---|
| **`deferContext(context: UserMessage)`** | 411 | **往 inbox 塞一条消息**（下一 step 生效） |
| **`concludeTurn()`** | 420 | **声明这个 turn 可以结束了** |

💡 **这两个方法让工具能影响主循环**。`deferContext` 的接线在 `AL/agent.ts:397`：

```ts
context => this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [context])
```

即追加到 `next-step` 队列尾部。`concludeTurn()` 则让 `executeToolCalls` 返回 `concluded: true`，使 `step()` 返回 `{ kind: 'completed' }`（[06 § 6.6](06-agent-loop-and-session-log.md)）。

💡 **典型用例**：`tool-ask-user`（问用户问题后 `concludeTurn`，等用户回答）、`tool-subagent-report`（把子 agent 的报告 `deferContext` 进来）。

## 7.11 三段 waterfall

> 📐 **配套可跑示例**：三段各有一个示例 ——
> pre-execute → [M01.2 · 权限门](../../dsh-example/M01-tool-pipeline/impl/02-permission-gate.ts)（返回 `deny` / `ask`）、
> post-execute + result → [M01.3 · 结果转换与审计](../../dsh-example/M01-tool-pipeline/impl/03-result-transform.ts)、
> 以及 pre-execute **之后**仍无法被推翻的 [M01.5 · 单调守卫](../../dsh-example/M01-tool-pipeline/impl/05-tool-guard.ts)。


`T/index.ts:152` / `:163` / `:175`，`this` 类型统一是 `Scoped<ToolRuntime>`。

![tools 的三段 waterfall](diagrams/07-tools-three-stages.svg)

**tools 的三段 waterfall** — [交互版](diagrams/07-tools-three-stages.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-tools-three-stages.architecture.json)

- **三段的分工**：pre-execute 决定能不能做 · execute 决定怎么做（含超时与重试） · post-execute 决定结果怎么呈现
- **调用身份不可变**：execute wrapper 只允许替换 exec.signal · 不允许改 callId、name 或 agent · 注册表会在 body 前重新熔接原始 caller 身份
- **审批的降级规则**：pre-execute 可以返回 ask 要求审批 · 若环境没有审批能力，ask 等价于拒绝 · 这是 fail-closed，不会静默放行

### 三条容易忽略的契约

💡 **① `pre-execute` 的"不放弃 promise"**（`:146-148`）：即使在 gate 等待期间发生了取消，注册表也不会丢弃那个 promise。这防止了"审批对话框还开着，但调用已被判定取消"导致的资源泄漏。

💡 **② `execute` wrapper 只能改 `signal`**（`:154-159`）：调用身份（callId、name、arguments）不可变。而且注册表**在 body 前重新熔接原始 caller signal**——所以 wrapper 即使换了 signal，调用方的取消仍然有效。这是"超时 wrapper 不能意外让任务变成不可取消"的保证。

💡 **③ `post-execute` 也接收抛错的工具**（`:167`）：`thrown tools still reach this waterfall as errors`。所以做指标/日志的监听器不需要额外的 try/catch。

## 7.12 `executeToolCalls`：并行与独占分组

`AL/agent.ts:395` 调用，实现在 `AL/tool-calls.ts:59-100`。

![executeToolCalls 的计划与执行](diagrams/07-execute-tool-calls.svg)

**executeToolCalls 的计划与执行** — [交互版](diagrams/07-execute-tool-calls.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-execute-tool-calls.architecture.json)

- **为什么先建 PlannedCall**：注释说明输入与执行上下文要分开 · 因为 tools/execute wrapper 可能替换 exec.signal · 分开后原始输入始终可追溯
- **发起者必须存在**：用 requireInitiator 而非 currentInitiator · 缺失时直接报错而不是猜一个 · subagent 委派依赖这个身份
- **参数在计划期解析**：parseArguments 在建 PlannedCall 时执行 · 解析失败可以在分发前就报告 · 避免进入执行阶段才发现参数非法

### `runGroup` 的六条语义

`AL/tool-calls.ts:112-120` 的 JSDoc 一次列了六条：

| 语义 | 含义 |
|---|---|
| **启动前重新分类** | "Later calls are reclassified before start" |
| **独占重分类要等池排空** | "an exclusive reclassification waits for the current pool to drain and remains for the caller's next barrier" |
| **结果与上下文按模型顺序提交** | "Results and contexts commit in model order" —— **并行执行但顺序提交**，日志可预测 |
| **abort 停止新启动、排空已启动** | "Abort stops starts, drains and commits started calls" |
| **abort 也接受已启动调用的 context** | "accepts their contexts into the owning batch" |
| **调度器失败不提交合成结果** | "Scheduler failure drains dispatches without committing synthetic recovery results" |

💡 **"结果按模型顺序提交"是很重要的正确性保证**。工具并行执行完成的顺序不确定，但 `tool/result` 事件按模型发出 tool_call 的顺序 append。这样日志可复现、模型看到的顺序稳定。

💡 **`parseArguments`（`AL/tool-calls.ts:104`）容错设计**：

```ts
function parseArguments(raw: string): unknown {
  try { return raw ? JSON.parse(raw) : {} } catch { return raw }
}
```

JSON 解析失败**不抛错，而是把原始字符串当作参数传下去**。注释："preserving invalid JSON as text and mapping empty input to `{}`"。这样工具或 `pre-execute` gate 能给出有意义的错误，而不是在解析阶段就崩。

### 事件写入

| 函数 | 行号 | 作用 |
|---|---|---|
| `appendSkippedToolCall()` | 249 | abort 后为未执行的调用补记录 |
| `appendToolCall()` | 262 | append `tool/call`，返回 seq |
| `appendToolResult()` | 268 | append `tool/result`（带 `surfaceOp`） |

## 7.13 `ToolExecution` 的类型层级

`T/index.ts` 里有一组逐步收窄的类型：

![工具执行上下文的类型收窄](diagrams/07-tool-exec-types.svg)

**工具执行上下文的类型收窄** — [交互版](diagrams/07-tool-exec-types.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-tool-exec-types.architecture.json)

- **类型即权限**：wrapper 拿到的是 Dispatch 视图，只能改 signal · 工具本体拿到的是 RunContext，只能读 · 靠类型而非运行时检查约束改动范围
- **token 是执行凭据**：ToolExecution 上新增 token · 用于关联子调用与父调用 · Code Mode 的子调用靠它归属
- **parent 支持嵌套**：parent 是 ToolExecutionToken · 于是工具内部还能再发起工具调用 · rootCallId 始终指向最外层

💡 **`ToolDispatchExecution` 用 `Omit<..., 'signal'>` 表达"这一层不该看 signal"**——因为 `tools/execute` 的 wrapper 要自己提供 signal（§ 7.11 ②）。用类型阻止误用，而非靠文档约定。

## 7.14 `ToolRuntime`：注册表

> 📐 **配套可跑示例**：[`M01.4 · narrow-visible-set`](../../dsh-example/M01-tool-pipeline/scenes/04-narrow-visible-set.ts) 验证"展示 / 查找 / 执行三者对齐"——
> 被收紧掉的工具在 `schemas(scope)` 里消失，调用它直接得到 `unknown tool "write"`。


`T/index.ts:787`（1946 行文件里的主类），`extends Service` → `ctx.tools`。

| 方法 | 行号 | 说明 |
|---|---|---|
| **`register(definition)`** | **1037** | 返回 disposer（走 cordis effect） |
| **`schemas(scope?)`** | **1234** | **按作用域返回工具 schema** → 喂给 prompt 组装 |
| **`execute(exec)`** | **1342** | 执行一次调用（走三段 waterfall） |
| `executionMode(exec)` | **1276** | 返回 `ToolExecutionMode`（`:344`），决定并行/独占 |

配套的调度器接口：

| 类型 | 行号 |
|---|---|
| `ScheduledToolPreparation` | 431 |
| `ScheduledToolDispatch` | 441 |
| `ToolRuntimeScheduler` | 451（`prepare()` = `:453`，`dispatch()` = `:455`） |

💡 **`schemas(scope?)` 是"每个 agent 看到不同工具集"的实现点**。`scope` 是 `ScopeKey`；不传则返回全局。这与 [07 篇](07-request-pipeline-llm-tools-and-prompts.md) 的 prompt 组装直接相连——**工具 schema 是 system prompt 的一部分**。

## 7.15 Code Mode

`T/code-mode.ts`（673 行）+ `T/ts-types.ts`（293）+ `T/py-types.ts`（818）。

![Native 模式与 Code Mode](diagrams/07-code-mode.svg)

**Native 模式与 Code Mode** — [交互版](diagrams/07-code-mode.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-code-mode.architecture.json)

- **Code Mode 的收益**：一次请求内完成多步工具编排 · 中间结果不必回到模型再决策 · 显著减少往返次数
- **可观测性没有降低**：每个子调用都有独立的 CodeDispatchLog · 通过 tool/code-dispatch 事件落日志 · 于是审计与回放依然完整
- **类型是生成的**：T/ts-types.ts 为工具生成 TypeScript 类型 · 模型写代码时有准确签名可依 · 减少参数错误

💡 **`CodeRunFailedError` 与 `RUN_CODE_NAME` 从 `code-mode.ts` 导出**（`T/index.ts:104`）。

💡 **Code Mode 的意义**：一次模型调用能完成多步工具编排，减少往返。代价是**沙箱与审批变复杂**——代码里的每个子调用都要过 gate（`code-runtime` 组 3963 行 + `code-runtime-worker-thread`）。

💡 **`tool/code-dispatch` 的 waterfall 只改"持久日志副本"**（`T/index.ts:180` 附近注释）：模型看到的与日志记录的可以不同。典型用途是脱敏。

## 7.16 呈现方式：`presentation.ts`

`T/presentation.ts`（389 行）+ `P/core/agent-tool-presentation`（104 行）。

💡 **同一个工具可以有不同的"呈现"**：native tool_call、Code Mode 的 SDK 函数、或两者（`DSH_TOOLS_MODE=both`）。`presentation.ts` 负责这个映射，`agent-tool-presentation` 是选择策略的挂钩点。

## 7.17 21 个 `tool-*` 包

全仓 `tool-*` 包共 **21 个**（[02 § 2.2](02-codebase-map.md)）：

| 组 | 工具包 |
|---|---|
| `fs` | `tool-fs`、`tool-fs-search`、`tool-str-replace-editor` |
| `shell` | `tool-bash`、`tool-bash-persistent`、`tool-pwsh` |
| `terminal` | `tool-terminal` |
| `lsp` | `tool-lsp` |
| `web` | `tool-web` |
| `skill` | `tool-skill` |
| `todo` | `tool-todo` |
| `goal` | `tool-goal` |
| `jobs` | `tool-jobs` |
| `workflow` | `tool-workflow`、`tool-ralph` |
| `subagent` | `tool-subagent`、`tool-subagent-control`、`tool-subagent-report` |
| `session-query` | `tool-session-query` |
| `interaction` | `tool-ask-user` |
| `extensions` | `tool-cordis` |

💡 **`tool-ralph`（在 workflow 组）** 名字很特别——大概是某种循环/重试模式的工具（"Ralph" 是 agent 圈里对"反复跑直到完成"模式的一个称法）。

💡 **`tool-*` 包本身通常很小**——它们只是 `ctx.tools.register(...)` 的一层壳，真正的能力在同组的 provider 里（[03 篇](03-capability-seams-and-services.md)）。

---

> 📎 **以下承接原「09 SystemPrompt 组装」。**
> 本篇讲 `ctx.systemPrompt`（`P/core/system-prompt`，605 行）：分节注册与排序、作用域遮蔽、工具 schema 收集与排序、变量插值、`complete` 独占节、以及 `system-prompt/assemble` waterfall。
> 路径缩写：`P/` = `packages/`，`SP/` = `packages/core/system-prompt/src/`。行号对应快照 `fb2c4b9e`。

## 7.18 四种可注册的东西

> 📐 **配套可跑示例**：section → [M02.1 · 提示段](../../dsh-example/M02-context-assembly-economics/impl/01-prompt-section.ts)，
> variable + 整段 assemble → [M02.2 · 提示变量与装配](../../dsh-example/M02-context-assembly-economics/impl/02-prompt-variable-assemble.ts)。
> 注意真实占位语法是 `{{name}}`，插值发生在 `renderPrompt(assembly)` 而不是 `assemble()`；
> 引用未注册的变量、或 provider 返回 `undefined`，都会让 `renderPrompt` **抛错**。


`SystemPrompt`（`SP/index.ts:338`）是一个 cordis Service → `ctx.systemPrompt`。它接受四类注册：

![SystemPrompt 的四类注册](diagrams/07-system-prompt-registry.svg)

**SystemPrompt 的四类注册** — [交互版](diagrams/07-system-prompt-registry.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-system-prompt-registry.architecture.json)

- **四类的差异**：section 是静态文本，context 是每次求值的动态文本 · toolProvider 决定模型看到哪些工具 · variable 供模板里的占位使用
- **order 决定拼装顺序**：section 与 context 都带 order · 负数排在前面，用于身份类前置说明 · 同 order 时按注册顺序
- **注册都是可逆的**：每次注册返回 disposer · 插件卸载时对应分节自动消失 · 于是提示词随插件树变化

💡 **`section` 与 `context` 的区别**：`section` 是**静态的提示词**（persona、行为约束），`context` 是**每次请求都可能变的运行时快照**（当前时间、工作目录、tmux 状态）。二者在渲染时分开（`renderPrompt` vs `renderContextSnapshot`，§ 7.22），而且 `context` 可被整体抑制。

💡 **`text` 可以是函数**（`:67`、`:84`：`string | ((context: AssembleContext) => string)`）。函数形态在 assemble 时求值，拿到 `AssembleContext`。

## 7.19 `PromptSection` 的四个字段

`SP/index.ts:53-76`：

| 字段 | 行号 | 说明 |
|---|---|---|
| `readonly name: string` | 55 | 唯一名（同层内不可重复） |
| `readonly order: number` | 61 | 排序键；**必须有限**（非有限抛错） |
| `readonly text: string \| (ctx) => string` | 67 | 内容；注释说变量"interpolated later, by `renderPrompt`" |
| `readonly complete?: boolean` | 74 | **独占标记**（§ 7.23） |

💡 **`order` 的校验很严**（`SP/index.ts:382-384`）：

```ts
if (!Number.isFinite(section.order)) {
  throw new TypeError(`prompt section "${section.name}" order must be a finite number`)
}
```

**`Infinity` / `NaN` 都不允许**——因为排序结果会不确定。`context()` 有相同的检查。

## 7.20 两个内建 section

`SystemPrompt` 构造函数（`SP/index.ts:353-371`）自己注册两节：

![SystemPrompt 构造函数注册的默认分节](diagrams/07-prompt-constructor.svg)

**SystemPrompt 构造函数注册的默认分节** — [交互版](diagrams/07-prompt-constructor.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-prompt-constructor.architecture.json)

- **order 的分配有讲究**：身份分节 order 为 -100，永远最前 · persona 为 0，是用户定制的主位 · 业务分节用正数排在其后
- **三个开关**：includeHarnessIdentity 默认为真 · persona 默认为空字符串 · includeRuntimeContext 控制运行时信息是否注入
- **为什么在构造期注册**：保证任何 assemble 都至少有这三段 · 插件可以后续覆盖同名分节 · 也可以用 complete 完全接管

`Config`（`SP/index.ts:186`）的 schema（`:339-345`）：

| 字段 | 默认 |
|---|---|
| `includeHarnessIdentity: boolean` | `true` |
| `includeRuntimeContext: boolean` | `true` |
| `persona: string` | `''` |
| `toolOrder: string[]` | **`undefined`**（刻意保留"未设置"状态） |

💡 **`toolOrder` 的默认值写法很特别**（`:343-344`）：

```ts
// Preserve omission because an explicit empty order lacks the rest marker.
toolOrder: z.array(z.string()).default(undefined as unknown as string[]),
```

注释解释：**必须能区分"没设置"与"设置为空数组"**——因为空数组缺少 rest 标记（`TOOL_ORDER_REST`，§ 7.24）。用 `default(undefined as unknown as string[])` 这个类型体操绕过 schema 库的类型约束。

## 7.21 `assemble()`：组装的九步

`SP/index.ts:467-542`（76 行）。这是每个 step 都调的热路径（`AL/agent.ts:337` 的 `renderPrompt(assembly)` 之前）。

![assemble 的六步拼装](diagrams/07-assemble-pipeline.svg)

**assemble 的六步拼装** — [交互版](diagrams/07-assemble-pipeline.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-assemble-pipeline.architecture.json)

- **最远优先的含义**：变量求值从最外层作用域开始 · 越靠近当前作用域的定义越后写入 · 于是最近的定义胜出
- **遮蔽而非合并**：同名 section 由作用域项整体遮蔽全局项 · 不做文本级拼接 · 这让覆盖行为可预测
- **每个 step 都要跑一次**：因此这 76 行在热路径上 · 实现里避免了重复的深拷贝 · 变量求值按需触发

### 三个值得注意的实现细节

💡 **① 变量的"最远优先"遍历**（`:477-482` 注释）：

> Scope-chain variables, farthest first, so the nearest scope wins a name.

按链从远到近赋值，后写覆盖前写 → **最近的作用域生效**。

💡 **② `structuredClone(parameters)`**（`:497`）：工具参数 schema 被深拷贝。防止 assemble 的消费方（或 waterfall 监听器）改动 provider 持有的原对象。

💡 **③ `complete` 与 `runtimeContextSuppressed` 在 waterfall 之后强制**（`:536-541`）。这是"不可绕过的约束"设计：waterfall 监听器可以改 sections/contexts，但**不能违反独占与抑制语义**。

## 7.22 三个渲染函数

| 函数 | 行号 | 输出 |
|---|---|---|
| **`renderPrompt(assembly)`** | **212** | 完整的 system prompt 字符串（`AL/agent.ts:337` 调用） |
| `renderContextSnapshot(assembly)` | 224 | 只渲染 contexts 部分 |
| `renderContextSections(assembly)` | 251 | 返回 `ContextSnapshotSection[]`（结构化） |
| `joinContextSections(sections)` | 236 | 把结构化的拼成字符串 |

💡 **变量插值发生在 `renderPrompt`**（`SP/index.ts:65` 注释："interpolated later, by `renderPrompt`"）。所以 `{{model}}` / `{{cwd}}` 这类占位符在 section 注册时是原样保存的，渲染时才替换。

💡 **为什么 contexts 要单独有渲染函数**：运行时上下文可能需要在别处展示（UI 里的"当前环境"面板），或作为独立消息注入而非拼进 system prompt。

## 7.23 `complete`：独占节

![complete 让某个分节独占提示词](diagrams/07-complete-section.svg)

**complete 让某个分节独占提示词** — [交互版](diagrams/07-complete-section.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-complete-section.architecture.json)

- **三条分支的判定**：活跃的 complete 多于一个：抛错并列出冲突分节名 · 恰好一个：只保留它，其余 sections 全部丢弃 · 没有：按 order 正常拼装全部 sections
- **典型用途**：plan-mode 需要完全专用的提示词 · 某些 subagent driver 要精确控制提示 · 这些场景不适合与其它分节共存
- **冲突直接报错**：两个 complete 同时活跃时语义不明 · 因此不做优先级裁决，直接抛错 · 错误信息里点名冲突的分节

## 7.24 工具排序：`toolOrder` 与 `TOOL_ORDER_REST`

`orderTools(collected, this.toolOrder, knownNames)`（`:164` 定义，`:529` 调用）。

| 常量 | 行号 | 值 |
|---|---|---|
| `TOOL_ORDER_REST` | 140 | `'<unlisted-tools>'` |

![toolOrder 与 rest 锚点](diagrams/07-tool-order.svg)

**toolOrder 与 rest 锚点** — [交互版](diagrams/07-tool-order.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-tool-order.architecture.json)

- **rest 是必需的锚点**：它标记「其余工具放这里」 · 缺了它未列出的工具就没有位置 · 因此校验会要求它存在
- **空数组与未设置不等价**：未设置表示使用默认顺序 · 空数组缺少 rest 锚点，所有工具都没位置 · 所以默认值必须区分这两种情况
- **顺序会影响模型行为**：靠前的工具更容易被选用 · 把高频工具放前面通常更稳 · 但不应依赖顺序来表达约束

## 7.25 作用域分层：`ScopedLayers` 与 `PromptLayer`

`SP/index.ts:305-336`：

![PromptLayer 的五个容器](diagrams/07-prompt-layer.svg)

**PromptLayer 的五个容器** — [交互版](diagrams/07-prompt-layer.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-prompt-layer.architecture.json)

- **命名与匿名的选择**：需要按名字覆盖的用 NamedEntries · 只需累加的用 AnonymousEntries · suppressor 与 toolProvider 属于后者
- **容器来自 core/scope**：与 03 篇的三个可复用容器是同一套 · 因此天然支持分层与撤销 · 见 03 篇的 scope 容器一节
- **一层就是一个作用域**：全局是一层，每个 agent 是一层 · assemble 时沿链合并 · 近的层遮蔽远的层

💡 **`ScopedLayers` 来自 `P/core/scope`**（561 行，见 [03 篇](03-capability-seams-and-services.md)）。同一个原语被 `tools`、`system-prompt` 等多个 core 包复用——**"按 agent 作用域分层注册"是 DSH 的通用模式**。

💡 **注册方法用 `this.layers.effect(this.ctx, ...)`**（`:385-389`）：

```ts
return this.layers.effect(
  this.ctx,
  layer => layer.sections.insert(section.name, section),
  { label: 'systemPrompt.section()' },
)
```

`label` 会出现在 cordis 的 `EffectMeta` 里（[cordis 03 § 3.2](../hello-cordis/03-fiber-model.md)），调试时能看到"这个 effect 是谁登记的"。

## 7.26 `system-prompt/assemble` waterfall

> 📐 **配套可跑示例**：[`M02.2 · prompt-variable-assemble`](../../dsh-example/M02-context-assembly-economics/impl/02-prompt-variable-assemble.ts) 的钩子演示了正确的包装写法 ——
> 先 `await next()` 拿到下游装配体，再往 `sections` 里插一段，**不要**把装配体拍平成字符串：
>
> ```ts
> ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
>   const downstream = await next()
>   return { ...downstream, sections: [{ name: 'runtime-preamble', text: '…' }, ...downstream.sections] }
> })
> ```


`SP/index.ts:31`（在 `declare module '@deepseek-ai/cordis'` 里）：

```ts
'system-prompt/assemble'(this: Scoped<SystemPrompt>, assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>
```

💡 **`this` 是 `Scoped<SystemPrompt>`**，与 `tools/*` 一致（[07 § 7.11](07-request-pipeline-llm-tools-and-prompts.md)）——按 agent 作用域过滤。

💡 **它是"最后的改写机会"**，但受 § 7.21 ⑩ 的强制后处理约束。典型用户：`context` 组的四个包（`agent-instructions`、`session-reference`、`time-context`、`tmux-context`，共 10251 行）。

## 7.27 `context` 组：运行时上下文的四个来源

`packages/context/`（10251 行）：

| 包 | 作用 |
|---|---|
| `agent-instructions` | **项目级指令**（如仓库里的 `AGENTS.md`） |
| `session-reference` | 会话引用 |
| `time-context` | 当前时间 |
| `tmux-context` | tmux 会话状态 |

💡 **`agent-instructions` 很关键**：它把项目里的 `AGENTS.md` / `CLAUDE.md` 读进提示词。DSH 自己的仓库就有这两个文件（149 行，内容相同，[02 § 2.9](02-codebase-map.md)）——**DSH 用自己开发自己**。

💡 **`tmux-context` 的存在说明 DSH 设计时考虑了终端多路复用场景**——agent 能知道自己在哪个 tmux pane 里。

---

**上一篇** ← [06 Agent 循环与会话日志](06-agent-loop-and-session-log.md) ｜ **下一篇** → [08 执行侧服务：文件、Shell、沙箱、子代理、压缩](08-execution-services.md)：agent 真正"动手"的那几个 seam 与它们的 fail-closed 边界。
