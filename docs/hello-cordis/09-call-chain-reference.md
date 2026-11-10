---
title: "关键调用链速查"
---
# 关键调用链速查

> **本篇回答**：全系列的索引——五条核心调用链、`symbols` 全表、逐文件符号表、错误消息对照、症状 → 分册路由。
> **路径缩写**：`C/` = `packages/core/src/`，`L/` = `packages/loader/src/`，`I/` = `packages/include/src/`，`H/` = `packages/hmr/src/`。行号对应快照 `f8ea3cd5`。
>
> 🧭 **本篇导览**：9.1 五条核心调用链 → 9.2–9.3 `symbols` 全表与逐文件符号表 → 9.4–9.7 错误消息、配置项、派发模式与状态语义速查 → 9.8–9.9 症状路由与测试文件映射。
>

## 9.1 五条核心调用链

### 链 1：`ctx.plugin(p)` → 插件运行

![链 1：ctx.plugin(p) 到插件运行](diagrams/09-plugin-chain.svg)

**链 1：ctx.plugin(p) 到插件运行** — [交互版](diagrams/09-plugin-chain.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-plugin-chain.architecture.json)

- **链路只有七步**：前四步在 registry 内完成归一化与去重 · 第五步起进入 Fiber 的构造 · 真正执行插件代码在 _reload 里
- **长堆栈起点在第一步**：getOuterStack 是默认参数，在调用处求值 · 因此捕获的是用户代码的真实位置 · 详见 03 篇 § 3.8
- **详细展开见各章**：Runtime 与 Fiber 的关系见 03 篇 § 3.1 · Inject.resolve 的四条分支见 05 篇 · _checkImpl 与 epoch 见 03 篇 § 3.4

详见 [03 § 3.6](03-fiber-model.md)、[05 § 5.2](05-service-registration-and-dependency-resolution.md)。

### 链 2：`ctx.db` → 拿到服务实例

| 步骤 | 位置 |
|---|---|
| Proxy get trap | `C/reflect.ts:63` |
| 特殊属性判定 | `C/reflect.ts:33`（symbol / `prototype` / `then` / 数字串 / `_` 前缀） |
| 已有属性 → traceable 包装 | `C/reflect.ts:68` → `C/utils.ts:110 getTraceable` |
| accessor 分支 | `C/reflect.ts:75-77` |
| 根 ctx 非严格分支 | `C/reflect.ts:81` |
| `internal/get` waterfall | `C/reflect.ts:82` |
| 沿 fiber 链向上查找 | `C/reflect.ts:84-95` |
| 命中 → `getTraceable(ctx, impl.value)` | `C/reflect.ts:87` |
| 声明了但不可用 → 抛 inactive | `C/reflect.ts:88-90` |
| isolate 边界 → 抛错 | `C/reflect.ts:93` |
| traceable 代理的 get trap | `C/utils.ts:165-194` |
| `this.ctx` 改写成调用方 ctx | `C/utils.ts:168` |

详见 [04 § 4.3](04-context-and-reflect-proxy.md)、[04 § 4.6](04-context-and-reflect-proxy.md)。

### 链 3：服务卸载 → 依赖者级联重载

![链 3：服务卸载到依赖者级联重载](diagrams/09-cascade-chain.svg)

**链 3：服务卸载到依赖者级联重载** — [交互版](diagrams/09-cascade-chain.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-cascade-chain.sequence.json)

- **传播由 notify 单点驱动**：disposer 只负责删表并调 notify · notify 全量遍历 fibers 并按 inject 过滤 · 没有依赖图，因此也不需要维护它
- **卸载是并发的**：同一 effect 内的 disposer 按启动顺序逆序 · 跨 Fiber 用 allSettled 并发等待 · 单个失败不阻断其余
- **递归终止条件**：每层卸载可能触发下一层 notify · 直到没有 Fiber 的 epoch 再变化 · 详见 03 篇 § 3.2 与 05 篇 § 5.6

详见 [05 § 5.4](05-service-registration-and-dependency-resolution.md)、[05 § 5.6](05-service-registration-and-dependency-resolution.md)。

### 链 4：yml 文件 → 插件树

| 步骤 | 位置 |
|---|---|
| `Include` 插件 `[Service.init]` | `I/index.ts:134` |
| 读文件 → `yaml.load` / `JSON.parse` | `I/index.ts:228`（`_read()`） |
| **`applyPatches(data)`** | `I/patch.ts:47` |
| `root.update(data)` | `I/index.ts:435`（`_scheduleApply()` 内） |
| `EntryGroup` 分发到各 `Entry.update()` | `L/config/group.ts` → `L/config/entry.ts:100` |
| 首次 → `Entry.init()` | `L/config/entry.ts:146` |
| `_init()` → `tree.import(name)` | `L/config/entry.ts:159` → `L/config/tree.ts:131` |
| `unwrapExports()`（双层 default 解包） | `L/index.ts:164` |
| `_patchContext([])` → isolate 7 步 | `L/config/entry.ts:170` → `L/config/isolate.ts:91` |
| `ctx.registry.plugin(...)` | `L/config/entry.ts:172` |
| 全部完成后 `notify(['loader'])` | `L/config/entry.ts:155` |

详见 [07 § 7.1](07-loader-and-configuration-tree.md)、[07 § 7.4](07-loader-and-configuration-tree.md)。

### 链 5：文件改动 → 插件热重载

| 步骤 | 位置 |
|---|---|
| chokidar `change` | `H/index.ts:162` |
| 是 external → 整进程重启 | `H/index.ts:168` |
| 配置文件（经 `ctx.hmr.watch` 注册） | `H/index.ts:172-181` + `I/index.ts:125-127` |
| 在 loadCache → `stashed.add` + 去抖 | `H/index.ts:186-189` |
| **`partialReload()`** | `H/index.ts:295` |
| **`analyzeChanges()`**（accepted/declined 传播） | `H/index.ts:240` |
| 找候选插件（按 entry name 解析） | `H/index.ts:303-325` |
| 判定真要重载的 | `H/index.ts:327-340` |
| 清 ESM loadCache（`Map.prototype.delete.call`） | `H/index.ts:366` |
| 清 CJS `require.cache` | `H/index.ts:371-373` |
| Stage 1 全部重新 import（含导出校验） | `H/index.ts:394-407` |
| `registry.delete` + Stage 3 换 Fiber | `H/index.ts:425`、`:447-465` |
| 失败 → import 期 `rollback()`；换 Fiber 期不回滚 | `H/index.ts:404-407`、`:458-464` |
| 下游插件因 epoch 变化自动重载 | 无代码——[03 § 3.4](03-fiber-model.md) |

详见 [08 § 8.3](08-hmr.md)。

## 9.2 `symbols` 全表

`C/utils.ts:47-75`，全部用 `Symbol.for`（跨实例共享）：

| 分组 | 符号 | 用途 |
|---|---|---|
| **内部** | `shadow` | 藏起服务自己的 ctx（[04 § 4.6](04-context-and-reflect-proxy.md)） |
| | `caller` | traceable 代理里取调用方 |
| | `receiver` | accessor 的 receiver 传递 |
| | `original` | 取被代理的原对象 |
| | `metadata` | `@Inject()` 方法装饰器的元数据 |
| | `initHooks` | 实例化后要跑的钩子（`C/fiber.ts:153`） |
| | `checkProto` | 标记 inject 对象需沿原型链合并 |
| **Context** | `effect` | `EffectMeta` 挂载键 |
| | `filter` | 事件派发过滤器（`Context.filter`） |
| | `isolate` | realm 映射表（`Context.isolate`） |
| | `intercept` | 服务配置表（`Context.intercept`） |
| **Service** | `init` | `Service.init` 初始化方法 |
| | `check` | `Service.check` 可用性判定 |
| | `config` | `Service.config` 配置类型槽 |
| | `invoke` | `Service.invoke` 让服务可调用 |
| | `extend` | `Service.extend` 派生视图 |
| | `tracker` | `Service.tracker` traceable 配置 |
| | `resolveConfig` | `Service.resolveConfig` 配置合并 |

另有三个不在 symbols 表里但同样重要的 `Symbol.for`：

| 符号 | 位置 | 用途 |
|---|---|---|
| `Symbol.for('cordis.entry')` | `L/config/entry.ts:35` | `Entry.key`，挂在 ctx 上标记所属 entry |
| `Symbol.for('cordis.group')` | `L/config/group.ts:6` | `EntryGroup.key`，标记 group 插件 |
| `Symbol.for('cordis.is')` | `C/context.ts:31` | `Context.is` 的判定键 |
| `Symbol.for('ValidationError')` | `C/fiber.ts:14` | 配置校验错误标记 |

## 9.3 逐文件符号表

### `C/fiber.ts`（496 行）

| 符号 | 行号 |
|---|---|
| `ValidationError` | 16 |
| `resolveConfig()` | 34 |
| `Disposable` / `Effect` / `EffectMeta` | 52 / 54 / 66 |
| `EffectRunner`（内部） | 71 |
| **`FiberState`** | **78** |
| `CordisError` | 87 |
| `INACTIVE = '__INACTIVE__'` | 101 |
| **`class Fiber`** | **103** |
| 构造函数 | 122 |
| 根 Fiber 分支 | 200-212 |
| `get name()` | 215 |
| `assertActive()` | 224 |
| `_execute()` | 229 |
| **`effect()`** | **277** |
| `getEffects()` | 342 |
| `_getState()` | 348 |
| `_updateState()` | 355 |
| `_checkImpl()` | 371 |
| **`_refresh()`** | **385** |
| **`_setEpoch()`** | **399** |
| `_reload()` / `_unload()` | 417 / 439 |
| `await()` / `restart()` / `update()` | 462 / 470 / 478 |

### `C/reflect.ts`（283 行）

| 符号 | 行号 |
|---|---|
| `enhanceError()` | 20 |
| `RESERVED_WORDS` | 27 |
| `isSpecialProperty()` | 33 |
| `Impl` | 54 |
| `class ReflectService` | 61 |
| **`static handler`** | **62** |
| get / set / has trap | 63 / 102 / 128 |
| `store` / `props` | 137 / 138 |
| `get()` / `_getImpl()` / `set()` | 152 / 156 / 164 |
| **`provide()`** | **177** |
| **`notify()`** | **207** |
| `accessor()` / **`mixin()`** | 231 / **241** |
| `trace()` / `bind()` | 269 / 273 |

### `C/utils.ts`（282 行）

| 符号 | 行号 |
|---|---|
| `DisposableList` | 4 |
| `Tracker` | 41 |
| **`symbols`** | **47** |
| `isConstructor()` | 76 |
| `joinPrototype()` | 88 |
| **`getTraceable()`** | **110** |
| `withProps()` | 120 |
| `createShadow()` / `createShadowMethod()` | 141 / 149 |
| **`createTraceable()`** | **161** |
| `applyTraceable()` / `createCallable()` | 218 / 223 |
| `composeError()` / `buildOuterStack()` | 264 / 279 |

### `C/registry.ts`（214 行）

| 符号 | 行号 |
|---|---|
| `isApplicable()` | 7 |
| **`@Inject()`** | **17** |
| `Inject.resolve()` | 43 |
| `Plugin` 类型 / `Plugin.Base` | 63 / 69 |
| `Plugin.Runtime` | 94 |
| `class RegistryService` | 125 |
| `get counter()` | 136 |
| `resolve()` / `delete()` | 144 / 162 |
| `inject()` / **`plugin()`** | 189 / **193** |

### `C/events.ts`（188 行）

| 符号 | 行号 |
|---|---|
| `isBailed()` | 6 |
| `DispatchMode` | 14 |
| `class EventsService` | 45 |
| `internal/listener` 自注册钩子 | 54 |
| `internal/update` 全局钩子 | 62 |
| **`_resolve()`** | **72** |
| `parallel` / `emit` / `serial` / `bail` / **`waterfall`** | 89 / 96 / 101 / 109 / **117** |
| `register()` / `unregister()` | 134 / 143 |
| **`on()`** / `once()` | **154** / 169 |
| **`interface Events`（8 事件）** | **178** |

### `C/service.ts`（80 行） · `C/context.ts`（78 行）

| 符号 | 行号 |
|---|---|
| `abstract class Service` | service:5 |
| 7 个 static symbol | service:6-12 |
| 构造函数 | service:18 |
| `[symbols.filter]` | service:37 |
| `[symbols.extend]` | service:41 |
| `[symbols.resolveConfig]` | service:51 |
| `static [Symbol.hasInstance]` | service:69 |
| `class Context` | context:21 |
| `Context.is` | context:26 |
| 构造函数 | context:35 |
| `new Proxy(...)` | context:38 |
| `_disposables.clear()` | context:47 |
| `extend()` / `isolate()` / `intercept()` | context:55 / 65 / 71 |

### `L/`（loader，997 行）

| 符号 | 位置 |
|---|---|
| `class Loader` | `index.ts:47` |
| `internal = ModuleLoader.fromInternal()` | `index.ts:55` |
| `internal/update` 写回钩子 | `index.ts:74` |
| `internal/plugin` 钩子（7 case 自卸载判定） | `index.ts:90` |
| `[Service.check]()` | `index.ts:141` |
| `unwrapExports()` | `index.ts:164` |
| `createResolve()`（`.cordis/resolve.mjs` 锚定解析） | `resolve.ts:65` |
| `class Entry` | `config/entry.ts:34` |
| `Entry.key` | `config/entry.ts:35` |
| `get disabled()`（沿父链） | `config/entry.ts:64` |
| `_patchContext()` | `config/entry.ts:84` |
| **`update()`** | `config/entry.ts:100` |
| `getOuterStack`（返回配置位置） | `config/entry.ts:136` |
| `init()` / `_init()` | `config/entry.ts:146` / `:159` |
| `EntryTree` / `sep = ':'` | `config/tree.ts:24` / `:25` |
| `resolve()` / `import()` | `config/tree.ts:74` / `:131` |
| `EntryGroup` / `Group` | `config/group.ts:5` / `:78` |
| `Realm` / `LocalRealm` / `GlobalRealm` | `config/isolate.ts:25` / `:47` / `:57` |
| **`loader/patch-context` 7 步算法** | `config/isolate.ts:91` |
| realm GC | `config/isolate.ts:151` |

### `I/`（include，947 行） · `H/`（hmr，496 行）

| 符号 | 位置 |
|---|---|
| `JsExpr` yaml 类型 | `I/index.ts:13` |
| `class Include` | `I/index.ts:81` |
| **`applyPatches()`** | `I/patch.ts:47` |
| `[Service.init]()` | `I/index.ts:134` |
| `_writeText()`（原子写） | `I/index.ts:351` |
| `loadDependencies()` | `H/index.ts:32` |
| `class Hmr` | `H/index.ts:82` |
| `[Service.init]()` | `H/index.ts:129` |
| **`analyzeChanges()`** | `H/index.ts:240` |
| **`partialReload()`** | `H/index.ts:295` |
| `rollback()` | `H/index.ts:380` |

## 9.4 错误消息对照表

| 消息 | 抛出位置 | 含义 |
|---|---|---|
| `cannot create effect on inactive context` | `C/fiber.ts:97`（`CordisError.Code`），抛于 `:226` | 在已卸载 ctx 上 `effect()` |
| `Invalid effect` | `C/fiber.ts:236`、`:245`、`:270` | effect 回调返回值非法 |
| `invalid config:\n  - ...` | `C/fiber.ts:16`（`ValidationError`） | Standard Schema 校验失败 |
| `Async config validation is not supported` | `C/fiber.ts:39` | Config 的 validate 返回 Promise |
| `cannot get property "x" without inject` | `C/reflect.ts:71` | 未声明依赖 |
| `cannot get required service "x" in inactive context` | `C/reflect.ts:89-90` | 声明了但提供者非 ACTIVE |
| `cannot set property "x" without provide` | `C/reflect.ts:111`、`:168` | 给未注册的名字赋值 |
| `cannot set property "x" in multiple fibers` | `C/reflect.ts:171` | 非注册者试图改值 |
| `property "x" is already declared as y` | `C/reflect.ts:182`、`:234` | service / accessor 名字冲突 |
| `service "x" has been registered at <y>` | `C/reflect.ts:190` | 同 realm 重复 provide |
| `invalid plugin, expect function or object with an "apply" method, received z` | `C/registry.ts:196` | 传入非法插件 |
| `@Inject() can only be used on class or class methods` | `C/registry.ts:37` | 装饰器位置错 |
| `extension "x" not supported` | `I/index.ts:111` | include 的文件扩展名不支持 |
| `config file not found: <path>` | `I/index.ts:142` | 文件不存在且无 `initial` |
| `config file %C is read-only, %d pending change(s) kept in memory` | `I/index.ts:326`（warn） | 配置文件不可写，变更暂存内存 |
| `loader internals are unavailable, source code HMR is disabled; pass --expose-internals or install node-addon-require-builtin to enable it` | `H/index.ts:141`（warn） | 缺内部接口时源码 HMR 被禁用（进程不退出） |
| `patch: entry %C not found` | `I/patch.ts:93`（warn） | patch 的 id 不存在 |
| `patch: name mismatch for %C ...` | `I/patch.ts:98`（warn） | patch 的 name 与目标不符 |
| `patch insert: entry %C is not a group` | `I/patch.ts:74`（warn） | 带 id 的 insert 目标不是 group |
| `patch: id is required for non-insert patches` | `I/patch.ts:87`（warn） | 非 insert patch 缺 id |

## 9.5 配置项速查

### `Loader.Config` / `Loader.Intercept`

| 项 | 位置 | 说明 |
|---|---|---|
| `baseUrl?: string` | `L/index.ts:39` | 解析相对路径的基准 |
| `intercept.await?: boolean` | `L/index.ts:43` | 为 true 时，loader 在有未完成任务期间报告不可用 |

### `Include.Config`

| 项 | 位置 | 说明 |
|---|---|---|
| `path: string` | `I/index.ts:74` | 配置文件路径 |
| `initial?: any[]` | `I/index.ts:75` | 文件不存在时的初始内容 |
| `patches?: PatchOptions[]` | `I/index.ts:76` | 补丁列表（§ [07 7.5](07-loader-and-configuration-tree.md)） |
| `enableLogs?: boolean` | `I/index.ts:77` | 是否打印 apply/reload/unload 日志 |

### `Hmr.Config`

| 项 | 默认 | 位置 |
|---|---|---|
| `base?: string` | — | `H/index.ts:481` |
| `root: string[]` | `['.']` | `H/index.ts:482` |
| `ignored: string[]` | `['**/node_modules', '**/.*', 'cache', 'data']` | `H/index.ts:483` |
| `debounce: number` | `100` | `H/index.ts:489` |

### 环境变量

| 变量 | 位置 | 说明 |
|---|---|---|
| `CORDIS_SHARED` | `L/index.ts:50` | JSON，跨重启共享的 `envData`（含 `startTime`） |

### 启动参数

| 参数 | 必要性 |
|---|---|
| `--expose-internals` | 可选增强：缺失时源码 HMR 禁用并告警（`ModuleLoader.fromInternal()` 返回 `undefined`） |
| `--import tsx` | 直跑 TS 源码时需要 |
| `--import @cordisjs/unyaml` | 需 `import x.yml` 时 |

## 9.6 五种事件派发模式对照

| 模式 | 位置 | 同/异步 | 中断 | 用途 |
|---|---|---|---|---|
| `emit` | `C/events.ts:96` | 同步 | 否 | 通知 |
| `parallel` | `C/events.ts:89` | 异步 | 否（`AggregateError`） | 并发副作用 |
| `bail` | `C/events.ts:109` | 同步 | 首个 `isBailed` | 询问式 |
| `serial` | `C/events.ts:101` | 异步 | 首个 `isBailed` | 异步询问 |
| **`waterfall`** | `C/events.ts:117` | 取决于监听器 | `next()` 控制 | **中间件 / 拦截 / 改写** |

`isBailed(v)` = `v !== null && v !== false && v !== undefined`（`C/events.ts:6`）。**注意 `0` 与 `''` 算"非空"**。

## 9.7 状态与语义速查

### `FiberState`（`C/fiber.ts:78`）

| 值 | 语义 | 判定依据（`_getState()`，`:348`） |
|---|---|---|
| `PENDING` | 依赖未就绪 | epoch === INACTIVE |
| `LOADING` | 正在执行插件代码 | `_setEpoch` 显式设置 |
| `ACTIVE` | 运行中 | epoch ≠ INACTIVE |
| `FAILED` | 初始化抛错 | `_error` 存在 |
| `DISPOSED` | 已卸载 | `uid === null` |
| `UNLOADING` | 正在卸载 | `_setEpoch` 显式设置 |

### effect 的返回形态（`C/fiber.ts:54`）

前四行是 `Effect` 类型声明的四种有效形态，后两行是 `_execute()` 的边界处理：

| 形态 | 处理位置 |
|---|---|
| `Disposable`（函数） | `:239-241` |
| `Iterable<Disposable>`（生成器） | `:249-255` |
| `Promise<Disposable>` | `:247` |
| `AsyncIterable<Disposable>`（async 生成器） | `:256-268` |
| `nullish` | `:242-243` |
| 其它 → `TypeError` | `:236`、`:245`、`:270` |

## 9.8 症状 → 分册路由

| 症状 | 先看哪篇 |
|---|---|
| 不知道从哪读起 | [01](01-overview-and-design-philosophy.md)、[02](02-code-structure-and-package-boundaries.md) |
| 插件不启动 / 反复重启 | [03 § 3.4-3.5](03-fiber-model.md) |
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
| 想查某符号在哪 | 本篇 § 9.3 |
| 遇到不认识的错误消息 | 本篇 § 9.4 |
| DSH 里怎么用这些机制 | [DSH 05 篇](../hello-dsh/05-startup-and-cordis-runtime.md) |

## 9.9 测试文件与语义映射

想确认某个语义的准确行为时，**读 spec 比读实现快**：

| 想确认什么 | 读哪个测试 |
|---|---|
| effect 的卸载顺序与幂等 | `core/tests/dispose.spec.ts`（240 行） |
| Fiber 状态机转移 | `core/tests/fiber.spec.ts`（242 行） |
| 插件注册与依赖 | `core/tests/plugin.spec.ts`（184 行） |
| 服务基类行为 | `core/tests/service.spec.ts`（165 行） |
| 5 种事件派发 | `core/tests/events.spec.ts`（282 行） |
| `this` 归属（shadow） | `core/tests/shadow.spec.ts`（310 行） |
| `a.b` 形式关联属性 | `core/tests/associate.spec.ts`（256 行） |
| 可调用服务 | `core/tests/invoke.spec.ts`（116 行） |
| `@Inject()` 装饰器 | `core/tests/decorator.spec.ts`（40 行） |
| core 层 isolate | `core/tests/isolate.spec.ts`（123 行） |
| **配置驱动的 isolate（realm 切换）** | `loader/tests/isolate.spec.ts`（**538 行**） |
| group 的启停传播 | `loader/tests/group.spec.ts`（291 行） |
| **HMR 全流程** | `hmr/tests/index.spec.ts`（**1294 行**） |
| **patch 语义** | `include/tests/patch.spec.ts`（263 行） |
| 定时器可逆性 | `timer/tests/index.spec.ts`（318 行） |

---

**上一篇** ← [08 HMR 热重载](08-hmr.md) ｜ **返回** → [索引](README.md) ｜ **动手** → [配套工程 dsh-lab](../../dsh-lab/README.md)
