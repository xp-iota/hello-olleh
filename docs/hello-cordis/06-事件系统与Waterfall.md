---
layout: content
title: "06 事件系统与 Waterfall"
parent_url: /docs/hello-cordis/
---

# 06 事件系统与 Waterfall

> **本篇回答**：178 行的 `C/events.ts` 里，五种派发模式的语义差异、waterfall 中间件链的完整原理（§ 6.3，本仓库只在此处展开）、监听器如何被 isolate 过滤、8 个 internal 事件各自的用途。
> **路径缩写**：`C/` = `packages/core/src/`。行号对应快照 `8cc9e33f`。
>
> 🧭 **本篇导览**：6.1–6.2 五种派发模式与 `_resolve()` → 6.3 waterfall 原理（两侧契约 / 逐行解剖 / 执行语义 / 轨迹 / Koa 与责任链对照） → 6.4–6.5 `on()` 与 `EventOptions` → 6.6–6.7 8 个 internal 事件与监听器的 traceable 包装。
>
> 📎 **来源**：本篇为本系列原始篇目，基于 cordiverse/cordis 快照 `8cc9e33f`。

## 6.1 五种派发模式

> 📐 **配套可跑示例**：[`17-dispatch-modes`](../../dsh-example/17-dispatch-modes/README.md) 在真实 `@deepseek-ai/cordis` 上依次运行 `emit`、`parallel`、`serial`、`bail`、`waterfall`。在 `dsh-example/` 执行 `npm run 17`，可直接观察 AggregateError、bail 截链与 waterfall 外层包装内建默认值；实现与断言见 [`index.ts`](../../dsh-example/17-dispatch-modes/index.ts) / [`run.ts`](../../dsh-example/17-dispatch-modes/run.ts)。

`DispatchMode`（`C/events.ts:14`）：

![五种事件派发模式](diagrams/06-dispatch-modes.svg)

**五种事件派发模式** — [交互版](diagrams/06-dispatch-modes.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-dispatch-modes.architecture.json)

- **按用途选模式**：只想广播用 emit，不关心结果 · 想问「谁能处理」用 bail 或 serial · 想改写或替换默认行为用 waterfall
- **非空判定的陷阱**：数字 0 与空字符串都被判为非空 · 监听器返回 0 会意外中断整条链 · 要表达「我不处理」必须返回 null、false 或不返回
- **同步与异步的对应关系**：bail 与 serial 语义相同，差别只在是否 await · emit 与 parallel 同为无返回值的通知 · parallel 用 allSettled，单个失败不影响其余

💡 **`isBailed` 只排除 `null` / `false` / `undefined`**（`C/events.ts:6-8`）。返回 `0`、`''`、`NaN` 都会中断 bail/serial 链。这是个容易踩的坑——如果监听器意外返回了 `0`，后续监听器就不会执行。

| 模式 | 同步/异步 | 中断条件 | 返回值 | 典型用途 |
|---|---|---|---|---|
| `emit` | 同步 | 不中断 | `void` | 状态变化通知 |
| `parallel` | 异步 | 不中断（收集全部错误） | `Promise<void>` | 并发的清理/上报 |
| `bail` | 同步 | 首个 `isBailed` | 该值 | "谁来处理这个？" |
| `serial` | 异步 | 首个 `isBailed` | `Promise<该值>` | 异步版 bail |
| `waterfall` | 取决于监听器 | 由 `next()` 控制 | 链的返回值 | 中间件、拦截、改写 |

## 6.2 `_resolve()`：统一解析调用参数与监听器

`emit`、`parallel`、`serial`、`bail`、`waterfall`（以及已标记为 deprecated 的 `dispatch`）都会先调用 `_resolve(type, args)`。它不执行目标事件的监听器，只负责参数解析、必要时触发 `internal/dispatch`，以及筛选目标回调；实际派发由各方法自己完成（`C/events.ts:72-86`）。

![_resolve 的四步预处理](diagrams/06-resolve-pipeline.svg)

**_resolve 的四步预处理** — [交互版](diagrams/06-resolve-pipeline.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-resolve-pipeline.architecture.json)

- **thisArg 是可选首参**：调用方可以传一个 Context 作为派发上下文 · 不传则为空，监听器的 this 保持默认 · filter 的判定就依赖这个 thisArg
- **internal/dispatch 是审计入口**：除 internal 事件本身外的所有派发都会通知它 · 没有监听器时直接跳过，零开销 · 可视化与埋点靠它拿到全量事件流
- **筛选决定可见范围**：global 事件对所有监听器可见 · 否则用 Context.filter 逐个判定 · 这是 isolate realm 在事件系统里的对应机制

### 6.2.1 参数重载与可变参数数组

公共 API 支持两种调用形式：

```ts
ctx.emit('event', value)
ctx.emit(thisArg, 'event', value)
```

`_resolve()` 会直接修改传入的 `args` 数组：先移除可选的 `thisArg`，再移除事件名；返回后，数组中只剩传给监听器的业务参数（`C/events.ts:72-74`）。因此 `emit` 和 `parallel` 会把同一组剩余参数传给每个监听器，`serial` 与 `bail` 也在每次循环中复用它们。

### 6.2.2 `internal/dispatch` 的观测事件

当事件名不是 `internal/` 开头，且当前存在 `internal/dispatch` 监听器时，`_resolve()` 会额外发出一次：

```ts
this.emit('internal/dispatch', type, name, args, thisArg)
```

因此观测监听器收到的四个参数依次是 **派发类型、事件名、参数数组、thisArg**。内部事件不会触发这一步，避免 `internal/dispatch` 递归通知自身（`C/events.ts:75-77`）。当前实现中，`parallel()` 调用 `_resolve('emit', args)`，所以它在 `internal/dispatch` 中报告的类型也是 `emit`；`serial`、`bail`、`waterfall` 则分别报告自身名称（`C/events.ts:89-90`、`:101-118`）。

### 6.2.3 `Context.filter` 与 `global`

`thisArg?.[Context.filter]` 提供可选的事件可见性过滤器（`C/events.ts:78`）。如果没有过滤器，所有监听器都进入候选列表；如果有过滤器，则只有 `hook.global` 为真，或 `filter.call(thisArg, hook.ctx)` 返回真时，监听器才会保留（`C/events.ts:79-80`）。

Cordis 用这一机制把上下文隔离延伸到事件派发：

- `Service` 的过滤器比较服务所属上下文与监听器上下文的 isolate 键（`C/service.ts:37-39`）。
- `reflect.notify()` 会为 `internal/service` 事件临时构造带过滤器的 `thisArg`（`C/reflect.ts:221-224`）。
- 在 `_resolve` 的过滤步骤中，`global: true` 表示该监听器不受当前 `Context.filter` 限制；它仍然是同一个事件名下的普通 Hook。

## 6.3 waterfall：中间件链

`C/events.ts:117-126` 是全文最巧妙的 10 行：

```ts
waterfall(...args: any[]) {
  const [thisArg, callbacks] = this._resolve('waterfall', args)
  const inner = args.pop()          // ← 最后一个参数是「兜底函数」
  const next = () => {
    const callback = callbacks.shift()
    return callback ? Reflect.apply(callback, thisArg, args) : inner(...args)
  }
  args.push(next)                   // ← 把 next 追加为最后一个参数
  return next()
}
```

![waterfall：监听器组成中间件链](diagrams/06-waterfall-chain.svg)

**waterfall：监听器组成中间件链** — [交互版](diagrams/06-waterfall-chain.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-waterfall-chain.sequence.json)

- **waterfall 与其余四种派发的区别**：emit / parallel / serial / bail 都是把监听器当独立处理器 · waterfall 把它们串成一条可委托的链 · 每个监听器拿到的最后一个参数是 next
- **inner 的位置**：调用方传入的最后一个函数被 pop 出来当兜底 · 它位于链的最内层，所有监听器都不短路时才执行 · 这让插件可以拦截并改写框架默认行为
- **短路的代价**：监听器不调 next 就直接返回，后面的链全部跳过 · inner 也不会执行，默认行为被完全替换 · 注册顺序因此决定了拦截优先级

### 6.3.1 两侧契约：调用方传 `inner`，监听器收 `next`

一次 waterfall 调用，两侧面对的是**同一条签名的两个视角**：

| 侧 | 形态 | 末位参数 |
|---|---|---|
| 调用方 | `ctx.waterfall(name, ...args, inner)` | `inner`：兜底函数（默认实现），链全部让行时才执行 |
| 监听器 | `ctx.on(name, (...args, next) => ...)` | `next`：委托下游（下一个监听器或 inner） |

类型层面看得更清楚（`C/events.ts:27`）：

```ts
waterfall<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>
```

`Events[K]` 的签名里**末位就是 `next`**（如 `internal/update(this: Fiber, config, noSave, next)`，`C/events.ts:173`）。所以调用方的兜底函数恰好落在 `next` 的类型槽位上——一份签名同时约束两侧，链的返回类型也就是签名的返回类型。

### 6.3.2 逐行解剖

| 行 | 做的事 | 关键点 |
|---|---|---|
| `_resolve('waterfall', args)` | shift 掉可选 thisArg 与事件名；按 `Context.filter` 过滤监听器（§ 6.2） | 此后 args 只剩业务参数 + inner；isolate 可见性在此已生效 |
| `inner = args.pop()` | 取出末位兜底函数 | inner 不进派发给监听器的参数列 |
| `callbacks.shift()` | 每次 `next()` 消费一个监听器 | `callbacks` 是 `filter().map()` 产出的**新数组**：破坏性 shift 不碰 `_hooks`；本次链是派发时刻的快照，派发期间的注册/注销不影响它 |
| `args.push(next)` | next 追加为末参 | 监听器签名 `(...args, next)`；**args 数组全程复用**（先 pop 再 push） |
| `return next()` | 启动链并返回结果 | waterfall 自己不 `await`；每次调用新建闭包，嵌套派发互不影响 |

### 6.3.3 执行语义的六条性质

1. **短路即否决**：监听器不调 `next()` 直接返回 → 下游监听器与 inner 全部跳过。**纯观察也必须 `return next()`**，否则等于否决整条链；注册顺序因此决定拦截优先级。
2. **`next()` 无参**：想改写下游看到的东西，只能在调 `next()` 前**就地改共享 args 的元素**——这是"可改写"语义的实现基础，也是污染源（§ 6.2.1 的数组复用）。
3. **同步/异步由监听器决定**：本体没有 async/await，返回类型由事件签名给出。DSH 的 `llm/stream` 签名返回 `AsyncIterable`，监听器因此能逐 chunk 包装流而不必等流结束（见 [DSH 07 § 7.3](../hello-dsh/07-请求管线-LLM工具与提示.md)）。
4. **异常不聚合**：监听器抛错直接穿透给调用方——对照 `parallel` 的 `AggregateError`，链式结构没有并发分支可聚合。
5. **重复调 `next()` 无防护**：同一监听器调两次会消费掉两个下游（Koa 会抛错，cordis 不会）。`next` 是裸闭包，不是 Promise。
6. **可见性与顺序**：链成员经 `_resolve` 的 filter 现算（isolate 感知，§ 6.2.3）；注册顺序即包裹顺序，`prepend: true` = 更外层（§ 6.5）。

### 6.3.4 一条最小执行轨迹

```ts
ctx.on('demo/wrap', (text, next) => `【A】${next()}`)   // 先注册 → 链首 → 最外层
ctx.on('demo/wrap', (text, next) => `【B】${next()}`)

ctx.waterfall('demo/wrap', '原始文本', (text) => `【base】${text}`)
```

洋葱模型——进入时从外到内，返回时从内到外：

```text
waterfall → A('原始文本', next)
  A → next() → B('原始文本', next)
    B → next() → callbacks 已空 → inner('原始文本') → '【base】原始文本'
    B 包装后返回 '【B】【base】原始文本'
  A 包装后返回 '【A】【B】【base】原始文本'
```

若 B 不调 `next()` 直接 `return '【B】接管'`，则 inner 不会执行，最终为 `'【A】【B】接管'`——A 的外层包装仍在，但默认行为已被替换。

> 📐 **配套可跑示例**：这段轨迹就是 [`17-dispatch-modes`](../../dsh-example/17-dispatch-modes/README.md) ⑥ 的真实输出（`npm run 17`）。

### 6.3.5 与 Koa 中间件的对照

与 Koa/Express 中间件是同一个洋葱模型，但 cordis 把它做成了事件系统的一种派发模式，并有三处关键差异：

| | Koa | cordis waterfall |
|---|---|---|
| `next()` | 返回 Promise，强制异步 | 裸闭包，同步友好 |
| 重复调 `next()` | 抛错 | 不防护，多消费一个下游 |
| 链的组成 | 全局 `app.use` 静态列表 | 每次派发经 `Context.filter` 现算；注册即 fiber effect，插件卸载自动摘除（§ 6.4） |

💡 **为什么 cordis 敢这么裸**：链成员资格由运行时上下文动态决定、随插件生命周期自动回收（§ 6.4 的 `fiber.effect()`），不需要 Koa 那种进程级静态防护——"链"本来就是每次派发临时算出来的。

### 6.3.6 与责任链模式的分界

waterfall 常被误认为责任链（Chain of Responsibility）。其实 cordis 把两种模式做成了两种不同的派发模式——§ 6.1 的表里它们各占一行：

| | 责任链（`bail` / `serial`） | `waterfall` |
|---|---|---|
| 回答的问题 | “谁来处理？” | “默认行为怎么被改写或替换？” |
| 结果由谁产生 | 恰好一个接盘者 | 最内层（inner 或截链者）产生，外层逐层加工 |
| 控制流 | 线性：处理**或**转发，转发者不再拿回控制权 | 嵌套：前处理 → `next()` → 后处理（洋葱模型） |
| 截链语义 | 有人**接盘**即成功终止（首个 `isBailed` 值） | 有人**拒绝委托**即否决（不调 `next()`，inner 一并跳过） |
| 内建默认 | 没有；无人接盘则落空 | 必有：调用方的末位实参就是兜底 |

判别准则只有一条：**转发之后还能不能拿回控制权、加工下游结果？** 能，就是中间件语义，与名字无关——Servlet 的 `FilterChain.doFilter()` 名叫“链”，结构上与 `next()` 同构，实为中间件。

💡 **DSH 的 `tools/pre-execute` 是“以责任链方式使用 waterfall”的实例**（[`03-permission-gate`](../../dsh-example/03-permission-gate/index.ts)）：权限门命中黑名单就返回 `{ kind: 'deny' }` 截链（=接盘），否则 `return next()`（=转发）。但底层是 waterfall，下游决定在返回途中仍可被外层加工——这就是“翻案”可能的根源，也是 DSH 要另设不可翻案的 `ctx.tools.guard()` 的原因（[`12-tool-guard`](../../dsh-example/12-tool-guard/README.md)）。

💡 **cordis 内部大量用 waterfall**：`internal/get`、`internal/set`、`internal/update` 三个 internal 事件都是 waterfall（见 § 6.6）。DSH 更是把它当作核心扩展机制——`tools/pre-execute`、`tools/execute`、`tools/post-execute`、`agent/pre-step`、`agent/request-error`、`llm/stream` 全是 waterfall（见 [DSH 07 篇](../hello-dsh/07-请求管线-LLM工具与提示.md)）。**本节（§ 6.3）是本仓库唯一展开 waterfall 原理的位置，其余文档一律引用此处。**

## 6.4 `on()`：注册监听器

`C/events.ts:144-158`：

![on() 注册监听器的六步](diagrams/06-on-register.svg)

**on() 注册监听器的六步** — [交互版](diagrams/06-on-register.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-on-register.architecture.json)

- **为什么要 bind 一层**：监听器内的 this 与参数都要经过 traceable · 这样它登记的副作用才归属正确的调用方 · 代价是监听器拿到的不是原始对象
- **internal/listener 是注册劫持点**：用 bail 派发，任一监听器返回非空即接管 · 可用于把事件转发到别的进程或做去重 · 返回空则走默认注册流程
- **注册本身可逆**：register 包在 fiber.effect 里 · setup 按 prepend 决定 push 还是 unshift · 插件卸载时自动 unregister，不留悬挂监听

💡 **`register()` 走 `fiber.effect()`**（`C/events.ts:130`），所以**监听器随插件卸载自动移除**。这是 cordis 里"一切皆可逆"的又一处体现——你永远不需要手动 `off()`。

💡 **`internal/listener` 的劫持能力**很关键。`EventsService` 构造函数自己就用了它（`C/events.ts:54-60`）：

```ts
this.on('internal/listener', function (this: Context, name, listener, options) {
  if (name === 'internal/update' && !options.global) {
    const hooks = this.fiber._hooks['internal/update'] ??= new DisposableList()
    return hooks[options.prepend ? 'unshift' : 'push'](listener)
  }
})
```

即：非 global 的 `internal/update` 监听器**不进全局 hooks 表，而是挂到当前 Fiber 的 `_hooks` 上**。这让每个插件能拦截"自己的"配置更新，而不是所有插件的。

💡 **配套的第二个钩子**（`C/events.ts:62-68`）：注册了一个 `global: true, prepend: true` 的 `internal/update` 监听器，它把 Fiber 级 `_hooks` 里的监听器串成链再委托给 `next`。**两段配合实现了"per-fiber 的 waterfall"**。

### `once()`

`C/events.ts:160-166`：包一层，在监听器执行前先调 `dispose()`。注意 **返回的是同一个 `dispose`**，所以手动取消也可以。

## 6.5 `EventOptions`

`C/events.ts:35-38`：

| 字段 | 作用 |
|---|---|
| `prepend?: boolean` | `unshift` 而非 `push`，插到链首 |
| `global?: boolean` | **绕过 filter 过滤**（§ 6.2），且不被 `internal/listener` 劫持逻辑处理 |

`Hook` 接口（`C/events.ts:40-43`）在此基础上加 `ctx` 与 `callback`。

💡 **`prepend` 在 waterfall 里意味着"更外层"**：链首的监听器最先拿到控制权，能包住后面所有人。

## 6.6 8 个 internal 事件

`interface Events`（`C/events.ts:169-178`）：

![内建事件的三类用途](diagrams/06-internal-events.svg)

**内建事件的三类用途** — [交互版](diagrams/06-internal-events.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/06-internal-events.architecture.json)

- **三类的派发模式不同**：生命周期类与服务类是通知，用 emit · 可拦截类全部是 waterfall，带 next · 因此只有后者能改写框架行为
- **loader 依赖两个事件落地**：internal/plugin 用来绑定 Entry 与 Fiber · internal/update 用来把配置变更写回 yml · 这是配置树与运行时之间的唯一接缝
- **internal 事件不递归上报**：internal/dispatch 只通知非 internal 事件 · 否则会形成无限自我通知 · 定义见 interface Events（events.ts:169-178）

💡 **`internal/get` 是极强的扩展点**。它让插件能在"服务查找失败之前"介入——比如实现懒加载、远程代理、或者 mock。DSH 没有直接用它，但 cordis 的 loader 用 `internal/update` 做了配置持久化。

💡 **注意 `internal/status` 的注释**（`C/fiber.ts:359`）：`// FIXME internal/fiber-info`——上游认为这个事件名/形态还需要改。**读到 FIXME 就知道这块 API 不稳定。**

💡 **`internal/listener` 的类型声明落后于实现**。`interface Events`（`C/events.ts:176`）把第三个参数写成 `prepend: boolean`，但 `on()` 实际传的是整个 `EventOptions` 对象（`C/events.ts:152`），构造函数里的自注册钩子也是按 `options.global` / `options.prepend` 读的（`:55`、`:57`）。**按类型签名写成布尔会拿不到 `global` 字段**——以实现为准。

## 6.7 `ctx.reflect.bind()`：监听器的 traceable 包装

`C/reflect.ts:271-280`：

```ts
bind<T extends Function>(callback: T) {
  return new Proxy(callback, {
    apply: (target, thisArg, args) => {
      return Reflect.apply(target, this.trace(thisArg), args.map(arg => this.trace(arg)))
    },
    construct: (target, args, newTarget) => {
      return Reflect.construct(target, args.map(arg => this.trace(arg)), newTarget)
    },
  })
}
```

💡 **每个监听器的 `this` 和全部参数都过一遍 `getTraceable`**。所以事件参数里如果传了服务对象，监听器拿到的是"以自己为调用方"的 traceable 代理——它在其上注册的效应归属自己的 Fiber。这是 cordis 保证"跨插件传递对象也不泄漏"的手段。

💡 **代价是性能**：每次事件派发都要为参数创建 Proxy。对高频事件（如每 token 一次）需要注意——DSH 的 `assistant/chunk` 是 session 事件而非 cordis 事件，可能正是出于这个考虑。

---

**上一篇** ← [05 服务注册与依赖解析](05-服务注册与依赖解析.md) ｜ **下一篇** → [07 Loader 与配置树](07-Loader与配置树.md)：从 yml 文件到插件树，以及 isolate realm 的 7 步切换算法。
