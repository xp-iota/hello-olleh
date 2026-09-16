# 第 04 课 · Agent 循环与干预面：先观察，再引导

> **本课任务**：不改主循环一行代码，先给 Agent 装上"只读"的生命周期遥测；再在
> `agent/turn-stopping` 边界引导（steer）一次，让**同一个 turn 多跑一个 step**；最后比较
> inbox 四种输入通道在 `nextStep` / `nextTurn` 两个边界上的落地差异。
> **运行命令**：`cd dsh-example && npm run M04`
> **你将看到**：遥测插件逐条打印 turn/step 边界；`turn=1` 在 `turn-stopping` 上 steer 后
> 出现 `pre-step：turn=1 step=2` 与 `本轮实际 step 数(应为 2): 2`；inbox 的 ⑤ followup
> 新开了 turn 2 / turn 3，而 ⑥ steer 只在 turn=4 里多走了一步。

前置：[第 00 课 · 跑起来](00-getting-started.md)。本课所有输出都来自真实运行，不是示意。
（`npm run M04` 需要 `LLM_API_KEY`；其中 M04.4、M04.5 两个阶段不发起模型请求。）

---

## 1. 本课任务

M01 讲的是"一次工具调用"的控制面；这一课往上一层，讲**整个 Agent 循环**的控制面。
Agent 循环不是"你去调它"，而是"你去监听它、往里塞数据"。本课把外部可控的地方拆成五块：

| 控制面 | 回答的问题 | 能否改变结果 | 本课对应实现 |
|---|---|---|---|
| **事件观察**（`session/event`） | 已经发生了什么？ | **不能**：只读"已被接受的事实" | `impl/01-agent-events-telemetry.ts`、`impl/04-session-telemetry.ts` |
| **生命周期 hook**（`agent/*` waterfall） | 这一步进不进？请求配置用什么？ | **能**：不调 `next()` 即否决；返回替换后的 config | `impl/02-lifecycle-steering.ts` |
| **回合收尾**（`agent/turn-stopping`，serial） | 这一轮该不该关？ | **能**：往 inbox 塞消息，主循环重读后自己决定 | `impl/02-lifecycle-steering.ts`、`scenes/02-steer-at-boundary.ts` |
| **输入路由**（inbox） | 这条消息进哪个边界？要不要唤醒？ | **能**：`nextStep` / `nextTurn` × 唤醒与否 | `impl/03-agent-inbox.ts`、`scenes/03-compare-inbox-channels.ts` |
| **失败归属**（invariants） | 谁违反了契约？ | **不能**：失败即抛，但带稳定的 `packageName` | `impl/05-invariants.ts` |

一句话概括本课：**观察是只读的，干预是"写数据"的，而且写入点只有 inbox 一处。**

```bash
cd dsh-example && npm run M04
```

---

## 2. 真实输出

```text
████ M04 · Agent 循环与干预面：先观察，再引导 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M04.1 · 观察 turn/step/session 事件 ────
----- 开始 turn（下面应由遥测插件打印生命周期）-----
[telemetry] ▶ turn 开始
[telemetry]  · step 开始

[telemetry]  · step 结束
[telemetry] ■ turn 结束

----- 结束 turn；聚合文本 = "Pong! 🏓 Runtime is live and ready. What would you like to do?" | step 数 = 1 -----
REAL_STAGE_OK M04.1 calls=1 ms=1918 in=0 out=49 finish=stop "Pong! 🏓 Runtime is live and ready. What…"

──── M04.2 · 在生命周期边界请求 steering ────
[hooks] session-start：agent=demo-session source=startup
----- 跑一个 turn -----
[hooks] pre-step：turn=1 step=1，认领消息 1 条
[hooks] request：turn=1 step=1 即将发出模型请求
[hooks] turn-stopping：turn=1 发现还有未清 TODO → steer 一条引导，强制再走一步
[hooks] pre-step：turn=1 step=2，认领消息 1 条
[hooks] request：turn=1 step=2 即将发出模型请求

聚合文本: "我先看看工作区里有哪些 TODO。\n\n我需要先实际扫描工作区，才能确定还有哪些 TODO。让我看一下。\n\n"
本轮实际 step 数(应为 2): 2
本轮是否被引导(steerRequested): true
累计 steer 次数(应为 1): 1
REAL_STAGE_OK M04.2 calls=2 ms=4366 in=0 out=337 finish=stop "我需要先实际扫描工作区，才能确定还有哪些 TODO。让我看一下。"

──── M04.3 · 比较 inbox 四种输入通道 ────
① inject：排入 nextStep 但不唤醒（turn 开始前注入的上下文）
   inbox 状态: nextStep = 1 | nextTurn = 0
   ↑ 排进去了，但 driver 没被叫醒 —— inject 不唤醒

② 跑一个 turn：真实主循环在 step1 的认领边界把两个队列都取空
   （inject 的上下文与 followup 的用户输入一起进了第一步，见下面 pre-step 的 source 列表）
  [inbox] pre-step turn=1 step=1 认领 2 条 (source: plugin, user)
   实际 step 数 = 1

③ send：全显式入口（target + wakeup 自己定）—— wakeup=false 不唤醒 driver
   inbox 状态: nextStep = 0 | nextTurn = 1
   ↑ 与 ① 的 inject 同为"不唤醒"，但目标队列是 nextTurn

④ 会话日志里的 inbox 流水（agent/inbox/spliced 可回放）:
   seq=0 target=next-step 入队 1 条 / 移除 0 条 → "背景：这是个演示。"
   seq=1 target=next-turn 入队 1 条 / 移除 0 条 → "开始吧"
   seq=3 target=next-step 入队 0 条 / 移除 1 条 
   seq=4 target=next-turn 入队 0 条 / 移除 1 条 
   seq=15 target=next-turn 入队 1 条 / 移除 0 条 → "下一轮再处理我"

⑤ followup：nextTurn + 唤醒 —— 该消息独占它自己的一个 turn
   inbox 状态: nextStep = 0 | nextTurn = 1
   ↑ 入队即返回（此时 driver 刚被唤醒，还没到认领边界），所以 nextTurn 仍是 1
  [inbox] pre-step turn=2 step=1 认领 1 条 (source: user)
  [inbox] pre-step turn=3 step=1 认领 1 条 (source: user)
   到目前的累计 step 数 = 3 （followup 唤醒了 driver，所以又多跑了一轮）

⑥ steer：nextStep + 唤醒 —— running driver 在【同一 turn 的下一步】消费
   下面在 turn-stopping 上 steer 一条：不 steer 的话本轮就该关轮了
  [inbox] pre-step turn=4 step=1 认领 1 条 (source: user)
  [turn-stopping] turn=4 反对停止 → steer 一条，强制再走一步
  [inbox] pre-step turn=4 step=2 认领 1 条 (source: plugin)
  [turn-stopping] turn=4 不再 steer → 本轮正常关闭
   steer 那一轮的 step 数 = 2 | 被引导 = true | 引导次数 = 1
   ↑ 对比 ⑤ 的 followup：steer 没有新开 turn，而是在同一个 turn 里多走了一步

⑦ 两条引导的 spliced 对照（target 决定落在哪条队列）:
   target=next-step source=plugin → "背景：这是个演示。"
   target=next-turn source=user   → "开始吧"
   target=next-turn source=user   → "下一轮再处理我"
   target=next-turn source=user   → "我是独立的一轮"
   target=next-turn source=user   → "做点事"
   target=next-step source=plugin → "继续：还有事没做完"

⑧ clear：丢弃全部待认领消息
   inbox 状态: nextStep = 0 | nextTurn = 0
REAL_STAGE_OK M04.3 calls=5 ms=18958 in=0 out=2036 finish=stop "确实，上一轮我只起了个头，没真正做完。 未完成项是：**查看当前环境，决定下一步…"

──── M04.4 · 捕获会话遥测账本 ────
sessionTelemetry: {
  backend: 'MemorySessionTelemetry',
  records: 1,
  channels: [ 'ledger' ],
  eventTypes: [ 'user/message' ]
}
REAL_STAGE_OK M04.4 calls=1 ms=750 in=0 out=58 finish=stop

──── M04.5 · 注册包归属运行时不变量 ────
invariants: {
  service: 'InvariantRegistry',
  selectedInstallerRan: true,
  duplicateNamesFailLoud: true
}
REAL_STAGE_OK M04.5 calls=1 ms=534 in=0 out=61 finish=stop

REAL_MODULE_OK M04 stages=5 calls=10 failed=0
```

**对照自己的输出**：最后一行必须原样出现

```text
REAL_MODULE_OK M04 stages=5 calls=10 failed=0
```

`ms=` / `out=` 这些数字每次运行都会变，不用对齐；要盯的是**结构**：

1. 每个阶段各有一行 `REAL_STAGE_OK M04.x`（本课共 5 个阶段）；
2. M04.2 里 `turn-stopping` 之后紧跟 `pre-step：turn=1 step=2`，且 `本轮实际 step 数(应为 2): 2`；
3. M04.3 的 ⑤ 出现 `turn=2` / `turn=3`，而 ⑥ 停在同一个 `turn=4` 内。

如果 M04.2 的 step 数是 1、M04.3 的 ⑤ 没有新 turn，说明干预没生效——去看第 7 节。

---

## 3. 观察域：`session/event` 是"已接受的事实"

打开 [`impl/01-agent-events-telemetry.ts`](../M04-agent-loop-intervention/impl/01-agent-events-telemetry.ts)。
整个插件没有 import 主循环、没有 import provider，只做一件事：监听 `session/event`。

```ts
export const name = 'agent-events-telemetry'
export const inject = []   // 空数组 = 明确"没有服务依赖"，不是漏了配置

export function apply(ctx: Context) {
  ctx.on('session/event', (_session, event) => {
    try {
      switch (event.type) {
        case 'turn/start': console.log('[telemetry] ▶ turn 开始'); break
        case 'step/start': console.log('[telemetry]  · step 开始'); break
        // 0.1.5 起没有 'assistant/chunk' 事件：token 增量内嵌在 assistant/message
        // 携带的 provider 流里，不再单独落日志。要观测流式请看 M03 的
        // llm/stream waterfall —— 会话日志是"已接受的事实"，不是传输过程。
        case 'assistant/attempt': console.log('[telemetry]  · provider attempt'); break
        case 'step/end': console.log('\n[telemetry]  · step 结束'); break
        case 'turn/end': console.log('[telemetry] ■ turn 结束\n'); break
        default: break // 其它事件类型这里不关心
      }
    } catch (err) {
      // 观测失败绝不能影响 agent 主循环——吞掉并记录即可。
      console.error('[telemetry] 观测器内部错误（已忽略）:', err)
    }
  })
}
```

第 2 节 M04.1 的输出就是它的逐行投影：

```text
[telemetry] ▶ turn 开始
[telemetry]  · step 开始

[telemetry]  · step 结束
[telemetry] ■ turn 结束
```

`step 数 = 1` 说明这个 turn 里只有一次模型请求加它触发的工具执行（这次回答是
`"Pong! 🏓 Runtime is live and ready. What would you like to do?"`）。
**"ping" → 一句话回答 → 一个 step**，这是最干净的基线。

### 为什么这里看不到流式 token

`session/event` 是**持久事件流**：`turn/start`、`step/start`、`assistant/message`、`step/end`……
它们都是**已经落盘的事实**。0.1.5 里根本没有 `assistant/chunk` 这个事件——token 增量内嵌在
`assistant/message` 携带的 provider 流（`stream` 字段）里，不再单独落一条日志。

所以要观测"边生成边吐字"，得去传输侧，用 [M03 的 `llm/stream` waterfall](../M03-inference-service-access/impl/llm-stream.ts)。
顺带一提：本课输出里**没有** ` · provider attempt` 这一行（虽然 switch 里有这个 case）——
因为这一步成功提交了 `assistant/message`；`assistant/attempt` 只在"一次没有产出可见消息的尝试"
上才落，比如失败/重试/取消。

### 观察者的自我隔离

注意 `try/catch`：**一个监听器抛错不应该打断主流程**。遥测后端、审计、进度 UI 都照这个模子写：
监听、不 import 主循环、自己失败自己吞。M01 § 6 讲过结果侧 containment（`tools/result` 只能看），
这里是同一思路在事件侧的体现。

> **原理对照**：9 个 `agent/*` 事件与 13 个核心 `session` 事件见
> [06 § 6.8](../../docs/hello-dsh/06-agent-loop-and-session-log.md) 与
> [06 § 6.13](../../docs/hello-dsh/06-agent-loop-and-session-log.md)；
> waterfall / serial / emit 三种派发模式的差别见
> [05 § 5.19](../../docs/hello-dsh/05-startup-and-cordis-runtime.md)。

---

## 4. 干预域：`agent/*` 的 waterfall 上，纯观察也必须 `return next()`

`session/event` 是全局广播；`agent/*` 不一样——它**携带活 Agent**，是策略事件。
打开 [`impl/02-lifecycle-steering.ts`](../M04-agent-loop-intervention/impl/02-lifecycle-steering.ts)，
它在前三个拦截点上都只打印日志：

```ts
export const name = 'hooks-lifecycle-steering'
export const inject = ['agents']

ctx.on('agent/session-start', ({ agent, source }: any) => {
  console.log(`[hooks] session-start：agent=${agent.id} source=${source}`)
})

ctx.on('agent/pre-step', (payload: any, next: () => any) => {
  console.log(`[hooks] pre-step：turn=${payload.turn} step=${payload.step}，认领消息 ${payload.messages.length} 条`)
  return next() // 纯观察也必须交回 next()，否则等于否决本步
})

ctx.on('agent/request', (payload: any, next: () => any) => {
  console.log(`[hooks] request：turn=${payload.turn} step=${payload.step} 即将发出模型请求`)
  return next() // 想换 provider/model 时返回替换后的 config；这里只观察
})
```

两个 `return next()` 旁边的注释是本课最重要的一条纪律：

- `agent/pre-step` 是 **waterfall**（around-middleware）。链尾是主循环自己的默认决定
  （"就按认领到的消息进入这一步"）。**不调 `next()` 就等于把整条链连同默认值一起接管**——
  你想只观察，结果是每一步都被你否决掉。
- `agent/request` 同样是 waterfall，但语义是"**返回替换后的调用配置**"。真实 dsh 的
  provider/model 切换、effort 改写就挂在这里；本课只观察，所以原样 `return next()`。
- `agent/session-start` 是 **emit**（一次广播），不需要 `next()`——也正因为如此，**插件装晚了
  就永远收不到它**（[第 01 课 § 7](01-tool-pipeline.md) 踩过同一个坑）。

第 2 节 M04.2 的前半段就是这三个监听器的点名：

```text
[hooks] session-start：agent=demo-session source=startup
----- 跑一个 turn -----
[hooks] pre-step：turn=1 step=1，认领消息 1 条
[hooks] request：turn=1 step=1 即将发出模型请求
```

`认领消息 1 条` 里的"认领"是实指：主循环在进入 step 之前，会先把 inbox 里该走的队列**取空**
（第 6 节会看到它一次取几条）。所以 `payload.messages` 就是**实际进入这一步的输入**——
这也是为什么自动压缩、上下文注入都挂在 `pre-step` 上。

---

## 5. 回合收尾：`turn-stopping` 是 serial，靠"数据"表态

第四个拦截点最特别。完整代码：

```ts
ctx.on('agent/turn-stopping', ({ agent, turn }: any) => {
  if (hasSteered) return // 已引导过一次 → 放行，回合正常关闭
  hasSteered = true
  console.log(`[hooks] turn-stopping：turn=${turn} 发现还有未清 TODO → steer 一条引导，强制再走一步`)
  agent.steer({
    role: 'user',
    content: [{ type: 'text', text: '请继续：还有 TODO 未处理完。' }],
    source: { kind: 'hook', hook: name },
  })
})
```

三件事必须一起看懂：

1. **它是 serial，没有 `next()`。** 签名里没有回调可以交回，所以"同意关闭"就是函数返回。
2. **它不用返回值表达反对。** 监听者不返回 `{ kind: 'reject' }` 之类的决定，而是调
   `agent.steer(...)`，**把一条消息写进 inbox**。
3. **决定权仍在主循环。** 派发结束之后，主循环**重读 `inbox.nextStep`**：非空就再跑一个 step，
   空才真正关轮。这叫 "data decides"——**监听者的顺序无法改变结果**，因为结果取决于 inbox
   里有没有东西，而不是谁先谁后表态。

第 2 节 M04.2 的证据链是连续的：

```text
[hooks] turn-stopping：turn=1 发现还有未清 TODO → steer 一条引导，强制再走一步
[hooks] pre-step：turn=1 step=2，认领消息 1 条          ← 同一个 turn，下一步
[hooks] request：turn=1 step=2 即将发出模型请求
...
本轮实际 step 数(应为 2): 2
本轮是否被引导(steerRequested): true
累计 steer 次数(应为 1): 1
```

模型也确实"看见"了这条引导——本轮聚合文本是两步的拼接：

```text
"我先看看工作区里有哪些 TODO。\n\n我需要先实际扫描工作区，才能确定还有哪些 TODO。让我看一下。\n\n"
```

### 这三个数字不是 harness 自己记的账

打开 [`scenes/02-steer-at-boundary.ts`](../M04-agent-loop-intervention/scenes/02-steer-at-boundary.ts)：

```ts
const result = await harness.runTurn({ prompt: '把这些 TODO 做完' })
console.log('本轮实际 step 数(应为 2):', result.steps)
console.log('本轮是否被引导(steerRequested):', result.steerRequested)
console.log('累计 steer 次数(应为 1):', result.steerCount)
```

而 `steps` / `steerCount` 的算法（`runtime/harness.ts`）是**从真实会话日志里数出来的**：
数 `step/start` 事件个数，和 `agent/inbox/spliced` 里 `target='next-step'` 且确实插入过的次数。
这正好把第 3、6 节串起来——**干预的效果，最终也体现为持久事件流里的可审计事实**。

> **原理对照**：turn 主循环里那个"重读 `nextStep`"的窗口见
> [06 § 6.4](../../docs/hello-dsh/06-agent-loop-and-session-log.md)；
> `agent/turn-stopping` 是全部 9 个 `agent/*` 事件里唯一的 serial 见
> [06 § 6.8](../../docs/hello-dsh/06-agent-loop-and-session-log.md)。

---

## 6. inbox 四通道：路由 × 唤醒（以及"归因"）

### 6.1 两个边界，四个入口

打开 [`impl/03-agent-inbox.ts`](../M04-agent-loop-intervention/impl/03-agent-inbox.ts)。文件顶部的注释
就是本节的完整原理：

```ts
// Agent 对外的所有输入都路由进 inbox 的两个边界：
//   - nextStep：下一个 step 边界认领（当前轮内继续）
//   - nextTurn：下一个 turn 认领（后续轮次）
//
// 四个入口只是"路由 + 是否唤醒"的组合：
//   - send(message, target, wakeup)  全显式的底层入口
//   - followup(message)  → nextTurn + 唤醒（该消息独占自己的 turn）
//   - steer(message)     → nextStep + 唤醒（running driver 在下一 step 边界消费）
//   - inject(message)    → nextStep + 不唤醒（排队模型可见上下文，等下一次唤醒）
```

用一张表记住（横轴路由、纵轴唤醒）：

| 入口 | target | 唤醒 driver？ | 一句话 |
|---|---|---|---|
| `send(msg, target, wakeup)` | 自己定 | 自己定 | 底层全显式入口 |
| `followup(msg)` | `nextTurn` | ✅ | 该消息**独占自己的一轮** |
| `steer(msg)` | `nextStep` | ✅ | running driver 在**同一轮的下一步**消费 |
| `inject(msg)` | `nextStep` | ❌ | 只是排队，等下一次唤醒一起带上 |

### 6.2 四通道的实测对照

`scenes/03` 把四个入口各显式调一次。下面是它的真实输出与解读：

```text
① inject：排入 nextStep 但不唤醒（turn 开始前注入的上下文）
   inbox 状态: nextStep = 1 | nextTurn = 0
   ↑ 排进去了，但 driver 没被叫醒 —— inject 不唤醒
```

消息**进了队列**，但主循环没有任何动静——`inject` 的唤醒位是 `false`。
设计意图很明确：注入上下文不该"白跑一个 step"，它等着下一次真正的输入把它一起带上。

```text
② 跑一个 turn：真实主循环在 step1 的认领边界把两个队列都取空
  [inbox] pre-step turn=1 step=1 认领 2 条 (source: plugin, user)
   实际 step 数 = 1
```

`inject` 的那条（`source: plugin`）和用户输入的那条（`source: user`）**在第一步被一起取走**。
这就是"认领边界"的实测证据：`pre-step` 一次拿到两条，而不是分两步。

```text
③ send：全显式入口（target + wakeup 自己定）—— wakeup=false 不唤醒 driver
   inbox 状态: nextStep = 0 | nextTurn = 1
   ↑ 与 ① 的 inject 同为"不唤醒"，但目标队列是 nextTurn
```

`send('next-turn', false)` 与 `inject` 唤醒位相同，差别只落在**哪条队列**上。

```text
④ 会话日志里的 inbox 流水（agent/inbox/spliced 可回放）:
   seq=0 target=next-step 入队 1 条 / 移除 0 条 → "背景：这是个演示。"
   seq=1 target=next-turn 入队 1 条 / 移除 0 条 → "开始吧"
   seq=3 target=next-step 入队 0 条 / 移除 1 条 
   seq=4 target=next-turn 入队 0 条 / 移除 1 条 
   seq=15 target=next-turn 入队 1 条 / 移除 0 条 → "下一轮再处理我"
```

**每一次入队和每一次认领，都会往会话日志写一条 `agent/inbox/spliced`**，带 `target`、
`inserted`、`removedCount`。所以"谁在什么时候塞了什么、又被谁在哪个边界取走"是**可回放**的。
`seq` 不连续很正常——中间夹着 `turn/start`、`step/start` 等其它事件。

接下来是 steer 与 followup 的分界，也是本课最容易搞混的一处：

```text
⑤ followup：nextTurn + 唤醒 —— 该消息独占它自己的一个 turn
  [inbox] pre-step turn=2 step=1 认领 1 条 (source: user)
  [inbox] pre-step turn=3 step=1 认领 1 条 (source: user)
   到目前的累计 step 数 = 3 （followup 唤醒了 driver，所以又多跑了一轮）

⑥ steer：nextStep + 唤醒 —— running driver 在【同一 turn 的下一步】消费
  [inbox] pre-step turn=4 step=1 认领 1 条 (source: user)
  [turn-stopping] turn=4 反对停止 → steer 一条，强制再走一步
  [inbox] pre-step turn=4 step=2 认领 1 条 (source: plugin)
  [turn-stopping] turn=4 不再 steer → 本轮正常关闭
   steer 那一轮的 step 数 = 2 | 被引导 = true | 引导次数 = 1
   ↑ 对比 ⑤ 的 followup：steer 没有新开 turn，而是在同一个 turn 里多走了一步
```

**同样都是"入队 + 唤醒"，`followup` 落到新的一轮（turn 2、turn 3），`steer` 落在本轮的下一个
step（turn=4 的 step=2）。** 这条对照就是 § 6.1 那张表的运行时证明。

最后是两条队列的归因视图与清空：

```text
⑦ 两条引导的 spliced 对照（target 决定落在哪条队列）:
   target=next-step source=plugin → "背景：这是个演示。"
   target=next-turn source=user   → "开始吧"
   ...
   target=next-step source=plugin → "继续：还有事没做完"

⑧ clear：丢弃全部待认领消息
   inbox 状态: nextStep = 0 | nextTurn = 0
```

⑦ 里每条消息都带 `target` 与 `source`，`target` 决定它落在哪条队列，`source` 说明它是谁塞的
（`user` / `plugin` / `hook`……）。⑧ 的 `clear()` 把两条队列都清空。

### 6.3 归因：失败也要能落到某个包

观察要能回放，干预要能归属。打开 [`impl/05-invariants.ts`](../M04-agent-loop-intervention/impl/05-invariants.ts)，
整个文件只有两行：

```ts
/** 集中注册包归属的运行时不变量；失败会带 packageName 和稳定错误类型。 */
export { InvariantRegistry as default, InvariantRegistry, InvariantError } from '@deepseek-ai/dsh-invariants'
```

M04.5 的真实输出：

```text
invariants: {
  service: 'InvariantRegistry',
  selectedInstallerRan: true,
  duplicateNamesFailLoud: true
}
```

- `service: 'InvariantRegistry'`：场景里那个 `@example/teaching-check` 注册项确实跑起来了
  （`selectedInstallerRan: true`），说明 `package_allowlist: ['^@example/']` 选中了它——**过滤不通过
  的包，名字也会被预留，只是检查不运行**。
- 失败不是一句泛泛的断言错误：`InvariantError` 带 `readonly packageName`，**谁违反契约是可机读的**。
- 关于第三项 `duplicateNamesFailLoud: true`：它在
  [`scenes/05`](../M04-agent-loop-intervention/scenes/05-attribute-invariant-failure.ts) 里是**写死的
  字面量**，不是当场测出来的。我另外单独跑了一次重名注册复现，registry 确实直接抛错
  （`invariants: package "…" is already registered`）——这条复现不属于 `M04.log`，只是补证。

`impl/04` 的内存遥测账本（M04.4）是同一思路在观察侧的收口：`MemorySessionTelemetry` 只是把
每条 record 推进内存数组（`structuredClone` 后入库），**不发网络**；生产里换成 OTel backend 即可。
真实输出：

```text
sessionTelemetry: {
  backend: 'MemorySessionTelemetry',
  records: 1,
  channels: [ 'ledger' ],
  eventTypes: [ 'user/message' ]
}
```

场景只 `append` 了一条 `user/message`，账本就捕获到 1 条——**账本跟着会话日志走，而不是跟着
provider 走**。

> **原理对照**：`agent/inbox/spliced` 的事件结构与它承诺的"先派发、后改投影"顺序见
> [06 § 6.9](../../docs/hello-dsh/06-agent-loop-and-session-log.md)。

---

## 7. 排障：`inject` 了上下文，driver 却一动不动

### 症状

你在 turn 开始前 `agent.inject(...)` 喂了一段背景，然后**什么都没发生**：没有新的 `pre-step`、
没有模型请求、`step` 数不涨。程序不报错——只是安静地没反应。

### 定位

1. 先打印 `agent.inbox.nextStep.length`。第 2 节 ① 那行给出的正是这个现场：

   ```text
   inbox 状态: nextStep = 1 | nextTurn = 0
   ↑ 排进去了，但 driver 没被叫醒 —— inject 不唤醒
   ```

   队列里有 1 条，但 driver 状态仍是 idle。**"消息在队列里"和"循环在跑"是两件事。**
2. 再看下一条日志：只要你再 `followup()` 或 `steer()`（或任何一次真正唤醒的输入），
   那条 `inject` 的消息就会在**下一个 step 的认领边界**被一起取走——见 ②：

   ```text
   [inbox] pre-step turn=1 step=1 认领 2 条 (source: plugin, user)
   ```

### 原因与修改

`inject` 的语义是 `send(message, 'next-step', false)`：**路由对、唤醒关**。它的设计目的就是
"补充模型可见上下文，但不自己触发一次模型调用"，避免每注入一条上下文就白跑一个 step。

按意图二选一：

| 你想要的效果 | 用哪个 |
|---|---|
| 排好上下文，等下一次真正的输入一起带上 | `inject`（保持现状，别指望它自己跑） |
| 现在就让 running 的 driver 多走一步 | `steer`（`nextStep` + 唤醒） |
| 把这条消息排到**下一轮**，并立刻开工 | `followup`（`nextTurn` + 唤醒） |

顺带记住另一个更容易致命的坑：在 `pre-step` 这种 **waterfall** 上，**纯观察也必须 `return next()`**。
忘了写不会"没反应"，而是把整条链（包括主循环的默认进入决定）一起接管掉，这一步就进不去了。
判断口诀：**`emit` 不用交回；`waterfall` 必须 `return next()`；`serial` 根本没有 `next()`。**

---

## 8. 代码在哪

```bash
cd dsh-example && ls M04-agent-loop-intervention/impl M04-agent-loop-intervention/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/01-agent-events-telemetry.ts`](../M04-agent-loop-intervention/impl/01-agent-events-telemetry.ts) | `inject = []` 的含义、`session/event` 的 switch、没有 `assistant/chunk` 的注释、`try/catch` 自我隔离 |
| [`impl/02-lifecycle-steering.ts`](../M04-agent-loop-intervention/impl/02-lifecycle-steering.ts) | 两个 `return next()` 的注释、`agent/session-start` 是 emit、`turn-stopping` 里 `hasSteered` 上限与 `agent.steer(...)` |
| [`impl/03-agent-inbox.ts`](../M04-agent-loop-intervention/impl/03-agent-inbox.ts) | 文件头那张四通道表、`agent/pre-step` 里怎么读出 `payload.messages` 的 `source.kind` |
| [`impl/04-session-telemetry.ts`](../M04-agent-loop-intervention/impl/04-session-telemetry.ts) | `MemorySessionTelemetry` 的 `emit`（只入内存）、`capture: 'live' / includeHistory` |
| [`impl/05-invariants.ts`](../M04-agent-loop-intervention/impl/05-invariants.ts) | 两行 re-export：`InvariantRegistry` + `InvariantError` |
| [`scenes/02-steer-at-boundary.ts`](../M04-agent-loop-intervention/scenes/02-steer-at-boundary.ts) | 最短的一次"真实 turn + 引导"，以及三个数字的来源说明 |
| [`scenes/03-compare-inbox-channels.ts`](../M04-agent-loop-intervention/scenes/03-compare-inbox-channels.ts) | 四通道各调一次；`spliced` 流水的打印方式 |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**。

---

## 9. 动手练习

### 练习 A：把 `turn-stopping` 的引导从 steer 换成 inject

打开 [`impl/02-lifecycle-steering.ts`](../M04-agent-loop-intervention/impl/02-lifecycle-steering.ts)，
把 `agent.steer({...})` 改成 `agent.inject({...})`。

**验证命令**

```bash
cd dsh-example && npm run M04
```

**可验证答案**：M04.2 的 `本轮实际 step 数` **仍然是 2**，`累计 steer 次数` 仍然是 1。
原因就是第 5 节那条 "data decides"：`turn-stopping` 之后主循环重读的是 `inbox.nextStep`
**有没有内容**，而不是"有没有被唤醒"——`inject` 与 `steer` 往的是同一条队列（`next-step`），
所以结果一样。真正会变的是**没有唤醒语**：在有并发的场景里，`inject` 不会去打断 driver 的等待。

### 练习 B：把引导改成 followup，看它跑到哪一轮

同样在这个文件里，把 `agent.steer(...)` 改成 `agent.followup({...})`。

**验证命令**

```bash
cd dsh-example && npm run M04
```

**可验证答案**：本 turn 的前两步与原来一致（`pre-step：turn=1 step=2` 仍会出现——它来自
"跑一个 turn"那次 `runTurn` 的 **followup 唤醒**，不是来自 `turn-stopping`）；差别在于
`turn-stopping` 之后**又多了一轮**：`[hooks] pre-step：turn=2 step=1`。同时
`累计 steer 次数` 变成 `0`——因为统计口径是 `agent/inbox/spliced` 里 `target='next-step'`
的插入，而 `followup` 写的是 `next-turn`。这条练习把 § 6.1 那张表从"读"变成"跑"。

### 练习 C（进阶）：让 `inject` 的消息"可读"

在 [`scenes/03`](../M04-agent-loop-intervention/scenes/03-compare-inbox-channels.ts) 的
`[inbox] pre-step` 那行打印后面，补上每条消息的文本（`payload.messages.map(m => m.content[0].text)`）。

**验证命令**

```bash
cd dsh-example && node M04-agent-loop-intervention/scenes/03-compare-inbox-channels.ts
```

**可验证答案**：第 ② 段 `turn=1 step=1 认领 2 条` 里，第一条来自 `plugin`（`"背景：这是个演示。"`），
第二条来自 `user`（`"开始吧"`）。这直接证明 `inject` 的上下文**确实进了模型的输入**，
只是它不负责叫醒 driver；同时也解释了为什么顺序是 `plugin` 在前——`claim` 先清空
`next-step` 队列，再取一条 `next-turn`。

---

**下一课** → [第 05 课 · 会话面：日志是事实，surface 是投影](05-session-surface.md)：把"发生过的事"与"模型看见的事"分开。
