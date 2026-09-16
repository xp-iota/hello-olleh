# 第 12 课 · 框架机制本体：派发语义与生命周期

> **本课任务**：用同一批 `ctx.on(name, fn)` 监听器，分别走五种派发模式，看它们的语义差在哪；
> 再把定时器、Fiber 依赖状态、服务隔离、调用域配置四件事各跑一遍真实输出。
> **运行命令**：`cd dsh-example && npm run M12`
> **你将看到**：`emit` 立即返回而异步观察者晚到；`parallel` 里慢的注册在前却后完成；
> `return 0` 意外截链；`bail` 把一个未决 Promise 当成了返回值；fiber 卸载时挂起的 `timeout` 被拒。

前置：[第 01 课 · 工具管线](01-tool-pipeline.md)。本课是系列的最后一课，输出全部来自真实运行。

---

## 1. 本课任务

前面 11 课都在用框架（注册工具、挂钩子、装配上下文）。这一课掉过头，看**框架自己**：

同一句 `ctx.on('demo/pick', fn)` 注册的监听器，派发方式一换，语义就完全变了。
M12 就是把这五个机制各演一遍：

| 机制 | 回答的问题 | 本课实现 |
|---|---|---|
| **dispatch 派发模式** | 一批监听器怎么组合、怎么返回值？ | [`impl/01-dispatch-modes.ts`](../M12-framework-mechanisms/impl/01-dispatch-modes.ts) |
| **timer 定时器** | 延时/轮询资源归谁管？ | [`impl/02-cordis-timer.ts`](../M12-framework-mechanisms/impl/02-cordis-timer.ts) |
| **Fiber 状态机** | 插件什么时候才算"活着"？ | [`impl/03-fiber-state-machine.ts`](../M12-framework-mechanisms/impl/03-fiber-state-machine.ts) |
| **isolate realm** | 同名服务怎么互不串门？ | [`impl/04-isolate-realm.ts`](../M12-framework-mechanisms/impl/04-isolate-realm.ts) |
| **intercept config** | 同一份服务怎么按调用域换配置？ | [`impl/05-intercept-config.ts`](../M12-framework-mechanisms/impl/05-intercept-config.ts) |

```bash
cd dsh-example && npm run M12
```

---

## 2. 真实输出

```text
████ M12 · 框架机制本体：事件语义与生命周期资源 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M12.1 · 对照五种事件派发模式 ────
① emit：同步广播，立即返回，不等任何 Promise
  [观察者 A] 看到 hello
  [观察者 B] 看到 hello
  → emit 已返回（异步观察者 C 此时还没打印）
  [异步观察者 C] 睡够 20ms 才看到 hello

② parallel：并发等齐，完成顺序由耗时决定（A 注册在前但更慢）
  [持久化 B] 已落盘 batch-1（耗时 10ms）
  [持久化 A] 已落盘 batch-1（耗时 50ms）
  → 全部 settle 后才走到这里

③ parallel：有监听者拒绝 → AggregateError
  [持久化 A] 已落盘 fail（耗时 50ms）
  → 捕获 AggregateError，内含 1 个失败: 模拟持久化后端故障

④ serial：按序 await，首个 bail 值截链（监听者全同步）
  [候选 A] 不接盘（return undefined → 继续问下一个）
  [候选 B] 接盘 1 → 返回 bail 值截链
  → 返回值 = winner:1

⑤ bail：同一批监听者走同步版本，结果与 ④ 完全一样
  [候选 A] 不接盘（return undefined → 继续问下一个）
  [候选 B] 接盘 2 → 返回 bail 值截链
  → 返回值 = winner:2

⑥ waterfall：最后一个实参是内建默认（base），外层监听者包装内层结果
  [B] 观察到输入 "原始文本"，交回 next()
  → 返回值 = 【A 包装】【内建默认】原始文本

⑦a isBailed 边界：return 0 会「意外」截链（0 既非 null 也非 false/undefined）
  [返回 0 的监听者] 0 既不是 null 也不是 false/undefined → 竟然截链了
  → 返回值 = 0

⑦b 换成异步监听者：serial 与 bail 的唯一差别在这里暴露
  [异步候选] 睡够 30ms 才返回 3
  serial → 返回值 = async-winner:3
  bail   → 返回值 = Promise { <pending> }
  bail 没 await，直接把未决 Promise 当成了截链值 —— 这是用 bail 接异步监听者的坑。
  [异步候选] 睡够 30ms 才返回 4
REAL_STAGE_OK M12.1 calls=1 ms=1600 in=0 out=90 finish=stop

──── M12.2 · 验证绑定 Fiber 的可处置定时器 ────
① timeout(delay) → Promise（可 await 的延时）
   50ms 到了

② timeout(cb, delay) → disposer（回调版）
   回调版 timeout 触发

③ interval(delay) → AsyncIterableIterator（消费 3 个 tick 后停）
   tick 1
   tick 2
   tick 3

④ debounce：连续调用只触发最后一次
   [debounced] 第三次（只有我会触发）

⑤ 插件里的 throttle 监听器：跑一个真实 turn，高频 session/event 被节流
  [throttled] session/event: agent/inbox/spliced
  [throttled] session/event: request/context
  [throttled] session/event: assistant/message

⑥ dispose：fiber 卸载时挂起的 timeout Promise 被拒
   被拒: Context has been disposed
REAL_STAGE_OK M12.2 calls=1 ms=2760 in=0 out=73 finish=stop "滴，收到～有什么需要我帮忙的吗？"

──── M12.3 · 观察 Fiber 依赖状态机 ────
FiberState: {
  beforeDependency: 'PENDING',
  afterDependency: 'ACTIVE',
  afterDispose: 'DISPOSED'
}
REAL_STAGE_OK M12.3 calls=1 ms=1557 in=0 out=79 finish=stop

──── M12.4 · 隔离同名服务 realm ────
isolate: { root: 'root', isolated: 'isolated', separated: true }
REAL_STAGE_OK M12.4 calls=1 ms=2604 in=0 out=57 finish=stop

──── M12.5 · 叠加调用域 intercept 配置 ────
intercept: {
  base: { mode: 'safe', budget: 100 },
  scoped: { mode: 'strict', budget: 40 },
  bothViewsAreDemoPolicy: true,
  traceProxyIdentityDiffers: true
}
REAL_STAGE_OK M12.5 calls=1 ms=14353 in=0 out=71 finish=stop

REAL_MODULE_OK M12 stages=5 calls=5 failed=0
```

**对照自己的输出**：最后一行必须精确出现 `REAL_MODULE_OK M12 stages=5 calls=5 failed=0`。
五个阶段各自还要有 `REAL_STAGE_OK M12.N` 那一行；本课只有 M12.2 是 `kind: 'model'`（真的跑了一个
turn，所以它那行末尾带模型回答 `"滴，收到～有什么需要我帮忙的吗？"`），另外四阶段是 `kind: 'mechanism'`，
不发请求。`failed=0` 说明五次派发全部按预期落地。

---

## 3. 派发模式：同一批 `ctx.on`，五种语义

打开 [`impl/01-dispatch-modes.ts`](../M12-framework-mechanisms/impl/01-dispatch-modes.ts)。这是全课最重的一节。

### 五条派发路径

| mode | 语义 | DSH 的用法 |
|---|---|---|
| `emit` | 同步即发即忘；返回值和 Promise **都被忽略** | `session/event` |
| `parallel` | 并发发起，等全部 settle；任一拒绝聚合成 `AggregateError` | `session/flush` |
| `serial` | 按注册顺序逐个 `await`；首个 `isBailed` 值截链 | `agent/turn-stopping` |
| `bail` | `serial` 的**同步版本**，其余语义相同 | 责任链"谁来处理？" |
| `waterfall` | **中间件**而非责任链：围绕 `next()` 组合，**最后一个实参是内建默认** | `llm/stream`、`tools/pre-execute` |

**这五条跑的是同一批监听器**——模式不是监听器的属性，而是**派发方**的选择。后面 ①②③ 用的是
同一个 `demo/flush` 的两条监听器，只是分别走 `parallel` 两次（一次成功一次失败）。

### 唯一的判别准则

`serial` / `bail`（以及 `parallel` 的"等齐"）之间都好分辨，真正容易混淆的是 `waterfall`：

> **转发之后，还能不能拿回控制权、加工下游的结果？**

- **能 → 中间件（`waterfall`）**：`await next()` 拿到下游结果再包装。看 ⑥ 的输出——
  返回值 `【A 包装】【内建默认】原始文本` 是**由外向内包出来**的。
- **不能 → 责任链（`serial` / `bail`）**：接盘者一旦返回值就截链，转发者交出控制权就再也回不来。
  ④ 里候选 A `return undefined` 只是"不接盘"，真正的接盘者是 B。

`waterfall` 还有一条责任链没有的性质：**必有内建默认**。⑥ 里调用方把 `() => Promise.resolve('【内建默认】原始文本')`
作为最后一个实参传进去，那是链条的地板。监听者只要不调 `next()`，就能**同时否决下游监听器和这个内建默认**——
责任链里"没人接盘就落空"，中间件里"没人转发就否决默认"，方向正好相反。

```ts
// 外层：先让内层产出结果，再加工
ctx.on('demo/wrap', async (_text, next) => {
  const inner = await next()
  return `【A 包装】${inner}`
})
// 内层：只是观察一下，然后原样交回
ctx.on('demo/wrap', (text, next) => {
  console.log(`  [B] 观察到输入 ${JSON.stringify(text)}，交回 next()`)
  return next()
})
```

`waterfall` 常被当成责任链，其实两者的差别正是上面这一条准则。完整原理见
[`06 § 6.3`](../../docs/hello-cordis/06-event-system-and-waterfall.md)（§ 6.3.6 是分界），本仓库只在那里展开。

### ② `parallel` 的完成顺序由耗时决定

监听器的**耗时和注册顺序是刻意安排的**，每一组都在暴露一个特征：

```ts
ctx.on('demo/flush', async (tag) => {
  await sleep(50)                                    // A：慢，但注册在前
  console.log(`  [持久化 A] 已落盘 ${tag}（耗时 50ms）`)
})
ctx.on('demo/flush', async (tag) => {
  await sleep(10)                                    // B：快，但注册在后
  if (tag === 'fail') throw new Error('模拟持久化后端故障')
  console.log(`  [持久化 B] 已落盘 ${tag}（耗时 10ms）`)
})
```

真实输出里 **B 的 10ms 那行先打印，A 的 50ms 那行后打印**——A 注册在前也没用：

```text
  [持久化 B] 已落盘 batch-1（耗时 10ms）
  [持久化 A] 已落盘 batch-1（耗时 50ms）
  → 全部 settle 后才走到这里
```

这是 `parallel` 与 `serial` 最直观的分界：**并发下顺序由耗时决定，注册顺序不再有意义**。
`→ 全部 settle 后才走到这里` 则说明 `parallel` 仍然会等——`emit` 是不会等的（① 里异步观察者 C
在 `emit 已返回` 之后才打印）。

### ③ 一个监听者拒绝 = `AggregateError`

```text
  [持久化 A] 已落盘 fail（耗时 50ms）
  → 捕获 AggregateError，内含 1 个失败: 模拟持久化后端故障
```

`parallel` 用的是 allSettled 语义：**单个失败不影响其余监听者**（A 照常落盘），但失败会聚合上报。
注意 `aggregate.errors.length` 是 **1**，不是 2——只有 B 抛了。

### ④⑤ 全同步时，`serial` 与 `bail` 完全一样

```text
  [候选 A] 不接盘（return undefined → 继续问下一个）
  [候选 B] 接盘 1 → 返回 bail 值截链
  → 返回值 = winner:1
```

返回值分别是 `winner:1` 和 `winner:2`（只是传入的 `n` 不同），监听器行为逐行一致。
**两者唯一的差别是 `serial` 会 `await`，`bail` 不会**——在同步监听者上这个差别看不见，
到 ⑦b 就暴露了。

### ⑦a `return 0` 会"意外"截链

```text
  [返回 0 的监听者] 0 既不是 null 也不是 false/undefined → 竟然截链了
  → 返回值 = 0
```

`isBailed` 只把 `null` / `false` / `undefined` 当作"不接盘"。`0` 既不等于 `null` 也不 `=== false`，
于是被判为**有效返回值**，链就此截断。证据是**缺了一行**：impl 里注册了第二个监听器
`[下游监听者] 我本该执行，却被那个 0 截断了`，它在真实输出里根本没有出现。`''`、`NaN` 同理。

### ⑦b 换异步监听者：`bail` 的 Promise 泄漏

这是本课最值钱的一个坑，也是 [`README.md`](../M12-framework-mechanisms/README.md) 写在"边界"里的那条：

```ts
ctx.on('demo/pick-async', async (n) => {
  await sleep(30)
  console.log(`  [异步候选] 睡够 30ms 才返回 ${n}`)
  return `async-winner:${n}`
})
```

```text
  [异步候选] 睡够 30ms 才返回 3
  serial → 返回值 = async-winner:3
  bail   → 返回值 = Promise { <pending> }
  bail 没 await，直接把未决 Promise 当成了截链值 —— 这是用 bail 接异步监听者的坑。
  [异步候选] 睡够 30ms 才返回 4
```

`serial` 会 `await`，拿到的 `async-winner:3` 是**真值**。`bail` 不同步等，它看到异步函数返回的
Promise 是个非空值，就把它当成了截链值——于是调用方拿到 `Promise { <pending> }`，真正的结果
`async-winner:4` **在 30ms 后才打印，且已经没人接收**（scene 用 `await leaky` 兜了一下，免得它
和后续输出交错）。

**结论**：`bail` 只适合全同步监听器。容忍不了 Promise 泄漏，就必须换成 `serial`（要返回值）
或 `parallel`（只要都跑完）这类异步派发模式。这也是 scene 里为什么专门留了 ⑦b 这一段。

### 顺带：类型化事件表

同一个 impl 文件开头用模块增强把自定义事件声明进了 cordis 的 `Events`：

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'demo/observe'(tag: string): void
    'demo/flush'(tag: string): Promise<void>
    'demo/pick'(n: number): string | undefined
    'demo/wrap'(text: string, next: () => Promise<string>): Promise<string>
  }
}
```

声明之后，`ctx.on` / `ctx.emit` / `ctx.serial` 的**参数和返回值都被 TS 检查**：事件名敲错一个字
直接编译不过，返回类型写错也过不了。这是把"字符串事件名"这种松散约定收进类型系统的手段——
DSH 的 `session/event`、`tools/pre-execute`、`llm/stream` 全在他们的 `Events` 表里。

---

## 4. 定时器：挂在当前 fiber 的 effect 上

打开 [`impl/02-cordis-timer.ts`](../M12-framework-mechanisms/impl/02-cordis-timer.ts)。

四种形态都各有**回调版**和**无回调版**：

| 形态 | 回调版 | 无回调版 |
|---|---|---|
| `timeout` | `timeout(cb, delay)` → disposer | `timeout(delay)` → `Promise<void>` |
| `interval` | `interval(cb, delay)` → disposer | `interval(delay)` → `AsyncIterableIterator` |
| `throttle` / `debounce` | 返回带 `dispose` 的包装函数 | 同左 |

M12.2 的输出逐条对照：

```text
① timeout(delay) → Promise（可 await 的延时）
   50ms 到了

② timeout(cb, delay) → disposer（回调版）
   回调版 timeout 触发

③ interval(delay) → AsyncIterableIterator（消费 3 个 tick 后停）
   tick 1
   tick 2
   tick 3

④ debounce：连续调用只触发最后一次
   [debounced] 第三次（只有我会触发）
```

③ 里 `break` 之后定时器就没了——`for await` 的 `break` 会调用 `iterator.return()`，
**迭代器协议自己完成了清理**，不需要手工 `clearInterval`：

```ts
for await (const _tick of ctx.interval(30)) {
  console.log(`   tick ${++count}`)
  if (count === 3) break   // break 会调用 iterator.return() → 定时器被清理
}
```

④ 连调三次 `debounced(...)`，输出里只有 `第三次（只有我会触发）`。这是 debounce 的定义行为，
不是 bug。

### ⑤ `throttle` 在真实 turn 里降噪

impl 注册了一个节流到 100ms 的监听器，挂在 `session/event` 上：

```ts
const throttled = ctx.throttle((type: string) => {
  console.log(`  [throttled] session/event: ${type}`)
}, 100)
ctx.on('session/event', (_s: any, event: any) => throttled(event.type))
```

scene 跑了一个真实 turn（`harness.runTurn({ prompt: '滴' })`），事件量很大，输出只剩三行：

```text
  [throttled] session/event: agent/inbox/spliced
  [throttled] session/event: request/context
  [throttled] session/event: assistant/message
```

遥测降噪就是 `throttle` 的典型用途——**事件照常派发，只是打印被节流**，派发本身没有被改动。

### ⑥ dispose 会拒绝挂起的 `timeout`

这是本节的核心，也是 fiber 归属的兑现：

```ts
const pending = ctx.timeout(10_000).then(
  () => '居然 resolve 了?!',
  (error: Error) => `被拒: ${error.message}`,
)
await fiber.dispose()
```

```text
⑥ dispose：fiber 卸载时挂起的 timeout Promise 被拒
   被拒: Context has been disposed
```

定时器是注册在**当前 fiber 的 effect** 上的。fiber 卸载时统一清理：回调版不会再触发，
Promise 版则以 `Context has been disposed` **拒绝**——它不会静默挂到天亮，也不会悄悄 resolve。
原理见 [`03 § 3.2 / § 3.3`](../../docs/hello-cordis/03-fiber-model.md)（`effect()` 是唯一的副作用入口）。

---

## 5. Fiber 状态机：PENDING → ACTIVE → DISPOSED

打开 [`impl/03-fiber-state-machine.ts`](../M12-framework-mechanisms/impl/03-fiber-state-machine.ts)——
整个实现只有 6 行：

```ts
export const name = 'fiber-state-machine-demo'
export const inject = ['lateService']
export function apply(_ctx: Context): void {}
```

`apply` 是空的，`inject` 声明了一个还不存在的服务 `lateService`。scene 分三步取状态：

```ts
const ctx = new Context()
const fiber = ctx.plugin(pendingPlugin)
await Promise.resolve()
const before = stateNames[fiber.state]          // 依赖还没提供
const remove = ctx.provide('lateService', { ready: true })
await fiber
const after = stateNames[fiber.state]           // 依赖满足，fiber 被唤醒
await fiber.dispose()
```

真实输出：

```text
FiberState: {
  beforeDependency: 'PENDING',
  afterDependency: 'ACTIVE',
  afterDispose: 'DISPOSED'
}
```

三个值对应三件事：

1. **`PENDING`**：依赖未满足，`apply` **根本没被执行**。cordis 不报错、不抛异常，就让插件静静地等着。
2. **`ACTIVE`**：`provide('lateService', ...)` 触发级联，fiber 自动激活并运行 `apply`。
3. **`DISPOSED`**：`dispose()` 之后 `uid = null`，**不可复活**。要再用只能重新 `ctx.plugin()`。

> scene 里那个 `stateNames` 数组是手工写的：`FiberState` 是 `const enum`（只在类型期存在），
> Node 原生 TS 运行时读不到枚举名，所以直接按公开数值取下标。状态是**算出来的**不是存的，
> 详见 [`03 § 3.5`](../../docs/hello-cordis/03-fiber-model.md)。

### 为什么第 2 步的坑很值得记

`PENDING` 的可怕之处在于**它不报错**。`runtime/harness.ts` 里就有这个坑的真实注释：

```ts
// 0.1.5 起 AgentLoop 的 static inject 多了 sessionProjections：不装它，
// agent-loop 的 fiber 会停在 PENDING —— 依赖未满足时 cordis 不执行插件，
// 症状是 ctx.agents.create() 报 'no agent factory registered'，而不是报缺依赖。
[SessionProjectionRegistry],
[AgentLoop, { agents: [] }],
```

也就是说：**症状和原因隔了两层**。你看到的是"没有 agent 工厂"，真实原因是"某个你没装的插件
让 AgentLoop 停在 PENDING 了"。遇到"某个插件像是没生效"时，第一反应应该是去查它的 fiber 状态，
而不是去查它自己的代码。

---

## 6. `isolate`：同名服务的独立解析域

打开 [`impl/04-isolate-realm.ts`](../M12-framework-mechanisms/impl/04-isolate-realm.ts)：

```ts
export function apply(ctx: Context, config: Config): void {
  ctx.provide('realmValue', { source: config.source })
}
```

服务名固定是 `realmValue`，只有配置里的 `source` 不同。scene 用 `isolate` 分出两个域：

```ts
const root = new Context()
await root.plugin(realmValue, { source: 'root' })
const isolated = root.isolate('realmValue')
await isolated.plugin(realmValue, { source: 'isolated' })
```

```text
isolate: { root: 'root', isolated: 'isolated', separated: true }
```

同一个服务名 `realmValue`，在根 ctx 上解析出 `source: 'root'`，在 isolate 出来的视图上解析出
`source: 'isolated'`，且 `root.realmValue !== isolated.realmValue`（`separated: true`）——
**两个完全无关的实体，谁也不覆盖谁**。

机制上 isolate 不维护任何作用域表：它生成新的 Symbol 当存储键，派生出一个新 Context 视图，
**符号不同 → 解析不到对方**。空间维度的可见性就是这么解决的，见
[`04 § 4.2 / § 4.5`](../../docs/hello-cordis/04-context-and-reflect-proxy.md)。
DSH 里服务按 realm 隔离，同名服务互不串门靠的正是这个原语
（[`05-startup`](../../docs/hello-dsh/05-startup-and-cordis-runtime.md)）。

---

## 7. `intercept`：不重建实例，只换调用域配置

打开 [`impl/05-intercept-config.ts`](../M12-framework-mechanisms/impl/05-intercept-config.ts)。
`DemoPolicy` 是个普通 `Service`，它的 `resolve()` 干一件事：**沿 `Context.intercept` 的原型链
把每一层的配置收集起来，再浅合并**：

```ts
resolve(): Config {
  const layers: Config[] = []
  let cursor: object | null = this.ctx[Context.intercept]
  while (cursor !== null) {
    const own = Object.getOwnPropertyDescriptor(cursor, 'demoPolicy')?.value as Config | undefined
    if (own !== undefined) layers.unshift(own)      // unshift：越靠近根的越靠前 → 优先级越低
    cursor = Object.getPrototypeOf(cursor) as object | null
  }
  return Object.assign({}, this.base, ...layers)
}
```

scene 叠了两层 `intercept`：

```ts
await root.plugin(DemoPolicy, { mode: 'safe', budget: 100 })
const scoped = root.intercept('demoPolicy', { budget: 40 }).intercept('demoPolicy', { mode: 'strict' })
```

```text
intercept: {
  base: { mode: 'safe', budget: 100 },
  scoped: { mode: 'strict', budget: 40 },
  bothViewsAreDemoPolicy: true,
  traceProxyIdentityDiffers: true
}
```

关键在两个 `true`：

- **`base` 是 `{ mode:'safe', budget:100 }`，`scoped` 是 `{ mode:'strict', budget:40 }`**——
  同一个服务，两个调用域看到两套配置。注意 `budget` 被内层 `40` 覆盖、`mode` 被 `strict` 覆盖，
  这是沿原型链由内向外 `Object.assign` 的结果。
- **`bothViewsAreDemoPolicy: true`**——两边的 `demoPolicy` **都是同一个 `DemoPolicy` 类的实例**。
  intercept 没有复制服务、没有重新构造，只是给这个调用域叠了一层配置视图。
- **`traceProxyIdentityDiffers: true`**——但两者**不是同一个对象**（`root.demoPolicy !== scoped.demoPolicy`），
  它们是不同的 traceable 代理视图。

一句话：**isolate 决定"看到哪个实现"，intercept 决定"以什么参数用"**。这正是
[`04 § 4.2`](../../docs/hello-cordis/04-context-and-reflect-proxy.md) 那句对照，
`Service.resolveConfig` 的原型链实现见 [`05 § 5.7`](../../docs/hello-cordis/05-service-registration-and-dependency-resolution.md)。

---

## 8. 排障：插件"装了但没生效"，还不报错

### 症状

某个你明明装了的插件，行为像是完全不存在：监听器不触发、注册的东西查不到。
控制台**没有任何异常**，`failed=0`。更具体的版本就是 `ctx.agents.create()` 报
`no agent factory registered`——听起来像 AgentLoop 没装，其实它装了，只是没醒。

### 定位

1. 先看这个插件有没有 `export const inject = [...]`，以及那些依赖**是否都被真正装上了**。
2. 拿到它的 Fiber，读 `fiber.state`（就像 [`scenes/03`](../M12-framework-mechanisms/scenes/03-observe-pending-state.ts) 那样）：

```ts
const fiber = ctx.plugin(plugin)
await Promise.resolve()
console.log(fiber.state)   // 1 = PENDING：依赖没满足，apply 从未运行
```

3. **不要去看插件自己的代码**。`PENDING` 时它一行都没执行，代码再对也没用。

### 原因与修改

依赖未满足时 cordis **不执行插件、也不报错**，fiber 静静停在 `PENDING`，等 `provide` 触发级联。
所以真正的问题是"谁该 provide 那个依赖"。修法有两种：

- **补装**：缺哪个补哪个。`harness.ts` 就是这么干的——0.1.5 起 `AgentLoop` 的 `static inject`
  多了 `sessionProjections`，于是它显式地把 `SessionProjectionRegistry` 排在 `AgentLoop` 之前，
  并且**顺序不能反**（`agent-loop` 注入 `agents/sessions/llm/tools/systemPrompt/sessionProjections`，
  必须最后装）。
- **改声明**：如果那个依赖本来就该可选，用 `inject` 的可选写法，而不是让它把 fiber 卡死。

另外注意 `DISPOSED` 是**单向**的：`dispose()` 之后 `uid = null`，同一个 fiber 不能复活，
想再用只能重新 `ctx.plugin()`。

### 第二个症状：`bail` 返回 `Promise { <pending> }`

如果你在输出里看到监听者的返回值是个未决 Promise（⑦b 那种），别怀疑监听器写错了——
**它写的是异步函数，而 `bail` 不 await**。定位方法就是换 `serial` 跑同一批监听器：
`serial` 出真值、`bail` 出 Promise，结论立刻明确。修法是改用 `serial`（要返回值）或
`parallel`（只要都跑完），见本课第 3 节末尾的边界结论。

---

## 9. 代码在哪

```bash
cd dsh-example && ls M12-framework-mechanisms/impl M12-framework-mechanisms/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/01-dispatch-modes.ts`](../M12-framework-mechanisms/impl/01-dispatch-modes.ts) | 开头的 `declare module` 事件表；A/B/⑦a/⑦b 四组监听器的耗时与注册顺序；⑥ 的 `next()` 包装 |
| [`impl/02-cordis-timer.ts`](../M12-framework-mechanisms/impl/02-cordis-timer.ts) | `ctx.throttle(cb, 100)` 的包装函数，以及它挂在插件 Fiber 上的含义 |
| [`impl/03-fiber-state-machine.ts`](../M12-framework-mechanisms/impl/03-fiber-state-machine.ts) | `inject = ['lateService']` + 空 `apply`——最短的状态机示例 |
| [`impl/04-isolate-realm.ts`](../M12-framework-mechanisms/impl/04-isolate-realm.ts) | 固定服务名 `realmValue`、`Config` 校验 `source` |
| [`impl/05-intercept-config.ts`](../M12-framework-mechanisms/impl/05-intercept-config.ts) | `resolve()` 的原型链遍历 + `unshift`；`Object.assign` 的覆盖顺序 |
| [`scenes/01-compare-dispatch-modes.ts`](../M12-framework-mechanisms/scenes/01-compare-dispatch-modes.ts) | 五种派发怎么被调用；`try/catch` 捕 `AggregateError`；`await leaky` 兜底 |
| [`scenes/02-dispose-pending-timer.ts`](../M12-framework-mechanisms/scenes/02-dispose-pending-timer.ts) | `for await ... break`；`fiber.dispose()` 之后取那个被拒的 Promise |
| [`scenes/03-observe-pending-state.ts`](../M12-framework-mechanisms/scenes/03-observe-pending-state.ts) | `stateNames` 手工映射、`ctx.provide` 唤醒、三次取状态 |
| [`scenes/05-layer-intercept-config.ts`](../M12-framework-mechanisms/scenes/05-layer-intercept-config.ts) | 两层 `intercept` 的叠加顺序 |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**。

---

## 10. 动手练习

### 练习 A：亲手制造一次"意外截链"

打开 [`impl/01-dispatch-modes.ts`](../M12-framework-mechanisms/impl/01-dispatch-modes.ts)，
把 `demo/boundary` 那个返回 `0` 的监听器改成 `return undefined`。

**验证命令**

```bash
cd dsh-example && node M12-framework-mechanisms/scenes/01-compare-dispatch-modes.ts
```

**可验证答案**：⑦a 会**多出一行** `[下游监听者] 我本该执行，却被那个 0 截断了`，
且 `→ 返回值 =` 从 `0` 变成 `undefined`。这证明了那次截链纯粹是 `isBailed` 判定的副作用。
（再试试 `return ''` 或 `return NaN`，同样会截链。）

### 练习 B：把 `bail` 换成 `serial`，看 Promise 泄漏消失

打开 [`scenes/01`](../M12-framework-mechanisms/scenes/01-compare-dispatch-modes.ts) 的 ⑦b，把

```ts
const leaky = ctx.bail('demo/pick-async', 4)
```

改成 `await ctx.serial('demo/pick-async', 4)`。

**验证命令**

```bash
cd dsh-example && node M12-framework-mechanisms/scenes/01-compare-dispatch-modes.ts
```

**可验证答案**：`Promise { <pending> }` 那行消失，取而代之的是真值 `async-winner:4`，
而且 `[异步候选] 睡够 30ms 才返回 4` 会出现在返回值那行**之前**（因为 `serial` 真的等了）。

### 练习 C：拿掉 `isolate`，看两个 realm 塌成一个

打开 [`scenes/04-isolate-same-name-service.ts`](../M12-framework-mechanisms/scenes/04-isolate-same-name-service.ts)，
把第二行改成直接用根 ctx：

```ts
// const isolated = root.isolate('realmValue')
await root.plugin(realmValue, { source: 'isolated' })
const isolated = root
```

**验证命令**

```bash
cd dsh-example && node M12-framework-mechanisms/scenes/04-isolate-same-name-service.ts
```

**可验证答案**：`separated` 变成 `false`，且 `root` 与 `isolated` 都会打印 `'isolated'`——
后注册的服务覆盖了同名服务，因为没有 realm 把它们分开。**同名服务的隔离完全来自 `isolate`**。

---

**课程结束** → 回到 [课程首页](../README.md) ｜ 想横向对照另一个框架，见 [iota-example](../../iota-example/README.md)。
