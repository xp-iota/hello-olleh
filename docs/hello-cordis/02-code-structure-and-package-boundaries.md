---
title: "代码结构与包边界"
---
# 代码结构与包边界

> **本篇回答**：16 个包各自的职责与依赖方向、core 的文件级导览、以及"为什么核心能压到 2057 行"。
> **路径缩写**：`C/` = `packages/core/src/`，`L/` = `packages/loader/src/`，`H/` = `packages/hmr/src/`。行号对应快照 `bc9fae7`（v4.0.0-rc.13）。
>
> 🧭 **本篇导览**：2.1–2.2 仓库全貌与依赖方向 → 2.3–2.4 core 的 9 个文件与四服务自举顺序 → 2.5–2.6 loader 的 8 个文件与三种"树" → 2.7–2.9 行数来源、测试布局与工具链。
>

## 2.1 仓库全貌

![仓库全貌](diagrams/02-code-structure-and-package-boundaries-diagram.svg)

**仓库全貌** — [交互版](diagrams/02-code-structure-and-package-boundaries-diagram.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-code-structure-and-package-boundaries-diagram.architecture.json)

- **组成**：画布 14 个节点 · 源图共 30 个节点，其余见正文
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：cordis/ · 末节点：timer/

⚠️ **上图绘制于 rc.10 基线（9 包布局）**，尚未随 rc.13 重画：新增的 8 个包（fs / fs-node / env / http / http-socks / cli / cli-cordis / package-manager）不在画布里，`@cordisjs/utils` 也已删除。以正文与 [01 § 1.2](01-overview-and-design-philosophy.md) 的 16 包表为准（已列入待重绘清单）。

💡 **没有 `src/` 顶层目录，没有构建脚本目录，CI 有两个 workflow**：`.github/workflows/build.yml` 与 **`release.yml`**（111 行 + `.github/scripts/check-release.mjs` 66 行）。后者由带 `release` 标签、标题 `chore: release v<version>` 的 PR 触发，校验版本号、tag 与变更范围后，合并即 publish 并自动 `gh release create`——这是 rc.13 新增的发布门槛。整个仓库仍是一个极简的 yarn workspace。

💡 **rc.13 还给 core 补了 CLI 入口**：`packages/core/bin.js`（20 行）——`new Context()` 后依次 `ctx.use(Fs)` → `ctx.use(NodeFs)` → `ctx.use(Loader)`，再由 loader 创建 include 组件加载 `./cordis.yml`。"core 不带任何可执行入口"的旧印象不再成立。

## 2.2 依赖方向

![包的依赖方向与分层](diagrams/02-package-layers.svg)

**包的依赖方向与分层** — [交互版](diagrams/02-package-layers.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-package-layers.architecture.json)

- **依赖是单向的**：core 不依赖任何 cordis 包，只有两个外部依赖 · 第 1 层直接建在 core 上（loader / include / timer / logger-console / env / fs / http / cli / package-manager），彼此不互相依赖 · 第 2 层才叠在同门包上（hmr → fs，fs-node → fs，cli-cordis → cli + fs + loader，http-socks → http，group → loader 再导出）
- **loader 是第二个中心**：1465 行，包含 EntryTree / Entry / Group / isolate · 它把配置行翻译成组件树 · include 与 group 都只是它的适配层
- **两个规模异常值**：group 只有 3 行，纯粹是个标记组件 · create-cordis 402 行是独立脚手架，不参与运行时 · hmr 1946 行（含新 `runtime/` 目录）是唯一强依赖 Node 内部加载器的包（拿不到会直接抛错，见 § 2.9）

💡 **`core` 反过来把 4 个包声明为可选 peerDependency**：`@cordisjs/loader`、`@cordisjs/include`、`@cordisjs/fs`、`@cordisjs/fs-node`（`packages/core/package.json` 的 `peerDependenciesMeta` 里全部 `optional: true`；rc.10 时只有前两个）。这是为了让 core 的类型定义能引用它们扩展的接口，同时不强制安装——**类型层面的双向、运行时的单向**。

💡 **rc.13 新增 8 个包，`@cordisjs/utils` 整包删除**：`env`（46 行，用 dotenv + dotenv-expand 按 `.env` → `.env.local` → `.env.{mode}` → `.env.{mode}.local` 合并后 `ctx.provide('env', process.env)`，`env/src/index.ts:45`）；`fs`（308 行，抽象文件系统服务 `ctx.fs`，`mount(prefix, provider)` 按最长前缀路由，`Fs extends Service` 在 `fs/src/index.ts:39`）；`fs-node`（128 行，chokidar + picomatch 的 `file:` provider，`fs-node/src/watcher.ts:2/:6`——watch 抽象上移到 fs 服务，hmr/include 不再直接依赖 chokidar）；`http` / `http-socks`（483 + 85 行，基于 undici 的 `ctx.http`，支持 fetch/websocket 与 socks 代理）；`cli`（949 行，`Command` / 参数解析 / 帮助生成的 CLI 框架库，挂到 `ctx.cli`）；`cli-cordis`（241 行，`inject: ['cli']`（`index.ts:11`）注册 `cordis run` 命令并 fork worker 子进程）；`package-manager`（13 个源文件 1860 行，规模仅次于 core 与 hmr，`ctx.packageManager` 识别 npm/pnpm/yarn，可改 `package.json`、安装、备份回滚并汇报 diff）。

## 2.3 core 的 9 个文件

这是全套分析的重点区域。按行数排序（`wc -l`）：

| 文件 | 行数 | 职责 | 对应篇 |
|---|---|---|---|
| **`C/fiber.ts`** | **557** | 生命周期状态机、`effect()`、epoch 依赖追踪（`_revision`）、卸载握手 | [03](03-fiber-model.md) |
| `C/reflect.ts` | 324 | Context 的 Proxy handler、`provide`/`notify`/`mixin`、`locate()` | [04](04-context-and-reflect-proxy.md) [05](05-service-registration-and-dependency-resolution.md) |
| `C/utils.ts` | 298 | `DisposableList`、symbols 表、traceable 代理、长堆栈 | [04](04-context-and-reflect-proxy.md) |
| `C/registry.ts` | 253 | `use()`（旧名 `plugin()` 已 @deprecated）、`@Inject()` 装饰器、`Component` 类型、`replace()` | [05](05-service-registration-and-dependency-resolution.md) |
| `C/logger.ts` | 233 | Logger / LoggerService / Exporter | — |
| `C/events.ts` | 224 | 5 种派发模式、11 个 internal 事件 | [06](06-event-system-and-waterfall.md) |
| `C/service.ts` | 83 | `abstract class Service` 基类（8 个可覆写符号） | [05](05-service-registration-and-dependency-resolution.md) |
| `C/context.ts` | 78 | `Context` 类、`extend`/`isolate`/`intercept` | [04](04-context-and-reflect-proxy.md) |
| `C/index.ts` | 7 | 只有 7 行 re-export | — |

`C/index.ts` 全文（rc.13 起全部带 `.ts` 扩展名，配合 `moduleResolution: nodenext`，源码可被 Node 的 type stripping 直接加载）：

```ts
export * from './context.ts'
export * from './events.ts'
export * from './fiber.ts'
export * from './logger.ts'
export * from './registry.ts'
export * from './service.ts'
export * from './utils.ts'
```

💡 **注意 `./reflect` 不在导出列表里**。`ReflectService` 是内部实现，用户通过 `ctx.reflect` 访问（由 `C/reflect.ts:182-185` 的 `mixin('reflect', [...])` 挂上去），但拿不到类本身。这是刻意的封装边界。

💡 **`registry.ts` 的公开面在 rc.13 变宽了**：除 `use()` / `inject()` / 旧名 `plugin()`（deprecated 转发）外，新增 `get` / `has` / `replace` / `keys` / `values` / `entries` / `forEach`（`C/registry.ts:173-227`）——其中 `replace(old, new)` 是 HMR 原位替换的公开入口（[05 篇](05-service-registration-and-dependency-resolution.md)、[08 篇](08-hmr.md)）。

## 2.4 四个服务的自举顺序

`Context` 构造函数（`C/context.ts:36-49`）里有一段精妙的自举：

![new Context() 的自举顺序](diagrams/02-context-bootstrap.svg)

**new Context() 的自举顺序** — [交互版](diagrams/02-context-bootstrap.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-context-bootstrap.sequence.json)

- **顺序为什么不能换**：Proxy 必须最先建立，后续所有属性访问都依赖它 · 根 Fiber 必须在服务之前，服务要挂到 Fiber 的 effect 上 · ReflectService 先于其余三个服务，因为它提供解析能力
- **根 Fiber 的特殊性**：runtime 传 null 是根 Fiber 的唯一标识 · uid 固定为 0，state 跳过 PENDING 直接 ACTIVE · 没有父 Fiber，因此不参与 epoch 依赖追踪
- **自举期的陷阱**：四个内建服务在挂载时会往根 Fiber 登记 disposer · 这些 disposer 是自举产物，不应参与 restart · 所以末尾要 _disposables.clear() 把它们丢掉

💡 **`this.fiber._disposables.clear()`（`C/context.ts:47`）是个容易忽略的细节**。四个内建服务在构造时都调了 `provide`，而 `provide` 内部是 `fiber.effect(...)`，会往根 Fiber 的 `_disposables` 里塞 disposer。如果不清空，`ctx.fiber.restart()` 会把 `reflect`/`registry`/`events`/`logger` 全拆掉。

💡 **根 Fiber 的特殊性**：`runtime === null` 时走 `C/fiber.ts:207-219` 分支——`uid = 0`、`state = ACTIVE`、`committed = Object.create(null)`（`fiber.ts:211`，rc.10 时这里是 `store = {}`，如今 `store` 字段已改名为 `committed` 提交快照）、`epoch = '0'`（`fiber.ts:213`，不再是空字符串）、`execute` 是空函数、`dispose = () => this.restart()`。也就是说**根 Fiber 永不卸载，只能重启**。

## 2.5 loader 的 8 个文件

| 文件 | 行数 | 职责 |
|---|---|---|
| `L/index.ts` | 204 | `Loader extends EntryTree`，注册 6 个 internal 监听器 + isolate 组件 |
| `L/config/entry.ts` | 373 | `Entry` = 一行配置对应一个组件实例（有 inject 时为 outer/inner 双 Fiber） |
| `L/config/isolate.ts` | 160 | isolate realm 的 7 步 patch 算法 |
| `L/config/tree.ts` | 261 | `EntryTree` 抽象基类：id 解析、import、`commit()` 变更通知 |
| `L/config/utils.ts` | 209 | `evaluate` / `interpolate` / `isJsExpr` / `ExprTrace`（配置源位置溯源） |
| `L/config/group.ts` | 120 | `EntryGroup` / `Group`（可嵌套的配置分组） |
| `L/resolve.ts` | 99 | `createResolve`：向配置文件所属项目写入 `.cordis/resolve.mjs`，以项目为锚解析裸模块名 |
| `L/internal.ts` | 39 | 只剩 `getInternalLoader()` 与 `unwrapExports`；完整 `ModuleLoader` 接口移到了 `H/runtime/internal.ts`（171 行） |

![配置树的四个类](diagrams/02-config-tree-classes.svg)

**配置树的四个类** — [交互版](diagrams/02-config-tree-classes.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-config-tree-classes.architecture.json)

- **两个 Symbol.for 键**：Entry 用 Symbol.for('cordis.entry')（entry.ts:49） · Group 用 Symbol.for('cordis.group')（group.ts:8） · 跨实例共享，因此可以跨包识别
- **Entry 是唯一持有 Fiber 的类**：一行配置对应一个 Fiber（rc.13 起，带 inject 的 entry 由内置 `loader:outer` 组件持有 outer Fiber，内部再建 inner Fiber） · get disabled (:114) 支持写 JS 表达式（结果缓存为 `_verdict` 三态）并沿父链向上检查 · 父级禁用则整棵子树都不激活
- **递归靠 Entry 指回 EntryTree**：某个 Entry 的 name 是 '@cordisjs/include' 时会生成子树 · id 用冒号分层，形如 main:sub:leaf · Loader 的 internal 由 getInternalLoader() 提供（L/index.ts:56）

💡 **`Entry` 与 `Fiber` 是 1:1 但概念不同**：Entry 是"配置意图"（持久，写在 yml 里），Fiber 是"运行实例"（易失，会 reload）。rc.13 的 HMR 恰恰利用了这一点：`registry.replace()` + `fiber._replace()` 让**同一个 Fiber 对象原位保留**、只换 runtime（见 [08](08-hmr.md)），Entry 与配置都无需动。

## 2.6 三种"树"的关系

这是 loader 最容易混淆的地方：

![三种树的区别与 id 拼接](diagrams/02-three-trees.svg)

**三种树的区别与 id 拼接** — [交互版](diagrams/02-three-trees.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-three-trees.architecture.json)

- **三者的持久化位置不同**：Loader 根树只在内存，写操作是空实现 · Include 树对应磁盘上的一个配置文件 · Group 子树寄生在父配置的某一行里 · 根树到文件树的跳转条件是某 Entry 的 name 为 '@cordisjs/include'
- **Group 可以自嵌套**：一个 group 行的 config 里还能有 group 行 · 嵌套深度没有硬限制 · 每层都会在 id 上追加一段
- **混淆点在于都叫「树」**：只有 Include 树与文件一一对应 · 改配置文件影响的是 Include 树，不是根树 · 定位问题时先确认自己在哪棵树上

## 2.7 为什么核心只要 2057 行

四个原因，都能在代码里找到证据：

![core 为什么只有 2057 行](diagrams/02-why-small.svg)

**core 为什么只有 2057 行** — [交互版](diagrams/02-why-small.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/02-why-small.architecture.json)

- **被拆出去的能力**：定时器拆成 @cordisjs/timer，148 行 · 日志导出拆成 @cordisjs/logger-console，137 行 · 配置驱动拆成 @cordisjs/loader，1465 行
- **用 Symbol 换命名空间隔离**：isolate 生成新 Symbol 当存储键 · 省掉一整套 realm 注册与查找表 · 代价是调试时看不到可读的键名
- **epoch 是最省代码的一处**：把自身 revision 与依赖身份编码成字符串，比较即判定 · 不需要拓扑排序或环检测 · 详见 03 篇 § 3.4

💡 **代价是可读性**。2057 行里塞满了 Proxy trap、原型链操作、Symbol 元编程。`utils.ts` 的 `createTraceable`（`:177-232`，56 行）是全框架最难读的一段——它要同时处理 `this` 归属、shadow 上下文、方法绑定、嵌套 tracker 四件事。**行数少不等于简单**。

## 2.8 测试布局

80 个 spec / 16803 行，测试行数超过实现行数。确认某个语义的准确行为时，读 spec 比读实现快——「想确认什么 → 读哪个 spec」的映射表统一见 [09 § 9.9](09-call-chain-reference.md)。

💡 **`isolate.spec.ts` 在 loader 里有 578 行，在 core 里只有 203 行**。这说明 isolate 的复杂度主要来自"配置驱动的动态 realm 切换"（loader 层），而不是隔离本身（core 层只是 Symbol 作键）。

## 2.9 构建与工具链

| 项 | 值 |
|---|---|
| 包管理 | yarn **4.14.1**（`packageManager` 字段锁定） |
| workspace | `packages/*` + `external/*`（后者在本快照中不存在） |
| 构建编排 | **yakumo** 3.2.1（作者自研的 monorepo 工具） |
| 构建命令 | `yarn yakumo esbuild && yarn yakumo tsc`（先打包再生成类型） |
| 测试 | vitest 4.1.5 + `@vitest/coverage-v8` |
| Lint | eslint 8.57.1 + `@cordisjs/eslint-config` |
| TS | typescript 5.9.3 |
| 特殊运行参数 | `node --expose-internals --import tsx --import @cordisjs/unyaml` |
| tsx 版本 | **`npm:@cordisjs/tsx@4.23.15-fix.1`**（自维护的 fork；npm 作用域已从 `@cordiverse` 换成 `@cordisjs`） |

💡 **`--expose-internals` 不再是"可选增强"，而是 HMR 的硬门槛**：loader 的内部加载器经 `getInternalLoader()`（`L/internal.ts:13-29`）获取——先试 `--expose-internals`，再回退 `node-addon-require-builtin`。拿不到时 rc.13 的 HMR 构造函数**直接抛错**（`H/index.ts:166-168`：`loader internals are unavailable, pass --expose-internals or install node-addon-require-builtin`）——rc.10 "打一条警告并禁用源码 HMR、进程照常运行"的优雅降级已被移除。

💡 **`@cordisjs/unyaml`** 让 `import x from './a.yml'` 直接可用。本快照中它只出现在根 `package.json` 的 scripts（`--import @cordisjs/unyaml`）；hmr 包的 i18n locales 目录已在 rc.13 删除，全仓 `.yml` 只剩测试 fixtures 与 create 的 `.eslintrc.yml`。

---

**上一篇** ← [01 项目概览与设计哲学](01-overview-and-design-philosophy.md) ｜ **下一篇** → [03 Fiber 模型](03-fiber-model.md)：557 行的生命周期状态机，全框架的心脏。
