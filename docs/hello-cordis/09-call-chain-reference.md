---
title: "关键调用链速查"
---
# 关键调用链速查

> **本篇回答**：全系列的索引——六条核心调用链、`symbols` 全表、逐文件符号表、错误消息对照、症状 → 分册路由。
> **路径缩写**：`C/` = `packages/core/src/`，`L/` = `packages/loader/src/`，`I/` = `packages/include/src/`，`H/` = `packages/hmr/src/`。行号对应快照 `bc9fae7`（v4.0.0-rc.13）。
>
> 🧭 **本篇导览**：9.1 六条核心调用链 → 9.2–9.3 `symbols` 全表与逐文件符号表 → 9.4–9.7 错误消息、配置项、派发模式与状态语义速查 → 9.8–9.9 症状路由与测试文件映射。
>

## 9.1 六条核心调用链

### 链 1：`ctx.use(p)` → 组件运行

![链 1：ctx.use(p) 到组件运行](diagrams/09-plugin-chain.svg)

**链 1：ctx.use(p) 到组件运行** — [交互版](diagrams/09-plugin-chain.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-plugin-chain.architecture.json)

- **链路只有七步**：前四步在 registry 内完成归一化（`_forward` 别名链）与去重 · 第五步起进入 Fiber 的构造 · 真正执行组件代码在 _reload 里
- **长堆栈起点在第一步**：getOuterStack 是默认参数，在调用处求值 · 因此捕获的是用户代码的真实位置 · 详见 03 篇 § 3.8
- **详细展开见各章**：Runtime 与 Fiber 的关系见 03 篇 § 3.1 · Inject.resolve 的四条分支见 05 篇 · _checkImpl 与 epoch 见 03 篇 § 3.4

详见 [03 § 3.6](03-fiber-model.md)、[05 § 5.2](05-service-registration-and-dependency-resolution.md)。

### 链 2：`ctx.db` → 拿到服务实例

| 步骤 | 位置 |
|---|---|
| Proxy get trap | `C/reflect.ts:106` |
| 特殊属性判定 | `C/reflect.ts:44`（symbol / `prototype` / `then` / 数字串 / `_` 前缀；`RESERVED_WORDS` `C/reflect.ts:38`） |
| 已有属性 → traceable 包装 | `C/reflect.ts:110-111` → `C/utils.ts:126 getTraceable` |
| accessor 分支 | `C/reflect.ts:118-120` |
| 根 ctx 非严格分支 | `C/reflect.ts:124` |
| `internal/get` waterfall | `C/reflect.ts:125` |
| `locate()` 沿 fiber 链向上查找 | `C/reflect.ts:126`（`locate()` 定义 `C/reflect.ts:83-102`，四分支注释齐全） |
| 命中 → `getTraceable(ctx, result.impl.value)` | `C/reflect.ts:128` |
| 声明了但不可用 → 抛 inactive | `C/reflect.ts:129-130` |
| isolate 边界 → locate 返回 undefined → 抛错 | `C/reflect.ts:127` |
| traceable 代理的 get trap | `C/utils.ts:180-210` |
| `tracker.property` 返回 useSite（def site / use site 术语见 utils.ts:174-179 注释） | `C/utils.ts:184` |

详见 [04 § 4.3](04-context-and-reflect-proxy.md)、[04 § 4.6](04-context-and-reflect-proxy.md)。

### 链 3：服务卸载 → 依赖者级联重载

![链 3：服务卸载到依赖者级联重载](diagrams/09-cascade-chain.svg)

**链 3：服务卸载到依赖者级联重载** — [交互版](diagrams/09-cascade-chain.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-cascade-chain.sequence.json)

- **传播由 notify 单点驱动**：disposer 只负责删表并调 notify · notify 全量遍历 fibers 并按 inject 过滤 · 没有依赖图，因此也不需要维护它
- **提供者会等全部依赖者卸载完**：disposer 里显式 `await impl.release` 等待 dependents 清空（`C/reflect.ts:240-243`）· 跨 Fiber 并发 `Promise.all`（`C/fiber.ts:492`）· 单个失败不阻断其余
- **递归终止条件**：每层卸载可能触发下一层 notify · 直到没有 Fiber 的 epoch 再变化 · 详见 03 篇 § 3.2 与 05 篇 § 5.6

详见 [05 § 5.4](05-service-registration-and-dependency-resolution.md)、[05 § 5.6](05-service-registration-and-dependency-resolution.md)。

### 链 4：yml 文件 → 组件树

| 步骤 | 位置 |
|---|---|
| `Include` 组件 `[Service.init]` | `I/index.ts:305` |
| 读文件 → `parseSyntax` / `JSON.parse` | `I/index.ts:399`（`_read()`） |
| **`applyPatches(data, patches)` → `{ data, index }`** | `I/patch.ts:105`（PatchIndex 所有权索引） |
| journal 记账叠加 → `root.update(tree)` | `I/index.ts:677-693`（`_scheduleApply()` 内，`root.update` 在 `:687`） |
| `EntryGroup.update` 分发到各 `Entry.update()` | `L/config/group.ts:80` → `L/config/entry.ts:218` |
| 首次 → `Entry.init()` | `L/config/entry.ts:311` |
| `_init()` → `tree.import(name)` | `L/config/entry.ts:339` → `L/config/tree.ts:198` |
| `unwrapExports()`（双层 default 解包） | `L/internal.ts:32` |
| `internal/config` waterfall：校验 + `!!js` 插值 | `L/index.ts:79-103`（校验定位 :79-89，插值 :93-103） |
| `_patchContext([])` → isolate 7 步 | `L/config/entry.ts:181` → `L/config/isolate.ts:82` |
| 有 inject → outer Fiber；否则直接 inner Fiber（`registry.use`） | `L/config/entry.ts:354`（outer）/ `:371`（inner） |
| 全部完成后 `notify(['loader'])` | `L/config/entry.ts:326` |

详见 [07 § 7.1](07-loader-and-configuration-tree.md)、[07 § 7.4](07-loader-and-configuration-tree.md)。

### 链 5：文件改动 → 组件热重载

| 步骤 | 位置 |
|---|---|
| `ctx.fs.watch`（file: 协议由 `@cordisjs/fs-node` 的 chokidar 供数） | `H/index.ts:236` + `packages/fs-node/src/watcher.ts` |
| 去抖收集 → `reconcile()` 事务（串行队列，拒绝嵌套） | `H/index.ts:286-301` |
| sweep：清失败的 module job | `H/index.ts:537` → `H/runtime/modules.ts:108` |
| `invalidateResolution(roots)`（resolve cache / realpath / manifest） | `H/index.ts:541` → `H/runtime/resolution.ts:74` |
| `_match` / `_moved`（root 匹配 + 请求改道） | `H/index.ts:501` / `:462` |
| **`_analyze()`**（沿 importer 反向 BFS：accepted/declined） | `H/index.ts:319` |
| **`_discover()`**（扫描已加载模块找已注册 Component） | `H/index.ts:404` |
| **`_partition()`**（并查集分 ReconcileUnit） | `H/index.ts:360` |
| `evict` + Stage 1 全部重新 import（含导出校验） | `H/index.ts:608` / `:617-661` |
| Stage 2 **`registry.replace()`** → `fiber._replace()`（原位） | `H/index.ts:734` → `C/registry.ts:187` / `C/fiber.ts:401` |
| Stage 3 `fiber.await()`（不回滚，FAILED 与冷启动一致） | `H/index.ts:748` |
| 失败 → aborted unit `backup.restore`；Stage 3 不回滚 | `H/index.ts:704` / `:744-748` |
| 下游组件因 epoch（`_revision`）变化自动重载 | 无代码——[03 § 3.4](03-fiber-model.md) |

详见 [08 § 8.3](08-hmr.md)。

### 链 6：`registry.replace(a, b)` → 热换实现（rc.13 新增）

| 步骤 | 位置 |
|---|---|
| `registry.replace(oldComponent, newComponent)`（登记 `_aliases` 别名链，复用/创建目标 runtime） | `C/registry.ts:187-211` |
| 对旧 runtime 的每个 fiber 调 `fiber._replace(target, inject)` | `C/fiber.ts:401-416` |
| 换 runtime / inject，清 `_error`，emit `internal/replace` | `C/fiber.ts:402-408` |
| `_revision++` → `_refresh()` → 新 epoch → `_reload()` | `C/fiber.ts:414-415` |

详见 [05 § 5.2](05-service-registration-and-dependency-resolution.md)、[08 § 8.8](08-hmr.md)。旧组件被 replace 后仍可经 `_forward()` 别名链 `get`/`has` 到新组件（`C/registry.ts:155-163`）。

## 9.2 `symbols` 全表

`C/utils.ts:61-87`，共 **20 个**，全部用 `Symbol.for`（跨实例共享）。注意 rc.13 的一次**交叉换名**：旧的 `symbols.metadata`（装饰器元数据）改名 `decorator`，`Service.config` 的槽位则改用了新的 `metadata`：

| 分组 | 符号 | 用途 |
|---|---|---|
| **内部** | `shadow` | 藏起服务自己的 ctx（[04 § 4.6](04-context-and-reflect-proxy.md)） |
| | `caller` | traceable 代理里取 def site 调用方 |
| | `receiver` | accessor 的 receiver 传递 |
| | `original` | 取被代理的原对象 |
| | `decorator` | `@Inject()` 方法装饰器的元数据（原名 `metadata`，utils.ts:67） |
| | `initHooks` | 实例化后要跑的钩子（`C/fiber.ts:161-163`） |
| | `checkProto` | 标记 inject 对象需沿原型链合并 |
| **Context** | `root`（新） | 根 ctx 引用（`ctx[Context.root]`，取代旧公开属性 `ctx.root`） |
| | `effect` | `EffectMeta` 挂载键 |
| | `filter` | 事件派发过滤器（`Context.filter`） |
| | `isolate` | realm 映射表（`Context.isolate`） |
| | `intercept` | 服务配置表（`Context.intercept`） |
| **Service** | `init` | `Service.init` 初始化方法 |
| | `check` | `Service.check` 可用性判定 |
| | `metadata`（新） | `Service.metadata` 拦截配置类型槽（service.ts:16） |
| | `invoke` | `Service.invoke` 让服务可调用 |
| | `extend` | `Service.extend` 派生视图 |
| | `tracker` | `Service.tracker` traceable 配置 |
| | `mergeIntercept`（新） | 拦截配置合并函数（默认 `Object.assign`） |
| | `resolveIntercept`（新） | 拦截配置解析（取代旧 `resolveConfig`） |

另有四个不在 symbols 表里但同样重要的 `Symbol.for`：

| 符号 | 位置 | 用途 |
|---|---|---|
| `Symbol.for('cordis.entry')` | `L/config/entry.ts:49` | `Entry.key`，挂在 ctx 上标记所属 entry |
| `Symbol.for('cordis.group')` | `L/config/group.ts:8` | `EntryGroup.key`，标记 group 组件 |
| `Symbol.for('cordis.is')` | `C/context.ts:32` | `Context.is` 的判定键 |
| `Symbol.for('ValidationError')` | `C/fiber.ts:14` | 配置校验错误标记 |

另有一个非 `Symbol.for` 但值得知道的事务键：`Symbol('transaction')`（`H/index.ts:292`，hmr 事务身份，配合 AsyncLocalStorage）与 `Symbol.for('cordis.hmr.patches')`（`H/runtime/patches.ts:76`，线程内单实例标记）。

## 9.3 逐文件符号表

### `C/fiber.ts`（557 行）

| 符号 | 行号 |
|---|---|
| `ValidationError`（含 `is`/`normalizePath`/`formatPath`） | 16 |
| `resolveConfig()` | 46 |
| `Disposable` / `Effect` / `EffectMeta` / `EffectRunner` | 64 / 66 / 78 / 83 |
| **`FiberState`** | **90** |
| `CordisError` | 99 |
| `INACTIVE = '__INACTIVE__'` | 113 |
| **`class Fiber`** | **115** |
| `committed`（旧 `store`）/ `provisions` | 120 / 121 |
| `_revision` | 131 |
| 构造函数 | 137 |
| 根 Fiber 分支（epoch `'0'`） | 207-219 |
| `get name()` | 222 |
| `assertActive()` | 231 |
| `_resolve()`（`internal/config` waterfall） | 236 |
| `_execute()` | 240 |
| **`effect()`** | **294** |
| `getEffects()` | 359 |
| `_getState()` | 365 |
| `_updateState()` | 372 |
| `_checkImpl()` | 387 |
| **`_replace()`**（新） | **401** |
| **`_refresh()`** | **418** |
| **`_setEpoch()`** | **432** |
| `_reload()` / `_unload()` | 450 / 481 |
| `await()` / `restart()` / `update()` | 520 / 528 / 536 |

### `C/reflect.ts`（324 行）

| 符号 | 行号 |
|---|---|
| `enhanceAccessError()` / `createAccessError()` | 23 / 32 |
| `RESERVED_WORDS` | 38 |
| `isSpecialProperty()` | 44 |
| `Impl`（`{ uid, name, ctx, dependents, release, value, check, isolate }`） | 65 |
| **`locate()`**（新，fiber 链查找） | **83** |
| `class ReflectService` | 104 |
| **`static handler`** | **105** |
| get / set / has trap | 106 / 137 / 163 |
| `store` / `props` / `_implCounter` | 172 / 173 / 174 |
| `get()` / `_getImpl()` / `set()` | 188 / 192 / 200 |
| **`provide()`** | **213** |
| **`notify()`** | **251** |
| `accessor()` / **`mixin()`** | 272 / **282** |
| `trace()` / `bind()` | 310 / 314 |

### `C/utils.ts`（298 行）

| 符号 | 行号 |
|---|---|
| `DisposableList`（head/tail 双 Map，`clear()` 按插入序） | 8 |
| `Tracker` | 55 |
| **`symbols`** | **61** |
| `isConstructor()` | 92 |
| `joinPrototype()` | 104 |
| **`getTraceable()`** | **126** |
| `withProps()` | 136 |
| `createShadow()` / `createShadowMethod()` | 157 / 165 |
| **`createTraceable()`** | **177** |
| `applyTraceable()` / `createCallable()` | 234 / 239 |
| `composeError()` / `buildOuterStack()` | 280 / 295 |

### `C/registry.ts`（253 行）

| 符号 | 行号 |
|---|---|
| `isApplicable()` | 7 |
| **`@Inject()`** | **17** |
| `Inject.resolve()` | 42 |
| `Component` 类型 / `Component.Base` | 63 / 69 |
| `Component.Runtime` | 94 |
| `class RegistryService`（`_aliases` :130） | 127 |
| `get counter()` | 139 |
| `resolve()` / `_unregister()` / **`replace()`** | 147 / 183 / **187** |
| `get/has/keys/values/entries/forEach`（新，公开） | 173-227 |
| `inject()` / **`use()`** / `plugin()`（deprecated） | 229 / **238** / 234 |

### `C/events.ts`（224 行）

| 符号 | 行号 |
|---|---|
| `isBailed()` | 6 |
| `DispatchMode` | 14 |
| `EventOptions` / `Hook`（新 `removed?: boolean`） | 35 / 40 |
| `class EventsService` | 46 |
| `internal/listener` 自注册钩子 | 55 |
| `internal/update` 全局钩子 / `internal/config` 内置校验钩子（新） | 72 / 81 |
| **`_resolve()`**（返回三元组） | **86** |
| `parallel` / `emit` / `serial` / `bail` / **`waterfall`** | 110 / 121 / 128 / 137 / **146** |
| `register()` / `unregister()` | 165 / 175 |
| **`on()`** / `once()` | **187** / 202 |
| **`interface Events`（11 事件：plugin/replace/status/service/update/commit/config/get/set/listener/dispatch）** | **211** |

### `C/service.ts`（83 行） · `C/context.ts`（78 行）

| 符号 | 行号 |
|---|---|
| `abstract class Service` | service:6 |
| 8 个 static symbol | service:7-14 |
| 构造函数 | service:20 |
| `[symbols.filter]` | service:39 |
| `[symbols.extend]` | service:43 |
| `[symbols.mergeIntercept]` / `[symbols.resolveIntercept]` | service:53 / 57 |
| `static [Symbol.hasInstance]` | service:72 |
| `class Context` | context:21 |
| `Context.is` | context:27 |
| 构造函数 | context:36 |
| `new Proxy(...)` | context:39 |
| `_disposables.clear()` | context:47 |
| `extend()` / `isolate()` / `intercept()` | context:55 / 65 / 71 |

### `L/`（loader，1465 行）

| 符号 | 位置 |
|---|---|
| `class Loader` | `index.ts:48` |
| `internal = getInternalLoader()` | `index.ts:56`（实现在 `internal.ts:13`） |
| `internal/config` 钩子（校验定位 / `!!js` 插值） | `index.ts:79-103` |
| `internal/commit` 写回钩子 | `index.ts:105` |
| `internal/status` 钩子（outer fiber 依赖丢失时清 `_verdict`） | `index.ts:120` |
| `internal/plugin` 钩子（7 case 自卸载判定） | `index.ts:128` |
| `[Service.check]()` | `index.ts:179` |
| `unwrapExports()` | `internal.ts:32` |
| `createResolve()`（`.cordis/resolve.mjs` 锚定解析） | `resolve.ts:92` |
| `class Entry` | `config/entry.ts:48` |
| `Entry.key` / `Entry.isOuter` | `config/entry.ts:49` / `:51` |
| `get disabled()`（`_verdict` + JS 表达式 + 父链） | `config/entry.ts:114` |
| `_patchContext()` / `_reconcile()` | `config/entry.ts:181` / `:195` |
| **`update()`** | `config/entry.ts:218` |
| `getOuterStack`（返回 `at id (file:line:col)` 形态） | `config/entry.ts:282` |
| `init()` / `_init()` | `config/entry.ts:311` / `:339` |
| `EntryTree` / `sep = ':'` | `config/tree.ts:71` / `:72` |
| `resolve()` / `import()` | `config/tree.ts:121` / `:198` |
| `EntryGroup` / `Group` | `config/group.ts:7` / `:107` |
| `Realm` / `LocalRealm` / `GlobalRealm` | `config/isolate.ts:16` / `:38` / `:48` |
| **`loader/patch-context` 7 步算法**（默认导出组件，`ctx.use(isolate)` 挂载） | `config/isolate.ts:82`（挂载点 `index.ts:172`） |
| realm GC | `config/isolate.ts:142` |

### `I/`（include，1212 行） · `H/`（hmr，index 839 行 + runtime/）

| 符号 | 位置 |
|---|---|
| `JsExpr` yaml ScalarTag | `I/index.ts:20` |
| `Include.Config`（含新 `watch`） | `I/index.ts:110` |
| `class Include` | `I/index.ts:244` |
| **`applyPatches()`**（返回 `PatchResult`） | `I/patch.ts:105` |
| journal `record()` / `reconcile()`（file wins） | `I/journal.ts:73` / `:195` |
| `[Service.init]()` | `I/index.ts:305` |
| `_writeText()`（原子写） | `I/index.ts:551` |
| `closure()`（host modules 收集） | `H/index.ts:43` |
| `class Hmr`（缺内部接口直接抛错 :166-168） | `H/index.ts:141` |
| `reconcile()`（事务入口） | `H/index.ts:286` |
| `[Service.init]()` | `H/index.ts:245` |
| **`_analyze()`** | `H/index.ts:319` |
| **`_partition()`** | `H/index.ts:360` |
| **`_discover()`** | `H/index.ts:404` |
| **`_reconcile()`**（七步机制） | `H/index.ts:525` |
| `ModuleLoader` v1 / v2（`fromInternal` :158） | `H/runtime/internal.ts:68` / `:100` |
| `ModuleCaches` / `sweep` / `evict`（`ModuleBackup.restore` :157） | `H/runtime/modules.ts:26` / `:108` / `:147` |
| `invalidateResolution()` / `locatePackage()` | `H/runtime/resolution.ts:74` / `:169` |
| `activate()`（替换 Node 内建方法，不随 dispose 恢复） | `H/runtime/patches.ts:89` |

## 9.4 错误消息对照表

| 消息 | 抛出位置 | 含义 |
|---|---|---|
| `cannot create effect on inactive context` | `C/fiber.ts:109`（`CordisError.Code`），抛于 `:233` | 在已卸载 ctx 上 `effect()` |
| `Invalid effect` | `C/fiber.ts:247`、`:256`、`:287` | effect 回调返回值非法 |
| `invalid config:\n  - ...` | `C/fiber.ts:16`（`ValidationError`） | Standard Schema 校验失败（loader 会把位置溯源到 yml，`L/index.ts:84-87`） |
| `Async config validation is not supported` | `C/fiber.ts:51` | Config 的 validate 返回 Promise |
| `cannot get property "x" without inject` | `C/reflect.ts:114` | 未声明依赖 |
| `cannot get required service "x" in inactive context` | `C/reflect.ts:129-130` | 声明了但提供者非 ACTIVE |
| `cannot set property "x" without provide` | `C/reflect.ts:142`、`:204` | 给未注册的名字赋值 |
| `cannot set property "x" in multiple fibers` | `C/reflect.ts:207` | 非注册者试图改值 |
| `property "x" is already declared as y` | `C/reflect.ts:218`、`:275` | service / accessor 名字冲突 |
| `service "x" has been registered at <y>` | `C/reflect.ts:226` | 同 realm 重复 provide |
| `invalid component, expect function or object with an "apply" method, received z` | `C/registry.ts:241`（另 `:189`、`:191`；hmr 变体 `invalid component at ${path}, ...` 在 `H/index.ts:640-642`） | 传入非法组件 |
| `@Inject() can only be used on class or class methods` | `C/registry.ts:37` | 装饰器位置错 |
| `next() called multiple times` | `C/events.ts:156` | waterfall 的 `next()` 重入 |
| `one or more listeners of event "x" failed` | `C/events.ts:118`（`AggregateError`） | `parallel` 有监听器失败 |
| `extension "x" not supported` | `I/index.ts:280` | include 的文件扩展名不支持 |
| `config file not found: <path>` | `I/index.ts:313` | 文件不存在且无 `initial` |
| `config file must be a top-level array` | `I/index.ts:434`（`ConfigFileError`，带行列位置） | 文件顶层不是数组 |
| `entry must be an object` | `I/index.ts:446` / `L/config/utils.ts:164`（`validateOptions`） | 配置行不是对象 |
| `config file %C is read-only, %d pending change(s) kept in memory` | `I/index.ts:526`（warn） | 配置文件不可写，变更暂存内存 |
| `loader internals are unavailable, pass --expose-internals or install node-addon-require-builtin` | `H/index.ts:167`（**throw**，不再降级） | 缺内部接口，Hmr 构造直接失败 |
| `invalid root ..., expected an absolute path` | `H/index.ts:530` | reconcile 的根路径不是绝对路径 |
| `cannot start a transaction inside another transaction` | `H/index.ts:289` | 嵌套事务被拒绝 |
| `cannot resolve entry ${id}` | `L/config/tree.ts:127`、`:130` | id 逐层下钻失败 |
| `entry ${id} is not a group` | `L/config/tree.ts:137` | resolveGroup 目标不是 group |
| `invalid entry options:`（`EntryValidationError`） | `L/config/utils.ts:150-155` | entry 选项校验失败（带位置） |
| `id must not contain ":"` | `L/config/utils.ts:177` | id 含分隔符 |
| `expected service ${name} to be implemented` | `L/config/isolate.ts:101`（warn） | isolate 声明的服务没有实现 |
| `patch insert: entry %C not found` | `I/patch.ts:141`（warn） | 带 id 的 insert 目标不存在 |
| `patch insert: entry %C is not a group` | `I/patch.ts:142`（warn） | 带 id 的 insert 目标不是 group |
| `patch: id is required for non-insert patches` | `I/patch.ts:154`（warn） | 非 insert patch 缺 id |
| `patch: entry %C not found` | `I/patch.ts:155`（warn） | patch 的 id 不存在 |
| `patch: name mismatch for %C (expected %C, got %C), skipping` | `I/patch.ts:157`（warn） | patch 的 name 与目标不符 |
| `cannot place entry %C: group %C not found` | `I/patch.ts:223`（`routeJournal`，warn） | journal 路由时目标 group 不存在 |

## 9.5 配置项速查

### `Loader.Config` / `Loader.Intercept`

| 项 | 位置 | 说明 |
|---|---|---|
| `baseUrl?: string` | `L/index.ts:40` | 解析相对路径的基准 |
| `intercept.await?: boolean` | `L/index.ts:44` | 为 true 时，loader 在有未完成任务期间报告不可用 |

### `Include.Config`

| 项 | 位置 | 说明 |
|---|---|---|
| `path: string` | `I/index.ts:111` | 配置文件路径 |
| `initial?: any[]` | `I/index.ts:112` | 文件不存在时的初始内容 |
| `patches?: PatchOptions[]` | `I/index.ts:113` | 补丁列表（§ [07 7.5](07-loader-and-configuration-tree.md)） |
| `enableLogs?: boolean` | `I/index.ts:114` | 是否打印 apply/reload/unload 日志 |
| `watch?: boolean`（新） | `I/index.ts:115` | 监听配置文件变更并 refresh（经 `ctx.fs.watch`，不依赖 HMR） |

### `Hmr.Config`（schemastery，整表重做）

| 项 | 默认 | 位置 |
|---|---|---|
| `base?: string` | — | `H/index.ts:769` |
| `watch.enabled: boolean` | `false` | `H/index.ts:771` |
| `watch.files: string[]`（`!` 否定 glob，作 `ctx.fs.watch()` 的 filter） | `['.', '!**/node_modules', '!**/.*']` | `H/index.ts:772-776` |
| `watch.debounce: number` | `100` | `H/index.ts:777` |

### 环境变量

| 变量 | 位置 | 说明 |
|---|---|---|
| `CORDIS_SHARED` | `L/index.ts:51` | JSON，跨重启共享的 `envData`（含 `startTime`） |

### 启动参数

| 参数 | 必要性 |
|---|---|
| `--expose-internals` | **HMR 必需**（或安装 `node-addon-require-builtin`）：缺失时 Hmr 构造函数直接抛错（不再降级告警）；另要求 Node ≥ 22 |
| `--import tsx` | 直跑 TS 源码时需要（`npm:@cordisjs/tsx@4.23.15-fix.1`，npm 作用域已从 `@cordiverse` 换成 `@cordisjs`） |
| `--import @cordisjs/unyaml` | 需 `import x.yml` 时 |

## 9.6 五种事件派发模式对照

| 模式 | 位置 | 同/异步 | 中断 | 用途 |
|---|---|---|---|---|
| `emit` | `C/events.ts:121` | 同步 | 否 | 通知 |
| `parallel` | `C/events.ts:110` | 异步 | 否（`AggregateError` 带消息） | 并发副作用 |
| `bail` | `C/events.ts:137` | 同步 | 首个 `isBailed` | 询问式 |
| `serial` | `C/events.ts:128` | 异步 | 首个 `isBailed` | 异步询问 |
| **`waterfall`** | `C/events.ts:146` | 取决于监听器 | `next()` 控制 | **中间件 / 拦截 / 改写** |

`isBailed(v)` = `v !== null && v !== false && v !== undefined`（`C/events.ts:6`）。**注意 `0` 与 `''` 算"非空"**。

## 9.7 状态与语义速查

### `FiberState`（`C/fiber.ts:90`）

| 值 | 语义 | 判定依据（`_getState()`，`:365`） |
|---|---|---|
| `PENDING` | 依赖未就绪 | epoch === INACTIVE |
| `LOADING` | 正在执行组件代码 | `_setEpoch` 显式设置 |
| `ACTIVE` | 运行中 | epoch ≠ INACTIVE |
| `FAILED` | 初始化抛错 | `_error` 存在（只能经 `update()` 恢复，`:436`） |
| `DISPOSED` | 已卸载 | `uid === null` |
| `UNLOADING` | 正在卸载 | `_setEpoch` 显式设置 |

### effect 的返回形态（`C/fiber.ts:66`）

前四行是 `Effect` 类型声明的四种有效形态，后两行是 `_execute()` 的边界处理：

| 形态 | 处理位置 |
|---|---|
| `Disposable`（函数） | `:251-252` |
| `Iterable<Disposable>`（生成器） | `:259-266` |
| `Promise<Disposable>` | `:257-258` |
| `AsyncIterable<Disposable>`（async 生成器） | `:267-285` |
| `nullish` | `:253-254` |
| 其它 → `TypeError` | `:247`、`:256`、`:287` |

## 9.8 症状 → 分册路由

| 症状 | 先看哪篇 |
|---|---|
| 不知道从哪读起 | [01](01-overview-and-design-philosophy.md)、[02](02-code-structure-and-package-boundaries.md) |
| 组件不启动 / 反复重启 | [03 § 3.4-3.5](03-fiber-model.md) |
| 副作用没被清理 | [03 § 3.2](03-fiber-model.md) |
| `cannot get property` 类错误 | [04 § 4.3](04-context-and-reflect-proxy.md) |
| 服务实例应该隔离但没隔离 | [04 § 4.5](04-context-and-reflect-proxy.md)、[07 § 7.7](07-loader-and-configuration-tree.md) |
| `this.ctx` 指向不对 | [04 § 4.6](04-context-and-reflect-proxy.md) |
| `provide` / `inject` 语义疑问 | [05](05-service-registration-and-dependency-resolution.md) |
| `Service` 基类的符号怎么用 | [05 § 5.7](05-service-registration-and-dependency-resolution.md) |
| 事件收不到 / 链条中断 | [06](06-event-system-and-waterfall.md) |
| 想写中间件 | [06 § 6.3](06-event-system-and-waterfall.md) |
| 配置文件不生效 | [07 § 7.3-7.5](07-loader-and-configuration-tree.md) |
| patch 语义疑问 | [07 § 7.5](07-loader-and-configuration-tree.md) |
| 配置被意外写回 | [07 § 7.8](07-loader-and-configuration-tree.md) |
| HMR 不工作 | [08](08-hmr.md) |
| Node 升级后热重载坏了 | [08 § 8.4](08-hmr.md) |
| 组件热替换后引用/依赖没刷新 | [08 § 8.8](08-hmr.md) + [03 § 3.4](03-fiber-model.md) |
| 想查某符号在哪 | 本篇 § 9.3 |
| 遇到不认识的错误消息 | 本篇 § 9.4 |
| DSH 里怎么用这些机制 | [DSH 05 篇](../hello-dsh/05-startup-and-cordis-runtime.md) |

## 9.9 测试文件与语义映射

想确认某个语义的准确行为时，**读 spec 比读实现快**：

| 想确认什么 | 读哪个测试 |
|---|---|
| effect 的卸载顺序与幂等 | `core/tests/dispose.spec.ts`（281 行） |
| Fiber 状态机转移 | `core/tests/fiber.spec.ts`（474 行） |
| 组件注册与依赖 | `core/tests/component.spec.ts`（194 行，原 plugin.spec.ts） |
| 服务基类行为 | `core/tests/service.spec.ts`（233 行） |
| 5 种事件派发 | `core/tests/events.spec.ts`（557 行） |
| `this` 归属（shadow） | `core/tests/shadow.spec.ts`（348 行） |
| `a.b` 形式关联属性 | `core/tests/associate.spec.ts`（256 行） |
| 可调用服务 | `core/tests/invoke.spec.ts`（116 行） |
| `@Inject()` 装饰器 | `core/tests/decorator.spec.ts`（40 行） |
| core 层 isolate | `core/tests/isolate.spec.ts`（203 行） |
| **`registry.replace()` 热换实现** | `core/tests/replace.spec.ts`（260 行，新） |
| **dependents / release 卸载握手** | `core/tests/service-dispose.spec.ts`（444 行，新） |
| **`update()` 与 `internal/commit`** | `core/tests/update.spec.ts`（283 行，新） |
| **拦截配置解析（mergeIntercept/resolveIntercept）** | `core/tests/intercept.spec.ts`（118 行，新） |
| **配置驱动的 isolate（realm 切换）** | `loader/tests/isolate.spec.ts`（**578 行**） |
| isolate 下 provide 语义 | `loader/tests/isolate-provide.spec.ts`（353 行，新） |
| group 的启停传播 | `loader/tests/group.spec.ts`（291 行） |
| 配置变更写回（commit/journal） | `loader/tests/commit.spec.ts`（327 行，新） |
| `!!js` 表达式求值与溯源 | `loader/tests/evaluate.spec.ts`（769 行，新） |
| entry 重建与移动 | `loader/tests/rebuild.spec.ts`（393 行，新） |
| entry 选项校验 | `loader/tests/validate.spec.ts`（118 行，新） |
| **HMR 全流程（reconcile 事务）** | `hmr/tests/reconcile.spec.ts`（**1078 行**，新） |
| HMR watch 行为 | `hmr/tests/watch.spec.ts`（350 行，新） |
| 模块缓存 sweep/evict/restore | `hmr/tests/modules.spec.ts`（148 行，新） |
| 解析缓存失效 | `hmr/tests/resolution.spec.ts`（230 行，新） |
| Node 内建方法替换 | `hmr/tests/patches.spec.ts`（389 行，新） |
| **patch 语义** | `include/tests/patch.spec.ts`（263 行） |
| journal 与文件同步（file wins） | `include/tests/sync.spec.ts`（630 行，新） |
| 配置源位置溯源 | `include/tests/location.spec.ts`（703 行，新） |
| include 自身 watch | `include/tests/watch.spec.ts`（113 行，新） |
| 定时器可逆性 | `timer/tests/index.spec.ts`（388 行） |

---

**上一篇** ← [08 HMR 热重载](08-hmr.md) ｜ **返回** → [索引](README.md) ｜ **动手** → [配套工程 dsh-lab](../../dsh-lab/README.md)
