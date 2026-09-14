---
title: "Loader 与配置树"
---
# Loader 与配置树

> **本篇回答**：`loader`（870 行）与 `include`（219 行）如何把一个 yml 文件变成运行中的插件树、`Entry` 与 `Fiber` 的分工、`applyPatches` 的语义（DSH profile/bundle 的地基）、以及 isolate realm 切换的 7 步算法。
> **路径缩写**：`L/` = `packages/loader/src/`，`I/` = `packages/include/src/`，`C/` = `packages/core/src/`。行号对应快照 `f8ea3cd5`。
>
> 🧭 **本篇导览**：7.1–7.2 从配置到运行与 `EntryOptions` → 7.3–7.4 `update()` 决策树与 `init()` → 7.5–7.6 `include` / `applyPatches` 与 id 解析 → 7.7–7.9 isolate realm 7 步、Loader 三钩子与 `EntryGroup`。
>

## 7.1 从配置到运行

> 📐 **配套对照与可跑入口**：[`cordis.yml`](../../dsh-example/cordis.yml) 用 `id` / `name` / `config` 展示 DSH 插件配置行的形态；[`runtime/harness.ts`](../../dsh-example/runtime/harness.ts) 则用真实 npm 包完成等价的服务与插件装配。`cordis.yml` 是配置示范，**不是本工程的直接执行入口**；要观察插件挂载与卸载，请在 `dsh-example/` 运行 `npm run M12`，并把 [`M12 timer phase`](../../dsh-example/M12-framework-mechanisms/phases/02-dispose-pending-timer.ts) 的 `loadPlugin()` / `fiber.dispose()` 与本篇 `Entry.init()` / Fiber 回收链对照阅读。

一个典型配置文件：

```yaml
- id: timer
  name: '@cordisjs/plugin-timer'

- id: db                  # 示例插件（本系列统一用 db 作示例服务名，见索引术语约定）
  name: my-database
  config:
    host: localhost
  isolate:
    logger: true          # ← 给这一行私有的 logger realm

- id: group1
  name: '@cordisjs/plugin-group'
  group: true
  config:
    - id: a
      name: plugin-a
    - id: b
      name: plugin-b
      disabled: true      # ← 这行不启动
```

![从 cordis.yml 到 Fiber 的落地链](diagrams/07-config-to-fiber.svg)

**从 cordis.yml 到 Fiber 的落地链** — [交互版](diagrams/07-config-to-fiber.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-config-to-fiber.architecture.json)

- **三段翻译**：Include 把文件变成 EntryOptions 数组 · EntryTree 把数组变成 Entry 对象树 · 每个启用的 Entry 再变成一个 Fiber
- **group 是配置里的一行**：group: true 的 Entry 其 config 是子 Entry 数组 · 子条目的 id 会拼上父级 id，用冒号分隔 · 嵌套深度没有硬限制
- **disabled 沿父链生效**：Entry.disabled 会向上检查（entry.ts:64） · 被禁用的 Entry 根本不创建 Fiber · 父级禁用则整棵子树都不激活

## 7.2 `EntryOptions`：配置行的字段

`L/config/entry.ts:8-15` + 两处模块扩展：

| 字段 | 来源 | 语义 |
|---|---|---|
| `id: string` | entry.ts:9 | 唯一标识（同层唯一），patch 的定位键 |
| `name: string` | entry.ts:10 | 模块名，会被 `import()` |
| `config?: any` | entry.ts:11 | 传给插件的配置；group 时是子 Entry 数组 |
| `group?: boolean \| null` | entry.ts:12 | 是否是分组 |
| `disabled?: boolean \| null` | entry.ts:13 | 是否禁用 |
| `inject?: Inject \| null` | entry.ts:14 | **配置层追加依赖声明** |
| `intercept?: Dict \| null` | isolate.ts:7 | 给该行注入服务配置 |
| `isolate?: Dict<true \| string> \| null` | isolate.ts:8 | realm 声明：`true` = 私有，字符串 = 命名 realm |

💡 **`inject` 可以写在配置里**（`L/index.ts:89-93`）：loader 在 `internal/plugin` 钩子里把 `entry.options.inject` 合并进 `fiber.inject`。这意味着**运维可以在不改代码的前提下给插件加依赖**——比如强制某插件等另一个服务就绪。

💡 **`sortKeys()`（`L/config/entry.ts:27-32`）**：每次 update 后把 options 的键重排为 `id, name, <其余按字母序>, config`。写回 yml 时字段顺序稳定，diff 干净。

## 7.3 `Entry.update()`：判断"重载还是原地改"

`L/config/entry.ts:100-133` 是 loader 的核心决策点：

![Entry.update 的决策分支](diagrams/07-entry-update.svg)

**Entry.update 的决策分支** — [交互版](diagrams/07-entry-update.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-entry-update.architecture.json)

- **create 决定合并语义**：create 为真表示新建，整份 options 直接替换 · 否则是增量更新，逐字段合并 · 值为空的字段按删除处理，而不是写入空值
- **三条出路互斥**：禁用则销毁 Fiber 并结束 · 未运行则走首次 init · 已运行则算 diff 再决定动作
- **diff 决定重载还是 patch**：只有配置真的变化才动 Fiber · 仅 Config 字段变化可以就地 patch · 涉及 name 或 inject 变化则必须重载

💡 **关键：已运行的 Entry 不重建 Fiber，走 `_patchContext`**（`L/config/entry.ts:84-92`）：

```ts
private _patchContext(diff: string[]) {
  this.context.waterfall('loader/patch-context', this, () => {
    Object.setPrototypeOf(this.ctx, this.parent.ctx)          // ← 换父作用域
    if (this.fiber?.uid && (diff.includes('config') || this.options.group)) {
      this.fiber.update(this._resolveConfig(this.fiber.runtime!.callback), true)
    }
  })
}
```

**`Object.setPrototypeOf(this.ctx, this.parent.ctx)`** 是很激进的操作——直接改运行中 Context 的原型，让它看到新的父作用域。isolate 插件在这个 waterfall 里插入了 7 步算法（§ 7.7）。

💡 **`noSave = true`**（第二个参数）：`_patchContext` 调 `fiber.update(config, true)`，避免"配置文件驱动的更新"又写回配置文件（死循环）。

## 7.4 `Entry.init()`：真正启动

`L/config/entry.ts:146-172`：

![Entry.init() 从配置项到插件就绪](diagrams/07-entry-init.svg)

**Entry.init() 从配置项到插件就绪** — [交互版](diagrams/07-entry-init.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-entry-init.sequence.json)

- **_initTask 的去重语义**：??= 让并发调用共享同一个 Promise · 配置热更新时同一 Entry 可能被反复 init · 去重保证模块只被 import 一次
- **导出处理为什么必要**：CommonJS 与 ESM 的默认导出形态不一致 · unwrapExports 统一成 cordis 认得的插件对象 · 否则 registry.resolve 会拿到 Module 命名空间对象
- **loader 就绪的广播**：全部 Entry 完成后才 notify(['loader']) · 依赖 loader 服务的插件在此刻才被唤醒 · 这形成了配置树加载与插件激活的分界

💡 **`unwrapExports()`（`L/index.ts:156-163`）处理 ESM/CJS 互操作的历史包袱**，注释里直接引了两个 issue：

```ts
unwrapExports(exports: any) {
  if (isNullable(exports)) return exports
  exports = exports.default ?? exports
  // https://github.com/evanw/esbuild/issues/2623
  // https://esbuild.github.io/content-types/#default-interop
  if (!exports.__esModule) return exports
  return exports.default ?? exports
}
```

**要解两次 `default`**——esbuild 转译产物在某些配置下会双层包裹。

💡 **`fiber.await().finally()` 里的 `notify(['loader'])`（`:154`）** 与 `Loader[Service.check]`（`L/index.ts:133`）配合，实现"所有配置项加载完毕后 loader 才算可用"。这样依赖 `loader` 且设了 `intercept: { loader: { await: true } }` 的插件（如某些需要完整插件列表的工具）会等到最后。

## 7.5 `include` 与 `applyPatches`

`include` 插件把一个文件变成 EntryTree。**它的 `applyPatches` 是 DSH profile/bundle 系统的直接地基**（见 [DSH 05 篇](../hello-dsh/05-startup-and-cordis-runtime.md)）。

`I/index.ts:101-164`：

![applyPatches 的两条处理路径](diagrams/07-apply-patches.svg)

**applyPatches 的两条处理路径** — [交互版](diagrams/07-apply-patches.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-apply-patches.architecture.json)

- **这是 DSH profile 与 bundle 的地基**：patch 让同一份 yml 派生出多套配置 · insert 用于追加条目，overrides 用于改写既有条目 · 不需要复制整份配置文件
- **失败一律降级为警告**：非 insert 的 patch 缺 id 会 warn id is required · 目标找不到会 warn entry not found · 坏 patch 被跳过，其余仍然生效
- **entryMap 必须递归建**：group 的 config 是嵌套数组 · 只扫顶层会漏掉子树里的 id · 下钻条件是 group 为真且 config 是数组

💡 **三条关键语义**（DSH 的 bundle patch 注释里反复强调）：

| 语义 | 含义 |
|---|---|
| **整体替换而非合并** | `target[key] = value`（`:159`）——patch 里写 `config` 会**替换整个 config 对象**，不是深合并 |
| **`name` 是安全阀** | 若 patch 写了 `name`，它必须与目标行的 `name` 一致，否则跳过。防止 id 被复用后 patch 打到错误的插件上 |
| **`insert` 与字段覆盖互斥** | 有 `insert` 就只做插入，忽略其余字段 |

💡 **`applyPatches` 是纯函数式地在数组上操作**，但注意它**原地修改** `data`（`:127`、`:133`、`:159`）。调用方 `I/index.ts:179` 传的是 `[...this.data!]` 浅拷贝——顶层数组是新的，但嵌套的 group config 对象是共享的。

### 文件格式与写回

| 扩展名 | MIME | 可写 |
|---|---|---|
| `.json` | `application/json` | ✅ |
| `.yaml` / `.yml` | `application/yaml` | ✅ |
| 其它 | — | ❌（走 `import()`，只读） |

`writable` 映射在 `I/index.ts:19-22`，`supported` 集合在 `:24`。不支持的扩展名直接抛 `extension "${ext}" not supported`（`I/index.ts:64`）。

💡 **写回是原子的**（`I/index.ts:192-204`）：先写 `filename + '.tmp'`，再 `rename` 覆盖。`rename` 在同一文件系统上是原子操作，避免写一半崩溃导致配置损坏。

💡 **`writeFile` 用 `setTimeout(..., 0)` 去抖**（`I/index.ts:205-211`）：连续多次写只落盘最后一次。

### 自定义 YAML 标签 `!!js`

`I/index.ts:8-15` 注册了一个 yaml 类型：

```ts
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: isJsExpr,
  represent: (data) => data['__jsExpr'],
})
```

配合 `L/config/utils.ts` 的 `evaluate` / `interpolate`，配置里可以写 JS 表达式。`Entry._resolveConfig`（`L/config/entry.ts:79-82`）对非 group 的配置调 `interpolate(this.ctx, this.options.config)`。

💡 **DSH 大量依赖这个能力**。`dsh-web-app` 的 patch 注释说："Rows configured from flags inject that service, so Loader resolves their expressions only after it exists"——即表达式的求值时机与依赖注入绑定。

## 7.6 `EntryTree`：id 解析

`L/config/tree.ts`（123 行）：

| 方法 | 行号 | 作用 |
|---|---|---|
| `static sep = ':'` | 7 | id 分层分隔符 |
| `getTasks()` | 33 | 收集所有未完成的 `_initTask` |
| `ensureId(options)` | 47 | 没 id 就生成一个（防重） |
| `resolve(id)` | 56 | 按 `a:b:c` 逐层下钻找 Entry |
| `resolveGroup(id)` | 69 | 找到 id 对应的 EntryGroup |
| `remove(id)` | 83 | 删除一行 |
| `import(name, getOuterStack?)` | 103 | 动态 import，出错时接长堆栈 |

💡 **`id` 的全路径由 `Entry.get id()`（`L/config/entry.ts:56-62`）拼出**：

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

## 7.7 isolate realm 的 7 步切换算法

`L/config/isolate.ts:67-149` 是 loader 里最复杂的一段——它要在**不重启插件**的前提下把服务实例从一个 realm 搬到另一个。

### 两种 Realm

![两种 Realm 的隔离粒度](diagrams/07-two-realms.svg)

**两种 Realm 的隔离粒度** — [交互版](diagrams/07-two-realms.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-two-realms.architecture.json)

- **suffix 决定 Symbol 的唯一性**：Realm 的职责是为服务名分配存储键 · suffix 拼进 Symbol 描述，保证不同 realm 不撞 · access 的 create 参数控制缺失时是否新建
- **配置写法直接映射类型**：isolate: { x: true } 得到 LocalRealm · isolate: { x: 'myRealm' } 得到 GlobalRealm · 后者让多个 entry 共用一份实现
- **回收策略也不同**：LocalRealm 随 entry 消亡，无需显式回收 · GlobalRealm 要等最后一个引用者离开 · 详见 § 7.6 的部分回收流程

Symbol 的描述串形如 `logger#db` 或 `logger@shared`——**调试时能一眼看出它属于哪个 realm**。

### 7 步算法

`loader/patch-context` 的监听器（`L/config/isolate.ts:92-149`）：

![patch-context 的三步切换](diagrams/07-patch-context.svg)

**patch-context 的三步切换** — [交互版](diagrams/07-patch-context.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-patch-context.architecture.json)

- **delim 是本次切换的标记**：delims[name] 缺省时新建一个 Symbol('delim:name') · entry.ctx[delim] 存放本次切换的标识 · 用于区分同名服务在切换前后的两个实例
- **diff 记录四个量**：旧 Symbol 与新 Symbol · entry 自己的 delim 值 · 实现所在 fiber 的 delim 值
- **运行时改原型链**：setPrototypeOf 直接改 isolate 与 intercept 的父级 · 这是「谁能看到什么」被重写的时刻 · 没有显式作用域表，因此必须在此一次性对齐

💡 **`delim`（delimiter）符号的作用是"标记一次切换的身份"**。因为 realm 切换可能级联发生（父 entry 切了，子 entry 也受影响），需要区分"这个 ctx 是被本次切换影响的，还是被别的切换影响的"。第 ⑥ 步的 filter 表达式就是在做这个判定——这也是全 cordis 最难读的一个布尔表达式。

💡 **第 ⑤ 步是"服务搬迁"而非"服务重建"**。如果一个插件 provide 了服务，而它的 realm 变了，理论上要卸载再重装；但 cordis 选择直接把 `store` 里的记录换个键。**服务实例的身份（以及它的 Fiber uid）不变** → 依赖它的插件的 epoch 不变 → 不会被无谓地重载。

💡 **`swap()`（`:16-23`）**：删掉 target 的全部 own key，再从 source 复制过来。**保持对象引用不变**——因为 `entry.ctx[isolate]` 可能被别的地方持有引用。

### Realm 垃圾回收

`loader/partial-dispose` 监听器（`L/config/isolate.ts:151-169`）：

![GlobalRealm 的引用计数回收](diagrams/07-realm-recycle.svg)

**GlobalRealm 的引用计数回收** — [交互版](diagrams/07-realm-recycle.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-realm-recycle.architecture.json)

- **两种 Realm 的回收责任不同**：LocalRealm 的生命周期绑定在 entry 上 · GlobalRealm 被多个 entry 共享，需要计数 · 因此只有后者要显式判断能否回收
- **两级删除**：先 realm.delete(name) 移除单个服务名 · 若 realm.size 归零再删掉整个 realm 记录 · 避免留下空壳 realm 占用 label
- **这是部分回收而非整体卸载**：监听器名为 loader/partial-dispose · 只处理 isolate 配置变化引起的键切换 · Fiber 本身的卸载走另一条路径

💡 **GC 是遍历式的**（`for (const entry of ctx.loader.entries())`）——O(entry 总数)。GlobalRealm 不常变，可以接受。

## 7.8 Loader 的三个钩子

`L/index.ts:74-125` 注册了三个监听器：

| 钩子 | 行号 | 作用 |
|---|---|---|
| `internal/update`（global, prepend） | 74 | **把新配置写回 yml**：`entry.options.config = unparse ? unparse(config) : config` 然后 `tree.write()`。有 `noSave` 或"是 entry 自己的根 fiber"时跳过 |
| `internal/update`（global） | 82 | 打印 `reload` 日志 |
| `internal/plugin` | 88 | ① 设置 `fiber.entry` 并合并配置里的 inject；② **6 个 case 的"自卸载"判定** |

### "自卸载"判定的 6 个 case

`L/index.ts:98-122` —— loader 需要区分"用户在代码里调了 `ctx.fiber.dispose()`"（应该把 `disabled: true` 写回配置）和其它卸载原因（不应该写）：

![internal/plugin 的五道排除条件](diagrams/07-unload-cases.svg)

**internal/plugin 的五道排除条件** — [交互版](diagrams/07-unload-cases.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/07-unload-cases.architecture.json)

- **为什么需要五道排除**：loader 要区分「用户主动禁用」与其余情形 · 只有前者该把 disabled 写回配置文件 · 误判会导致配置被意外改写
- **case 4 是 HMR 的关键**：HMR 的顺序是先 registry.delete 再 dispose · 于是此刻 registry 里已查不到该 callback · 靠这个特征把热重载与真卸载区分开
- **事件本身一体两用**：internal/plugin 在创建与卸载时各发一次 · case 1 用 fiber.uid 把创建事件先滤掉 · 其余四道逐层排除非用户意图的卸载

💡 **case 4 的注释解释了顺序差异**（`L/index.ts:109-110`）：

```
// self-dispose: ctx.fiber.dispose() -> fiber / runtime dispose -> delete(plugin)
// plugin hmr:   delete(plugin) -> runtime dispose -> fiber dispose
```

自卸载时 registry 里**还有**这个 callback；HMR 时已经被 delete 了。用这个差异区分两种情况——很巧，但也很脆弱（依赖调用顺序）。

## 7.9 `EntryGroup` 与 `Group`

`L/config/group.ts`（88 行）：

| 符号 | 行号 | 说明 |
|---|---|---|
| `class EntryGroup` | 5 | 管理一批 Entry 的容器 |
| `static key = Symbol.for('cordis.group')` | 6 | 标记"这是个 group 插件" |
| `unlink(options)` | 30 | 从 data 数组里摘掉一行 |
| `remove(id, isDispose?)` | 36 | 删除并 dispose |
| `stop()` | 66 | 停掉全部子 Entry |
| `class Group extends EntryGroup` | 73 | **可作为插件使用**的 group |
| `Group.initial` | 74 | 静态初始配置 |

`packages/group/src/index.ts` 全文 3 行，就是把 `Group` 再导出，让配置能写 `name: '@cordisjs/plugin-group'`。

💡 **`Entry.get disabled`（`L/config/entry.ts:64-73`）沿父链检查**：

```ts
get disabled() {
  if (this.options.group) return false      // ← group 永远"启用"
  let entry: Entry | undefined = this
  do {
    if (entry.options.disabled) return true
    entry = entry.parent.ctx.fiber.entry
  } while (entry)
  return false
}
```

**父 group 被 disable 会让所有子孙都 disabled**。但 group 自身的 `disabled` 属性对它自己无效（`group` 永远返回 false）——它靠让子孙都 disabled 来实现"停用整组"。

---

**上一篇** ← [06 事件系统与 Waterfall](06-event-system-and-waterfall.md) ｜ **下一篇** → [08 HMR 热重载](08-hmr.md)：模块图上的 accepted/declined 传播、Node 22/24 的缓存差异、以及失败回滚。
