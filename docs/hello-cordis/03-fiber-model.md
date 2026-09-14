---
title: "Fiber 模型"
---
# Fiber 模型

> **本篇回答**：`C/fiber.ts`（486 行）——cordis 的心脏——同时承担的三件事：可逆效应的登记与回收、6 态生命周期状态机、以及用一个字符串实现的依赖追踪。
> **路径缩写**：`C/` = `packages/core/src/`。行号对应快照 `f8ea3cd5`。
>
> 🧭 **本篇导览**：3.1–3.3 Fiber 与 `effect()` 的返回形态 → 3.4 epoch 依赖追踪 → 3.5–3.6 6 态状态机与父子挂载 → 3.7–3.8 公开 API 与长堆栈。
>

## 3.1 Fiber 是什么

**每一次 `ctx.plugin(p)` 都产生一个 Fiber**（`C/registry.ts:207`），它是"这个插件这一次运行"的全部状态。

![Plugin / Runtime / Fiber 三层概念](diagrams/03-three-layers.svg)

**Plugin / Runtime / Fiber 三层概念** — [交互版](diagrams/03-three-layers.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-three-layers.architecture.json)

- **三者的基数关系**：一份代码对应一个 Runtime · 一个 Runtime 对应任意多个 Fiber · Runtime 上的 fibers 列出全部实例
- **Fiber 的身份与状态字段**：uid 是递增序号，为 null 表示已卸载 · state 是六态之一，由其它字段推导得出 · store 是本 Fiber 可见的服务快照，未激活时为空
- **Fiber 的执行与回收字段**：inertia 持有在途的 reload 或 unload 任务，是串行化锁 · _disposables 是本 Fiber 登记的全部可逆效应 · _runner 持有 epoch 与 exec，字段定义见 fiber.ts:104-120

💡 **`uid` 的双重身份**：既是"是否存活"的标志（`null` = 已卸载，`C/fiber.ts:224 assertActive` 就检查它），又是 **epoch 的构成材料**（§ 3.4）。`uid` 从 `parent.registry.counter` 取（`C/fiber.ts:137`），而 `counter` 是个 getter：`get counter() { return ++this._counter }`（`C/registry.ts:136`）——**每次读取都自增**，保证全局唯一且递增。

## 3.2 `effect()`：唯一的副作用入口

> 📐 **配套可跑示例**：[`M12 cordis-timer`](../../dsh-example/M12-framework-mechanisms/README.md) 把 timeout、interval、throttle、debounce 都挂到真实 cordis Fiber 的 effect 上。在 `dsh-example/` 运行 `npm run M12`，最后一步会卸载插件 Fiber，并验证挂起的 timeout Promise 以 `Context has been disposed` 拒绝。重点对照 [`run.ts`](../../dsh-example/M12-framework-mechanisms/phases/02-dispose-pending-timer.ts) 的第 ⑥ 步。

这是 cordis 的核心契约：**插件做的任何有副作用的事，都必须通过 `ctx.effect()` 登记，并返回撤销它的函数。**

![ctx.effect() 的九步登记流程](diagrams/03-effect-pipeline.svg)

**ctx.effect() 的九步登记流程** — [交互版](diagrams/03-effect-pipeline.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-effect-pipeline.architecture.json)

- **为什么先断言活性**：已卸载的 Fiber 不能再登记新效应 · 否则 disposer 永远不会被执行 · 这是防止资源泄漏的第一道闸门
- **wrapper 的双重身份**：作为函数调用即触发 dispose · 作为对象挂着 symbols.effect 的 EffectMeta · 加 then 后可以 await 出 disposer 而不误触发
- **登记是双向的**：wrapper 进入 fiber._disposables · 把「从 fiber 摘除」也存进本地 disposables · 因此局部 dispose 不会在 Fiber 上留下悬挂项

### 返回值的双重身份

`effect()` 返回的 wrapper 是 cordis 里最巧妙的 API 设计之一（`C/fiber.ts:322-337`）：

```ts
const dispose = ctx.effect(() => {
  const conn = connect()
  return () => conn.close()
})

dispose()               // ① 当函数用：立即撤销
const d = await dispose // ② 当 thenable 用：等 setup 完成，拿到 disposer
```

实现方式：

| 用法 | 代码位置 | 行为 |
|---|---|---|
| `dispose()` | `:322-327` | `if (!runner.epoch) return`（幂等）→ `runner.epoch = false` → `task ? task.then(dispose) : dispose()` |
| `await dispose` | `:333-336` | `Promise.resolve(task).then(() => disposeAsync)` —— **返回的是 `disposeAsync` 函数本身**，不执行它 |

💡 **为什么需要 thenable？** 因为 effect 的 setup 可能是异步的（返回 Promise 或 AsyncIterable）。同步调 `dispose()` 时框架内部会 `task.then(dispose)` 排队，但调用方无法知道 setup 是否已完成。`await dispose` 给出了"等 setup 稳定后再决定"的能力。

💡 **幂等靠 `runner.epoch` 这个布尔**（注意与 Fiber 级 epoch 字符串不是一回事，只是复用了字段名）。第二次调用 `dispose()` 直接 return。

### `dispose()` 的逆序 + 异步链

`C/fiber.ts:281-294`：

```ts
const dispose = () => {
  let task!: void | Promise<void>
  for (const dispose of disposables.splice(0).reverse()) {   // ← 逆序
    if (task) {
      task = task.then(dispose)                              // ← 串成链
    } else {
      const result = dispose()
      if (isObject(result) && 'then' in result) {
        task = result as any
      }
    }
  }
  return task
}
```

💡 **`splice(0).reverse()`** 一次做两件事：清空原数组（保证幂等）+ 逆序。**先注册的最后撤销**——这是资源清理的正确顺序（先开的连接最后关）。

💡 **一旦某个 disposer 返回 Promise，后续全部串行等待**。前面的同步 disposer 直接执行，不等待。这是"尽快同步清理、必要时才异步"的折中。

💡 **务必区分两级卸载语义**——这是最容易被读者混淆的一点：

| 层级 | 实现 | 顺序保证 |
|---|---|---|
| **单个 effect 内部** | 上面这段 `dispose()`（`C/fiber.ts:281-294`）：`splice(0).reverse()` 逆序 + `task.then(...)` 串链 | **严格逆序、严格串行** |
| **Fiber 级卸载** | `_unload()`（`C/fiber.ts:437-458`）：`await Promise.all(this._disposables.clear().map(...))` | `clear()`（`C/utils.ts:26-30`）返回的数组确实逆序（`values.reverse()`），但 `Promise.all` 让它们**并发**执行——只有启动顺序，没有完成顺序 |

所以：**跨 effect 的清理依赖不能指望注册顺序**。如果 B 的清理必须等 A 完成，就要把两者放进同一个 effect（生成器形态 yield 两个 disposer），而不是分成两次 `ctx.effect()`。后文所有提到「卸载时逆序执行全部 disposer」的地方，都应按这张表理解。

## 3.3 effect 支持的返回形态

`Effect` 类型（`C/fiber.ts:54`）声明的是四种**有效**形态——函数 / Promise / Iterable / AsyncIterable；`_execute()`（`C/fiber.ts:229-272`）在此之上还处理两种边界（nullish 直接放行、其余一律抛 `TypeError`），所以下图共六条分支：

![effect 执行体的五种合法返回形态](diagrams/03-effect-return-shapes.svg)

**effect 执行体的五种合法返回形态** — [交互版](diagrams/03-effect-return-shapes.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-effect-return-shapes.architecture.json)

- **四种有效形态加一种拒绝**：Effect 类型在 C/fiber.ts:54 声明 · 函数、nullish、Promise、Iterable、AsyncIterable 均合法 · 其余一律抛 TypeError，不做静默降级
- **生成器形态的堆栈修正**：Iterable 分支会 info.error = new Error() · 目的是重置堆栈锚点，让报错指向 yield 处 · 否则错误会归到遍历循环上
- **异步生成器可被打断**：每轮 yield 后比对 runner.epoch 与开始时的值 · 不一致即中止遍历（:263） · 这让依赖变化能及时终止长流程

💡 **生成器形态（④⑤）是 cordis 的招牌用法**。典型例子是 `C/reflect.ts:239 mixin`：

```ts
mixin(source, mixins) {
  return this.ctx.fiber.effect(function* () {      // ← 生成器 effect
    for (const [key, value] of entries) {
      yield self.accessor(value, { get, set })     // ← 每个 accessor 是一个 disposer
    }
  }, `ctx.mixin(...)`)
}
```

一个 effect 登记 N 个 disposer，卸载时逆序全撤。比手写 `const ds = []; ...; return () => ds.forEach(d => d())` 干净。

💡 **AsyncIterable 形态的 epoch 检查（`:263`）是防"过期任务"的关键**：如果 effect 还在异步初始化过程中 Fiber 就被 unload 了，epoch 已变，循环立即 return，不再 collect 新的 disposer。

💡 **Service 的 `[Service.init]` 常写成 async generator**。cordis 生态里的惯例：

```ts
async* [Service.init]() {
  yield () => this.watcher?.close()   // 先登记清理，再做初始化
  this.watcher = watch(...)           // 这样即使初始化中途失败也能清理
}
```

`packages/hmr/src/index.ts:97` 与 `packages/include/src/index.ts:166` 都是这个模式。

## 3.4 epoch：用字符串实现依赖追踪

这是 cordis 最精妙的设计。**没有依赖图、没有拓扑排序、没有引用计数——只有一个字符串。**

![_refresh() 如何把依赖压成一个字符串](diagrams/03-epoch-refresh.svg)

**_refresh() 如何把依赖压成一个字符串** — [交互版](diagrams/03-epoch-refresh.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-epoch-refresh.architecture.json)

- **举例：inject 为 db 与 cache**：db 的 Fiber uid 是 3，cache 的是 7 · 于是 epoch 等于 ':3:7' · 字符串本身就编码了全部依赖身份
- **依赖换代的效果**：db 卸载重装拿到新 uid 9 · epoch 变成 ':9:7'，与 ':3:7' 不等 · 于是本插件自动 unload 再 reload
- **依赖消失的效果**：cache 不见了，epoch 直接置为 INACTIVE · 触发 unload，状态回落到 PENDING · 没有依赖图、拓扑排序或引用计数

`_refresh()` 全文（`C/fiber.ts:385-397`）：

```ts
_refresh() {
  let epoch: string | boolean = false
  epoch = ''
  for (const name of Object.keys(this.inject)) {
    const impl = this._store[name]
    if (!impl) {
      epoch = INACTIVE
      break
    }
    epoch += ':' + impl.fiber.uid
  }
  this._setEpoch(epoch)
}
```

💡 **为什么用字符串而不是数组或对象？** 因为需要的只有一个操作：**判断"依赖集合的身份"是否变了**。字符串的 `===` 比较是 O(n) 但常数极小，且天然处理"顺序 + 身份"两个维度。用对象要写深比较，用数组要写逐元素比较——字符串把两者压成一次比较。

💡 **`':'` 前缀不可省**。若写成 `epoch += impl.fiber.uid`，则 `[uid=1, uid=23]` 和 `[uid=12, uid=3]` 都产生 `'123'`——**歧义**。加分隔符后是 `':1:23'` vs `':12:3'`。

💡 **无依赖的插件 epoch = `''`**（空字符串），而 `'' !== INACTIVE`，所以 `_getState()`（`:348`）判定它是 ACTIVE。这解释了为什么无依赖插件装上就立即运行。

### `_store` 从哪来

`_checkImpl(name)`（`C/fiber.ts:371-383`）负责填充 `_store`：

![_checkImpl() 如何填充 _store](diagrams/03-check-impl.svg)

**_checkImpl() 如何填充 _store** — [交互版](diagrams/03-check-impl.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-check-impl.architecture.json)

- **strict 的含义**：只接受提供者 Fiber 处于 ACTIVE 的实现 · 半就绪的服务不会被写入 _store · 避免依赖方拿到尚未初始化完的实例
- **check 是提供方的准入钩子**：返回 false 表示该实现对此消费者不可用 · 抛异常会被记进 error 日志后同样删除 · 让同名服务可以按消费者做差异化放行
- **_store 是 epoch 的输入**：_checkImpl 只负责填或删 _store · epoch 完全由 _store 的内容推导 · 两者分离让依赖判定保持无状态

💡 **`impl.check` 是"服务自己说自己还不可用"的机制**。典型用途见 `L/index.ts:133 [Service.check]`：Loader 在还有未完成的加载任务时返回 `false`，让依赖 `loader` 的插件（如 HMR）等到加载完毕才启动。

## 3.5 6 态状态机

`FiberState`（`C/fiber.ts:78-85`）：

![Fiber 的六态状态机](diagrams/03-fiber-states.svg)

**Fiber 的六态状态机** — [交互版](diagrams/03-fiber-states.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-fiber-states.lifecycle.json)

- **_getState() 的判定优先级**：① uid === null 则 DISPOSED · ② _error 存在则 FAILED · ③ epoch 不等于 INACTIVE 则 ACTIVE · ④ 否则 PENDING
- **状态是算出来的，不是存的**：六个状态没有任何一个字段直接保存 · 全部由 uid / _error / epoch 三个量推导（fiber.ts:348） · dispose() 可从 PENDING / ACTIVE / FAILED 任一状态发生，都是置 uid = null
- **迁移触发条件与 UNLOADING 的两条出路**：LOADING → FAILED：_reload 抛异常，_error 被设置且 epoch 强制回 INACTIVE · ACTIVE → UNLOADING：epoch 变为新值或变回 INACTIVE，均触发 _unload() · 卸载完成时再查 epoch：是 INACTIVE 则回 PENDING，已换新值则直接进 LOADING · 后者让热重载可以连续发生，省掉一次回落

### `inertia`：状态机的串行化锁

`_setEpoch()`（`C/fiber.ts:399-413`）的关键一行：

```ts
private _setEpoch(epoch: string) {
  const oldEpoch = this._runner.epoch
  if (epoch === oldEpoch) return          // ← 无变化，直接返回
  this._runner.epoch = epoch
  if (this.inertia) return                // ← ⭐ 有在途任务，只更新 epoch 就返回
  this._updateState(() => { ... })
}
```

💡 **`if (this.inertia) return` 是整套并发控制的核心**。如果正在 reload/unload，新的 epoch 变化只是"记下来"，不启动新任务。等在途任务结束时，`_reload()`（`:415-436`）/ `_unload()`（`:437-459`）的收尾逻辑会**比较 epoch 是否又变了**，决定继续做还是停下：

![epoch 竞态：依赖在加载途中又变了](diagrams/03-epoch-race.svg)

**epoch 竞态：依赖在加载途中又变了** — [交互版](diagrams/03-epoch-race.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-epoch-race.sequence.json)

- **inertia 是防重入闸门**：inertia 非空表示已有一次装卸在途 · 此时 _setEpoch 只更新目标 epoch，不启动新流程 · 因此无论外部改多少次依赖，都只有一条执行链
- **收敛靠尾部比对**：_reload 结束时比对 _runner.epoch 与开始时的 oldEpoch · 不相等说明期间依赖变过，转入 _unload · _unload 结束时再查 epoch 是否 INACTIVE，决定停还是重载
- **为什么不能直接打断**：插件代码正在 await，强行中断会留下未登记的副作用 · 只能等它跑完再整体卸载，保证 disposer 完整 · 代价是一次多余的完整装载，换来可逆性

💡 **这是一个"最终一致"的状态机**：中间可能经历多轮 unload/reload，但最终一定收敛到与最新 epoch 匹配的状态。代价是**中间态可能被跳过**——如果 epoch 快速抖动，某些配置版本可能从未真正运行过。

### 状态变化的通知

`_updateState()`（`C/fiber.ts:355-369`）在状态变化时：

1. `context.emit('internal/status', this, oldState)`（`:360`）
2. **仅当跨越 ACTIVE 边界时**（`:363`：`if (oldState !== ACTIVE && this.state !== ACTIVE) return`），遍历本 Fiber 提供的所有服务，逐个 `reflect.notify([impl.name])`

💡 **第 2 步是级联的起点**：本 Fiber 状态变了 → 通知它提供的服务 → `notify` 找到所有 inject 该服务的 Fiber → 它们 `_checkImpl` + `_refresh` → epoch 变化 → 它们也 reload……**依赖树的传播就是这样一层层展开的**，全程没有显式的图遍历。

## 3.6 构造函数：Fiber 如何挂到父 Fiber 上

`C/fiber.ts:122-212` 是全文最密的一段。非根 Fiber（`runtime !== null`）的流程：

![非根 Fiber 的构造七步](diagrams/03-fiber-construct.svg)

**非根 Fiber 的构造七步** — [交互版](diagrams/03-fiber-construct.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-fiber-construct.architecture.json)

- **第七步是全段的关键**：把「本 Fiber 存在」本身登记为父 Fiber 的一个 effect · 父 Fiber 卸载时会连带拆掉本 Fiber · 插件树的可逆性由此递归成立
- **构造函数与普通函数的差异**：isConstructor 走 new callback(ctx, config) · 随后依次执行 symbols.initHooks 与 symbols.init · 普通函数只是 callback(ctx, config)
- **这一段是全文最密的**：源码位置 C/fiber.ts:122-212 · 根 Fiber 走另一条分支（runtime 为 null） · 派生 Context 早于依赖解析，因此插件内可直接用 ctx

💡 **最后一步是全框架的结构性关键**：子 Fiber 不是被父 Fiber "持有"，而是**作为父 Fiber 的一个可逆效应存在**。所以父插件卸载时，它的 `_disposables` 会被全部执行，其中就包含"卸载子 Fiber"——**插件树的级联卸载是 effect 机制的自然结果，没有额外代码**。

effect 内部（`:171-178`）做的事：
1. `runtime.fibers.push(this)`（登记到 Runtime 的实例表，返回 remover）
2. `this.config = resolveConfig(runtime, config)`（Standard Schema 校验）
3. `this._refresh()`（算 epoch，可能立即启动）
4. 出错则 `logger.error` + 记 `_error`

disposer 内部（`:179-197`）做的事：
1. `uid = null`（标记已卸载）
2. `emit('internal/plugin', this)`（loader 借此判断"自卸载"）
3. 若 registry 里还有这个 callback：`remove()`；若 Runtime 再无 fiber，`registry.delete(callback)`
4. `_setEpoch(INACTIVE)` 触发 unload
5. `while (this.inertia) await this.inertia`（等状态机彻底停下）

💡 **第 5 步的注释很坦诚**（`:189-194`）：`inertia` 本身理论上不会 reject（`_reload`/`_unload` 都自己 catch 并 log），如果真 reject 了只可能是 logger 自身失败，那时无法恢复——"让 rejection 传播，进程崩溃是诚实的结果"（let the rejection propagate; process-level crash is the honest outcome）。

## 3.7 公开 API

| 方法 | 位置 | 作用 |
|---|---|---|
| `effect(execute, label?)` | `:277` | 登记可逆效应（§ 3.2） |
| `getEffects()` | `:342` | 返回 `EffectMeta[]`，用于调试可视化 |
| `assertActive()` | `:224` | uid 为 null 则抛 `CordisError('INACTIVE_EFFECT')` |
| `get name()` | `:215` | 沿 fiber 链向上找第一个有 `runtime.name` 的，否则 `'root'` |
| `await()` | `:460` | 等 `inertia` 清空；有 `_error` 则抛出 |
| `restart()` | `:468` | 强制 `_setEpoch(INACTIVE)` 再 `_refresh()`，然后 `await()` |
| `update(config, noSave?)` | `:476` | 校验新配置 → 走 `internal/update` waterfall → 更新 config 并 restart |
| `dispose` | 构造时赋值（`:173`） | 见 § 3.6 |

💡 **`update()` 走 waterfall 而非直接赋值**（`:480`）。这给了 loader 插入钩子的机会——`L/index.ts:74-86` 注册了两个 `internal/update` 监听器，负责把新配置**写回 yml 文件**并打印 reload 日志。所以在代码里调 `fiber.update(...)` 会持久化到配置文件，除非传 `noSave = true`。

💡 **`restart()` 和 `update()` 都用 `this.ctx.fiber` 而非 `this`**（`:469`、`:477`）。因为 `ctx` 是 Proxy，`ctx.fiber` 经过 traceable 包装后指向调用方视角的 fiber——在嵌套场景下二者可能不同。

## 3.8 错误处理与长堆栈

![长堆栈是怎么拼出来的](diagrams/03-long-stack.svg)

**长堆栈是怎么拼出来的** — [交互版](diagrams/03-long-stack.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/03-long-stack.architecture.json)

- **两个锚点缺一不可**：内层锚点在 composeError 里当场创建 · 外层锚点在插件注册时就已存下 · 拼接点靠内层锚点的第 3 行定位
- **为什么能跨 await**：异步栈天然断在 await 处 · 注册栈是提前捕获的，不受异步影响 · 两段拼起来才还原出完整因果链
- **看到长堆栈不是巧合**：这是刻意设计，不是引擎行为 · 定位失败时保持原样，不掩盖真实错误 · offset 参数用于跳过框架自身的栈帧

💡 **效果**：插件在异步初始化中出错时，堆栈不是止于 `at async Fiber._reload`，而是能一直追到 `ctx.plugin(xxx)` 的那一行。代价是**每次 `effect()` / `plugin()` 都要 `new Error()`**（构造堆栈有开销）。

💡 **loader 进一步扩展了这个机制**：`L/config/entry.ts:136 getOuterStack` 返回的不是 JS 调用栈，而是**配置文件位置**：

```
    at file:///path/cordis.yml#entryId
    at file:///path/parent.yml#parentId
```

这样配置错误能直接定位到 yml 的哪一行。

---

**上一篇** ← [02 代码结构与包边界](02-code-structure-and-package-boundaries.md) ｜ **下一篇** → [04 Context 与 Reflect 代理](04-context-and-reflect-proxy.md)：`ctx` 的 Proxy 魔法、isolate realm、以及 `this` 归属的 traceable 机制。
