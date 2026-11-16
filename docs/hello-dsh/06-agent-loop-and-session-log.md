---
title: "Agent 循环与会话日志"
---
# Agent 循环与会话日志

> **本篇回答**：一个 turn 到底怎么跑，以及跑出来的东西存在哪。前半逐行拆解 `ReactLoopAgent`（`AL/agent.ts`，751 行）——turn/step 语义、Phase 状态机、Inbox 的四种输入、12 个 `agent/*` 扩展点；后半是它的落点：追加式会话日志的 **Model-visible means logged** 不变量、`append()` 的四道防御、`surfaceOp` 有序表面、带缓存的消息投影与 `fork`，以及 rc.3 的两层流式记账（`assistant/attempt`）与会话格式 v0→v4 迁移链。
> **路径缩写**：`P/` = `packages/`，`AL/` = `packages/core/agent-loop/src/`，`AG/` = `packages/core/agent/src/`，`S/` = `packages/core/session/src/`。行号对应快照 `38a6a5c9`（tag `dsh-v0.2.2-rc.3`）。
>
> 🧭 **本篇导览**：6.1–6.11 turn / step 主循环与 Inbox → 6.12–6.22 append-only Session 日志、surface、投影与 fork。
>

## 6.1 turn 与 step 的定义

`docs/architecture.md` 的原话：

> A **step** is one model request plus the tools it calls. A **turn** is zero or more steps: it opens before its first input is claimed and closes once nothing is owed.

![turn 与 step 的边界](diagrams/06-turn-and-step.svg)

**turn 与 step 的边界** — [交互版](diagrams/06-turn-and-step.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-turn-and-step.architecture.json)

- **step 的定义**：一个 step 等于一次模型请求加它触发的工具执行 · 工具执行完若还需要模型继续，就再开一个 step · 因此 step 数由对话内容决定
- **turn 的结束条件**：没有 turnEnds 阻碍 · 且 inbox 的 nextStep 队列为空 · 两者同时满足才关闭
- **零 step 的 turn 有意义**：它把「被拒绝的尝试」也记进日志 · 便于审计谁在什么时候试图介入 · 不消耗任何模型配额

## 6.2 `Agent` 接口

基面在 `AG/types.ts:16-19`——只有 `readonly id: SessionId`（`:18`）。运行期能力全部在 `AG/runtime-types.ts:190-273` 的模块增强里：

| 成员 | 行号 | 说明 |
|---|---|---|
| `readonly options: AgentOptions` | 193 | 路由回退与输出控制 |
| `readonly session: Session` | 195 | 它的事件日志 |
| `readonly model: Model` | 197 | **rc.3 新增**：Agent 拥有的持久模型选择（`AG/model-selection.ts`） |
| `readonly inbox: Inbox` | 199 | 待处理输入 |
| `readonly status: AgentStatus` | 201 | `'idle' \| 'running'`（`:136`） |
| `readonly ctx: Context` | 203 | **每个 Agent 自己的 cordis Context**（见 [05 § 5.18](05-startup-and-cordis-runtime.md)） |
| `cancel(cause, options?)` | 213 | |
| `whenIdle()` | 221 | 返回 Promise |
| `runMaintenance(task)` | 232 | **rc.3 新增**：真 idle 相位上跑一次维护任务 |
| **`send(message, target, wakeup)`** | **245** | 通用入口 |
| **`followup(message)`** | **252** | = `send(m, 'next-turn', true)` |
| **`steer(message)`** | **261** | = `send(m, 'next-step', true)` |
| **`inject(message)`** | **271** | = `send(m, 'next-step', false)` |

四种输入的差异（实现在 `AL/agent.ts:171-189`）：

![四种输入方式的差异](diagrams/06-four-inputs.svg)

**四种输入方式的差异** — [交互版](diagrams/06-four-inputs.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-four-inputs.architecture.json)

- **两个维度决定语义**：target 决定排到下一个 turn 还是下一个 step · wake 决定是否立即唤醒驱动器 · 四种组合覆盖了全部使用场景
- **steer 与 inject 的区别只在 wake**：steer 会立刻打断当前等待 · inject 只是排队，等自然轮到 · 后者适合程序化补充上下文
- **实现集中在 19 行内**：AL/agent.ts:171-189 · 三个方法都只是转调 send · 语义差异全部体现在两个参数上

💡 **`inject` 的"不唤醒"语义是设计要点**。`docs/architecture.md`：

> One inbox feeds the driver; injected context waits for a waking message. AgentLoop's durable `inbox` projection exposes pending input without live Agents.

即：注入的上下文**不会自己触发一次模型调用**，它等着下一次真正的输入把它一起带上。这避免了"每注入一条上下文就白跑一个 step"。

## 6.3 `Phase`：驱动的状态机

`AL/agent.ts:53-61`，是一个 discriminated union：

![Agent driver 的相位状态机](diagrams/06-driver-phase.svg)

**Agent driver 的相位状态机** — [交互版](diagrams/06-driver-phase.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-driver-phase.lifecycle.json)

- **status 只有两种对外取值**：idle 与 maintenance 都对外报 'idle' · 其余相位报 'running' · 见 AL/agent.ts:157 的 get status()
- **维护期的唤醒会被 latch 住**：维护中收到的唤醒请求记为 wakeRequested · 不立即打断维护任务 · 任务结束后若仍有 pending 才真正唤醒（AL/agent.ts:204-221） · 图上 maintenance 回 idle 的边未标注：方向即语义，条件见上三条
- **相位携带的上下文不同**：running 带 abort / turn / step / wakeRequested · maintenance 带 abort / lastTurn / wakeRequested · idle 只带 lastTurn，由 AgentRegistry 的 turn/step 投影恢复（AL/index.ts:568）

💡 **`status` 只有两个值**（`AgentStatus = 'idle' | 'running'`，`AG/runtime-types.ts:136`），但内部 Phase 有三种。`maintenance` 对外呈现为 `idle`——因为它不是模型工作。

💡 **`lastTurn` 从注册表的投影恢复**（`AL/agent.ts:152` 的 `this.phase = { kind: 'idle', lastTurn }`）。驱动构造时传入的 `lastTurn` 来自 `loopCtx.agents.turnBoundaryOf(session).lastTurn`（`AL/index.ts:568`；`turnBoundaryOf` 在 `AG/index.ts:300`）——而那个投影只是 **Session 的 turn/step 事件的共享纯折叠**（`AG/projection.ts` 开头一句："Shared pure fold of the Session's turn and step events."）。**turn 计数不存额外状态，仍从 append-only 日志折叠**。这是"Model-visible means logged"不变量的直接体现（[06 篇](06-agent-loop-and-session-log.md)）。

## 6.4 `turn()`：主循环

> 📐 **配套可跑示例**：[`M04.1 · 观察 turn / step 边界`](../../dsh-lab/M04-agent-loop-intervention/index.ts) 用真实 agent-loop 跑一个 turn，
> 把 `turn/start → step/start → step/end → turn/end` 四个**边界**事件逐条打印出来。
> 缺 `LLM_API_KEY` 时该阶段会退化成"只验证事件订阅通道在位"，并把跳过原因打印出来。


`AL/agent.ts:333-438`，约 106 行；外层驱动是 `kick()` 里的 `while (await this.turn()) {}`（`:276`）。

![turn() 的实现骨架](diagrams/06-turn-impl.svg)

**turn() 的实现骨架** — [交互版](diagrams/06-turn-impl.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-turn-impl.architecture.json)

- **主体是一个 while 循环**：源码范围 AL/agent.ts:333-438 · 每轮对应一个 step · 失败在驱动边界被收纳（kick 的 catch 注释："Reported failures and cancellation are contained at the driver boundary"）
- **target 会在循环中变化**：首轮取 next-turn 队列 · 后续轮次改取 next-step 队列 · 这就是 steer 与 inject 能插入的位置
- **写日志失败即中止**：append turn/start 包在 try/catch 里 · 失败直接 throwError，不继续执行 · 因为无法重建的 turn 不允许存在

### 五个关键细节

💡 **① `turn/end` 一定会 append**（`finally` 块，`:426-431`）。注释：`// oxlint-disable-next-line typescript/no-non-null-assertion -- every exit assigns a turn ending`——每条退出路径都赋了 `turnEnds`，所以 `turnEnds!` 的非空断言是安全的。

💡 **② `TurnEndReason` 是 merge 可扩展的和类型**（`S/types.ts:205-236`）。loop 在线发五种：`completed`、`max-tokens`（StepEndReason，`:63`）、`blocked`（`:355`）、`aborted`（`:412`，带 cause）、`error`（`:418-421`）；另有 `interrupted`（崩溃孤儿 turn 事后闭合，由 agent-loop resume / session-query 合成）与 `forked`（fork 种子在边界闭合开着的 turn，由 `buildForkSeed` 合成）——**loop 从不在线上发这两种**（`S/types.ts:226-235` 注释）。错误处理（`:417-421`）：

```ts
turnEnds = {
  kind: 'error',
  error: error instanceof LlmError
    ? error.failure                                    // ← LlmError 保留结构化事实
    : { message: errorChain(error), code: error instanceof ToolActivationError ? error.code : 'UNKNOWN' },  // ← 其它拍平成文本
}
```

💡 **③ `max-tokens` 的 sticky 语义**（`:377-381` 注释重复了两遍）：一旦任何 step 撞到上限，后续正常完成的 step **不能把 turn 的结果降级**。

💡 **④ 两次检查 `turnEnds && this.inbox.nextStep.length === 0`**（`:401` 与 `:404`）。中间夹着 `agent/turn-stopping` 的 serial 派发（`:402`）——**监听器可以在这个窗口里往 inbox 塞消息来延续 turn**。这是"持续推进"类插件的挂钩窗口；不过 rc.3 的 `goal-round-driver` 已改挂 `agent/inbox/*` 与 `agent/pre-step`（`P/goal/goal-round-driver/src/index.ts:315/:387`），**不再监听 turn-stopping**。

💡 **⑤ 每个 turn 换新的 `AbortController`**（`:434-437`）：

```ts
phase.abort = new AbortController()
// A fresh controller makes a latch set on the old one stale: the live driver claims the queue itself.
phase.wakeRequested = false
phase.step = 0
```

新 controller 让旧 controller 上的 latch 失效——**活着的 driver 自己认领队列**，避免重复唤醒。

## 6.5 `preStep()`：决定模型看到什么

`AL/agent.ts:289-331`：

![preStep 的 claim 与 waterfall](diagrams/06-pre-step.svg)

**preStep 的 claim 与 waterfall** — [交互版](diagrams/06-pre-step.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-pre-step.architecture.json)

- **这是最有用的扩展点**：监听 agent/pre-step 可以拒绝、改写或补充消息 · 它在模型调用之前，成本最低 · 审批与准入类插件都挂在这里
- **claim 是破坏性的**：消息一旦被 claim 就从队列移除 · 即使随后被 reject 也不会退回 · 因此拒绝时要自行决定是否重新入队
- **decision 的两种 kind**：enter 表示继续，携带最终的 messages（可带 startsRequestSeries）· reject 表示阻塞，turn 记为 blocked · 默认实现总是返回 enter

💡 **`agent/pre-step` 是全 DSH 最重要的扩展点之一**。`docs/architecture.md`：

> `agent/pre-step` listeners accept, rewrite, or reject claimed messages; a rejected or empty first claim closes a durable turn without a step.

💡 **rc.3 给 pre-step 增加了模型选择快照**：payload 现在带 `modelSelection: Readonly<ModelSelection>`（`AG/runtime-types.ts:351`）。preStep 先经 `this.model.current()` 取持久选择（没有就抛错，`:296`），再用它解析工具集（`tools.resolve`，`:300`）与组装 prompt（`:302`），waterfall 的默认 next 由组装结果生成运行时上下文消息（`:302-313`）。`docs/architecture.md`："Before assembly, the loop snapshots Session model selection in `AssembleContext.modelSelection` and `agent/pre-step.modelSelection`; retries retain it"——**重试不重复装配、不重复 pre-step**。

典型用户：`compaction`（压缩上下文）、`plan-mode`（计划模式拦截）、`guard/repeat-tool-reminder`、`goal-round-driver`（续跑轮次，`:387`）。

## 6.6 `step()`：一次模型请求

`AL/agent.ts:441-617`，177 行，含一个 retry 循环。

![step() 的请求构建与重试](diagrams/06-step-impl.svg)

**step() 的请求构建与重试** — [交互版](diagrams/06-step-impl.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-step-impl.architecture.json)

- **历史永远从日志投影**：不维护内存里的消息数组 · buildRequest 调 deriveMessages() 取边界消息并整体冻结（:734-741）· 因此压缩与 fork 立即生效
- **preparedCall 的作用**：允许上游预先准备好一个流 · 用于 mock、录制回放或自定义传输 · 没有则回落到 ctx.llm.stream（:496）
- **流式记账是两层的**：chunk 先在内存聚合成紧凑流 · 结束时一次性落账：assistant/message 内嵌整段流，没有产生消息的尝试落一条 assistant/attempt

### 流式记账的新形态（rc.3 整体重写了 0.1.5 的 chunk 逐条落账）

![流式记账的两层结构（rc.3）](diagrams/06-stream-accounting.svg)

**流式记账的两层结构（rc.3）** — [交互版](diagrams/06-stream-accounting.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-stream-accounting.architecture.json)

- **两层各管什么**：实时层：agent/assistant-stream，供 UI · 持久层：assistant/attempt，供回放 · 聚合发生在内存，不产生 chunk 日志
- **为什么改**：逐 chunk append 让日志爆炸 · 一次落账保住"Model-visible means logged" · replayState 随流快照一起保存
- **兼容性提醒**：0.1.5 的 assistant/chunk 已删除 · 旧快照需经 v0→v4 迁移链 · chunk-rows.ts 不再存在

| 层 | 载体 | 位置 |
|---|---|---|
| **实时层**（进程内，不落盘） | `AssistantStreamFrame`：start / chunk / end 三种帧，经 `agent/assistant-stream` emit | 帧类型 `AG/runtime-types.ts:156-188`；emit 回调注入点 `AL/agent.ts:492`；发布者 `AL/assistant-stream.ts` 的 `start()/push()/settle()/abandon()`（:49/:60/:78/:100） |
| **持久层**（一次落账） | chunk 经 `AssistantStreamAccumulator` 在内存聚合成紧凑的 `AssistantStreamRecord[]`；settlement 时**一条**持久事件携带整段流 | `AL/assistant-stream.ts:60-71`（push 同时喂聚合与实时）、`:78-97`（settle：先落账拿 seq，再发 committed 终帧）、`:112-114`（stream getter） |

落账点（`AL/agent.ts`）：

- **成功**：`assistant/message` 带 `stream: live.stream`（`:566-575`）；
- **turn 中途被打断且已有可见前缀**：仍是 `assistant/message`，带 `interrupted: true`（`:521-539`）——"An aborted turn with no such event streamed no visible content"（`S/types.ts:349-361` 注释）；
- **失败 / 中止且没有可见内容**：`assistant/attempt` 只带 `{ turn, step, stream }`（`:528-535`、`:551-552`）——"one model attempt that committed no surface message"（`S/types.ts:363-365`）；
- **落账本身被拒**：`live.abandon()` 发 abandoned 终帧，两层都不留持久痕迹（`AL/assistant-stream.ts:100-109`）。

`docs/architecture.md`（:108）：

> `agent/assistant-stream` publishes process-local start, transient chunk, and end frames. The loop commits the complete compact stream as one message or log-only attempt before a committed end frame.

收益对照 0.1.5：日志不再按 chunk 逐条膨胀（`P/core/session/src/chunk-rows.ts` 及其 346 行行化代码已删除），**回放与 UI 保真**由内嵌流保住——UI 消费实时帧，回放消费持久流。聚合器在 `P/llm/llm/src/assistant-stream.ts`（534 行）。

### 另外两个关键细节

💡 **② `assistant/message` 不再引用来源事件**：`sourceEventSeqs` 对它是 `never`（`S/types.ts:480-482`，注释："Assistant messages embed their provider stream instead of citing source events"）。溯源信息改在 `message.source` 里：provider / model / **`replayState`**（`AL/agent.ts:561-565`——`live.replayState` 仍取自 llm 的 `BlockAssembler`，录制回放状态没有丢）。

💡 **③ `concluded` 的语义**（`:603`）：工具执行后返回 `concluded` 表示"这个 turn 可以结束了"（例如工具调了 `concludeTurn()`，声明在 `P/core/tools/src/contracts.ts:261`，接线 `pipeline.ts:144`）；返回 `null` 表示"还欠一次模型请求"，turn 继续下一 step。

## 6.7 `buildRequest()`：组装请求

0.1.5 的一个 89 行方法拆成了两个：**路由解析在 `prepareRequest()`（`AL/agent.ts:619-660`），日志落点在 `buildRequest()`（`:662-751`，90 行）**。

| 步骤 | 位置 | 说明 |
|---|---|---|
| `requestProposal()` | `AL/agent.ts:70-78` | 从持久 header 剥掉 adapter 派生值：`adapterDefaults` 标记为默认的 `reasoningEffort` / `maxTokens` 删除 |
| 组装种子配置 | `:630-635` | controls + `ModelSelection`（`deepFreeze(structuredClone(...))`） |
| `agent/request` waterfall | `:636-641` | **给插件改输出控制的机会**；但改 provider / model / effort 会直接抛错（`:642-648`）——选择必须在 step 准备前经 `agent.model.select()` 落定 |
| `llm.prepareCall()` | `:649-656` | 绑定解析出精确模型默认值的适配器注册；无适配器的路由回落 proposedConfig |
| `buildRequest()` 落日志 | `:662-751` | `request/header`（initial / change / series 三种 reason，`:683-696`）· `developer/message` 通告工具增删（`:706-714`）· `request/context`（`:728`）· 边界消息 `deriveMessages()` + 整体冻结（`:734-741`） |

💡 `prepareRequest` 的方法注释（`:617`）：

> Resolve request config for the step's selection and bind its adapter before admitting model-visible input.

💡 **`agent/request` 已标 deprecated**。`docs/architecture.md`：

> the deprecated `agent/request` hook adjusts controls without changing the provider, model, or effort selection

即：**provider/model/effort 的选择由 `ModelSelection` 投影持久化**（`AG/model-selection.ts`，经 `ctx.sessionProjections` 注册），`agent/request` 只剩输出控制；"显式设置跨 step 保留、标记为默认的每步重解析"由 `requestProposal` 对 `adapterDefaults` 的剥离实现。详见 [07 篇](07-request-pipeline-llm-tools-and-prompts.md)。

## 6.8 12 个 `agent/*` 事件

> 📐 **配套可跑示例**：[`M04.2 · 在 turn 结束前 steer`](../../dsh-lab/M04-agent-loop-intervention/index.ts) 在 `agent/turn-stopping` 上挂监听器，
> 监听者调 `agent.steer(...)` 注入一条新消息，并验证主循环**重读 inbox**、真的多走一步。


全部声明在 `AG/runtime-types.ts:291-430` 的模块扩展里，`this` 类型统一是 `Scoped<Agent>`：

| 事件 | 行号 | 模式 | 用途 |
|---|---|---|---|
| `agent/created` | 291 | **serial** | Agent 创建（`AG/index.ts:564` 派发）；**原 `agent/session-start` 的 `source` 并入这里**（`SessionStartSource` = `'startup' \| 'resume' \| 'clear' \| 'compact'`，`:152`） |
| `agent/disposed` | 300 | emit | Agent 销毁 |
| `agent/status` | 310 | emit | idle ↔ running（`AL/agent.ts:167`） |
| `agent/inbox/inserted` | 318 | emit | inbox 插入（`AL/inbox.ts:228`） |
| `agent/inbox/claimed` | 329 | emit | inbox 被领取（`AL/inbox.ts:111`） |
| `agent/inbox/discarded` | 337 | emit | inbox 被丢弃（`AL/inbox.ts:225`） |
| **`agent/pre-step`** | **351** | **waterfall** | 决定模型看到什么（§ 6.5）；payload 带 `modelSelection` |
| **`agent/request`** | **374** | **waterfall** | 改输出控制（已标 deprecated，§ 6.7） |
| **`agent/request-error`** | **390** | **waterfall** | 返回 `{ kind: 'retry' }` 可重试（§ 6.6） |
| **`agent/assistant-stream`** | **400** | **emit** | **rc.3 新增**：实时流式帧（§ 6.6） |
| **`agent/turn-stopping`** | **418** | **serial** | **没有 `next()`**；可往 inbox 塞消息延续 turn（§ 6.4 ④） |
| `agent/error` | 430 | emit | 未捕获错误（`AL/agent.ts:270`） |

共 **12 个** `agent/*` 事件（0.1.5 是 9 个：`agent/session-start` 删除并入 `agent/created`，inbox 三事件从驱动侧回调注册改为 runtime-types 声明 + inbox 内直接 emit，新增 `agent/assistant-stream`）。

💡 **`agent/turn-stopping` 是唯一无 `next()` 的 serial**。`docs/architecture.md`："`agent/turn-stopping` is serial and has no `next()`"。`agent/created` 也改为 serial——监听器按序 await，创建在全部监听器完成前不 resolve（runtime-types 注释："Listeners run in order and are awaited before creation resolves. AgentLoop holds queued input until all listeners finish"）。serial 的语义是"依次 await"（[cordis 06 § 6.1](../hello-cordis/06-event-system-and-waterfall.md)）。

💡 **`Scoped<Agent>` 作为 `this`** 让监听器能拿到"当前是哪个 Agent"，同时受 scope 隔离（[05 § 5.18](05-startup-and-cordis-runtime.md)）。派发工具在 `AG/dispatch.ts`：`agentCarrier()`（`:94`）、`agentEvents()`（`:107`）、`emitAgentEvent()`（`:158`）、`assembleContextFor()`（`:174`）。

## 6.9 `Inbox`：两条有序队列

> 📐 **配套可跑示例**：[`M04.3 · 三条 inbox 通道`](../../dsh-lab/M04-agent-loop-intervention/index.ts) 把 inbox 通道的区别跑成断言：
> `send(..., 'next-turn', wakeup=false)` 只入队**不唤醒**（driver 仍是 idle），`inbox.clear()` 后队列归零。
> 配套工程验证的是"入队 / 不唤醒 / 清空"这条语义链；流水事件（谁在什么时候塞了什么）以本快照的源码分析为准。


`AL/inbox.ts`（232 行）。内部状态是 `Record<InboxTarget, UserMessage[]>` 的投影，**一切变更走 `splice()` 落一条持久事件**：

| 方法 | 行号 | 说明 |
|---|---|---|
| `clear()` | 97 | 两条队列各 splice 清空 |
| **`claim(target, turn)`** | **108** | 取出并清空该队列，通知 `claimed`（`:111`） |
| `append(target, message)` | 120 | 尾部追加 |
| `prepend(target, message)` | 129 | 头部插入 |
| `replace(messageId, newMessage)` | 139 | 按 id 替换 |
| `remove(messageId)` | 151 | 按 id 移除 |
| **`splice(target, start, deleteCount, inserted)`** | **166** | 通用变更：查重（id 不许重复 pending）、算 `removedCount`/`outcome` |

💡 **inbox 的变更也是持久事件**。`agent/inbox/spliced` 的声明移到了 `AG/types.ts:104-117`（与 `model/selection` 相邻）；落账在 `AL/inbox.ts:223`，随后才 emit `discarded` / `inserted`（`:225-228`）。类型注释（`AG/types.ts:106-108`）：

> The session-projection registry applies the committed event before `Session.append()` returns; Inbox live notifications follow that commit.

即：**先落持久事件（投影随之应用）、后发 agent 侧实时通知**。0.1.5 的"Live dispatch precedes projection mutation"（先派发后改投影）在 rc.3 反转为"commit precedes live notification"——同步观察者读到的一定是已提交后的状态。

## 6.10 `AgentRegistry` 与 `AgentFactory`

`AG/index.ts`（679 行）。

![AgentRegistry 的四组职责](diagrams/06-agent-registry.svg)

**AgentRegistry 的四组职责** — [交互版](diagrams/06-agent-registry.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-agent-registry.architecture.json)

- **setFactory 是最大的扩展点**：Agent 的构造完全由注册的工厂决定 · 换工厂即换掉 Agent 的全部行为 · 比替换 agentLoop 更彻底
- **enter 建立父子关系**：enter(agent) 声明谁拥有这个 agent · subagent 就靠它挂到父 agent 下 · announce 用于向外广播新 agent
- **发起者追踪的用途**：记录当前操作是谁触发的 · 委派给 subagent 时要带上发起者身份 · requireInitiator 在缺失时直接报错

符号行号：`class AgentRegistry`（`:246`，Service → `ctx.agents`）、`turnBoundaryOf()`（`:300`）、`requireInitiator()`（`:327`）、`withInitiator()`（`:346`）、`setFactory()`（`:377`）、`create()`（`:410`）、`enter()`（`:474`）、`announce()`（`:551`）。

💡 **`AG/src` 在 rc.3 拆出一批专题文件**：`dispatch.ts`（176 行，融合派发器）、`model-selection.ts`（174 行，模型选择的持久投影与切换通知）、`consumed-work.ts`（109 行——"一次 turn 消耗了什么工作"的记账，turn/step 词汇本身答不了"被拒的 turn 是不是白跑"）、`archive-admission.ts`（38 行，Session 归档时"Agent 是否在 turn 里"的准入族）、`projection.ts`（59 行，turn/step 事件的共享纯折叠，`turnBoundaryOf` 的底座）。

💡 **`ctx.agents` 与 `ctx.agentLoop` 分开是刻意的**：前者是接口 + 注册表（谁在跑），后者是驱动实现（怎么跑）。`dsh-base` 的 patch 里 `agent`（:82）与 `agent-loop`（:532）是两行（[05 § 5.11](05-startup-and-cordis-runtime.md)），**换掉 `agent-loop` 那行就换掉整个主循环**。

## 6.11 `AgentLoop` 服务的配置

`AL/index.ts`（838 行）：

| 符号 | 行号 | 说明 |
|---|---|---|
| `INACTIVE_STATES` | 41 | 一组 `FiberState`，判定"不再接受新工作" |
| `raceAbort()` / `raceAbortCall()` | 112 / 128 | 把操作与 abort 信号竞速 |
| `assertAgentOptions()` | 152 | |
| `LauncherAgentIdentity` | 210 | |
| `CONFIGURED_AGENT_IDENTITIES_KEY` | 226 | |
| `applyLauncherIdentities()` | 236 | 用启动器提供的身份覆盖配置里的 agent |
| `Config` | 252 | 插件配置；`maxParallelToolCalls: Volatile<number>`（`:257`） |
| `validateConfiguredAgents()` | 272 | **检查身份不重复** |
| **`class AgentLoop`** | **290** | `extends Service implements AgentFactory`；静态 `Config` schema（`:294-306`）把 `maxParallelToolCalls` 默认为 `DEFAULT_MAX_PARALLEL_TOOL_CALLS`（= 10，`constants.ts:5`） |

💡 **`maxParallelToolCalls` 现在是单一来源的 volatile 配置**（`:257` / `:295`）：运行期可改，改动走 cordis 的 volatile 更新语义。0.1.5 的"Config 与 Settings 双来源、settings 覆盖启动配置"已不成立——配置分层在 rc.3 被简化了（详见 [09 篇](09-host-runtime-and-storage.md) 的 settings）。

💡 **`raceAbort` 的实现（`:112-118`）用 `Promise.withResolvers()`**——与 `engines` 要求的 Node `>=24.9.0` 对得上（文件里 `:57`、`:439`、`:488` 等处同款用法）。

---

> 📎 **以下承接原「06 会话日志 SessionEvent」。**
> 本篇讲 DSH 最核心的数据结构：append-only 事件日志。含 14 个核心事件、`surfaceOp` 的有序表面机制、`deriveMessages()` 的缓存投影、fork 语义、以及"Model-visible means logged"不变量怎么被强制。
> 路径缩写：`P/` = `packages/`，`S/` = `packages/core/session/src/`。行号对应快照 `38a6a5c9`。

## 6.12 核心不变量：Model-visible means logged

> 📐 **配套可跑示例**：[`M05.1 · 日志结构与 seq 不变量`](../../dsh-lab/M05-session-surface/index.ts) 逐条验证本节的不变量：
> seq 从 0 开始连续递增、事件类型分布（`type × count`）、新建会话至少有一条 `session/created`。
> 配套工程**未覆盖**"事件深冻结"与"`deriveMessages()` 只投影消息事件"这两条断言——它们以本快照的源码分析为准。


`docs/architecture.md` 的原话：

> **Model-visible means logged.** Every model request must be reconstructable from the log. New model-visible inputs require session events. Plugins changing existing message content register [pure message projections](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/subsystems/session.md#plugin-owned-message-projections); detached readers supply the same definitions explicitly.

![模型可见即必须落日志](diagrams/06-model-visible-logged.svg)

**模型可见即必须落日志** — [交互版](diagrams/06-model-visible-logged.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-model-visible-logged.architecture.json)

- **这是全仓最强的约束**：不是建议而是运行时断言 · 违反在 append / 校验路径直接抛错，不做降级 · 会话头版本不符同样直接拒绝（S/index.ts:106-107）
- **扩展的正确姿势**：先在 SessionEventMap 里加事件类型 · 再实现从该事件渲染成 Message（或注册纯消息投影）· 最后才在业务侧 append
- **为什么值得**：回放与 fork 不需要额外快照机制 · UI 显示的与模型看到的严格一致 · 压缩只需重写表面，不动日志

💡 **0.1.5 的 `S/invariant.ts`（250 行）已删除**，全仓 invariant 约定同步废除：不变量检查并入 `validateSessionEventData`（`S/surface.ts:131` 起）与 append 的运行时校验。rc.3 还补了一条**投影缝**：插件改写已有消息内容不再动日志，而是注册纯消息投影（`ctx.sessionProjections`，`P/session/session-projection` 独立成包；`docs/architecture.md:132`："dsh-session-projection owns ctx.sessionProjections"）。

## 6.13 14 个核心事件

`SessionEventMap`（`S/types.ts:287`）是**可 merge 扩展的接口**——插件用 `declare module` 往里加。核心 14 个：

| 事件 | 行号 | 数据 | 是否上表面 |
|---|---|---|---|
| `turn/start` | 294 | `{ turn }` | — |
| `turn/end` | 303 | `{ turn, reason: TurnEndReason }` | — |
| `step/start` | 305 | `{ turn, step }` | — |
| `step/end` | 307 | `{ turn, step }` | — |
| **`user/message`** | **315** | `UserMessage` | ✅ |
| **`developer/message`** | **317** | `{ turn, step, message, headerSeq? }` | ✅ |
| **`system/message`** | **338** | `{ turn, step, message }` | ✅ |
| **`assistant/message`** | **349** | `{ turn, step, message, stream, usage?, interrupted? }` | ✅ |
| `assistant/attempt` | 363 | `{ turn, step, stream: AssistantStreamRecord[] }` | — |
| `tool/call` | 369 | `{ turn, step, callId, name, arguments }` | — |
| **`tool/result`** | **383** | （见 [07 篇](07-request-pipeline-llm-tools-and-prompts.md)） | ✅ |
| `request/header` | 398 | `{ header, reason, startsSeries? }` | — |
| `request/context` | 410 | `RequestContext` | — |
| `session/end-seed` | 435 | `{ inherited?: true }` | — |

插件扩展的例子：`agent/inbox/spliced`（`AG/types.ts:110`，见 [06 § 6.9](06-agent-loop-and-session-log.md)）、`model/selection`（`AG/types.ts:115`，log-only，永不进派生历史）。

💡 **五种事件能上"表面"**（`SurfaceEventType`，`S/types.ts:447-452`）：`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`——**这五种就是最终会变成 LLM message 的**。0.1.5 只有三种；rc.3 把 system prompt 与开发者通告做成了模型可见的一等表面事件。

💡 **三个新事件的角色**：
- **`developer/message`**：会话内的增量变更通告进日志。典型落点：`buildRequest` 在工具清单变化时落 `{ kind: 'tool-registry' }` 的增删通告（`AL/agent.ts:706-714`）。
- **`system/message`**：渲染后的 system prompt 以**历史形式**流动（`docs/architecture.md:114`："The system prompt travels as `system/message` history: empty text clears it, capable routes append updates, and other routes consolidate it at the first system node"）。0.1.5 的"system prompt 只在请求组装期出现"已不成立。
- **`assistant/attempt`**：见 § 6.6——没有产生表面消息的模型尝试，保留审计与回放而不伪造模型可见历史。

💡 **`assistant/chunk` 与 `todo/write` 已从核心 `SessionEventMap` 移出**。前者的职责由 `assistant/message` 内嵌流 + `assistant/attempt` 接管（§ 6.6）；后者仍是包级声明事件（`tool-todo` 用 module augmentation 声明，`S/known-event-types.ts:71` 记录事件名，见 [09 § 9.24](09-host-runtime-and-storage.md)）。

## 6.14 `append()`：唯一的写入口

`S/index.ts:853-882`（另有批量变体 `#appendEvents`，`:884-917`——多条事件"要么全进、要么一条不进"）。这个方法的 JSDoc 仍超过 30 行，是全仓注释最密的地方之一。

![append 的类型技巧与三道校验](diagrams/06-append-contract.svg)

**append 的类型技巧与三道校验** — [交互版](diagrams/06-append-contract.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-append-contract.architecture.json)

- **条件类型做了什么**：opts 的类型按事件是否属于表面事件而变 · 表面事件时是 [opts: SurfaceIntent] · 否则是空元组，多传参数编译不过
- **三道校验都是 fail-closed**：不可序列化直接抛错，不做降级写入 · 请求头空字段与工具失败元数据矛盾同样拒绝 · 保证日志永远可重放
- **避免空值进 JSON**：surfaceMetadata 按字段存在性拼装 · 这样日志里不会出现无意义的空字段 · 也让 diff 与压缩更干净

💡 **rc.3 新增版本头守门**：`validateSessionHeader`（`S/index.ts:104-122`）要求会话头 `version === SESSION_FORMAT_VERSION`，不符直接抛错（`:106-107`："session header version must be 4, got …"）——这是 § 6.20 迁移链的读侧守门。

### 四个防御性设计

💡 **① 一次遍历同时做校验与拷贝**。JSDoc 明确说明动机：

> One iterative pass reads, validates, and copies each nested value once, so a stateful getter cannot supply one value to validation and another to storage.

即：**防止"有状态的 getter"在校验时返回一个值、存储时返回另一个值**。这是对 TOCTOU（check-then-use）类问题的防御。

💡 **② 失败点在 append 处而非后续 flush**：

> The event log is the durable source of truth, so a bad event fails at the append site rather than later during a backend flush.

💡 **③ 重入禁止**。JSDoc："an append reentered while this acceptance/publication boundary is open also rejects before the log changes"；执行点是 `publicationEntry()`（`:952`，从 `attachments` WeakMap 取 entry 并检查 `appending`）。这保证了日志顺序与事件派发顺序严格一致。

💡 **④ 先收集回调、后改日志、再调回调**。批量路径先把全部 `session/event` 回调经 `collectSessionCallbacks` 收齐（`:891-898`），再 `this.log.push` 逐条入日志，最后 `invokeContainedSessionObservers` 逐个调用（`:905` 起）。这个顺序让**同步观察者在被调用时看到的是"已包含新事件"的日志**，但回调列表是在改日志之前确定的（避免回调内注册新监听器影响本次派发）。

## 6.15 `surfaceOp`：有序表面

> 📐 **配套可跑示例**：[`M02.3 · 折叠会话历史为模型表面`](../../dsh-lab/M02-context-assembly-economics/index.ts) 读出一个真实会话的**模型表面**（`ctx.sessionQuery.readSurface`），
> 打印表面事件条数，并与 `tokenMeter` 是否在位一起核对——"模型看到什么"与"计量了多少"在同一次调用里对上。
> 配套工程**没有**逐字复现旧版示例里那两条 `surface replace:` 抛错原文；`replace` 的 fail-closed 约束以本快照的源码分析为准。


这是 DSH 处理"上下文压缩"的关键机制。

![SurfaceOp 的两种形态与表面的作用](diagrams/06-surface-ops.svg)

**SurfaceOp 的两种形态与表面的作用** — [交互版](diagrams/06-surface-ops.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-surface-ops.architecture.json)

- **日志与表面分离**：日志只追加，是唯一事实来源 · 表面是可重写的投影视图 · 压缩只改表面，历史不丢
- **replace 的三条约束**：start 与 end 必须都在当前表面上 · start 等于 end 时替换单个节点 · sourceEventSeqs 必须包含全部被遮蔽节点
- **不只压缩能用**：任何表面替换型生产者都可用 replace · 例如把多条工具输出合并成一条摘要 · 语义由生产者自己定义

相关类型：

| 类型 | 行号 | 说明 |
|---|---|---|
| `SurfaceEventType` | `S/types.ts:447-452` | `'system/message' \| 'developer/message' \| 'user/message' \| 'assistant/message' \| 'tool/result'` |
| `SurfaceEvent` | `S/types.ts:455` | `SessionEvent<SurfaceEventType>` |
| `SurfaceOp` | `S/types.ts:470` | append / replace 两种 |
| `SurfaceIntent` | `S/types.ts:478` | `{ surfaceOp }`；`assistant/message` 分支 `sourceEventSeqs?: never`，其余分支 `sourceEventSeqs?: SessionSeq[]` |

💡 **`sourceEventSeqs` 的语义在 rc.3 收紧**（`S/types.ts:480-486`）：
- `assistant/message` **禁止**携带该字段——"Assistant messages embed their provider stream instead of citing source events"（内嵌整段流取代引用）；
- 其它表面事件若带，**必须是完整非空**的已知来源 seq 集合。

## 6.16 `deriveMessages()`：带缓存的投影

`S/index.ts:1079-1097`。这是每个 step 都要调的热路径（[06 § 6.6](06-agent-loop-and-session-log.md)）。

![deriveMessages 的增量投影与缓存](diagrams/06-derive-messages.svg)

**deriveMessages 的增量投影与缓存** — [交互版](diagrams/06-derive-messages.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-derive-messages.architecture.json)

- **代号是失效信号**：表面被 replace 或消息投影注册时递增 contentGeneration · 投影缓存记下自己算的是哪一代 · 代号不匹配即全部重算
- **常态是增量**：普通 append 不改代号 · 于是只需处理新增的表面节点 · 这让每 step 一次调用的开销可接受
- **为什么不能只增量**：replace 会遮蔽已投影过的节点 · 增量无法回退已产出的消息 · 因此压缩后必须整体重建

💡 **三条性能与安全承诺**（JSDoc `:1066-1078`）：

| 承诺 | 实现 |
|---|---|
| **每个表面节点只投影一次** | `derivedNodes` 游标；纯尾部增长成本 O(新节点数) |
| **返回的数组是每次调用的新快照** | `[...this.derived]` —— 后续 append 不会"长大"调用方已持有的数组 |
| **数组里的 `Message` 对象是共享且深冻结的** | 未变内容复用已冻结的持久事件数据，**不做第二次深拷贝**；投影块是冻结的派生副本，消费方无法改日志 |

💡 **`contentGeneration` 是压缩与投影变更的共同代价**（`S/surface.ts:578`、`:582` 递增，getter `:702`）：一次 `replace` 让整个投影缓存失效重建。但压缩本身是低频操作，可接受。

💡 **空内容的 `assistant/message` 要跳过**（`:1093-1096` 注释）：max-tokens 的那一步可能只带 `usage` 而没有内容，它不能进 transcript。0.1.5 注释里"五种 message-producing types"与当时三种 `SurfaceEventType` 对不上的笔误，在 rc.3 消失了——表面事件扩到五种后，注释（"one of the five message-producing types"）、`SurfaceEventType` 与 `deriveEventMessage` 的五个 `case`（`S/surface.ts:120-158`）完全一致。

## 6.17 `Session` 类

`S/index.ts:555`（1555 行文件里的主类）。

| 成员 | 行号 | 说明 |
|---|---|---|
| `get surface(): SessionSurface` | 562 | 有序表面（实现在 `S/surface.ts`，758 行） |
| `readonly header: SessionHeader` | 574 | |
| `get id(): SessionId` | 580 | |
| `readonly firstLiveSeq: SessionLogOffset` | 597 | **第一个"活"事件的 seq**（seed 之后） |
| `get events(): readonly SessionEvent[]` | 763 | 带 `eventsSnapshot` 缓存（`:736` / `:764`） |
| `get seq(): SessionLogOffset` | 791 | 下一个 seq |
| **`append()`** | **853** | § 6.14 |
| `requestHeader(): EpochHeader \| undefined` | 1007 | 折叠 `request/header` 事件 |
| `requestContext(): RequestContext \| undefined` | 1028 | |
| **`deriveMessages()`** | **1079** | § 6.16 |
| `deriveEventMessage(event)` | 1108 | 单事件投影（纯函数在 `surface.ts:120`） |

辅助导出：

| 符号 | 行号 | 说明 |
|---|---|---|
| `adoptSessionEvent()` | 172 | 接纳外部事件（校验形状） |
| `snapshotSessionEvent()` | 201 | 快照（= `adoptSessionEvent(structuredClone(event))`） |
| `assertMessageEventShape()` | 337 | 在 `:175`、`:280` 被调用 |
| `SessionForkError` | 1130 | 带 `SessionForkErrorCode` |

💡 **`firstLiveSeq`（`:597`）区分 seed 与 live**。会话可以带"种子事件"（fork 时 `buildForkSeed` 复制的父会话前缀）。`firstLiveSeq` 之前的是种子，之后是本会话真正产生的。

## 6.18 `SessionStore`：会话的注册表

`S/index.ts:1144`，是一个 cordis Service → `ctx.sessions`。

| 方法 | 行号 | 说明 |
|---|---|---|
| `create(id?, options?)` | 1206 | 新建 |
| `prepare(id?, options?)` | 1238 | 预备（尚未 enter） |
| `enter(session)` | 1311 | 进入活动状态，返回 disposer |
| `announce(session)` | 1367 | 广播 |
| `get(id)` | 1455 | |
| `list()` | 1463 | |
| **`fork(source, boundary?, childSessionId?)`** | **1483** | |

💡 **`prepare` / `enter` / `announce` 三段式**对应 cordis 的生命周期习惯：先构造（不可见）→ 进入（注册 effect）→ 广播（通知观察者）。`enter` 返回 disposer，所以**会话的存在本身是一个可逆效应**（[cordis 03 § 3.2](../hello-cordis/03-fiber-model.md)）。

💡 **`SessionEntry`（`S/index.ts:423-433`）** 是 session 与 store 的绑定：`{ id, session, carrier: Scoped<Session>, emitCtx, announcement, appending, detachRequested, detach() }`，存在 `attachments` WeakMap（`:436`）里。`append` 里用的 `publicationEntry()`（`:952`）取的就是它。**未 attach 的 session 也能 append，只是不派发事件**（`entry === undefined` 的分支）。

## 6.19 `fork()`：分叉会话

> 📐 **配套可跑示例**：[`M08.3 · fork：继承父会话前缀`](../../dsh-lab/M08-delegation-presets/index.ts) 演示 fork 的稳定前缀语义 ——
> 子会话带 `parentSession` 与显式 seed 前缀，事件数与继承前缀条数一起打印（`inheritedEventCount`），子会话可独立回放与审计。
> 配套工程**没有**断言"边界落在未闭合 turn 里会抛 `SessionForkError { code: 'OPEN_TURN' }`"——那一条以本快照的源码分析为准。


`docs/architecture.md` 的映射表里有一条：

> Fork at a turn boundary → `ctx.agents.create({ sessionId, seed, inheritedEventCount, meta: { isSeeded: true } })` — only agent-loop-published sessions persist

![session.fork 的参数与语义](diagrams/06-session-fork.svg)

**session.fork 的参数与语义** — [交互版](diagrams/06-session-fork.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-session-fork.architecture.json)

- **fork 是官方支持的分叉**：docs/architecture.md 的映射表里专门列了它 · subagent-fork-in-process 直接用它 · 不需要复制文件或手工裁剪日志
- **种子由 buildForkSeed 构造**：[0, boundary) 的事件成为不可变种子并打 `inherited` 标记 · 开着的 turn/step 用 `forked` 原因闭合（S/fork.ts:21）· firstLiveSeq 之后才是子会话自己的事件
- **source 可以只给 id**：不必先把父会话加载进内存 · store 会按需读取 · 便于对归档会话做分叉

💡 **`S/fork.ts`（30 行）是 rc.3 的新文件**：`buildForkSeed(events, boundary)` 复制精确前缀、标记继承切点、用 `forked` 原因合成闭合（`TurnEndReason` 的 `forked` 变体，`S/types.ts:228-235` 注明"only fork seeds carry this marker — the loop never emits it"；开着的 turn 用 `openTurnClosers`，来自 `S/repair.ts`）。fork 的错误码族也在 `S/index.ts:1123-1130`（`SESSION_NOT_FOUND` / `SESSION_NOT_LIVE` / `SESSION_ALREADY_EXISTS` / `INVALID_BOUNDARY`）。

## 6.20 `session` 组的 22 个子包

`core/session` 只管**内存里的日志与投影**。持久化、格式迁移、遥测、标题等全在 `packages/session/` 组（**22 个子包、18832 行 src**；0.1.5 是 13 个子包）：

![持久化与投影是两个独立 seam](diagrams/06-persistence-seam.svg)

**持久化与投影是两个独立 seam** — [交互版](diagrams/06-persistence-seam.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-persistence-seam.architecture.json)

- **三层职责分明**：core/session 只维护内存日志与投影 · persistence seam 负责落盘 · checkpoint policy 决定落盘时机
- **JSONL 与日志模型天然契合**：每行一个事件，追加即写 · 崩溃后按行恢复，无需事务 · rc.3 起它是唯一持久化 provider（session-persistence-sqlite 已删除；需要查询走 session-query 组的 sqlite 索引）
- **策略独立成包的好处**：改落盘频率不需要动 provider · 也不需要动 core/session · 是 capability 事件解耦的又一例

新增子包一览（src 行数实测）：

| 包 | 行数 | 职责 |
|---|---|---|
| `session-persistence` | 636 | 持久化 seam 定义（0.1.5 是 2159 行——物理细节全移去了 jsonl） |
| `session-persistence-jsonl` | **5086** | 唯一的物理 provider：`session.vN.jsonl[.zstd]` 分代、最高代选择、迁移链组合、独占发布 |
| `session-checkpoint-policy` | 83 | 落盘时机策略 |
| `session-format` | 945 | 相邻迁移机制的共享机器 |
| `session-format-catalog` | 153 | 生成的格式目录（`scripts/gen-session-format-catalog.ts`） |
| `session-format-v0-to-v1` … `v3-to-v4` | 2879 / 1256 / 815 / 1702 | 四个相邻迁移包（见下） |
| `session-projection` / `session-projection-cache` | — | 投影缝与投影缓存独立成包（§ 6.12 的纯消息投影、§ 6.16 的缓存） |
| `session-log-deepseek`、`session-stats`、`session-telemetry`(+`-otel`)、`session-turn-outline`、`message-quotes`、`working-directory`、`tool-working-directory` | — | 各专项扩展 |

💡 **`session-title` 的 provider 收敛为组内两个**：`session-title-first-prompt-llm`（首个 prompt）与 `session-title-llm`（全对话），第三个 `session-title-all-prompts-llm` 移到 experimental。"唯一 provider" 的 seam 约束不变（`docs/architecture.md`："Generate session titles → register the sole `ctx.sessionTitle` provider"）。

💡 **JSONL 是天然匹配 append-only 日志的格式**（每行一个 JSON）。它的实现（5086 行，0.1.5 是 1939）比整个 persistence seam 定义（636 行）大 8 倍——因为要处理分代选择、zstd 压缩、损坏修复（对应 `S/repair.ts`，211 行）与相邻迁移链的一次性组合。

### 会话格式版本与迁移（rc.3 的最大工程化补强）

0.1.5 的 `SESSION_FORMAT_VERSION = 0`（"无兼容承诺"）已翻页：

- **`SESSION_FORMAT_VERSION = 4`**（`S/types.ts:90`），会话头必须带 `version`，读侧拒绝不等于 4 的头（`S/index.ts:106-107`）。
- **格式链 v0 → v4**：物理文件是 `session.vN.jsonl[.zstd]`，打开时**选择数值最高的分代**，相邻迁移包每个只管一步 `vN → vN+1`，打开时**一次性组合整条静态链**再返回校验过的当前格式事件（`docs/architecture.md:128`）。四步分别是：v0→v1 物理 codec 与身份、v1→v2 assistant-stream、v2→v3 system prompt / canonical envelope / PTC、v3→v4 tool-role 与投递校验（各包 `package.json` description）。
- **"已提交的分代永不改名、覆写或删除"**：写侧先编码、校验、**独占发布**新的 version 命名后继文件，源文件原样保留（`docs/architecture.md:128`）。
- **事实源**：`docs/session-format-status.md`——writer 常量、finalization 记录、release 记录三者分离；迁移脚本 `scripts/migrate-sessions-to-v4.ts`。

这是对"Model-visible means logged"体系的落地补强：**模型可见的历史跨版本可重建**，而不是"0 就是没有兼容承诺"。

## 6.21 `session-query` 组：查询与导出

单独一个组（3 包、5940 行 src）：

| 包 | 行数 | 作用 |
|---|---|---|
| `session-query` | 2241 | 查询服务定义 |
| `session-query-sqlite` | 1781 | SQLite 全文索引 provider |
| `session-log-export` | 1918 | 导出会话日志 |

（0.1.5 组内的第四个包 `tool-session-query`——让模型查历史会话的工具——已移到 experimental。）

💡 **`web-app` bundle 里 `session-query-sqlite` 的配置是 `{ path: ':memory:', openAt: 'never' }`**（web-app patch :27-31）——全文搜索默认关闭。注释说明部署方可以把 `openAt` 覆盖为 `'first-search'`，"defers the node:sqlite import and in-memory handle to the first search so startup stays quiet"——把 `node:sqlite` 的 import 与内存句柄延迟到首次搜索。

## 6.22 `S/` 逐文件

| 文件 | 行数 | 职责 |
|---|---|---|
| **`index.ts`** | **1555** | `Session` + `SessionStore` |
| `surface.ts` | 758 | `SessionSurface` + `deriveEventMessage` + `isSurfaceEvent` |
| `types.ts` | 574 | `SessionEventMap`、`SurfaceOp`、`SessionEvent`、`SESSION_FORMAT_VERSION` |
| `repair.ts` | 211 | 日志损坏修复 |
| `known-event-types.ts` | 91 | **本仓库声明的每个 `SessionEventMap` 成员的清单** |
| `tool-history.ts` | 75 | 工具历史的折叠读取（新增） |
| `seq-ranges.ts` | 73 | seq 区间工具（新增） |
| `request-header.ts` | 69 | `EpochHeader` 相关 |
| `preparation.ts` | 49 | |
| `fork.ts` | 30 | `buildForkSeed`（新增） |

（0.1.5 的 `chunk-rows.ts`、`invariant.ts`、`json.ts` 已删除。）

💡 **`known-event-types.ts`（91 行）的存在很说明问题**：`SessionEventMap` 是可 merge 扩展的接口，编译期无法枚举。这个文件手工维护一份"本仓库已知的事件类型"清单，供运行时校验与工具使用。**这是 TypeScript 声明合并的一个已知代价**。

---

**上一篇** ← [05 启动流程与 Cordis 落地](05-startup-and-cordis-runtime.md) ｜ **下一篇** → [07 请求管线：LLM、工具与 SystemPrompt](07-request-pipeline-llm-tools-and-prompts.md)：一次模型请求怎么被组装、发出、收回。
