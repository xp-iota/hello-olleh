---
title: "Loader 与配置树"
---
# Loader 与配置树

> **本篇回答**：`loader`（1465 行）与 `include`（1212 行：index 696 + patch 274 + journal 242）如何把一个 yml 文件变成运行中的组件树、`Entry` 与 outer/inner 双 Fiber 的分工、`applyPatches` 与 journal 写回的语义（DSH profile/bundle 的地基）、以及 isolate realm 切换的 7 步算法。
> **路径缩写**：`L/` = `packages/loader/src/`，`I/` = `packages/include/src/`，`C/` = `packages/core/src/`。行号对应快照 `bc9fae7`（v4.0.0-rc.13）。
>
> 🧭 **本篇导览**：7.1–7.2 从配置到运行与 `EntryOptions` → 7.3–7.4 `update()` 决策树与 `init()` → 7.5–7.6 `include` / `applyPatches` / journal 与 id 解析 → 7.7–7.9 isolate realm 7 步、Loader 的 6 监听器 + 1 组件与 `EntryGroup`。
>

## 7.1 从配置到运行

> 📐 **配套对照与可跑入口**：[`cordis.yml`](../../dsh-lab/examples/15-dsh-chat-demo/cordis.yml) 是**空根表**，[`cordis.patch.yml`](../../dsh-lab/examples/15-dsh-chat-demo/cordis.patch.yml) 才是真正的装配清单（全部行都在这里）；[`src/boot.ts`](../../dsh-lab/examples/15-dsh-chat-demo/src/boot.ts) 调用官方 `boot()` 把两者组合成服务树，[`src/services.ts`](../../dsh-lab/examples/15-dsh-chat-demo/src/services.ts) 则集中 import 24 个 `@deepseek-ai/*` 服务包做 Context 类型增强。配套工程里没有一行服务是手工 `new` 出来的，装配全部来自这两份 yml；要观察组件挂载与卸载，请在 `dsh-lab/` 运行 `npm run example:cordis-seam-demo`，并把 [`M12.1`](../../dsh-lab/examples/01-cordis-seam-demo/src/index.ts) 的 `ctx.plugin(plugin)`（`ctx.use()` 的旧名，两条版本线都可用） / `fiber.dispose()` 与本篇 `Entry.init()` / Fiber 回收链对照阅读。

一个典型配置文件：

```yaml
- id: timer
  name: '@cordisjs/timer'

- id: db                  # 示例插件（本系列统一用 db 作示例服务名，见索引术语约定）
  name: my-database
  config:
    host: localhost
  inject:                 # ← 配置层声明依赖（见 § 7.2 的 outer/inner 双 Fiber）
    - greeter
  isolate:
    logger: true          # ← 给这一行私有的 logger realm

- id: group1
  name: '@cordisjs/group'
  group: true
  config:
    - id: a
      name: plugin-a
    - id: b
      name: plugin-b
    disabled: true        # ← 这行不启动（也可以写 !!js 表达式）
```

![从 cordis.yml 到 Fiber 的落地链](diagrams/07-config-to-fiber.svg)

**从 cordis.yml 到 Fiber 的落地链** — [交互版](diagrams/07-config-to-fiber.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-config-to-fiber.architecture.json)

- **三段翻译**：Include 把文件变成 EntryOptions 数组 · EntryTree 把数组变成 Entry 对象树 · 每个启用的 Entry 再创建 Fiber（声明了 `inject` 的 Entry 是 outer/inner 两层，见 § 7.2）
- **group 是配置里的一行**：group: true 的 Entry 其 config 是子 Entry 数组 · 子条目的 id 会拼上父级 id，用冒号分隔 · 嵌套深度没有硬限制
- **disabled 沿父链生效**：`get disabled`（entry.ts:114-118）以缓存的 `_verdict` 判定并向上检查父链（`_parentDisabled()`，:120-127） · `disabled` 支持 JS 表达式（`:104-112`） · 被禁用的 Entry 根本不创建 Fiber · 父级禁用则整棵子树都不激活

## 7.2 `EntryOptions`：配置行的字段

`L/config/entry.ts:8-16` + 一处模块扩展（isolate 字段由 `L/config/isolate.ts:6-9` 的 module augmentation 声明）：

| 字段 | 来源 | 语义 |
|---|---|---|
| `id: string` | entry.ts:9 | 唯一标识（同层唯一），patch 的定位键 |
| `name: string` | entry.ts:10 | 模块名，会被 `import()` |
| `config?: any` | entry.ts:11 | 传给组件的配置；group 时是子 Entry 数组 |
| `group?: boolean \| null` | entry.ts:12 | 是否是分组 |
| `disabled?: boolean \| null` | entry.ts:13 | 是否禁用；支持 `!!js` 表达式 |
| `inject?: Inject \| null` | entry.ts:14 | **配置层追加依赖声明** |
| `intercept?: Dict \| null` | entry.ts:15 | 给该行注入服务配置（原 isolate.ts 字段上移为一级字段） |
| `isolate?: Dict<true \| string> \| null` | isolate.ts:8 | realm 声明：`true` = 私有，字符串 = 命名 realm |

💡 **`inject` 写在配置里会产生两层 Fiber**。落地机制与 rc.10 完全不同：Entry 有自己的 `inject` 字典（entry.ts:63），`_resolveInject()`（`:150-167`）解析并插值、用 `deepEqual` 判断变化。有 inject 的 entry 由内置 **outer 组件 `'loader:outer'`**（`:36-46`）持有一个 **outer Fiber**（`:354`），outer 的 apply 里重新 `entry._import()`——这样 HMR 期间重载过的模块会被用上——import 失败前先 `yield () => {}` 防止依赖丢失误启；真正启动时在 outer 内部再建 **inner Fiber**（`_start()` 里 `innerContext.registry.use(component, this.options.config, ...)`，`:364-372`）。**"entry 的 root fiber" 是 innerFiber**（`L/index.ts:131` 用 `!Entry.isOuter(fiber)` 判定）。这意味着**运维可以在不改代码的前提下给组件加依赖**——比如强制某组件等另一个服务就绪，代价是该 entry 多一层 Fiber。

💡 **`sortKeys()`（`L/config/entry.ts:28-33`）**：每次 update 后把 options 的键重排为 `id, name, <其余按字母序>, config`。写回 yml 时字段顺序稳定，diff 干净。

## 7.3 `Entry.update()`：判断"重载还是原地改"

`L/config/entry.ts:218-257` 是 loader 的核心决策点（新增第三参 `force`；diff 用 `deepEqual`；rebuild 条件 = inject 变化或 name 变化，`:243`）：

![Entry.update 的决策分支](diagrams/07-entry-update.svg)

**Entry.update 的决策分支** — [交互版](diagrams/07-entry-update.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-entry-update.architecture.json)

- **create 决定合并语义**：create 为真表示新建，整份 options 直接替换 · 否则是增量更新，逐字段合并 · 值为空的字段按删除处理，而不是写入空值
- **三条出路互斥**：禁用则销毁 Fiber 并结束 · 未运行则走首次 init · 已运行则算 diff 再决定动作
- **diff 决定重载还是 patch**：只有配置真的变化才动 Fiber · 仅 config 字段变化可以就地 patch · 涉及 name 或 inject 变化则必须重载

💡 **关键：已运行的 Entry 不重建 Fiber，走 `_patchContext`**（`L/config/entry.ts:181-193`）：

```ts
private async _patchContext(diff: string[]) {
  await this.context.waterfall('loader/patch-context', this, async () => {
    Object.setPrototypeOf(this.ctx, this.parent.ctx)
    Object.setPrototypeOf(this._intercept, this.parent.ctx[Context.intercept])

    if (this.outerFiber) {
      if (this.outerFiber.state !== FiberState.ACTIVE) return
      await this._reconcile(this.outerFiber.ctx, diff)
    } else if (this.innerFiber?.uid) {
      await this._reconcile(this.ctx, diff)
    }
  })
}
```

**`Object.setPrototypeOf` 换父作用域**是很激进的操作——直接改运行中 Context 的原型，让它看到新的父作用域；第二行连 `_intercept`（该行的服务配置表）的父级一起换。isolate 组件在这个 waterfall 里插入了 7 步算法（§ 7.7）。

💡 **后续动作委托给 `_reconcile()`（`:195-209`）**：inner fiber 不存在时只 `outerFiber.restart()`（重新激活时会重新求值 `disabled`）；inner fiber 存活时重新求值 disabled、应用 intercept，diff 含 `config` 或是 group 时才 `innerFiber.update(this.options.config, true)`（`:207`）。**`noSave = true`**（第二个参数）避免"配置文件驱动的更新"又经 `internal/commit` 写回配置文件（死循环）。

## 7.4 `Entry.init()`：真正启动

`L/config/entry.ts:311-328`（`_init()` 在 `:339-358`）：

![Entry.init() 从配置项到插件就绪](diagrams/07-entry-init.svg)

**Entry.init() 从配置项到组件就绪** — [交互版](diagrams/07-entry-init.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-entry-init.sequence.json)

- **_initTask 的去重语义**：??= 让并发调用共享同一个 Promise · 配置热更新时同一 Entry 可能被反复 init · 去重保证模块只被 import 一次
- **导出处理为什么必要**：CommonJS 与 ESM 的默认导出形态不一致 · unwrapExports 统一成 cordis 认得的组件对象 · 否则 registry.resolve 会拿到 Module 命名空间对象
- **loader 就绪的广播**：全部 Entry 完成后才 notify(['loader']) · 依赖 loader 服务的组件在此刻才被唤醒 · 这形成了配置树加载与组件激活的分界

💡 **`unwrapExports()` 处理 ESM/CJS 互操作的历史包袱**，已从 `L/index.ts` 移到 `L/internal.ts:32-39`（loader 上保留转发，`L/index.ts:199-201`；hmr 也有一份拷贝，`H/index.ts:128-135`），注释里直接引了两个 issue：

```ts
export function unwrapExports(exports: any) {
  if (exports === null || exports === undefined) return exports
  exports = exports.default ?? exports
  // https://github.com/evanw/esbuild/issues/2623
  // https://esbuild.github.io/content-types/#default-interop
  if (!exports.__esModule) return exports
  return exports.default ?? exports
}
```

**要解两次 `default`**——esbuild 转译产物在某些配置下会双层包裹。

💡 **`fiber.await().finally()` 里的 `notify(['loader'])`（entry.ts:324-327，notify 在 `:326`）** 与 `Loader[Service.check]`（`L/index.ts:179-183`）配合，实现"所有配置项加载完毕后 loader 才算可用"。这样依赖 `loader` 且设了 `intercept: { loader: { await: true } }` 的组件（如某些需要完整组件列表的工具）会等到最后。

## 7.5 `include` 与 `applyPatches`

`include` 插件把一个文件变成 EntryTree。**它的 `applyPatches` 是 DSH profile/bundle 系统的直接地基**（见 [DSH 05 篇](../hello-dsh/05-startup-and-cordis-runtime.md)）。

`I/patch.ts:105-182`：

![applyPatches 的两条处理路径](diagrams/07-apply-patches.svg)

**applyPatches 的两条处理路径** — [交互版](diagrams/07-apply-patches.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-apply-patches.architecture.json)

- **这是 DSH profile 与 bundle 的地基**：patch 让同一份 yml 派生出多套配置 · insert 用于追加条目，overrides 用于改写既有条目 · 不需要复制整份配置文件
- **失败一律降级为警告**：非 insert 的 patch 缺 id 会 warn id is required · 目标找不到会 warn entry not found · 坏 patch 被跳过，其余仍然生效
- **entries 表必须递归建**：group 的 config 是嵌套数组，mount/unmount 都要下钻（`:111-132`） · 只扫顶层会漏掉子树里的 id · 下钻条件是 group 为真且 config 是数组

💡 **四条关键语义**（前三条是 DSH 的 bundle patch 注释里反复强调的，第四条是 rc.13 新增）：

| 语义 | 含义 |
|---|---|
| **整体替换而非合并** | `target[key] = value`（`I/patch.ts:168`）——patch 里写 `config` 会**替换整个 config 对象**，不是深合并 |
| **`name` 是安全阀** | 若 patch 写了 `name`，它必须与目标行的 `name` 一致，否则跳过（`:156-158`，`patch: name mismatch for %C (expected %C, got %C), skipping`）。防止 id 被复用后 patch 打到错误的组件上 |
| **`insert` 与字段覆盖互斥** | 有 `insert` 就只做插入，忽略其余字段（`:140-152`） |
| **变更按所有权记账写回** | `applyPatches` 现在返回 `{ data, index }`（PatchResult，`:95-98`）——新增 **PatchIndex 所有权索引**（file / patch / embedded 三类，`:47-93`），运行期变更经 journal 记账后按所有权写回文件或 patch（`routeJournal`，`:189-274`，见下） |

💡 **`applyPatches` 不再原地修改传入的数组**：入口先 `data = structuredClone(data)`（`I/patch.ts:106`），插入的条目也各自 `structuredClone`（`:143`）——树拥有它挂载的每一个对象。调用点有两处：`_read`（`I/index.ts:454`）与 `_scheduleApply`（`:677-693`，其中 `root.update(tree)` 在 `:687`），文件缓存也不会被 patch 污染。

### journal：树侧变更的记账与写回

`I/journal.ts`（242 行，全新）是 include 写回语义的大扩展：

- **EntryChange 四类**（`L/config/tree.ts:63-69`）：`options` 缺失 = 从 group 删除；`legacy` 缺失 = 新建；都在 = 更新（`from` 是同树内移动时离开的 group）；**跨树移动 = 源树一条 remove + 目标树一条 create**。
- **`record()`（journal.ts:73-89）** 把 EntryChange 折进 `JournalRecord`（remove / upsert 两类）；`mergeRecords()`（`:45-62`）把同 id 的先后记录合并成一条——创建后又删除且从未落盘的条目不留痕迹。`Include.commit()`（`I/index.ts:357-363`）在树侧变更就位后同步记账并置 dirtyWrite。
- **文件与树冲突时 file wins**：`reconcile()`（journal.ts:195-242）做三方调和，冲突键从 journal 里删掉、树跟随文件，每个冲突打一条 `config conflict in %C: entry %C %s; file wins`（`I/index.ts:455-458`）。
- **`routeJournal()`（patch.ts:189-274）**：patch 拥有的键写回 patch 本身（经 `PatchIndex.key`），文件拥有的写回 data；patches 若因此变化，会经 `fiber.update(this.config)` 持久化（`I/index.ts:495-512`）。
- **`Include.Config` 新增 `watch?: boolean`（`I/index.ts:115`）**：开启后经 `ctx.inject(['fs'], …) ctx.fs.watch(...)` 监听配置文件并自行 `refresh()`（`:294-298`）——**配置热重载不再依赖 HMR 包**。

### 文件格式与写回

| 扩展名 | MIME | 可写 |
|---|---|---|
| `.json` | `application/json` | ✅ |
| `.yaml` / `.yml` | `application/yaml` | ✅ |
| 其它 | — | ❌（构造函数直接抛错，不再回退 `import()`） |

扩展名到 MIME 的映射在 `I/index.ts:36-40`（`types`）。不支持的扩展名在构造函数里直接抛 `extension "${ext}" not supported`（`I/index.ts:280`）。

💡 **写回是原子的**（`I/index.ts:551-575` 的 `_writeText`）：先写 `.{basename}.{pid}.{序号}.tmp`，再 `rename` 覆盖。`rename` 在同一文件系统上是原子操作，避免写一半崩溃导致配置损坏；Windows 上被杀毒软件短暂占住导致的 `EACCES`/`EPERM`/`EBUSY` 会按 20ms×(n+1) 退避重试至多 10 次（`RENAME_RETRIES`/`RENAME_BACKOFF`，`:95-96`，判定 `:104-107`）。带期望内容写入时还会核对文件没被别人改过，改过则抛 `StaleWriteError`（`:561`，类定义 `:82-84`）触发重读（`:534-537`）。

💡 **读写由 `_drain()` / `_loop()` 驱动**（`I/index.ts:365-397`）：读、写各有一个脏标记，任一置位就启动一轮 drain 循环，循环里反复"读—写"直到两个脏位都清空。连续多次写只落盘最后一次；读到写了一半的文件只告警并保留脏位等下一次触发。

### 自定义 YAML 标签 `!!js`

js-yaml 换成了 `yaml`（eemeli，为拿到 AST Range / LineCounter 做行列级定位），`JsExpr` 现在是它的 **ScalarTag** 对象（`I/index.ts:20-29`）：

```ts
const JsExpr: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  identify: isJsExpr,
  resolve: (source) => ({ __jsExpr: source }),
  // quoted like any other string
  stringify: (item, ctx, onComment, onChompKeep) => {
    const scalar = new Scalar((item.value as any).__jsExpr)
    return stringifyString(Object.assign(scalar, { type: item.type }), ctx, onComment, onChompKeep)
  },
}
```

插值入口也变了：`Entry._resolveConfig` 已删，插值由 **loader 的 `internal/config` 监听器统一执行**（`L/index.ts:93-103`：`interpolate(fiber.ctx, config, fiber.entry.trace, ['config'])`）。求值错误经 `//# sourceURL=<cordis:expression#n>` 标记（`L/config/utils.ts:21-31`）把栈帧映射回配置文件的行列位置。

💡 **DSH 大量依赖这个能力**。`dsh-web-app` 的 patch 注释说："Rows configured from flags inject that service, so Loader resolves their expressions only after it exists"——即表达式的求值时机与依赖注入绑定。

## 7.6 `EntryTree`：id 解析

`L/config/tree.ts`（261 行）：

| 方法 | 行号 | 作用 |
|---|---|---|
| `static sep = ':'` | 72 | id 分层分隔符 |
| `* entries()` | 90 | 递归枚举全部 Entry（含子树） |
| `getTasks()` | 98-102 | 收集所有未完成的 `_initTask` 与 outer/inner fiber 的 inertia |
| `await()` | 104 | 循环等待 tasks 清空 |
| `ensureId(options)` | 112 | 没 id 就生成一个（防重） |
| `resolve(id)` | 121 | 按 `a:b:c` 逐层下钻找 Entry |
| `resolveGroup(id)` | 134 | 找到 id 对应的 EntryGroup |
| `create(options, parent, position)` | 141 | 校验（`validateOptions`）并抛 `EntryValidationError`，再建 Entry |
| `remove(id)` | 151 | 删除一行 |
| `update(id, options, parent?, position?)` | 159 | 更新，支持跨 group / 跨树移动 entry |
| `import(name, getOuterStack?)` | 198-246 | 动态 import，出错时接长堆栈 |

💡 **`id` 的全路径由 `Entry.get id()`（`L/config/entry.ts:90-96`）拼出**：

```ts
get id() {
  let id = this.options.id
  if (this.parent.tree.ctx.fiber.entry) {
    id = this.parent.tree.ctx.fiber.entry.id + EntryTree.sep + id
  }
  return id
}
```

只在**跨树**时拼前缀（子树的宿主 Entry 的 id），同一棵树内的 group 嵌套**不拼**。所以 group 内的 entry id 在整棵树里必须唯一。

💡 **`import()` 的三条新路径**（`:198-246`）：Windows 盘符路径自动 `pathToFileURL`（`:200`）；优先走 `loader.internal.import()`（`:212-214`）；`ERR_MODULE_NOT_FOUND` 被包装成带 entry 位置的 `ModuleNotFoundError`（`ModuleNotFoundError` 类在 `:42-49`，包装在 `:236-245`）。

## 7.7 isolate realm 的 7 步切换算法

`L/config/isolate.ts`（160 行）里最复杂的一段——它要在**不重启组件**的前提下把服务实例从一个 realm 搬到另一个。载体从"被 loader 注册的钩子集合"变成了**一个默认导出的 Component**：`export default function isolate(ctx)`（`isolate.ts:58`），由 `ctx.use(isolate)` 挂载（`L/index.ts:172`）。

### 两种 Realm

![两种 Realm 的隔离粒度](diagrams/07-two-realms.svg)

**两种 Realm 的隔离粒度** — [交互版](diagrams/07-two-realms.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-two-realms.architecture.json)

- **suffix 决定 Symbol 的唯一性**：Realm 的职责是为服务名分配存储键 · suffix 拼进 Symbol 描述，保证不同 realm 不撞 · access 的 create 参数控制缺失时是否新建
- **配置写法直接映射类型**：isolate: { x: true } 得到 LocalRealm · isolate: { x: 'myRealm' } 得到 GlobalRealm · 后者让多个 entry 共用一份实现
- **回收策略也不同**：LocalRealm 随 entry 消亡，无需显式回收 · GlobalRealm 要等最后一个引用者离开 · 详见本节的回收流程

Symbol 的描述串形如 `logger#db` 或 `logger@shared`——**调试时能一眼看出它属于哪个 realm**。

### 7 步算法

`loader/patch-context` 的监听器（`L/config/isolate.ts:82-140`）：

![patch-context 的三步切换](diagrams/07-patch-context.svg)

**patch-context 的三步切换** — [交互版](diagrams/07-patch-context.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-patch-context.architecture.json)

- **delim 是本次切换的标记**：delims[name] 缺省时新建一个 Symbol('delim:name') · entry.ctx[delim] 存放本次切换的标识 · 用于区分同名服务在切换前后的两个实例
- **diff 记录四个量**：旧 Symbol 与新 Symbol · entry 自己的 delim 值 · 实现所在 fiber 的 delim 值
- **运行时改原型链**：setPrototypeOf 直接改 isolate 与 intercept 的父级（`entry.ts:183-184` 同款） · 这是「谁能看到什么」被重写的时刻 · 没有显式作用域表，因此必须在此一次性对齐

💡 **`delim`（delimiter）符号的作用是"标记一次切换的身份"**。因为 realm 切换可能级联发生（父 entry 切了，子 entry 也受影响），需要区分"这个 ctx 是被本次切换影响的，还是被别的切换影响的"。第 ⑥ 步的 filter 表达式就是在做这个判定——这也是全 cordis 最难读的一个布尔表达式。

💡 **第 ⑤ 步是"服务搬迁"而非"服务重建"**（`:117-124`）。如果一个组件 provide 了服务，而它的 realm 变了，理论上要卸载再重装；但 cordis 选择直接把 `store` 里的记录换个键，并同步改写 `impl.isolate`（`:122`）。**服务实例的身份（以及它的 Fiber）不变** → 依赖它的组件的 epoch 不变 → 不会被无谓地重载。

💡 **`swap()`（`L/config/utils.ts:102-109`）**：删掉 target 的全部 own key，再从 source 复制过来。**保持对象引用不变**——因为 `entry.ctx[isolate]` 可能被别的地方持有引用。

### Realm 垃圾回收

`loader/partial-dispose` 监听器（`L/config/isolate.ts:142-159`，现带第三参 `active`）：

![GlobalRealm 的引用计数回收](diagrams/07-realm-recycle.svg)

**GlobalRealm 的引用计数回收** — [交互版](diagrams/07-realm-recycle.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-realm-recycle.architecture.json)

- **两种 Realm 的回收责任不同**：LocalRealm 的生命周期绑定在 entry 上 · GlobalRealm 被多个 entry 共享，需要计数 · 因此只有后者要显式判断能否回收
- **两级删除**：先 realm.delete(name) 移除单个服务名 · 若 realm.size 归零再删掉整个 realm 记录 · 避免留下空壳 realm 占用 label
- **这是部分回收而非整体卸载**：监听器名为 loader/partial-dispose · 只处理 isolate 配置变化引起的键切换 · Fiber 本身的卸载走另一条路径

💡 **GC 是遍历式的**（`for (const entry of ctx.loader.entries())`）——O(entry 总数)。GlobalRealm 不常变，可以接受。

## 7.8 Loader 的 6 个监听器 + 1 个组件

`L/index.ts:79-172` 注册了 6 个监听器并挂载 1 个组件（旧的"`internal/update` 写回"职责拆成了 `internal/config` + `internal/commit`）：

| 监听器 / 组件 | 行号 | 作用 |
|---|---|---|
| `internal/config`（prepend） | 79-89 | 校验失败时 `entry.traceValidation(error)` 把错误定位到 YAML 源位置（运行期传入、还没写到任何地方的配置除外） |
| `internal/config`（interpolate） | 93-103 | 对 entry 配置做 `!!js` 表达式插值（在内置校验监听器之后，校验看到的是插值结果） |
| `internal/commit` | 105-112 | **把新配置写回配置文件**：`entry.options.config = unparse ? unparse(config) : config` 然后 `entry.parent.tree.commit(...)`（include 的 commit 记入 journal 并异步落盘） |
| `internal/update`（global） | 114-118 | 打印 `reload` 日志 |
| `internal/status` | 120-126 | outer fiber 因**依赖丢失**卸载时清 `entry._verdict`，让 `disabled` 表达式下次重新求值（uid 检查跳过已被替换的 outer fiber） |
| `internal/plugin` | 128-170 | ① 给 fiber 设置 `fiber.entry`；② **7 个 case 的"自卸载"判定** |
| `ctx.use(isolate)` | 172 | 挂载 isolate 组件（§ 7.7） |

### "自卸载"判定的 7 个 case

`L/index.ts:138-170` —— loader 需要区分"用户在代码里调了 `ctx.fiber.dispose()`"（应该把 `disabled: true` 写回配置）和其它卸载原因（不应该写）：

- **为什么需要七道排除**：loader 要区分「用户主动禁用」与其余情形 · 只有前者该把 disabled 写回配置文件（`:165-168`） · 误判会导致配置被意外改写
- **case 1/2/3 先滤掉创建与无关 fiber**：case 1 用 fiber.uid 把创建事件滤掉（`:139`） · case 2 滤掉不受 loader 跟踪的 fiber（`:142`） · case 3 滤掉 entry 内部的子组件（parent fiber 同属一个 entry，`:145`）
- **case 4/5 是级联卸载**：case 4：entry 所在的树正在 dispose（宿主树 fiber.uid 已清空，`:148`） · case 5：entry 的父级正在卸载、顺带带走它（父级可能因依赖丢失仍在注册表中，`:155`） · 二者都不该写回
- **case 6/7 排除 loader 自身的操作**：case 6：EntryGroup.remove 先注销再 dispose（`store` 里已查不到，`L/config/group.ts:72`） · case 7：loader 行为经 `entry.dispose()` 触发（`entry._disposing`：配置文件更新、祖先 group 禁用、rebuild，`:163`） · 二者都不算用户自卸载

💡 **旧版靠"registry 里还有没有 callback"区分 HMR 的 case 4 已删除**——那段 `// self-dispose / // plugin hmr` 注释在 rc.13 源码中已不存在。热重载现在走 `registry.replace()` **原位替换**，不再"先 delete 再注册"（见 [08 § 8.8](08-hmr.md)），也就不再需要那个脆弱的调用顺序判别法。

## 7.9 `EntryGroup` 与 `Group`

`L/config/group.ts`（120 行）：

| 符号 | 行号 | 说明 |
|---|---|---|
| `class EntryGroup` | 7 | 管理一批 Entry 的容器 |
| `static key = Symbol.for('cordis.group')` | 8 | 标记"这是个 group 组件" |
| `getOuterStack(id)` | 34 | 返回 `    at ${id} (${filename}:${line}:${column})` 形态的配置位置帧 |
| `unlink(options)` | 58 | 从 data 数组里摘掉一行 |
| `remove(id, isDispose?)` | 64 | 删除并 dispose |
| `update(config)` | 80 | 全量对齐子 Entry |
| `stop()` | 100 | 停掉全部子 Entry |
| `class Group extends EntryGroup` | 107 | **可作为组件使用**的 group |
| `Group.initial` | 108 | 静态初始配置 |

`Group` 现在自带 `[Service.init]` async generator（`:116-119`，`yield () => this.stop()`）并监听 `internal/update` 更新子项（`:113`）。`packages/group/src/index.ts` 全文 3 行，就是把 `Group` 再导出，让配置能写 `name: '@cordisjs/group'`。

💡 **`get disabled`（`L/config/entry.ts:104-127`）支持 JS 表达式**：

```ts
private _resolveDisabled(ctx: Context) {
  const { disabled } = this.options
  try {
    this._verdict = isJsExpr(disabled) ? !!evaluate(ctx, disabled.__jsExpr, this.trace(['disabled'])) : !!disabled
  } catch (error) {
    this.ctx.logger.error(error)
    this._verdict = true
  }
}

get disabled() {
  // group is always enabled
  if (this.options.group) return false
  return this._verdict !== false || this._parentDisabled()
}

private _parentDisabled() {
  let entry = this.parent.ctx.fiber.entry
  while (entry) {
    if (entry._verdict !== false) return true
    entry = entry.parent.ctx.fiber.entry
  }
  return false
}
```

判定结果缓存为 `_verdict` 三态（undefined / true / false）：**求值失败视为禁用**；`_verdict === undefined`（outer fiber 尚未提交依赖）也算禁用——表达式要等依赖就绪才能在补丁后的上下文里求值；父链检查按 `_verdict !== false` 判定，**父 group 被 disable 会让所有子孙都 disabled**。group 自身的 `disabled` 对它自己无效（永远返回 false）——它靠让子孙都 disabled 来实现"停用整组"。

---

**上一篇** ← [06 事件系统与 Waterfall](06-event-system-and-waterfall.md) ｜ **下一篇** → [08 HMR 热重载](08-hmr.md)：reconcile 事务模型、模块图驱逐与 registry.replace 原位替换、Node 22-24 的缓存差异、以及失败回滚边界。
