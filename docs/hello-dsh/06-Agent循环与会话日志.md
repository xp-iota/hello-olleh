---
layout: content
title: "06 Agent 循环与会话日志"
parent_url: /docs/hello-deepseek-harness/
---

# 06 Agent 循环与会话日志

> **本篇回答**：一个 turn 到底怎么跑，以及跑出来的东西存在哪。前半逐行拆解 `ReactLoopAgent`（`AL/agent.ts`，496 行）——turn/step 语义、Phase 状态机、Inbox 的四种输入、9 个 `agent/*` 扩展点；后半是它的落点：追加式会话日志的 **Model-visible means logged** 不变量、`append()` 的四道防御、`surfaceOp` 有序表面、带缓存的消息投影与 `fork`。
> **路径缩写**：`P/` = `packages/`，`AL/` = `packages/core/agent-loop/src/`，`AG/` = `packages/core/agent/src/`，`S/` = `packages/core/session/src/`。行号对应快照 `47f94385`。
>
> 🧭 **本篇导览**：6.1–6.11 turn / step 主循环与 Inbox → 6.12–6.22 append-only Session 日志、surface、投影与 fork。
>
> 📎 **来源**：本篇合并自原 05 / 06 篇，章节已重新连续编号为 6.x。

## 6.1 turn 与 step 的定义

`docs/architecture.md` 的原话：

> A **step** is one model request plus the tools it calls. A **turn** is zero or more steps: it opens before its first input is claimed and closes once nothing is owed.

![turn 与 step 的边界](diagrams/06-turn-and-step.svg)

**turn 与 step 的边界** — [交互版](diagrams/06-turn-and-step.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-turn-and-step.architecture.json)

- **step 的定义**：一个 step 等于一次模型请求加它触发的工具执行 · 工具执行完若还需要模型继续，就再开一个 step · 因此 step 数由对话内容决定
- **turn 的结束条件**：没有 turnEnds 阻碍 · 且 inbox 的 nextStep 队列为空 · 两者同时满足才关闭
- **零 step 的 turn 有意义**：它把「被拒绝的尝试」也记进日志 · 便于审计谁在什么时候试图介入 · 不消耗任何模型配额

## 6.2 `Agent` 接口

`AG/runtime-types.ts:64-143`：

| 成员 | 行号 | 说明 |
|---|---|---|
| `readonly id: SessionId` | 66 | **Agent id 就是 SessionId** |
| `readonly options: AgentOptions` | 68 | |
| `readonly session: Session` | 70 | 它的事件日志 |
| `readonly inbox: Inbox` | 72 | 待处理输入 |
| `readonly status: AgentStatus` | 74 | `'idle' \| 'running'`（`:50`） |
| `readonly ctx: Context` | 76 | **每个 Agent 自己的 cordis Context**（见 [05 § 5.18](05-启动与Cordis落地.md)） |
| `cancel(cause, options?)` | 85 | |
| `whenIdle()` | 93 | 返回 Promise |
| **`send(message, target, wakeup)`** | **117** | 通用入口 |
| **`followup(message)`** | **124** | = `send(m, 'next-turn', true)` |
| **`steer(message)`** | **133** | = `send(m, 'next-step', true)` |
| **`inject(message)`** | **143** | = `send(m, 'next-step', false)` |

四种输入的差异（实现在 `AL/agent.ts:113-132`）：

![四种输入方式的差异](diagrams/06-four-inputs.svg)

**四种输入方式的差异** — [交互版](diagrams/06-four-inputs.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-four-inputs.architecture.json)

- **两个维度决定语义**：target 决定排到下一个 turn 还是下一个 step · wake 决定是否立即唤醒驱动器 · 四种组合覆盖了全部使用场景
- **steer 与 inject 的区别只在 wake**：steer 会立刻打断当前等待 · inject 只是排队，等自然轮到 · 后者适合程序化补充上下文
- **实现集中在 20 行内**：AL/agent.ts:113-132 · 三个方法都只是转调 send · 语义差异全部体现在两个参数上

💡 **`inject` 的"不唤醒"语义是设计要点**。`docs/architecture.md`：

> Input reaches the driver through one inbox. Some messages wake it immediately; injected context waits in the inbox until another message does.

即：注入的上下文**不会自己触发一次模型调用**，它等着下一次真正的输入把它一起带上。这避免了"每注入一条上下文就白跑一个 step"。

## 6.3 `Phase`：驱动的状态机

`AL/agent.ts:38-47`，是一个 discriminated union：

![Agent driver 的相位状态机](diagrams/06-driver-phase.svg)

**Agent driver 的相位状态机** — [交互版](diagrams/06-driver-phase.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-driver-phase.lifecycle.json)

- **status 只有两种对外取值**：idle 与 maintenance 都对外报 'idle' · 其余相位报 'running' · 见 AL/agent.ts:99 的 get status()
- **维护期的唤醒会被 latch 住**：维护中收到的唤醒请求记为 wakeRequested · 不立即打断维护任务 · 任务结束后若仍有 pending 才真正唤醒（AL/agent.ts:145-158） · 图上 maintenance 回 idle 的边未标注：方向即语义，条件见上三条
- **相位携带的上下文不同**：running 带 abort / turn / step / wakeRequested · maintenance 带 abort / lastTurn / wakeRequested · idle 只带 lastTurn，构造时从日志末个 turn/start 恢复

💡 **`status` 只有两个值**（`AgentStatus = 'idle' | 'running'`，`AG/runtime-types.ts:50`），但内部 Phase 有三种。`maintenance` 对外呈现为 `idle`——因为它不是模型工作。

💡 **`lastTurn` 从日志恢复**（`AL/agent.ts:92`）：

```ts
const lastTurn = session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0
```

**turn 计数不存额外状态，从 append-only 日志倒查**。这是"Model-visible means logged"不变量的直接体现（[06 篇](06-Agent循环与会话日志.md)）。

## 6.4 `turn()`：主循环

> 📐 **配套可跑示例**：[`06-agent-events-telemetry`](../../dsh-example/06-agent-events-telemetry/run.ts) 用真实 agent-loop 跑一个 turn，
> 把这里描述的边界事件逐条打印出来；实测序列是
> `turn/start → step/start → user/message → request/header → request/context → assistant/chunk* → assistant/message → step/end → turn/end`。


`AL/agent.ts:246-330`，85 行。

![turn() 的实现骨架](diagrams/06-turn-impl.svg)

**turn() 的实现骨架** — [交互版](diagrams/06-turn-impl.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-turn-impl.architecture.json)

- **全文只有 85 行**：源码范围 AL/agent.ts:246-330 · 主体是一个 while 循环 · 每轮对应一个 step
- **target 会在循环中变化**：首轮取 next-turn 队列 · 后续轮次改取 next-step 队列 · 这就是 steer 与 inject 能插入的位置
- **写日志失败即中止**：append turn/start 包在 try/catch 里 · 失败直接 throwError，不继续执行 · 因为无法重建的 turn 不允许存在

### 五个关键细节

💡 **① `turn/end` 一定会 append**（`finally` 块，`:317-323`）。注释：`// oxlint-disable-next-line typescript/no-non-null-assertion -- every exit assigns a turn ending`——每条退出路径都赋了 `turnEnds`，所以 `turnEnds!` 的非空断言是安全的。

💡 **② `TurnEndReason` 的六种**（从代码可见）：`completed`、`max-tokens`、`blocked`、`aborted`（带 cause）、`error`（带结构化 failure）。错误处理（`:308-314`）：

```ts
turnEnds = {
  kind: 'error',
  error: error instanceof LlmError
    ? error.failure                                    // ← LlmError 保留结构化事实
    : { message: errorChain(error), code: 'UNKNOWN' },  // ← 其它拍平成文本
}
```

💡 **③ `max-tokens` 的 sticky 语义**（`:288-290` 注释重复了两遍）：一旦任何 step 撞到上限，后续正常完成的 step **不能把 turn 的结果降级**。

💡 **④ 两次检查 `turnEnds && nextStep.length === 0`**（`:295` 与 `:299`）。中间夹着 `agent/turn-stopping` 的 serial 派发——**监听器可以在这个窗口里往 inbox 塞消息来延续 turn**。这是 `goal-round-driver`（`P/goal/goal-round-driver`）等"持续推进"插件的挂钩点。

💡 **⑤ 每个 turn 换新的 `AbortController`**（`:325-327`）：

```ts
phase.abort = new AbortController()
// A fresh controller makes a latch set on the old one stale: the live driver claims the queue itself.
phase.wakeRequested = false
```

新 controller 让旧 controller 上的 latch 失效——**活着的 driver 自己认领队列**，避免重复唤醒。

## 6.5 `preStep()`：决定模型看到什么

`AL/agent.ts:225-243`：

![preStep 的 claim 与 waterfall](diagrams/06-pre-step.svg)

**preStep 的 claim 与 waterfall** — [交互版](diagrams/06-pre-step.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-pre-step.architecture.json)

- **这是最有用的扩展点**：监听 agent/pre-step 可以拒绝、改写或补充消息 · 它在模型调用之前，成本最低 · 审批与准入类插件都挂在这里
- **claim 是破坏性的**：消息一旦被 claim 就从队列移除 · 即使随后被 reject 也不会退回 · 因此拒绝时要自行决定是否重新入队
- **decision 的两种 kind**：enter 表示继续，携带最终的 messages · reject 表示阻塞，turn 记为 blocked · 默认实现总是返回 enter

💡 **`agent/pre-step` 是全 DSH 最重要的扩展点之一**。`docs/architecture.md`：

> `agent/pre-step` decides what the model sees. Listeners may rewrite the claimed messages or reject them outright; a rejected or empty first claim still closes a durable turn that spent no step, so the log records the attempt.

典型用户：`compaction`（压缩上下文）、`plan-mode`（计划模式拦截）、`guard/repeat-tool-reminder`。

## 6.6 `step()`：一次模型请求

`AL/agent.ts:332-405`，74 行，含一个 retry 循环。

![step() 的请求构建与重试](diagrams/06-step-impl.svg)

**step() 的请求构建与重试** — [交互版](diagrams/06-step-impl.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-step-impl.architecture.json)

- **历史永远从日志投影**：不维护内存里的消息数组 · 每个 step 都调一次 deriveMessages() · 因此压缩与 fork 立即生效
- **preparedCall 的作用**：允许上游预先准备好一个流 · 用于 mock、录制回放或自定义传输 · 没有则回落到 ctx.llm.stream
- **chunkSeqs 记录来源**：每个流式 chunk 落日志后记下 seq · 最终 assistant/message 带上 sourceEventSeqs · 于是消息可追溯到原始分片

### 三个关键细节

💡 **① 每个 chunk 都进日志**（`:349`）。不是"攒完再存"——`assistant/chunk` 是持久 session 事件。`docs/architecture.md`：

> raw `assistant/chunk` events preserve replay and UI fidelity

代价是日志体积；收益是**回放与 UI 保真**。配套有 `P/core/session/src/chunk-rows.ts`（346 行）做 chunk 的行化处理，以及 `session-projection-cache` 包做投影缓存。

💡 **② `sourceEventSeqs: chunkSeqs`**（`:389`）把 `assistant/message` 和产生它的那批 chunk 关联起来。这让 UI 能"折叠"chunk 只显示最终消息，也让压缩时能安全丢弃 chunk 而保留 message。

💡 **③ `concluded` 的语义**（`:399`）：工具执行后返回 `concluded` 表示"这个 turn 可以结束了"（例如工具调了 `concludeTurn()`，`P/core/tools/src/index.ts:420`）；返回 `null` 表示"还欠一次模型请求"，turn 继续下一 step。

## 6.7 `buildRequest()`：组装请求

`AL/agent.ts:407-495`（89 行，最长的方法）。核心是**模型路由的解析顺序**。

| 步骤 | 说明 |
|---|---|
| 读 `session.requestHeader()` | 从日志取持久化的 header（`P/core/session/src/index.ts:670`） |
| `requestProposal()`（`AL/agent.ts:55`） | 若 `header.adapterDefaults === undefined` 用 `header.config`，否则以它为提案 |
| `dispatch.waterfall('agent/request', { turn, step, signal }, next)`（`:439`） | **给插件改写模型/参数的机会**，返回 `LlmCallConfig` |
| 绑定 `preparedCall` | 绑到解析出精确模型默认值的那个适配器注册 |

💡 **方法注释**（`:403-406`）：

> Compose one frozen request and bind it to the adapter registration that resolved its exact-model defaults.

以及（`:434-437`）：

> A loop instance starts from its declared route, restoring only an explicit effort owned by that exact model. Later steps re-resolve marked defaults.

即：**"显式设置"会跨 step 保留，"标记为默认"的会每步重新解析**。详见 [07 篇](07-请求管线-LLM工具与提示.md)。

## 6.8 9 个 `agent/*` 事件

> 📐 **配套可跑示例**：[`09-hooks-lifecycle-steering`](../../dsh-example/09-hooks-lifecycle-steering/index.ts) 在这 9 个事件里挑了 4 个挂监听器，
> 并验证 `agent/turn-stopping` 的 serial 语义：监听者调 `agent.steer(...)` 后主循环**重读 inbox**，真的多跑了一个 step。


全部声明在 `AG/runtime-types.ts` 的模块扩展里，`this` 类型统一是 `Scoped<Agent>`：

| 事件 | 行号 | 模式 | 用途 |
|---|---|---|---|
| `agent/created` | 159 | emit | Agent 创建（`AG/index.ts:561` 派发） |
| `agent/disposed` | 168 | emit | Agent 销毁（`AG/index.ts:529` 派发） |
| `agent/status` | 178 | emit | idle ↔ running（`AL/agent.ts:109`） |
| `agent/session-start` | 217 | emit | 带 `source: 'startup' \| 'resume' \| 'clear' \| 'compact'`（`AG/runtime-types.ts:61`） |
| **`agent/pre-step`** | **231** | **waterfall** | 决定模型看到什么（§ 6.5） |
| **`agent/request`** | **244** | **waterfall** | 改写 `LlmCallConfig`（§ 6.7） |
| **`agent/request-error`** | **260** | **waterfall** | 返回 `{ kind: 'retry' }` 可重试（§ 6.6） |
| **`agent/turn-stopping`** | **278** | **serial** | **没有 `next()`**；可往 inbox 塞消息延续 turn（§ 6.4 ④） |
| `agent/error` | 290 | emit | 未捕获错误（`AL/agent.ts:206`） |

另有 inbox 相关的 emit 事件（`AL/agent.ts:88-91` 注册 notifications）：`agent/inbox/inserted`、`agent/inbox/discarded`、`agent/inbox/claimed`。

💡 **`agent/turn-stopping` 是唯一的 serial**。`docs/architecture.md` 明确指出："`agent/turn-stopping` is serial and has no `next()`"。serial 的语义是"依次 await，首个非空返回值中断"（[cordis 06 § 6.1](../hello-cordis/06-事件系统与Waterfall.md)）。

💡 **`Scoped<Agent>` 作为 `this`** 让监听器能拿到"当前是哪个 Agent"，同时受 scope 隔离（[05 § 5.18](05-启动与Cordis落地.md)）。派发工具在 `AG/dispatch.ts`：`agentCarrier()`（`:94`）、`agentEvents()`（`:107`）、`emitAgentEvent()`（`:158`）、`assembleContextFor()`（`:174`）。

## 6.9 `Inbox`：两条有序队列

> 📐 **配套可跑示例**：[`19-agent-inbox`](../../dsh-example/19-agent-inbox/run.ts) 把四个入口各调一遍，
> 并把会话日志里的 `agent/inbox/spliced` 流水打出来 —— "谁在什么时候塞了什么"是可回放的。


`AG/inbox.ts`（220 行）。内部就是 `Record<InboxTarget, UserMessage[]>`（`:12`）。

| 方法 | 行号 | 说明 |
|---|---|---|
| `clear()` | 58 | |
| **`claim(target, turn)`** | **71** | 取出并清空该队列，通知 `claimed` |
| `append(target, message)` | 86 | 尾部追加 |
| `prepend(target, message)` | 96 | 头部插入 |
| `replace(messageId, newMessage)` | 109 | 按 id 替换 |
| `remove(messageId)` | 121 | 按 id 移除 |
| **`splice(target, start, deleteCount, inserted)`** | **139** | 通用变更 |

`InboxNotifications`（`:15-22`）三个回调：`inserted` / `discarded` / `claimed`，由 `ReactLoopAgent` 构造时接到 `agent/inbox/*` 事件（`AL/agent.ts:88-91`）。

💡 **inbox 的变更也是持久事件**。`AG/types.ts:12-27` 扩展了 `SessionEventMap`：

```ts
'agent/inbox/spliced': {
  target: InboxTarget
  start: number
  removedCount?: number
  inserted: UserMessage[]
  outcome?: 'canceled'
}
```

注释说明顺序保证："Live dispatch precedes projection mutation, so synchronous observers may read the pre-splice inbox to recover the removed messages."——**先派发事件、后改投影**，让同步观察者能读到变更前的状态。

## 6.10 `AgentRegistry` 与 `AgentFactory`

`AG/index.ts`（706 行）。

![AgentRegistry 的四组职责](diagrams/06-agent-registry.svg)

**AgentRegistry 的四组职责** — [交互版](diagrams/06-agent-registry.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-agent-registry.architecture.json)

- **setFactory 是最大的扩展点**：Agent 的构造完全由注册的工厂决定 · 换工厂即换掉 Agent 的全部行为 · 比替换 agentLoop 更彻底
- **enter 建立父子关系**：enter(agent, owner) 声明谁拥有这个 agent · subagent 就靠它挂到父 agent 下 · announce 用于向外广播新 agent
- **发起者追踪的用途**：记录当前操作是谁触发的 · 委派给 subagent 时要带上发起者身份 · requireInitiator 在缺失时直接报错

💡 **`ctx.agents` 与 `ctx.agentLoop` 分开是刻意的**：前者是接口 + 注册表（谁在跑），后者是驱动实现（怎么跑）。`dsh-base` 的 patch 里 `agent` 与 `agent-loop` 是两行（[05 § 5.11](05-启动与Cordis落地.md)），**换掉 `agent-loop` 那行就换掉整个主循环**。

## 6.11 `AgentLoop` 服务的配置

`AL/index.ts`（713 行）：

| 符号 | 行号 | 说明 |
|---|---|---|
| `INACTIVE_STATES` | 33 | 一组 `FiberState`，判定"不再接受新工作" |
| `raceAbort()` / `raceAbortCall()` | 93 / 109 | 把操作与 abort 信号竞速 |
| `resolveMaxParallelToolCalls()` | 133 | 默认 `DEFAULT_MAX_PARALLEL_TOOL_CALLS` |
| `assertAgentOptions()` | 142 | |
| `LauncherAgentIdentity` | 195 | |
| `CONFIGURED_AGENT_IDENTITIES_KEY` | 211 | |
| `applyLauncherIdentities()` | 221 | 用启动器提供的身份覆盖配置里的 agent |
| `AGENT_LOOP_SETTINGS_NAMESPACE` | 237 | `settingsNamespace('agent-loop')` |
| `AgentLoopSettings` / `AGENT_LOOP_SETTINGS_SCHEMA` | 244 / 250 | `maxParallelToolCalls` |
| `Config` | 255 | 插件配置 |
| `validateConfiguredAgents()` | 278 | **检查身份不重复**（`exactIdentities` Map） |
| **`class AgentLoop`** | **296** | `extends Service implements AgentFactory` |

💡 **`maxParallelToolCalls` 同时出现在插件 Config（`:301`）与 Settings（`:250`）里**，且 `:332` 有 `return source().maxParallelToolCalls`——**配置有两个来源，settings 可覆盖启动配置**。这是 DSH 里"配置分层"的一个缩影（详见 [09 篇](09-宿主与运行面-Web网关编排存储类型.md) 的 settings）。

💡 **`raceAbort` 的实现（`:93-107`）用 `Promise.withResolvers()`**——Node 22+ 的新 API，与 `engines` 要求的 `^22.19.0` 对得上。

---

> 📎 **以下承接原「06 会话日志 SessionEvent」。**
> 本篇讲 DSH 最核心的数据结构：append-only 事件日志。含 13 个核心事件、`surfaceOp` 的有序表面机制、`deriveMessages()` 的缓存投影、fork 语义、以及"Model-visible means logged"不变量怎么被强制。
> 路径缩写：`P/` = `packages/`，`S/` = `packages/core/session/src/`。行号对应快照 `47f94385`。

## 6.12 核心不变量：Model-visible means logged

> 📐 **配套可跑示例**：[`18-session-log`](../../dsh-example/18-session-log/run.ts) 逐条验证本节的不变量：
> seq 连续、事件深冻结（改写抛 `TypeError`）、`deriveMessages()` 只投影三类消息事件。


`docs/architecture.md` 的原话：

> **Model-visible means logged.** Anything that reaches a model request must be reconstructable from the log, and a runtime invariant asserts it. This is why a new model-visible input requires a new session event: extend `SessionEventMap` and render from the log.

![模型可见即必须落日志](diagrams/06-model-visible-logged.svg)

**模型可见即必须落日志** — [交互版](diagrams/06-model-visible-logged.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-model-visible-logged.architecture.json)

- **这是全仓最强的约束**：不是建议而是运行时断言 · 违反会直接抛错，不做降级 · 250 行不变量专门守这一条
- **扩展的正确姿势**：先在 SessionEventMap 里加事件类型 · 再实现从该事件渲染成 Message · 最后才在业务侧 append
- **为什么值得**：回放与 fork 不需要额外快照机制 · UI 显示的与模型看到的严格一致 · 压缩只需重写表面，不动日志

## 6.13 13 个核心事件

`SessionEventMap`（`S/types.ts:236`）是**可 merge 扩展的接口**——插件用 `declare module` 往里加。核心 13 个：

| 事件 | 行号 | 数据 | 是否上表面 |
|---|---|---|---|
| `turn/start` | 243 | `{ turn }` | — |
| `turn/end` | 252 | `{ turn, reason: TurnEndReason }` | — |
| `step/start` | 254 | `{ turn, step }` | — |
| `step/end` | 256 | `{ turn, step }` | — |
| **`user/message`** | **264** | `UserMessage` | ✅ |
| `assistant/chunk` | 266 | `{ turn, step, chunk: StreamChunk }` | — |
| **`assistant/message`** | **273** | `{ turn, step, message, usage? }` | ✅ |
| `tool/call` | 279 | `{ turn, step, callId, name, arguments }` | — |
| **`tool/result`** | **291** | （见 [07 篇](07-请求管线-LLM工具与提示.md)） | ✅ |
| `todo/write` | 299 | `{ todos: TodoItem[] }` | — |
| `request/header` | 304 | `{ header: EpochHeader, reason }` | — |
| `request/context` | 309 | `RequestContext` | — |
| `session/end-seed` | 332 | `Record<string, never>` | — |

插件扩展的例子：`agent/inbox/spliced`（`P/core/agent/src/types.ts:19`，见 [06 § 6.9](06-Agent循环与会话日志.md)）。

💡 **只有三种事件能上"表面"**（`SurfaceEventType`，`S/types.ts:343`）：`user/message`、`assistant/message`、`tool/result`。**这三种就是最终会变成 LLM message 的**。其余事件（turn/step 边界、chunk、tool/call、todo）是记录，不进模型历史。

💡 **`assistant/chunk` 与 `assistant/message` 并存**是刻意的冗余：chunk 保留流式保真度（回放/UI），message 是投影用的定稿。二者通过 `sourceEventSeqs` 关联（[06 § 6.6](06-Agent循环与会话日志.md)）。

## 6.14 `append()`：唯一的写入口

`S/index.ts:604-655`。这个方法的 JSDoc 有 30 余行，是全仓注释最密的地方之一。

![append 的类型技巧与三道校验](diagrams/06-append-contract.svg)

**append 的类型技巧与三道校验** — [交互版](diagrams/06-append-contract.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-append-contract.architecture.json)

- **条件类型做了什么**：opts 的类型按事件是否属于表面事件而变 · 表面事件时是 [opts: SurfaceIntent] · 否则是空元组，多传参数编译不过
- **三道校验都是 fail-closed**：不可序列化直接抛错，不做降级写入 · 请求头不受支持同样拒绝 · 保证日志永远可重放
- **避免空值进 JSON**：surfaceMetadata 按字段存在性拼装 · 这样日志里不会出现无意义的空字段 · 也让 diff 与压缩更干净

### 四个防御性设计

💡 **① 一次递归遍历同时做校验与拷贝**。JSDoc 明确说明动机：

> One recursive pass reads, validates, and copies each nested value once, so a stateful getter cannot supply one value to validation and another to storage.

即：**防止"有状态的 getter"在校验时返回一个值、存储时返回另一个值**。这是对 TOCTOU（check-then-use）类问题的防御。

💡 **② 失败点在 append 处而非后续 flush**：

> The event log is the durable source of truth, so a bad event fails at the append site rather than later during a backend flush.

💡 **③ 重入禁止**（`:623-626`）。如果 `session/event` 的监听器里又调 `append`，会抛错。这保证了日志顺序与事件派发顺序严格一致。

💡 **④ 先收集回调、后改日志、再调回调**（`:637-646`）。这个顺序让**同步观察者在被调用时看到的是"已包含新事件"的日志**，但回调列表是在改日志之前确定的（避免回调内注册新监听器影响本次派发）。

## 6.15 `surfaceOp`：有序表面

> 📐 **配套可跑示例**：[`18-session-log`](../../dsh-example/18-session-log/run.ts) 用真实 `replace` 折叠了两个节点并打印
> "模型现在看到的第一条"；两条 fail-closed 校验的抛错原文也在输出里：
>
> ```text
> surface replace: start seq 999 not found in surface
> surface replace: sourceEventSeqs must include every shadowed surface node; missing 16
> ```


这是 DSH 处理"上下文压缩"的关键机制。

![SurfaceOp 的两种形态与表面的作用](diagrams/06-surface-ops.svg)

**SurfaceOp 的两种形态与表面的作用** — [交互版](diagrams/06-surface-ops.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-surface-ops.architecture.json)

- **日志与表面分离**：日志只追加，是唯一事实来源 · 表面是可重写的投影视图 · 压缩只改表面，历史不丢
- **replace 的三条约束**：start 与 end 必须都在当前表面上 · start 等于 end 时替换单个节点 · sourceEventSeqs 必须包含全部被遮蔽节点
- **不只压缩能用**：任何表面替换型生产者都可用 replace · 例如把多条工具输出合并成一条摘要 · 语义由生产者自己定义

相关类型：

| 类型 | 行号 | 说明 |
|---|---|---|
| `SurfaceEventType` | `S/types.ts:343` | `'user/message' \| 'assistant/message' \| 'tool/result'` |
| `SurfaceEvent` | `S/types.ts:357` | `SessionEvent<SurfaceEventType> & { surfaceOp: SurfaceOp }` |
| `SurfaceOp` | `S/types.ts:372` | 见上 |
| `SurfaceIntent` | `S/types.ts:380` | `{ surfaceOp, sourceEventSeqs? }` |

💡 **`sourceEventSeqs` 的语义有细微差别**（`S/types.ts:383-388` 注释）：
- `assistant/message` **可以**是"存在但为空数组"——表示已知的空 provider 流
- 字段**缺失**表示"本事件不记录是哪些更早事件产生了它"
- 其它表面事件若带这个字段，**必须非空**

## 6.16 `deriveMessages()`：带缓存的投影

`S/index.ts:726-747`。这是每个 step 都要调的热路径（[06 § 6.6](06-Agent循环与会话日志.md)）。

![deriveMessages 的增量投影与缓存](diagrams/06-derive-messages.svg)

**deriveMessages 的增量投影与缓存** — [交互版](diagrams/06-derive-messages.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-derive-messages.architecture.json)

- **代号是失效信号**：表面每次被 replace 就递增 replaceGeneration · 投影缓存记下自己算的是哪一代 · 代号不匹配即全部重算
- **常态是增量**：普通 append 不改代号 · 于是只需处理新增的表面节点 · 这让每 step 一次调用的开销可接受
- **为什么不能只增量**：replace 会遮蔽已投影过的节点 · 增量无法回退已产出的消息 · 因此压缩后必须整体重建

💡 **三条性能与安全承诺**（JSDoc `:718-724`）：

| 承诺 | 实现 |
|---|---|
| **每个表面节点只投影一次** | `derivedNodes` 游标；一次调用成本 O(新节点数) |
| **返回的数组是每次调用的新快照** | `[...this.derived]` —— 后续 append 不会"长大"调用方已持有的数组 |
| **数组里的 `Message` 对象是共享且深冻结的** | 内容复用已冻结的持久事件数据，**不做第二次深拷贝**，消费方也无法改日志 |

💡 **`replaceGeneration` 是压缩的代价**：一次 `replace` 让整个投影缓存失效重建。但压缩本身是低频操作，可接受。

💡 **为什么空内容的 `assistant/message` 要跳过**（`:740-742` 注释）：max-tokens 的那一步可能只带 `usage` 而没有内容，它不能进 transcript。

💡 **上游注释里有一处笔误**：`:740` 写的是 "A surface node is one of the **five** message-producing types"，但 `SurfaceEventType`（`S/types.ts:343`）只有**三种**，`deriveEventMessage`（`S/surface.ts:96`/`:99`/`:106`）也只有三个 `case`。注释与实现不一致，实现为准。

## 6.17 `Session` 类

`S/index.ts:425`（1157 行文件里的主类）。

| 成员 | 行号 | 说明 |
|---|---|---|
| `get surface(): SessionSurface` | 431 | 有序表面（实现在 `S/surface.ts`，460 行） |
| `readonly header: SessionHeader` | 443 | |
| `get id(): SessionId` | 446 | |
| `readonly firstLiveSeq: number` | 472 | **第一个"活"事件的 seq**（seed 之后） |
| `get events(): readonly SessionEvent[]` | 559 | 带 `eventsSnapshot` 缓存 |
| `get seq(): number` | 565 | 下一个 seq |
| **`append()`** | **604** | § 6.14 |
| `requestHeader(): EpochHeader \| undefined` | 670 | 折叠 `request/header` 事件（带 `headerFold` 缓存，`:658-660`） |
| `requestContext(): RequestContext \| undefined` | 691 | |
| **`deriveMessages()`** | **726** | § 6.16 |
| `deriveEventMessage(event)` | 755 | 单事件投影（纯函数在 `surface.ts`） |

辅助导出：

| 符号 | 行号 | 说明 |
|---|---|---|
| `adoptSessionEvent()` | 167 | 接纳外部事件（校验形状） |
| `snapshotSessionEvent()` | 192 | 快照 |
| `assertMessageEventShape()` | — | 在 `:168`、`:276` 被调用 |
| `SessionForkError` | 779 | 带 `SessionForkErrorCode` |

💡 **`firstLiveSeq`（`:472`）区分 seed 与 live**。会话可以带"种子事件"（`CreateAgentOptions.seed`，`P/core/agent/src/index.ts:109`）——例如 fork 时把父会话的历史作为种子。`firstLiveSeq` 之前的是种子，之后是本会话真正产生的。

## 6.18 `SessionStore`：会话的注册表

`S/index.ts:792`，是一个 cordis Service → `ctx.sessions`。

| 方法 | 行号 | 说明 |
|---|---|---|
| `create(id?, options?)` | 830 | 新建 |
| `prepare(id?, options?)` | 863 | 预备（尚未 enter） |
| `enter(session)` | 913 | 进入活动状态，返回 disposer |
| `announce(session)` | 968 | 广播 |
| `get(id)` | 1055 | |
| `list()` | 1063 | |
| **`fork(source, boundary?, childSessionId?)`** | **1081** | |

💡 **`prepare` / `enter` / `announce` 三段式**对应 cordis 的生命周期习惯：先构造（不可见）→ 进入（注册 effect）→ 广播（通知观察者）。`enter` 返回 disposer，所以**会话的存在本身是一个可逆效应**（[cordis 03 § 3.2](../hello-cordis/03-Fiber模型.md)）。

💡 **`SessionAttachment`（`S/index.ts:403-411`）** 是 session 与 ctx 的绑定：`{ id, session, carrier: Scoped<Session>, emitCtx, detach() }`。`append` 里用的 `attachments.get(this)` 取的就是它。**未 attach 的 session 也能 append，只是不派发事件**（`entry === undefined` 的分支）。

## 6.19 `fork()`：分叉会话

> 📐 **配套可跑示例**：[`18-session-log`](../../dsh-example/18-session-log/run.ts) 第 ⑥ 节演示 fork 的稳定前缀要求 ——
> 边界落在未闭合的 turn 里会抛 `SessionForkError { code: 'OPEN_TURN' }`。


`docs/architecture.md` 的映射表里有一条："Fork a live session → `ctx.sessions.fork(source, boundary?, childSessionId?)`"。

![session.fork 的参数与语义](diagrams/06-session-fork.svg)

**session.fork 的参数与语义** — [交互版](diagrams/06-session-fork.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-session-fork.architecture.json)

- **fork 是官方支持的分叉**：docs/architecture.md 的映射表里专门列了它 · subagent-fork-in-process 直接用它 · 不需要复制文件或手工裁剪日志
- **种子与活跃区分开**：[0, boundary) 的事件成为不可变种子 · firstLiveSeq 之后才是子会话自己的事件 · 于是父子共享历史但互不影响
- **source 可以只给 id**：不必先把父会话加载进内存 · store 会按需读取 · 便于对归档会话做分叉

## 6.20 `session` 组的 13 个子包

`core/session` 只管**内存里的日志与投影**。持久化、遥测、标题等全在 `packages/session/` 组（21442 行）：

![持久化与投影是两个独立 seam](diagrams/06-persistence-seam.svg)

**持久化与投影是两个独立 seam** — [交互版](diagrams/06-persistence-seam.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-persistence-seam.architecture.json)

- **三层职责分明**：core/session 只维护内存日志与投影 · persistence seam 负责落盘 · checkpoint policy 决定落盘时机
- **JSONL 与日志模型天然契合**：每行一个事件，追加即写 · 崩溃后按行恢复，无需事务 · SQLite provider 适合需要查询的场景
- **策略独立成包的好处**：改落盘频率不需要动 provider · 也不需要动 core/session · 是 capability 事件解耦的又一例

💡 **`session-title` 有三个 provider**（fallback + 首 prompt LLM + 全 prompt LLM），且 `docs/architecture.md` 特别说明："Generate session titles → register the sole `ctx.sessionTitle` provider"——**唯一 provider**。这是 seam 的一种变体：定义方允许零个或一个 provider，不允许多个。

💡 **JSONL 是天然匹配 append-only 日志的格式**（每行一个 JSON）。它的实现（1939 行）比 SQLite（714 行）大——因为要处理文件轮转、损坏修复（对应 `S/repair.ts`，133 行）等。

## 6.21 `session-query` 组：查询与导出

单独一个组（12283 行）：

| 包 | 作用 |
|---|---|
| `session-query` | 查询服务定义 |
| `session-query-sqlite` | SQLite 全文索引 provider |
| `session-log-export` | 导出会话日志 |
| `tool-session-query` | **让模型能查历史会话的工具** |

💡 **`web-app` bundle 里 `session-query-sqlite` 的配置是 `{ path: ':memory:', openAt: 'never' }`**（[05 § 5.3](05-启动与Cordis落地.md)）——全文搜索默认关闭。注释说明部署方可以把 `openAt` 覆盖为 `'first-search'`，**把 `node:sqlite` 的 import 与内存句柄延迟到首次搜索**，让 Node 22 的启动保持安静。

## 6.22 `S/` 逐文件

| 文件 | 行数 | 职责 |
|---|---|---|
| **`index.ts`** | **1157** | `Session` + `SessionStore` |
| `surface.ts` | 460 | `SessionSurface` + `deriveEventMessage` + `isSurfaceEvent` |
| `types.ts` | 436 | `SessionEventMap`、`SurfaceOp`、`SessionEvent` |
| `chunk-rows.ts` | 346 | chunk 的行化（注释说这类事件"never enter `Session.events`"，用裸结构） |
| **`invariant.ts`** | **250** | 运行时不变量（全仓最厚） |
| `json.ts` | 190 | `snapshotJsonValue` / `deepFreeze` 等 |
| `repair.ts` | 133 | 日志损坏修复 |
| `request-header.ts` | 71 | `EpochHeader` 相关 |
| `known-event-types.ts` | 64 | **本仓库声明的每个 `SessionEventMap` 成员的清单** |
| `preparation.ts` | 49 | |

💡 **`known-event-types.ts`（64 行）的存在很说明问题**：`SessionEventMap` 是可 merge 扩展的接口，编译期无法枚举。这个文件手工维护一份"本仓库已知的事件类型"清单，供运行时校验与工具使用。**这是 TypeScript 声明合并的一个已知代价**。

---

**上一篇** ← [05 启动流程与 Cordis 落地](05-启动与Cordis落地.md) ｜ **下一篇** → [07 请求管线：LLM、工具与 SystemPrompt](07-请求管线-LLM工具与提示.md)：一次模型请求怎么被组装、发出、收回。
