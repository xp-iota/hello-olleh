---
layout: content
title: "04 Context 与 Reflect 代理"
parent_url: /docs/hello-cordis/
---

# 04 Context 与 Reflect 代理

> **本篇回答**：`ctx` 为什么是 Proxy、`ctx.db` 这样的属性访问背后发生了什么、isolate realm 如何实现空间隔离、以及 traceable 机制如何让服务方法里的 `this.ctx` 指向调用方。
> **路径缩写**：`C/` = `packages/core/src/`。行号对应快照 `8cc9e33f`。
>
> 🧭 **本篇导览**：4.1–4.2 Proxy 本体与三种派生 → 4.3–4.5 服务解析、`store` 与 isolate realm → 4.6–4.7 traceable 与 mixin → 4.8–4.9 `set` / `has` trap 与 `Context.is`。
>
>
> 💡 **术语**：`trap` 指 JavaScript `Proxy` 的拦截器——`Proxy handler` 上响应对象操作的方法，例如 `get` trap 处理属性读取、`set` trap 处理属性写入、`has` trap 处理 `in` 判断。中文资料有时译作"代理陷阱"，本系列统一保留英文并写作 `get` / `set` / `has` trap。
> 💡 **示例服务名**：本篇的 `db`（如 `ctx.db`）是全系列统一的**示例服务名**（虚构的数据库服务）——cordis 源码中并不存在名为 `db` 的服务，其测试用的是 `foo` / `bar` / `logger` 等占位名；文中所有 `db` 均可替换为任意服务名理解，见[索引术语约定](README.md)。

## 4.1 `ctx` 不是普通对象

`Context` 构造函数的最后一行是 `return self`（`C/context.ts:48`），而 `self` 是：

```ts
const self = new Proxy<this>(this, ReflectService.handler)   // C/context.ts:39
```

**用户拿到的 `ctx` 永远是 Proxy**。这意味着：

![ctx.db 触发的 Proxy get trap 分流](diagrams/04-proxy-get-trap.svg)

**ctx.db 触发的 Proxy get trap 分流** — [交互版](diagrams/04-proxy-get-trap.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-proxy-get-trap.architecture.json)

- **为什么要有特殊属性白名单**：symbol 与 prototype 若走解析会破坏语言语义 · then 必须直通，否则 ctx 会被当成 thenable · 下划线前缀留给框架内部字段
- **已有属性也不直接返回**：Reflect.has 命中后仍要包一层 traceable · 目的是让服务方法内的 this.ctx 指向调用方 · 解包与包装规则见 § 4.6
- **三条出口互斥**：直通、traceable 包装、动态解析各走各路 · 判定顺序固定，先特殊属性再看是否已存在 · 只有都不命中才进入服务解析

### `isSpecialProperty` 的四类直通

`C/reflect.ts:33-38`：

```ts
function isSpecialProperty(prop: string | symbol): prop is symbol {
  return typeof prop === 'symbol'
    || RESERVED_WORDS.includes(prop)        // ['prototype', 'then']（:27）
    || parseInt(prop).toString() === prop   // 数字字符串
    || prop.startsWith('_')                 // 下划线前缀
}
```

| 类别 | 为什么直通 |
|---|---|
| `symbol` | 内部元数据（`symbols.isolate`、`symbols.shadow` 等 18 个）必须能直接读写 |
| `'prototype'` | 原型链操作不能被拦截 |
| **`'then'`** | **防止 `ctx` 被误判为 thenable** —— `await ctx` 会去读 `.then`，若走动态解析会抛错或死循环 |
| 数字字符串 | 数组式访问（如 `ctx[0]`）不是服务名 |
| `_` 前缀 | 约定：内部字段（`_hooks`、`_disposables`、`_runner`……） |

💡 **`then` 的处理是一个"反直觉但必要"的细节**。有意思的是 cordis 反过来**刻意让别的东西是 thenable**：`ctx.plugin()` 的返回值（`C/registry.ts:209-211`）和 `ctx.effect()` 的返回值（`C/fiber.ts:333`）都挂了 `then`，所以 `await ctx.plugin(p)` 会等插件就绪。**只有 `ctx` 自己不能是 thenable。**

## 4.2 三种派生：extend / isolate / intercept

> 📐 **配套可跑示例**：[`M01 tool-restrict`](../../dsh-example/M01-tool-pipeline/README.md) 的 `npm run M01` 展示“在哪个 context 上调用，effect 就归哪个 Fiber”——`agent.ctx.tools.restrict()` 的 disposer 随 agent context 回收，而不是随注册监听器的插件 Fiber 回收。它使用的是 DSH 的 scoped context，**不等同于**本节的 cordis isolate realm；适合用来观察 Context 派生之后的 effect 归属边界，见 [`run.ts` 第 ⑥ 步](../../dsh-example/M01-tool-pipeline/phases/04-tool-restrict.ts)。

`Context` 只有三个公开方法，全部返回**新的 Context 视图**（不改原对象）：

![Context 的三个派生方法](diagrams/04-three-derivations.svg)

**Context 的三个派生方法** — [交互版](diagrams/04-three-derivations.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-three-derivations.architecture.json)

- **三者的共同点**：全部返回新的 Context 视图，绝不修改原对象 · 全部靠 Object.create 建立原型链继承 · isolate 与 intercept 最终都走 extend
- **原型链就是作用域链**：新视图继承原 ctx 的全部可见性 · 只覆盖自己显式改动的那一个键 · 因此不需要显式的作用域表
- **两种覆盖的对象不同**：isolate 覆盖 symbols.isolate 里的存储键 · intercept 覆盖 symbols.intercept 里的配置 · 前者改「看到哪个实现」，后者改「以什么参数用」

💡 **原型链是 cordis 用来实现"作用域"的核心手段**。它不维护任何父子指针表——JS 引擎的原型链查找就是作用域链查找。这也是 `isolate.ts:118-119` 能用 `Object.setPrototypeOf` 在运行时"改父作用域"的原因（见 [07 § 7.7](07-Loader与配置树.md)）。

## 4.3 服务解析：沿 fiber 链向上查找

这是 `handler.get` 的核心路径（`C/reflect.ts:63-99`）：

![服务的动态解析路径](diagrams/04-dynamic-resolve.svg)

**服务的动态解析路径** — [交互版](diagrams/04-dynamic-resolve.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-dynamic-resolve.architecture.json)

- **error 为什么提前构造**：构造 Error 的那一刻才能拿到正确调用栈 · 若等到确认失败再构造，栈已经在框架内部 · 这是长堆栈能指回用户代码的前提
- **根 ctx 走非严格模式**：根 ctx 没有 runtime，也没有依赖声明 · 因此允许拿到尚未 ACTIVE 的实现 · 插件的 ctx 一律走严格模式
- **waterfall 钩子的位置**：在向上查找之前派发 internal/get · 插件可以短路并返回自己的实现 · 这是服务代理与 mock 的官方入口

💡 **三种失败被区分开，错误消息完全不同**——这是很用心的诊断设计：

| 错误消息 | 含义 | 修法 |
|---|---|---|
| `cannot get property "db" without inject` | 根本没声明依赖 | 加 `inject: ['db']` |
| `cannot get required service "db" in inactive context` | 声明了，但提供者 Fiber 不是 ACTIVE | 检查提供者为什么没启动 |
| （同第一条，但因 isolate 边界） | 父作用域的 db 属于别的 realm | 检查 isolate 配置 |

💡 **`enhanceError`（`C/reflect.ts:20-25`）**：把 error 的 stack 前两行替换成 `Error: ${message}`。因为 error 是在 `handler.get` 开头构造的，前两行是 Proxy 内部帧，对用户无意义。

💡 **`ctx.fiber.runtime` 为空时走非严格分支**（`:79`）。根 Context 的 fiber 是 `runtime === null`（见 [03 § 3.1](03-Fiber模型.md)），所以**在根 ctx 上访问服务不要求提供者 ACTIVE**，也不需要 inject 声明。这让宿主程序能自由探查状态。

## 4.4 `store`：以 Symbol 为键

`ReflectService` 有两张表（`C/reflect.ts:135-136`）：

```ts
public store: Dict<Impl, symbol> = Object.create(null)   // symbol → Impl
public props: Dict<Property> = Object.create(null)       // name → 'service' | 'accessor'
```

`Impl` 的结构（`C/reflect.ts:54-59`）：

```ts
export interface Impl {
  name: string
  fiber: Fiber        // ← 谁提供的（epoch 靠它的 uid）
  value?: any
  check?: () => boolean
}
```

![名字到存储键到实现的三级映射](diagrams/04-name-key-store.svg)

**名字到存储键到实现的三级映射** — [交互版](diagrams/04-name-key-store.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-name-key-store.architecture.json)

- **隔离靠键不同，不靠容器嵌套**：store 是全局的，只有一张表 · 两个 realm 的 db 对应两个不同 Symbol · 于是表里是两条互不干扰的记录
- **为什么这样最省代码**：不需要实现嵌套作用域容器 · 查找永远是一次哈希，没有链式回溯 · 可见性完全由 isolate 映射的原型链决定
- **代价在可观测性**：Symbol 没有可读的稳定标识 · 调试时看 store 的键不直观 · isolate 的第二个参数 label 就是为此准备的

💡 **这个设计让"隔离"的成本几乎为零**。传统做法是给每个 scope 建一个容器（Map），查找时逐层回溯；cordis 只有一张扁平表，隔离体现在"用哪个 key 去查"。查找是 O(1)。

💡 **`ctx.root[symbols.isolate][name] ??= Symbol(name)`（`C/reflect.ts:184`）**：首次 provide 某个名字时，在**根 ctx** 上登记默认 Symbol。这样没显式 isolate 的 ctx 都会沿原型链拿到这个共享 Symbol——即默认全局单例。

## 4.5 isolate realm：空间可组合性

![isolate 前后的存储键变化](diagrams/04-isolate-realm.svg)

**isolate 前后的存储键变化** — [交互版](diagrams/04-isolate-realm.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-isolate-realm.architecture.json)

- **变的只有一个键**：root 的 isolate 映射始终是 { db: Sym_A } · P2 的新视图多出一个 own 属性 db 指向 Sym_B · P1 完全不受影响
- **store 里新增而非替换**：Sym_A 的生产库连接仍在 · Sym_B 的测试库连接是新记录 · 两者可以同时存活
- **这就是空间可组合性**：同名服务在不同 realm 是不同实体 · 无需插件配合，调用方单方面决定 · 详见 01 篇的时空可组合性

`isolate(name, label?)`（`C/context.ts:65-69`）的 `label` 参数决定共享范围：

| 调用 | 效果 |
|---|---|
| `ctx.isolate('db')` | `Symbol('db')` —— **每次调用都是新 Symbol**，完全私有 |
| `ctx.isolate('db', sharedSym)` | 用传入的 Symbol —— 多个 ctx 传同一个即可**共享一个 realm** |

loader 层把这个能力包装成配置里的 `isolate: { db: true }`（私有）或 `isolate: { db: 'realmName' }`（命名 realm），实现在 `L/config/isolate.ts`——`LocalRealm` 后缀 `#entryId`（`:52`），`GlobalRealm` 后缀 `@label`（`:62`）。详见 [07 § 7.7](07-Loader与配置树.md)。

### 服务自己也参与隔离判定

`Service[symbols.filter]`（`C/service.ts:37-39`）：

```ts
protected [symbols.filter](ctx: Context) {
  return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name]
}
```

💡 **这是事件派发时的过滤器**。当一个服务 emit 事件时，只有"看到同一个 realm"的监听器才会收到。实现在 `C/events.ts:80-81`：`_resolve` 取 `thisArg?.[Context.filter]` 并用它筛 hooks。所以 **isolate 不仅隔离服务实例，也隔离事件流**。

## 4.6 traceable：让 `this.ctx` 指向调用方

这是 cordis 最难理解、也最关键的一块。**问题**：

```ts
class Db extends Service {
  onQuery(cb) {
    this.ctx.on('query', cb)   // ← this.ctx 是谁的 ctx？
  }
}

// 插件 A 里：
ctx.db.onQuery(handler)        // ← 期望：A 卸载时这个监听器自动移除
```

如果 `this.ctx` 是 Db 服务自己的 ctx，监听器就挂在 Db 的 Fiber 上——**插件 A 卸载时不会被清理**，泄漏。

**cordis 的解法**：`ctx.db` 返回的不是 Db 实例本身，而是一个 **traceable 代理**，它把 `this.ctx` 改写成调用方的 ctx。

![getTraceable 的包装与解包判定](diagrams/04-get-traceable.svg)

**getTraceable 的包装与解包判定** — [交互版](diagrams/04-get-traceable.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-get-traceable.architecture.json)

- **createTraceable 的 get trap 要点**：symbols.original 返回原对象，symbols.caller 返回调用方 ctx · tracker.property（通常是 ctx）返回调用方的 ctx（:166） · associate 开启时把 db.xxx 形式的属性转发出去
- **三种出口**：非对象、无 tracker 都原样返回 · 带 shadow 的走解包，取原型上的真实 ctx · 只有带 tracker 才真正建代理
- **读这段的顺序建议**：先读 core/tests/shadow.spec.ts（176 行） · 它把四件事拆成独立断言 · 再回来看 createTraceable 的实现

`Tracker` 的定义（`C/utils.ts:41-45`）：

```ts
export interface Tracker {
  associate?: string   // 服务名，用于 'db.xxx' 形式的关联属性
  property?: string    // 哪个属性名代表 ctx（Service 基类里是 'ctx'）
  noShadow?: boolean   // 是否跳过 shadow 机制
}
```

`Service` 基类在构造时挂上 tracker（`C/service.ts:22-25`）：

```ts
const tracker: Tracker = {
  associate: name,
  property: 'ctx',
}
```

💡 **一句话总结 traceable**：`ctx.db` 拿到的代理，让 Db 内部的 `this.ctx` 变成"发起这次调用的那个插件的 ctx"。于是 `this.ctx.on(...)` / `this.ctx.effect(...)` 登记的效应自动归属调用方的 Fiber，**调用方卸载即清理**。

### shadow：区分"服务自己的 ctx"和"调用方的 ctx"

有时服务确实需要访问自己的 ctx（比如读自己的配置）。`createShadow`（`C/utils.ts:141-147`）为此保留了一条通道：

![服务如何取回自己的 ctx](diagrams/04-shadow-self-ctx.svg)

**服务如何取回自己的 ctx** — [交互版](diagrams/04-shadow-self-ctx.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-shadow-self-ctx.architecture.json)

- **为什么默认要劫持**：服务方法里用调用方 ctx 才能正确归属副作用 · 否则调用方卸载时服务里登记的 effect 不会回收 · 这是可逆性跨服务边界的保证
- **shadow 是逃生舱**：仅当服务确实需要读自己的配置时才走 shadow 取回 · 服务确实需要读自己的配置时才用 · 藏在原型上，不污染正常属性访问 · 解包是显式动作，不会误触发
- **两条路径要分清**：this.ctx 给的是调用方视角 · 经 shadow 解包拿到的是服务自身视角 · 混用会导致副作用归属错乱

💡 **`shadow.spec.ts` 有 176 行专门测这个**（`packages/core/tests/shadow.spec.ts`）。如果要改 traceable 相关代码，先读这个 spec。

💡 **服务解析时也用到 shadow**：`C/reflect.ts:82` 的 `let fiber = (ctx[symbols.shadow] as Context ?? ctx).fiber`——查找起点优先用 shadow 里的原始 ctx，保证服务内部访问其它服务时从自己的位置起算，而不是从调用方位置起算。

## 4.7 mixin 与 accessor

`ReflectService` 构造函数里（`C/reflect.ts:144-147`）把四个内建服务的方法"平铺"到 ctx 上：

```ts
this.mixin('reflect', ['get', 'set', 'provide', 'accessor', 'mixin'])
this.mixin('fiber', ['runtime', 'effect'])
this.mixin('registry', ['inject', 'plugin'])
this.mixin('events', ['on', 'once', 'parallel', 'emit', 'serial', 'bail', 'waterfall'])
```

这就是为什么可以写 `ctx.effect(...)` 而不必写 `ctx.fiber.effect(...)`、写 `ctx.on(...)` 而不必写 `ctx.events.on(...)`。

![mixin 如何把 fiber 的方法搬到 ctx 上](diagrams/04-mixin-accessor.svg)

**mixin 如何把 fiber 的方法搬到 ctx 上** — [交互版](diagrams/04-mixin-accessor.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/04-mixin-accessor.architecture.json)

- **这就是 ctx.effect 的来历**：effect 本来是 fiber 上的方法 · mixin 把它注册成 ctx 上的 accessor · 所以能写 ctx.effect 而不必写 ctx.fiber.effect
- **用生成器换来逐项可逆**：每个 yield 出去的 accessor 都有自己的 disposer · 卸载时逐个 delete props 上的键 · 不需要记录批量注册的边界
- **绑定的是合成对象**：receiver 存在时用 withProps 合成 mixin · 函数被 bind 到该合成对象上 · 于是方法内的 this 同时看到服务与调用方

💡 **`props` 表有两种类型**（`C/reflect.ts:40-52`）：

| type | 语义 | 注册方式 |
|---|---|---|
| `'service'` | 走 `store` 查找，受 isolate 影响 | `provide(name, value)` |
| `'accessor'` | 直接调 getter/setter，**不受 isolate 影响** | `accessor(name, { get, set })` |

同一个名字不能既是 service 又是 accessor——`provide`（`:177-181`）和 `accessor`（`:231-233`）都会检查并抛 `property "x" is already declared as y`。

## 4.8 `set` 与 `has` trap

| trap | 位置 | 行为 |
|---|---|---|
| `set` | `C/reflect.ts:100-124` | 特殊属性直通；否则要求 `props[prop]` 存在（即先 provide 过），否则抛 `cannot set property "x" without provide`；accessor 走 `def.set`；service 走 `internal/set` waterfall → `reflect.set` |
| `has` | `C/reflect.ts:126-133` | 特殊属性走 `Reflect.has`；否则 `Reflect.has(target, prop) \|\| !!props[prop]` |

`reflect.set`（`C/reflect.ts:162-174`）有两道额外检查：

```ts
if (!impl) throw new Error(`cannot set property "${name}" without provide`)
if (impl.fiber !== this.ctx.fiber) {
  throw new Error(`cannot set property "${name}" in multiple fibers`)
}
```

💡 **第二道检查很重要**：只有**注册该服务的那个 Fiber** 能改它的值。别的插件即使拿到了服务也不能替换实现。这保证了服务所有权的单一性。

## 4.9 `Context.is` 的 Symbol 技巧

`C/context.ts:27-34`：

```ts
static is(value: any): value is Context {
  return !!value?.[Context.is as any]
}

static {
  Context.is[Symbol.toPrimitive] = () => Symbol.for('cordis.is')
  Context.prototype[Context.is as any] = true
}
```

💡 **这段代码把函数当属性键用**。`value[Context.is]` 在取值时会把 `Context.is`（一个函数）转成 primitive 作键，触发 `Symbol.toPrimitive` 返回 `Symbol.for('cordis.is')`。所以实际读的是 `value[Symbol.for('cordis.is')]`，而 `Context.prototype` 上预设了这个键为 `true`。

好处：**跨 cordis 实例可用**（`Symbol.for` 是全局注册表），且不污染可见的属性名。代价：极其晦涩。

---

**上一篇** ← [03 Fiber 模型](03-Fiber模型.md) ｜ **下一篇** → [05 服务注册与依赖解析](05-服务注册与依赖解析.md)：`provide` / `inject` / `notify` 的完整链路，以及 `Service` 基类的七个可覆写符号。
