---
layout: content
title: "08 HMR 热重载"
parent_url: /docs/hello-cordis/
---

# 08 HMR 热重载

> **本篇回答**：`packages/hmr`（`index.ts` 405 行 + `error.ts` 35 行 / 测试 800 行）如何在模块图上做 accepted/declined 传播、Node 22-24 的模块缓存差异有什么后果、以及失败时的双层回滚。
> **路径缩写**：`H/` = `packages/hmr/src/`，`L/` = `packages/loader/src/`。行号对应快照 `8cc9e33f`。
>
> 🧭 **本篇导览**：8.1–8.2 三条变更路径与传播算法 → 8.3–8.4 五阶段 `partialReload()` 与 Node 缓存差异 → 8.5–8.6 回滚与 `[Service.init]` → 8.7–8.8 声明的事件与 Fiber 机制的配合。
>
> 📎 **来源**：本篇为本系列原始篇目，基于 cordiverse/cordis 快照 `8cc9e33f`。
>
> 💡 **先说清楚：HMR 是什么**——**HMR** 是 **Hot Module Replacement**（模块热替换）的缩写。"热"指进程尽量不退出，"替换"指把已经加载的旧模块或插件换成新版本；它不是简单地重新执行一个文件，也不是每次改代码都重启整个 Node 进程。
> cordis 的 HMR 由开发期插件 `@cordisjs/plugin-hmr` 提供：监听文件变化 → 分析 Node 模块依赖图 → 把变化尽可能收敛到**插件入口** → 通过 cordis 的卸载/重载机制替换对应 Fiber。插件注册的事件、定时器等副作用随旧 Fiber 一起清理，再由新插件重新建立。
> 它并非所有情况下都做局部替换：框架自身依赖变化会触发整进程重启，loader 配置变化会刷新配置，其他未分类的文件变化则发出 `hmr/change` 事件。由于实现需要访问 Node 的内部模块加载器，启动时还必须带 `--expose-internals`（`H/index.ts:78-82`）。

## 8.1 三条变更路径

文件变化时，HMR 先分类（`H/index.ts:127-152`）：

![文件变化的四路分诊](diagrams/08-change-triage.svg)

**文件变化的四路分诊** — [交互版](diagrams/08-change-triage.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-change-triage.architecture.json)

- **externals 不可热更**：框架自身的模块被列为 externals · 它们的变化只能整进程重启 · 因为框架状态无法在替换后保持一致
- **判定顺序不能换**：先排除 externals，再看是否已加载过 · 已加载才有旧模块可替换 · 最后才考虑是否为配置文件
- **配置重载与代码重载分离**：include.refresh() 只重读 yml，不换模块 · 代码没变时插件不必重新执行 · 两条路径互不干扰

### externals 的定义

`H/index.ts:117-122`：

```ts
const mainUrl = pathToFileURL(resolve(process.argv[1])).href
const mainJob = this.internal.loadCache.get(mainUrl)
if (mainJob) {
  this.externals = await loadDependencies(mainJob)
} else {
  this.externals = new Set()
}
```

💡 **externals = 主入口（`process.argv[1]`）的完整依赖树**。也就是 cordis 框架本身 + loader + hmr 自己。这些文件变了只能整进程重启——因为 HMR 的实现代码本身在其中，热更它等于在换飞行中的引擎。

💡 **`loadDependencies()`（`H/index.ts:31-42`）跳过两类**：`node:` 内建模块与路径含 `/node_modules/` 的。所以第三方依赖变化不触发 HMR（也不算 external）。

## 8.2 accepted / declined 传播算法

`analyzeChanges()`（`H/index.ts:174-227`）是本包的算法核心。目标：**判断哪些模块应该被重新加载**。

![analyzeChanges 的传播算法](diagrams/08-analyze-changes.svg)

**analyzeChanges 的传播算法** — [交互版](diagrams/08-analyze-changes.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-analyze-changes.architecture.json)

- **传播方向是沿依赖向下**：从改动文件出发查它的 children · 只要依赖链上有 accepted 成员就整体接受 · 这是本包最核心的算法
- **两个集合互斥且单调**：accepted 与 declined 只增不减 · 一旦定性就不再重新判断 · 保证循环必然终止
- **declined 的两个来源**：externals 在初始化时就全部进入 · 传播中确认与改动无关的也会进入 · 后续 partialReload 用它排除候选

💡 **传播方向是"沿依赖边向下"，判定是"向上"**。注释（`H/index.ts:167-173`）说得很准：

> A file is accepted if it's directly changed (stashed) or if **any of its dependents are accepted**. A file is declined if **all its dependents are declined** or if it's an external.

注意代码里 `getLinked(url)` 返回的是 `job.linked`——即**该模块 import 的模块**（children）。而判定逻辑写的是"若某个 child 在 accepted 则自己 accepted"。**所以在这份实现里，"dependents" 实际指向 children 方向**。

💡 **不动点迭代 + 保守收尾**。`hasUpdate` 标志防止死循环；无法判定的一律 declined（保守：宁可不重载也不错误重载）。

💡 **`isExcluded`（`H/index.ts:180`）** 与 `loadDependencies` 用同一条规则（`node:` 前缀或 `/node_modules/`），保证两处一致。

## 8.3 `partialReload()`：五个阶段

`H/index.ts:229-378` 是最长的一个方法。

![partialReload 的四个阶段](diagrams/08-partial-reload.svg)

**partialReload 的四个阶段** — [交互版](diagrams/08-partial-reload.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-partial-reload.architecture.json)

- **插件入口是原子单元**：候选以 entry.options.name 解析出的 url 为准 · 取到候选后立刻把该 url 加入 declined · 避免同一入口被重复计入依赖树
- **第三步要临时放行自己**：算依赖树前先把自己从 declined 移除 · 否则整棵树会被自己截断 · 算完再据结果决定是否重载
- **这是全包最长的方法**：源码范围 H/index.ts:229-378 · 四个阶段职责清晰但耦合紧 · 改动前建议先读 § 8.2 的传播算法

💡 **第 ② 步"插件入口是原子单元"是关键设计**。HMR 不重载任意模块，只重载**被配置引用为插件的那个入口文件**。中间的辅助模块变化会沿依赖树冒泡到最近的插件入口，然后整个插件重装。这大幅简化了状态迁移问题。

💡 **第 ⑤ 步的两阶段（先全 import、再逐个换）很重要**。如果边 import 边换，中途某个模块语法错误会留下"一半新一半旧"的状态。先全部 import 成功再动 Fiber，把失败窗口压到最小。

## 8.4 Node 22 / 23 / 24 的缓存差异

这是本包最"脏"的一段，注释（`H/index.ts:277-289`）写了整整 13 行解释：

![Node 版本间的模块缓存差异](diagrams/08-node-cache-quirks.svg)

**Node 版本间的模块缓存差异** — [交互版](diagrams/08-node-cache-quirks.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-node-cache-quirks.architecture.json)

- **这是本包最脏的一段**：源码里的注释写了整整 13 行说明 · 原因是 Node 内部缓存结构跨版本变了 · 没有公开 API 可以规避
- **子类重写导致 delete 失效**：Node 24 的 LoadCache 重写了 delete · 它只清 type 槽而不删 Map 条目 · 于是旧 ModuleJob 仍可被命中
- **两个缓存必须一起清**：ESM 侧清 loadCache · CJS 侧清 require.cache · 漏掉任一个都会拿到旧模块

💡 **`Map.prototype.delete.call(...)` 是标准的"绕过子类重写"技巧**，但也意味着 HMR **强依赖 Node 内部实现细节**。Node 再改一次 loadCache 结构，这里就得再改。这是热重载不可避免的代价。

💡 **`ModuleLoader.fromInternal()`（`L/index.ts:55`，实现在 `L/internal.ts`，123 行）** 是这层适配的载体。它探测 Node 版本并暴露统一的 `version` / `resolve` / `resolveSync` / `loadCache` 接口。

## 8.5 回滚

`rollback()`（`H/index.ts:311-318`）：

```ts
const rollback = () => {
  for (const filename in esmBackup) {
    Map.prototype.set.call(this.internal.loadCache, filename, esmBackup[filename])
  }
  for (const filepath in cjsBackup) {
    require.cache[filepath] = cjsBackup[filepath]
  }
}
```

两处触发：

| 触发点 | 位置 | 后续动作 |
|---|---|---|
| import 阶段失败 | `:326-329` | `handleError(ctx, e)` + `rollback()` + return（**不动任何 Fiber**） |
| 换 Fiber 阶段失败 | `:363-373` | `rollback()` + 对每个 reloads 项：`registry.delete(新插件)` 然后 `reload(旧插件, runtime)` |

💡 **第二种回滚是"补偿式"的**，不是事务。如果补偿本身也失败，只打 warn（`:370`）——此时状态可能不一致。**HMR 的可靠性上限就在这里**。

💡 **`H/error.ts` 的 `handleError`** 专门格式化 import 阶段的语法/解析错误，让用户能看到是哪个文件出错。

## 8.6 `[Service.init]` 与配置

`H/index.ts:97-152` 是一个 **async generator**：

```ts
async* [Service.init]() {
  yield () => this.watcher?.close()      // ← 先登记清理
  // ...然后才建 watcher
}
```

💡 **先 yield disposer 再做初始化**，这样即使后面的初始化抛错，watcher 也能被关闭。这是 cordis 生态里 `Service.init` 的标准写法（见 [03 § 3.3](03-Fiber模型.md)）。

配置 schema（`H/index.ts:381-402`）：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `base?: string` | — | 监听根目录（相对 `ctx.baseUrl`） |
| `root: string[]` | `['.']` | chokidar 的监听路径 |
| `ignored: string[]` | `['**/node_modules', '**/.*', 'cache', 'data']` | 忽略模式（picomatch） |
| `debounce: number` | `100`（ms） | 变更去抖 |

外加继承 `ChokidarOptions` 的全部字段。i18n 有 `en-US` 与 `zh-CN` 两份（`H/locales/`）。

💡 **`ctx.debounce(...)`（`H/index.ts:125`）来自 `plugin-timer`**——这就是 HMR `@Inject('timer')` 的原因。timer 提供的是**可逆的**定时器：插件卸载时在途的 debounce 自动取消。

## 8.7 两个声明的事件

`H/index.ts:22-23`：

| 事件 | 何时触发 |
|---|---|
| `hmr/change(url)` | 变更文件不属于任何已知类别时（§ 8.1 的第 4 条路径） |
| `hmr/reload(reloads: Map<Plugin, Reload>)` | 一轮 partialReload 成功后 |

`Reload` 结构（`H/index.ts:44-47`）：`{ filename: string, runtime?: Plugin.Runtime }`。

## 8.8 与 Fiber 机制的配合

HMR 换插件时发生的完整链条：

![HMR 换代：旧 Fiber 拆除到新 Fiber 生效](diagrams/08-hmr-swap.svg)

**HMR 换代：旧 Fiber 拆除到新 Fiber 生效** — [交互版](diagrams/08-hmr-swap.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/08-hmr-swap.sequence.json)

- **为什么必须先删再注册**：delete 让 registry 里不再有旧 callback · Loader 因此判定为 case 4，不会把插件标记成 disabled · 顺序反了会导致配置文件被写坏
- **换代靠 uid 而非内容比对**：新 Fiber 一定拿到新的 uid · 依赖方的 epoch 里编码了被依赖 Fiber 的 uid · uid 变化即 epoch 变化，级联重载自动发生
- **级联范围是精确的**：只有 inject 了该服务的 Fiber 会重载 · 无关插件的 epoch 不变，完全不受影响 · 这是 Fiber 模型相对全量重启的核心收益

💡 **依赖者的自动重载是"免费"的**——HMR 只负责换掉直接变更的插件，下游插件因为 epoch 变化自动跟着重载（[03 § 3.4](03-Fiber模型.md)）。**HMR 代码里没有一行处理"依赖者"。**

💡 **`fiber.entry` 的搬迁（`H/index.ts:331-337`）** 让配置层无感知：Entry 对象不变，只是它指向的 Fiber 换了。这也是 [02 § 2.5](02-代码结构与包边界.md) 说"Entry 是配置意图、Fiber 是运行实例"的实际体现。

---

**上一篇** ← [07 Loader 与配置树](07-Loader与配置树.md) ｜ **下一篇** → [09 关键调用链速查](09-关键调用链速查.md)：全系列行号索引与症状路由表。
