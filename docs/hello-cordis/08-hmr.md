---
title: "HMR 热重载"
---
# HMR 热重载

> **本篇回答**：`packages/hmr`（`index.ts` 839 行 + `runtime/` 四模块：patches 433 / resolution 281 / modules 183 / internal 171，另 `error.ts` 35 行 / 测试 17 文件约 3000 行）如何在 rc.13 里以"**缓存级事务 + 组件原位替换**"实现热重载：`reconcile()` 事务模型、`_analyze` 的反向 BFS、`ReconcileUnit` 分区、`registry.replace()` 原位替换、以及 `runtime/` 的模块解析缓存失效子系统。
> **路径缩写**：`H/` = `packages/hmr/src/`，`L/` = `packages/loader/src/`。行号对应快照 `bc9fae7`（v4.0.0-rc.13）。
>
> 🧭 **本篇导览**：8.1 事务模型与 hostModules → 8.2 `_analyze` 反向 BFS → 8.3 `_reconcile` 七步机制与 ReconcileUnit → 8.4 `runtime/` 缓存子系统与 Node 差异 → 8.5 回滚边界 → 8.6 watch 与配置 → 8.7 公开面 Result / SkipReason → 8.8 与 Fiber 机制的配合。
>
>
> 💡 **先说清楚：HMR 是什么**——**HMR** 是 **Hot Module Replacement**（模块热替换）的缩写。"热"指进程尽量不退出，"替换"指把已经加载的旧模块或组件换成新版本；它不是简单地重新执行一个文件，也不是每次改代码都重启整个 Node 进程。
> cordis 的 HMR 由 `@cordisjs/hmr`（2.0.0-rc.0，旧名 `@cordisjs/plugin-hmr`）提供。rc.11–rc.13 是一次近乎全部的重写：旧版按"文件 → fiber 重启"模型（先 `registry.delete` 再注册新 Fiber），新版是"**缓存级事务 + `registry.replace()` 原位替换**"——Fiber 身份与 config 保持不变，`ctx.use()` 返回的引用持续有效（`H/README.md:3`，README 86 行就是规格书）。
> 实现需要访问 Node 的内部模块加载器：拿不到时（既没带 `--expose-internals` 也没安装 `node-addon-require-builtin`）构造函数**直接抛错**——`loader internals are unavailable, pass --expose-internals or install node-addon-require-builtin`（`H/index.ts:166-168`），且 `ModuleLoader.fromInternal()` 要求 **Node ≥ 22**（`H/runtime/internal.ts:161`）。没有降级路径，进程起不来。

## 8.1 `reconcile()` 事务模型与 hostModules

新入口是 **`ctx.hmr.reconcile(callback)`**（`H/index.ts:286-301`）：callback 作为事务体运行，返回要调和的**根路径**（绝对路径，文件或目录，`resolve()` 归一化，非法值抛 `invalid root ..., expected an absolute path`，`:529-533`）。事务**串行**（`_queue` 队列，`:291-300`），并用 `AsyncLocalStorage` 拒绝嵌套事务（`cannot start a transaction inside another transaction`，`:288-290`）；事务身份就是 `Symbol('transaction')`（`:292`）。callback 抛错则事务以其错误 reject，模块缓存原样保留（`:265-266` 注释）。

```ts
reconcile(callback: () => Awaitable<Iterable<string>>): Promise<Hmr.Result> {
  const current = this._storage.getStore()
  if (current && current === this._current) {
    return Promise.reject(new Error('cannot start a transaction inside another transaction'))
  }
  const task = this._queue.then(() => {
    const id = Symbol('transaction')
    this._current = id
    return this._storage.run(id, () => this._reconcile(callback)).finally(() => {
      this._current = undefined
    })
  })
  // only the order matters, so the result is not kept alive
  this._queue = task.then(() => {}, () => {})
  return task
}
```

### hostModules：宿主模块集合

旧版的 `externals` 改名 **`hostModules`**（`H/index.ts:154`），在 `[Service.init]`（`:245-259`）里用新函数 **`closure()`**（`:43-56`）收集：从 `process.argv[1]` 的 realpath 出发沿依赖边遍历。

```ts
async function closure(
  roots: Iterable<string>,
  edges: (url: string) => Iterable<string> | Promise<Iterable<string>>,
  stop: (url: string) => boolean = () => false,
) {
  const result = new Set<string>()
  const traverse = async (url: string) => {
    if (result.has(url) || isBuiltin(url) || stop(url)) return
    result.add(url)
    await Promise.all([...await edges(url)].map(traverse))
  }
  await Promise.all([...roots].map(traverse))
  return result
}
```

💡 **`closure()` 只跳过 `node:` 内建（`isBuiltin`，`:50`），不再跳过 `/node_modules/`**——宿主模块集合现在包含主入口的**全部第三方依赖**。旧版的 `isExcluded`/node_modules 规则已不存在。

💡 **host module 变更不再整进程重启**。旧版遇 external 调 `loader.exit()`；rc.13 把它记入 `result.skipped`（reason `HostModule`，`:546-547`；native addon 是 `NativeAddon`，`:548-549`）并告警 `skipped changes, which apply after a restart:`（`:218-221`）——**是否重启交给宿主决定**。`loader.exit()` 方法已不存在（loader 只剩 `'exit'` 事件声明，`L/index.ts:18`）。

💡 **配置文件重载与 HMR 解耦**：include 在自身 `config.watch` 开启时用 `ctx.fs.watch` 自行 `refresh()`（`I/index.ts:294-298`），不再经 `ctx.hmr.watch`（该 API 已删）。旧版 `hmr/change` / `hmr/reload` 两个事件已全部删除——hmr 现在不声明任何事件（`H/index.ts:13-17` 只声明 `ctx.hmr`），对外公开面换成 `Hmr.Result`（§ 8.7）。

## 8.2 `_analyze()`：沿 importer 的反向 BFS

`_analyze(changed)`（`H/index.ts:319-349`）是本包的算法核心。目标：**判断哪些已加载模块应该被驱逐**。算法从旧版"自底向上不动点迭代"改为**沿 importer（反向依赖）的 BFS**：

```ts
const importers = new Map<string, string[]>()
for (const [url, children] of edges) {
  if (this.hostModules.has(url)) continue
  for (const child of children) {
    let list = importers.get(child)
    if (!list) importers.set(child, list = [])
    list.push(url)
  }
}

const accepted = new Set<string>()
const queue = [...changed]
while (queue.length) {
  const url = queue.pop()!
  if (accepted.has(url)) continue
  accepted.add(url)
  queue.push(...importers.get(url) ?? [])
}

const declined = new Set(this.hostModules)
for (const url of urls) {
  if (!accepted.has(url)) declined.add(url)
}
return { accepted, declined, edges }
```

- **方向反过来了**：旧版"沿依赖向下、判定向上"的不动点迭代没有了；新版先把全部已加载模块的依赖边（**旧模块图**，`:321-323`）反转成"谁 import 我"的 `importers` 表（`:325-333`），再从 changed 出发沿 importers 扩散（`:335-342`）——**改动的模块以及所有直接或间接 import 它的模块都 accepted（驱逐）**。
- **天然终止，不需要保守收尾**：每个 url 至多入队一次（`accepted.has(url)` 去重），旧版的 `hasUpdate` 标志与"无法判定一律 declined"都不需要了。
- **declined 的来源**：hostModules 全量进入（`:344`）+ 未被 accepted 的已加载模块（`:345-347`）。host modules 不进 importers 表（`:327`），从宿主方向来的引用不会引发驱逐。
- **不管有没有组件在用**：注释明说驱逐不取决于"是否有已注册组件使用它"（`:310-314`）——之后被重新启用的组件再次 import 时自然拿到新代码。

## 8.3 `_reconcile()`：七步机制与 ReconcileUnit

`_reconcile()`（`H/index.ts:525-753`）是最长的一个方法。`H/README.md` § Mechanism（:30-41）就是它的规格书，七步：

| 步骤 | 位置 | 做什么 |
|---|---|---|
| 1. Sweep | `:537`；`runtime/modules.ts:108-140` | 清掉 load / link / evaluate **失败**的 module job（不管文件有没有变），让下次 import 重试 |
| 2. Resolution caches | `:541`；`runtime/resolution.ts:74-87` | 让后续解析观察到 roots 下的新文件系统（§ 8.4） |
| 3. Matching | `:543-553`；`_match` `:501-523`、`_moved` `:462-495` | 匹配 roots 命中的已加载模块；请求改道的模块也纳入；host module / native addon 记入 skipped |
| 4. Module graph | `:556`（§ 8.2） | changed 及其全部 importer 驱逐 |
| 5. Component discovery | `:561-602`；`_discover` `:404-422`、`_partition` `:360-397` | 扫描**全部已加载模块**找"导出了已注册 Component"的模块，按变更分组 |
| 6. Import | `:617-661` | 全部重新 import 并校验导出；aborted / skipped 单元回滚缓存 |
| 7. Replacement | `:727-750` | 同步 `registry.replace()` 后统一 await |

### 第 5 步：组件发现与分区

- **候选不再是"entry.options.name 解析出的 url"**。`_discover()`（`:404-422`）扫描全部已加载模块，经 ESM namespace 或 **CJS exports**（只有 `require()` 加载过的组件也能被发现）解出导出，`registry.has(component)` 命中才算候选。
- **一个 Component 可由多个模块导出**（`StaleComponent { url, urls, entries, component, modules }`，`:59-70`）：比如入口模块 re-export 实现模块。替换取自**最外层**模块（`outermost`，`:593-599`），其余 entry 一起重新 import 并校验导出一致（`:636-646`），不一致则 `AmbiguousExport` 跳过。
- **`_partition()`（`:360-397`）把变更集分成 ReconcileUnit**：以"新旧模块图的 closure 是否共享一个被驱逐模块"为关系做**并查集**（union-find），每个 unit = 一组要么一起提交、要么一起中止/跳过的 attempts。失败/跳过**按 unit 粒度**处理、缓存也按 unit 恢复（`:674-704`）——不再像旧版那样"一荣俱荣一损俱损"。

### 第 6 步（Stage 1）：先全 import 并校验、再动手

💡 **"先校验后动手"仍是关键设计**（`:617-661`）。所有 stale 组件的新模块先全部 import 成功，并当场校验导出形态（`invalid component at ${path}, expect function or object with an "apply" method, received ${typeof exports}`，`:640-642`）。此时唯一被动过的状态只有模块缓存——失败只需把该 unit 记为 aborted、恢复其缓存，**不动任何 Fiber**。注释还交代了两条细节：没有任何缓存条目在其他组件 import 完成之前被恢复（避免新模块链接到被驱逐的旧模块，`:613-615`）；import 前先把目标记进 `attempt.imported`，这样 import 失败也能拿到新模块图（`:621-622`）。

💡 **模块可能搬家**：`_locate()`（`:435-445`）让一个被移走的模块（包换了 `exports` 入口、link 重指）通过"曾解析到它的请求"重新定位——请求现在全部解析到同一个模块才走请求导入，否则 `AmbiguousImport` 跳过。`_moved()`（`:462-495`）处理"请求现在改道到别处"的已加载模块：父模块静态链接它则父模块也变，动态导入则模块自身重新导入。

## 8.4 `runtime/`：缓存子系统与 Node 差异

模块缓存这层从 index.ts 整体搬进了 `H/runtime/`（4 个模块），这是 Node 侧最重的新增：

- **ModuleLoader v1 / v2**（`runtime/internal.ts:68` / `:100`）：v2 的变更清单注释仍在（`:93-99`，"LoadCache became typed Map ... with **delete only setting undefined**"）。`fromInternal()`（`:158-170`）按 `getOrCreateModuleJob` / `getModuleJobForImport` 的**存在性**判 v2/v1（`:165-167`）——形态按 API 判定而非按版本号（按大版本判断会把 24.0–24.11 误判成 v2）；**Node < 22 直接返回 undefined**（`:161`），Hmr 构造函数随之抛错。
- **`ModuleCaches`**（`runtime/modules.ts:26`）集中管理两个缓存。注释（`:19-25`）明说为什么所有访问都走 `Map.prototype` 直调：条目是 `{ [type]: ModuleJob }`（`loadCache.get(url)` 只读 `javascript` 槽，会漏掉 `with { type: 'json' }` 的 job）；它自带的 `delete(url)` **只清 type 槽不删 Map 条目**；它 extends Node 内部的 `SafeMap`，`instanceof Map` 是 false。`sweep()` 在 `:108-140`，`evict()` 返回 `ModuleBackup`（`:147-167`）。

### 模块解析缓存失效子系统（rc.13 全新）

`runtime/resolution.ts`（281 行）+ `runtime/patches.ts`（433 行）让"**包被换 / exports 改了 / link 重指**"之后还能正确重导入——旧版完全没有这层：

- **`invalidateResolution(roots)`**（resolution.ts:74-87）：移除 ESM resolve cache 里受 roots 影响的条目（结果或父级在 roots 之下，或从 roots 新增的 `node_modules/<name>` 目录下解析包名；`package.json` 代表其目录），**整体清空** CJS 的 `Module._pathCache` 与 ESM/CJS 两张 realpath 缓存；被移除的条目以 `Resolution` 形式返回，供 `_locate` 沿旧请求重新导入、以及 `restoreResolutions`（`:137-145`）恢复。
- **`patches.ts` 替换 Node 内建方法**：`activate()`（`:89-108`）替换 `internalBinding('modules')` 读 manifest 的方法与 `Module._load`，让失效路径下的 `package.json` 从磁盘重读（`invalidateManifests`，`:113-118`）。**替换不随 dispose 恢复**——恢复会把陈旧条目重新暴露出来；下一个 HMR 实例接手失效路径。线程内**至多一个实例**活跃（`Symbol.for('cordis.hmr.patches')` 记录，`:76`；README § Replacements of Node.js methods，:47）。

### Node 22 / 23 / 24 的缓存差异

![Node 版本间的模块缓存差异](diagrams/08-node-cache-quirks.svg)

**Node 版本间的模块缓存差异** — [交互版](diagrams/08-node-cache-quirks.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-node-cache-quirks.architecture.json)

- **强依赖内部实现细节**：LoadCache 结构跨版本变化，没有公开 API 可规避 · v2 的变更清单写在 runtime/internal.ts:93-99 · `Map.prototype.delete.call(...)` 是"绕过子类重写"的标准技巧
- **子类重写导致 delete 失效**：Node 24 的 LoadCache 重写了 delete · 它只清 type 槽而不删 Map 条目 · 于是旧 ModuleJob 仍可被命中
- **两个缓存必须一起清**：ESM 侧清 loadCache · CJS 侧清 require.cache · 漏掉任一个都会拿到旧模块

💡 Node 再改一次 loadCache 结构，这里就得再改。这是热重载不可避免的代价；rc.13 把这层代价集中收进了 `runtime/`，index.ts 本体不再碰 Node 内部接口。

## 8.5 回滚：按 unit 选择性恢复

旧版的 `rollback()` 整体恢复函数已删。替代者是 **`ModuleBackup.restore(urls)` 选择性恢复**（`runtime/modules.ts:157-165`，被 `H/index.ts:704` 调用）：

- aborted / skipped unit 的模块**恢复**（连同它们的 resolutions，`:709-712`），旧组件继续运行；committed unit 的模块保持 evicted。
- 不属于任何 unit 的被驱逐模块：沿旧模块图找到它够到的 kept unit 就一并恢复，若同时够到 committed unit 则两种版本都不一致、保持 evicted（`:684-691`）。
- Stage 1 新加载的模块：若在新模块图里够到一个被恢复的模块（已链接新版本）则驱逐，否则保留（`:700-703`）。

两处边界：

| 触发点 | 位置 | 后续动作 |
|---|---|---|
| import / 导出校验失败 | `:648-655` | unit 记为 **aborted**：`handleError` + 恢复该 unit 的缓存（**不动任何 Fiber**），文件保留到下一批重试（watch 路径 `:226-229`） |
| 换 Fiber 阶段失败 | Stage 3（`:744-748`） | **不回滚**：组件保持 failed 状态（与冷启动失败的表现完全一致），保留注册、父级与配置，下一次文件变化会重试 |

💡 **"换 Fiber 不回滚"是刻意选择**，注释逐字保留了这个立场：

```
// Stage 3: wait for the fibers to settle (concurrent).
// No rollback: a component that fails to apply is left FAILED, exactly as it
// would be on a cold start, and has already been logged by its fiber. It
// keeps its parent and config, so the next change to the file retries it.
```

Stage 1 已经把导出校验做掉了，Stage 3 能失败只剩组件自身初始化的问题——回滚到一个已知有问题的旧实例没有意义，留在 failed 状态反而与冷启动语义一致。可靠性的边界全部压在 Stage 1 的"先校验后动手"上。

💡 **`H/error.ts` 的 `handleError`** 专门格式化 **esbuild `BuildFailure`**，用 `@babel/code-frame` 把出错位置画成代码框（error.ts:6-8、:16-33），让用户能看到是哪个文件哪一行出错。

## 8.6 watch 与配置

`[Service.init]`（`H/index.ts:245-259`）**没有 yield**，只收集 hostModules（旧版"先 yield disposer 再建 watcher"的写法没有了——watcher 的清理交给 `ctx.inject(['fs'], …)` 子 Fiber 与 `ctx.effect`，见 [03 § 3.3](03-fiber-model.md)）。

配置 schema 完全重做（schemastery，`:768-779`）：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `base?: string` | — | 监听基准目录（缺省 `ctx.baseUrl`） |
| `watch.enabled: boolean` | `false` | 开关；需要 `fs` 服务 |
| `watch.files: string[]` | `['.', '!**/node_modules', '!**/.*']` | glob，带 `!` 否定前缀，作为 **`ctx.fs.watch()` 的 filter**（`:772-776`） |
| `watch.debounce: number` | `100`（ms） | 变更去抖 |

💡 **watch 走 `ctx.fs` 服务**（`:184` `ctx.inject(['fs'], ctx => this._watch(ctx))`；`:236` `ctx.fs.watch(...)`）：chokidar / picomatch 移到了 `@cordisjs/fs-node`，hmr 不再依赖 `plugin-timer`——去抖用原生 `setTimeout`/`clearTimeout`，并以 `ctx.effect(() => () => clearTimeout(timer))` 保证可逆（`:203-204`、`:241`）。批与批串行（`flushing` 链，`:208`），**aborted unit 的文件 retained 到下一批**（`:226-229`）：下一批只可能修复它新 import 的模块，所以改动过它的文件要留着。

💡 依赖面也变了：peerDeps 仅 `@cordisjs/fs`（optional）、`cordis`、`node-addon-require-builtin`（optional）；deps 是 `@babel/code-frame` + `schemastery`。旧版的 i18n locales 目录已删。

## 8.7 公开面：`Hmr.Result` 与 `SkipReason`

**hmr 不再声明任何事件**（旧 `hmr/change`、`hmr/reload` 已删）。一轮事务的产物是返回值 `Hmr.Result`（`:785-792`）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `settled` | `Fiber[]` | 被原位替换的 fiber；新组件 apply 失败的 fiber 保持 `FAILED` 也在其中 |
| `aborted` | `Abort[]`（`:802-807`） | 新模块 import 失败的 unit：带走其被驱逐模块列表与首个错误；缓存已恢复、旧组件继续运行，watch 下一批重试 |
| `skipped` | `Skip[]`（`:813-817`） | 无法原位应用的变更：模块列表 + `SkipReason`，重启后生效 |

`Hmr.SkipReason`（`:820-836`）四种：

| 值 | 含义 |
|---|---|
| `HostModule` | 主入口静态可达的模块，进程只跑一次 |
| `NativeAddon` | 原生插件，同进程无法二次加载 |
| `AmbiguousImport` | 曾解析到组件模块的各 import 现在解析到不同模块（两条 link 只重指了一条）——fiber 不记录自己来自哪个 import |
| `AmbiguousExport` | 曾导出同一组件的各模块现在导出不同值——fiber 不记录自己来自哪个模块 |

💡 **与 `@cordisjs/package-manager` 组合**是这套 API 的招牌用法（README:13-17）：装完包把 added/removed/updated 的路径作为 roots 交给 `reconcile()`，实现"装包后原位热更新"。

## 8.8 与 Fiber 机制的配合

HMR 换代时发生的完整链条：

- **原位替换而非拆建**：Stage 2 调 `ctx.registry.replace(component, replacement)`（`:734`；`C/registry.ts:187-211`）· 对每个现存 fiber 调 `fiber._replace(target, inject)`（`C/fiber.ts:401-416`）· 同一个 Fiber 对象保留，只换 runtime 与 inject、清 `_error`、`_revision++` 再 `_refresh()` · `ctx.use()` 拿到的引用持续有效
- **换代靠 `_revision` 而非新 uid**：epoch 以 `${_revision}` 起始（`C/fiber.ts:420`）· `_revision++` 后 `_refresh()` 必然产生新 epoch，即使依赖集合不变 · 依赖方的 epoch 编码的是 `impl.uid`，级联重载自动发生
- **级联范围是精确的**：只有 inject 了该服务的 Fiber 会重载 · 无关组件的 epoch 不变，完全不受影响 · 这是 Fiber 模型相对全量重启的核心收益

💡 **"先删再注册"没有了**。旧版靠 `registry.delete` + 新 Fiber 新 uid 触发级联，还要靠 loader 的 case 4 判别法避免误写配置（[07 § 7.8](07-loader-and-configuration-tree.md)）；rc.13 的 `registry.replace()` 直接复用旧 runtime 的 fiber 列表逐个 `_replace()`——Fiber 身份、config、`fiber.entry` 全部不变，loader 完全无感。

💡 **依赖者的自动重载仍是"免费"的**——HMR 只负责换掉直接变更的组件，下游组件因为 epoch 变化自动跟着重载（[03 § 3.4](03-fiber-model.md)）。**HMR 代码里没有一行处理"依赖者"。** `fiber.entry` 的搬迁代码也已删除——Entry 结构改为 outer/innerFiber（[07 § 7.2](07-loader-and-configuration-tree.md)），不再需要搬。

---

**上一篇** ← [07 Loader 与配置树](07-loader-and-configuration-tree.md) ｜ **下一篇** → [09 关键调用链速查](09-call-chain-reference.md)：全系列行号索引与症状路由表。
