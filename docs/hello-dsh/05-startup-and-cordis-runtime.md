---
title: "启动流程与 Cordis 落地"
---
# 启动流程与 Cordis 落地

> **本篇回答**：`dsh web` 敲下回车后发生的全部事情，以及这一切底下的 cordis 是什么样的。前半是 profile 解析、bundle patch 分层、根 include 挂载、"启动必须响亮失败"；后半是 DSH vendored 的那份 cordis —— 分叉有多大、三处 fiber 加固、行号怎么换算、以及 DSH 在 cordis 之上补的 `Scoped<T>`。
> **路径缩写**：`P/` = `packages/`，`AB/` = `packages/boot/app-boot/src/`，`V/` = `vendor/cordis/src/`；上游用 `C/` = cordis 仓库的 `packages/core/src/`。行号：DSH 侧对应 `fb2c4b9e`，cordis 侧对应 `8cc9e33f`。
>
> 🧭 **本篇导览**：5.1–5.12 启动、Profile 与 Bundle → 5.13–5.16 vendored cordis 分叉 → 5.17–5.20 Cordis 原语与 DSH Scope。
>

## 5.1 两个概念：Profile 与 Bundle

> 📐 **配套可跑示例**：[`cordis.yml`](../../dsh-example/cordis.yml) 是一份"把一组插件挂进真实 agent"的 patch 示范 ——
> 每一行就是本节说的那种配置行（`id` / `name` / `config`）。


![Bundle 与 Profile 的关系](diagrams/05-bundle-and-profile.svg)

**Bundle 与 Profile 的关系** — [交互版](diagrams/05-bundle-and-profile.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-bundle-and-profile.architecture.json)

- **Bundle 是可分发的**：它是 npm 包，同时带配置行与实现代码 · 一个 bundle 可被任意 profile 引用 · 版本随包管理器解析
- **Profile 是本机的组合**：住在 Harness home 的 profiles 目录下 · 只声明要叠哪些 bundle 加自己的定制 · 因此切 profile 就切整套能力
- **每行都是普通配置行**：形如 id / name / config 三要素 · 任何一行都可被上层按 id 覆盖 · 这正是没有特权内核的落地方式

💡 **profile 是"用户拥有"的，bundle 是"分发方拥有"的**。profile 目录里还有 `pnpm-workspace.yaml` 模板（`AB/profile.ts:138 PROFILE_PNPM_WORKSPACE`）——**profile 本身就是一个 pnpm 工作区**，用户能往里装第三方插件包。

## 5.2 分层顺序

`docs/architecture.md` 的原文：

> Layers apply to an empty entry list in this order: each bundle in the profile's listed order, then the profile's `cordis.patch.yml`, then the home-level one, then any `--patch` overlay.

![四层 patch 的叠加顺序](diagrams/05-layer-order.svg)

**四层 patch 的叠加顺序** — [交互版](diagrams/05-layer-order.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-layer-order.architecture.json)

- **一次调用完成全部叠加**：composeEntries() 位于 AB/profile.ts:413 · 它把所有层 flat 成一个 patch 数组 · 然后只调用一次 applyEntryPatches
- **底层就是 cordis 的 applyPatches**：与 cordis include 用的是同一套语义 · insert 追加、按 id 覆盖两条路径 · 见 cordis 07 篇 § 7.5
- **顺序决定优先级**：后叠的层覆盖先叠的 · 命令行 --patch 优先级最高 · 便于临时调试而不改文件

`composeEntries()` 全文（`AB/profile.ts:413-419`）：

```ts
export function composeEntries(
  layers: readonly PatchOptions[][], warn: (message: string) => void = () => {},
): EntryOptions[] {
  return applyEntryPatches([], structuredClone(layers.flat()), (message: string, ...args: unknown[]) => {
    let index = 0
    warn(message.replace(/%C/g, () => JSON.stringify(args[index++])))
  })
}
```

💡 **三个实现细节**：
1. **`layers.flat()`** —— 所有层拼成一个数组，`applyEntryPatches` 按顺序处理，**后写胜出**（per row）。
2. **`structuredClone`** —— 深拷贝，避免 patch 处理时原地修改污染缓存的 patch 数据（cordis 的 `applyPatches` 是原地改的，见 [cordis 07 § 7.5](../hello-cordis/07-loader-and-configuration-tree.md)）。
3. **`warn` 把 `%C` 占位符替换成 JSON** —— cordis logger 的格式化占位符在这里手动展开，因为 `composeEntries` 可能在没有 logger 的场景（config dump）被调用。

## 5.3 patch 的三条硬语义（DSH 侧的表述）

`dsh-base/cordis.patch.yml` 的头部注释（前 13 行）把语义讲得比 cordis 文档更清楚：

```yaml
# The dsh-base bundle patch: the shared core of every dsh profile, applied as
# ONE insert over the empty profile root. Later bundle patches and the user's
# profile cordis.patch.yml address these rows by id, with the last write
# winning per row.
#
# A patch replaces the targeted row's whole `config` rather than merging into
# it, so a row whose value differs by mode does NOT live here: it belongs to
# each mode bundle, keeping any single row down to one bundle layer plus the
# user's. Mode-specific rows appear below only with shared plugin identity and
# neutral defaults; each mode bundle restates its complete configuration.
#
# Row order carries no load semantics (activation is service-availability
# driven); the grouping is for readers.
```

| 语义 | 含义 | 推论 |
|---|---|---|
| **整体替换而非合并** | patch 里写 `config` 会替换目标行的**整个** config 对象 | 按模式不同的值**不能**放 base；每个 mode bundle 必须**完整重述**自己的配置 |
| **每行最多两层** | 一行的配置来源应控制在"一个 bundle 层 + 用户层" | 避免多层叠加导致难以推理 |
| **行顺序无加载语义** | 激活由**服务可用性**驱动（cordis 的 epoch 机制） | patch 文件里的分组只是给人读的 |

💡 **`web-app` patch 里能看到这个约束的实际后果**：它重述了 `system-prompt` 的整个 `persona`、`session-query-sqlite` 的整个 config、`tools` 的整个 config——即使只想改一个字段。

💡 **`web-app` 还把 hmr 关掉了**：

```yaml
# TODO: Re-enable shared HMR for Web after its reload lifecycle is tested.
- id: hmr
  disabled: true
```

**patch 可以只写 `disabled: true` 而不写 config**——因为 `disabled` 是 `EntryOptions` 的独立字段（[cordis 07 § 7.2](../hello-cordis/07-loader-and-configuration-tree.md)）。

## 5.4 `loadProfile()`：解析一个 profile

`AB/profile.ts:371-402`：

![loadProfile 的分支与模板初始化](diagrams/05-load-profile.svg)

**loadProfile 的分支与模板初始化** — [交互版](diagrams/05-load-profile.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-load-profile.architecture.json)

- **报错必须可操作**：找不到 profile 且无模板时直接抛错 · 错误信息里给出创建它的完整命令 · 不做静默创建，避免产生意料外的配置
- **模板初始化写三个文件**：package.json 声明 profile 与要叠的 bundle · cordis.patch.yml 是空的定制层 · pnpm-workspace.yaml 让 profile 能装自己的依赖
- **归一化的作用**：normalizeShippedProfile 处理随包分发的 profile · 补齐缺省字段并校验 bundle 列表 · 之后各层才能安全 flat

💡 **`options.userLayer !== false`** 这个双重否定是刻意的：默认（`undefined`）**包含**用户层；只有显式传 `false` 才跳过。config dump 的"只看 bundle 层"模式会用到。

💡 **`healProfilesModuleFallback()`（`AB/profile.ts:223`）与 `ensureSymlink()`（`:171`）**：profile 目录需要能解析到 DSH 自己的包，靠符号链接搭桥。这是"profile 在 home 目录、代码在安装目录"这个分离带来的必要复杂度。

## 5.5 `boot()`：主启动函数

`AB/index.ts:757-801`。整个函数只有 45 行，但注释比代码多。

![boot() 的两段式启动](diagrams/05-boot-sequence.svg)

**boot() 的两段式启动** — [交互版](diagrams/05-boot-sequence.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-boot-sequence.sequence.json)

- **两段 stage 标签的作用**：第一段覆盖宿主准备，失败即 host preparation failed · 第二段覆盖插件树，失败即 plugin tree failed to load · 报错时用户能立刻分清是环境问题还是配置问题
- **为什么反复重取 loader**：每个 await 都是一次让界面推进的机会 · 用户可能在启动过程中就退出 · 退出会拆掉整棵插件树，loader 随之消失
- **正常退出与失败的区分**：loader 消失时直接 return ctx，不抛错 · 只有 assertEntriesActivated 不通过才算启动失败 · 这条边让 Ctrl+C 不会被报成崩溃

`boot()` 的错误处理（`AB/index.ts:786-800`）值得逐条看：

```ts
} catch (cause) {
  await ctx.fiber.dispose()
  const detail = cause instanceof Error ? cause.message : String(cause)
  let deepest: unknown = cause
  while (deepest instanceof Error && deepest.cause !== undefined) deepest = deepest.cause
  const stack = deepest instanceof Error && deepest !== cause ? `\n${deepest.stack ?? deepest.message}` : ''
  throw new Error(`${binName}: ${stage}: ${detail}${stack}`, { cause })
}
```

💡 **三个设计点**：
1. **先 `ctx.fiber.dispose()`**，注释说明"根 fiber 卸载会按观察者隔离清理失败（cordis fiber.ts 加固），重复调用返回已 settle 的单次结果，所以这个 await 不会 reject 并替换 `cause`"。**这正是 [01 § 1.6](01-overview.md) 提到的 vendored cordis 的 `emitPluginDisposed` 加固在起作用。**
2. **沿 `error.cause` 链找最深的错误**并把它的 stack 附上。因为 Loader 的事务性更新会把失败层层包裹，最深的 cause 才是插件真正抛出的错误。
3. **`stage` 两段标签**：`prepare` 在任何配置树行挂载之前跑，它失败就是宿主问题而非插件树问题。

## 5.6 `mountRootInclude()`：把配置文件挂成根

`AB/index.ts:486-529`。这一步把 cordis 的 `Include` 插件作为 **id 固定为 `'include'`** 的一行挂到 loader 上。

![mountRootInclude 如何挂 builtins](diagrams/05-mount-root-include.svg)

**mountRootInclude 如何挂 builtins** — [交互版](diagrams/05-mount-root-include.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-mount-root-include.architecture.json)

- **为什么要动态子类**：宿主可能把插件装在非默认位置 · 裸模块名需要从宿主给的基准 URL 解析 · 覆写 import 是最小侵入的做法
- **group 必须是 builtin**：isolate realm 要用 group 行做容器 · 若 group 不是 builtin 就无法在配置里直接用 · 见 § 5.6 与 03 篇的两级隔离
- **这一步是 cordis 与 DSH 的接缝**：把 cordis 的 Include 与 Group 接进 DSH 的解析策略 · 之后整棵插件树的加载都走这套规则 · 改这里等于改整个模块解析行为

💡 **为什么 id 写死为 `'include'`**（`:511-513` 注释）：

> Pinned id: the bootstrap include is app glue, not a config row, and its id appears in Loader failure chains — a random id would make startup diagnostics unstable across runs (and snapshot fixtures).

即：**随机 id 会让启动诊断信息在每次运行间变化，也会破坏快照测试**。

💡 **两个 builtin 的注释解释了 `cordis:group` 为什么必须内置**（`:505-509`）：

> a group row is how a composition gives one `isolate` realm to a provider and its consumers together, and an agent preset living outside this workspace cannot resolve `@deepseek-ai/cordis-plugin-group` by name.

即：**group 行是"给 provider 和它的 consumer 一个共同的 isolate realm"的手段**（对应 [cordis 07 § 7.7](../hello-cordis/07-loader-and-configuration-tree.md)），而 workspace 外的 agent preset 无法按名字解析到 group 包——所以必须作为 builtin 注入。这直接关联 [03 篇](03-capability-seams-and-services.md) 的 seam 隔离机制。

## 5.7 `--dump-config`：看真实的插件树

`docs/architecture.md` 给的命令：

```sh
dsh --profile web --dump-config
```

实现在 `AB/index.ts`：

| 符号 | 行号 | 作用 |
|---|---|---|
| `ConfigDumpLayer` | 341 | 一层的描述 |
| `renderConfigDump()` | 379 | 渲染输出 |
| `groupedDump()` | 445 | 按组织分组打印 |

💡 **这是排查启动问题的第一工具**。它打印的每一行都能被你自己的 patch 按 id 覆盖。

## 5.8 环境变量的分层加载

`AB/index.ts` 有一套专门的 env 处理：

| 符号 | 行号 | 作用 |
|---|---|---|
| `loadEnv()` | 78 | 加载单个 env 文件 |
| `BOOTSTRAP_NAMES` | 93 | 白名单：哪些变量属于"引导期" |
| `BOOTSTRAP_PREFIXES` | 117 | `['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']` |
| `isBootstrapOnly()` | 125 | 判定 |
| `readEnvLayer()` | 139 | 读一层 |
| **`loadLayeredEnv()`** | **177** | 分层合并 |

💡 **区分"引导期变量"与"应用变量"的意义**：引导期变量（`DSH_*`、`XDG_*`、`DYLD_*`、`BASH_FUNC_*`）影响 dsh 自身怎么启动，不应该被 `.env` 文件覆盖或传给子进程；应用变量则相反。这是 [08 篇](08-execution-services.md)（子进程环境）与 [08 篇](08-execution-services.md)（沙箱环境）的前置。

## 5.9 "响亮失败"：`installFailLoud` 与激活审计

DSH 对启动失败的态度很明确：**不允许静默降级**。

![installFailLoud：不允许静默降级](diagrams/05-fail-loud.svg)

**installFailLoud：不允许静默降级** — [交互版](diagrams/05-fail-loud.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-fail-loud.architecture.json)

- **为什么需要暂扣**：启动期插件的 rejection 可能是正常的重试中间态 · 立即上报会产生大量假警报 · 于是先暂扣，给 loader 一个认领窗口
- **引用计数的作用**：retain 增加计数，release 减少 · 计数归零且无人认领才判定为真失败 · 避免多个观察者互相覆盖判断
- **超时是硬上限**：窗口只有 2000 毫秒 · 超时后未认领的 rejection 直接报错 · 这是 fail-closed 原则的具体实现

💡 **"暂扣 rejection"的设计动机**：cordis 的插件初始化是异步的，一个插件抛错时 rejection 可能先到达 `unhandledRejection` 处理器，此时 loader 还没来得及把它包装成有诊断信息的错误。`retain/release` + 2 秒超时给了 loader 认领的窗口——**认领了就走正常诊断路径，没认领就当真的未处理 rejection 报出来**。

## 5.10 用户 patch 的热监听

| 符号 | 行号 | 作用 |
|---|---|---|
| `UserPatchWatchOptions` | 210 | 配置 |
| `watchUserPatches()` | 232 | 监听用户 patch 文件变化 |
| `userPatchesSchema` | 207 | `entryListSchema` 校验 |
| `loadOptionalPatches()` | 278 | 文件可选（不存在返回 undefined） |
| `loadOverlayPatches()` | 298 | 文件必需 |
| `parsePatchList()` | 320 | 解析 + 校验 |

💡 **`loadOptionalPatches` 与 `loadOverlayPatches` 的区别**：前者用于"可能不存在"的层（profile patch、home patch），后者用于"声明了就必须有"的层（bundle 的 `dsh.bundle.patch`）。

💡 **`watchUserPatches` 让改 patch 文件即时生效**，配合 cordis include 的 `refresh()`（[cordis 07 § 7.5](../hello-cordis/07-loader-and-configuration-tree.md)）。对应测试 `AB/../tests/config-reload.spec.ts`（431 行）与 `user-patches.spec.ts`（422 行）。

## 5.11 `dsh-base` patch 里都装了什么

前 70 行的行 id（`P/bundle/base/cordis.patch.yml`）：

| id | 插件 | 说明 |
|---|---|---|
| `timer` | `@deepseek-ai/cordis-plugin-timer` | 可逆定时器 |
| `hmr` | `@deepseek-ai/cordis-plugin-hmr` | 热重载（`root: ['.']`）；web-app 里被 disable |
| `llm` | `@deepseek-ai/dsh-llm` | LLM 服务定义 |
| `session` | `@deepseek-ai/dsh-session` | 会话日志 |
| `typert` | `@deepseek-ai/dsh-typert-registry` | 类型运行时注册表 |
| `typert-loader` | `@deepseek-ai/dsh-typert-loader` | |
| `typert-gateway` | `@deepseek-ai/dsh-api-gateway` | |
| `session-title` | `@deepseek-ai/dsh-session-title` | 会话标题（`fallbackMaxWords: 5` 等） |
| `session-title-llm` | `@deepseek-ai/dsh-session-title-first-prompt-llm` | 用首个 prompt 生成标题 |
| `user-questions` | `@deepseek-ai/dsh-user-questions` | |
| `agent` | `@deepseek-ai/dsh-agent` | Agent 注册表 |
| **`agent-default-model`** | `@deepseek-ai/dsh-agent-default-model` | **`provider: deepseek-official` / `model: deepseek-v4-flash`** |
| `jobs` | `@deepseek-ai/dsh-jobs-local` | 后台任务 |

💡 **默认模型是 `deepseek-official` / `deepseek-v4-flash`**。注释说明这是"入口点创建 Agent 时的、与传输无关的默认值；设置可以提供已保存的选择，消费方在创建时读取"。

💡 **注意 `agent` 与 `agent-loop` 是两行**：前者是接口与注册表，后者是默认驱动。**把 `agent-loop` 那行换掉就能换掉整个主循环**——这是"everything is a plugin"最有力的证据。

## 5.12 `cmdline`：命令行解析

`P/boot/cmdline/src/index.ts`（172 行）：

| 符号 | 行号 | 作用 |
|---|---|---|
| `CmdlineArgs` | 27 | 参数结构 |
| `AppExit` | 36 | 退出契约 |
| `CmdlineHost` | 54 | 宿主接口 |
| `provideCmdline()` | 68 | 把 cmdline 作为服务提供出去 |
| `internals`（stdout/stderr 可注入） | 75 | **测试可替换输出流** |
| `parseCmdline()` | 98 | 用 commander 解析 |
| `hasAction()` | 132 | 判断是否有子命令动作 |
| `configureExitAndOutput()` | 146 | 接管 commander 的退出与输出 |
| `isCommanderError()` | 167 | 识别 commander 错误 |

💡 **`internals` 对象让 stdout/stderr 可注入**——这样测试能捕获输出而不污染真实控制台。同样的手法在 `installFailLoud` 的 `FailLoudProcess` 接口（`AB/index.ts:535`）里也用了：**只声明需要的 `process` 切片**（`on` / `off` / `exit`），测试传假对象即可。

💡 **`webStartup` 服务是 flag 与配置的桥**（`web-app` patch 注释）：

> The web-startup plugin injects `cmdlineArgs` and provides `webStartup` as an ordinary Cordis service. Rows configured from flags inject that service, so Loader resolves their expressions only after it exists.

即：**命令行参数通过一个普通 cordis 服务传给配置行**，配置里的 JS 表达式（[cordis 07 § 7.5](../hello-cordis/07-loader-and-configuration-tree.md) 的 `!!js` 标签）依赖该服务，因此**只在服务就绪后才求值**。`dsh --profile web --help` 不提供这个服务，所以不会真的绑定端口。

---

> 📎 **以下承接原「04 Cordis 在 DSH 中的落地」。**
> 本篇是跨仓库桥接篇：DSH 的 vendored cordis 与上游的精确差异、行号对照表、以及 DSH 怎么用 cordis 的每一个原语（Service / effect / waterfall / isolate / Fiber）。
> 路径缩写：`P/` = `packages/`，`V/` = `vendor/cordis/src/`；上游用 `C/` = cordis 仓库的 `packages/core/src/`。行号：DSH 侧对应 `fb2c4b9e`，cordis 侧对应 `8cc9e33f`。

## 5.13 vendored 全家桶清单

DSH 不依赖 npm 上的 cordis，而是把整套 vendor 进 `vendor/` 并 rescope 到 `@deepseek-ai/*`：

| `vendor/` 目录 | rescope 后的包名 | 版本 | 上游对应 |
|---|---|---|---|
| `cordis` | `@deepseek-ai/cordis` | **4.0.2** | `cordis@4.0.0-rc.10` |
| `loader` | `@deepseek-ai/cordis-plugin-loader` | 1.0.2 | `@cordisjs/plugin-loader@1.0.0-rc.5` |
| `include` | `@deepseek-ai/cordis-plugin-include` | 1.0.6 | `@cordisjs/plugin-include@1.0.4` |
| `hmr` | `@deepseek-ai/cordis-plugin-hmr` | 1.0.16 | `@cordisjs/plugin-hmr@1.0.15` |
| `group` | `@deepseek-ai/cordis-plugin-group` | 1.0.1 | `@cordisjs/plugin-group@1.0.0` |
| `timer` | `@deepseek-ai/cordis-plugin-timer` | 1.1.3 | `@cordisjs/plugin-timer@1.1.2` |
| `logger-console` | `@deepseek-ai/cordis-plugin-logger-console` | 1.0.1 | `@cordisjs/plugin-logger-console@1.0.0` |
| `cosmokit` | `@deepseek-ai/cosmokit` | 1.8.2 | `cosmokit@1.8.1` |
| `schemastery` | `@deepseek-ai/schemastery` | 3.18.1 | 独立项目 |

`pnpm-workspace.yaml` 强制指向本地：

```yaml
linkWorkspacePackages: true
overrides:
  '@deepseek-ai/cosmokit': 'link:vendor/cosmokit'
  '@deepseek-ai/schemastery': 'link:vendor/schemastery'
```

💡 **为什么 vendor 而不是直接依赖**：cordis 上游 README 明示 API 不稳定（[cordis 01 § 1.9](../hello-cordis/01-overview-and-design-philosophy.md)）。DSH 要在这个基础上做产品，必须锁死一个可控的副本。同时 DSH 也在给它加文档与加固（§ 5.15）。

💡 **配套的三道校验脚本**：`scripts/rescope-vendor.ts`（+ `.spec.ts`）做 rescope、`scripts/check-vendor-manifest.sh` 校验清单、`scripts/verify-vendored-links.ts` 校验链接。`scripts/cordis-core-api.ts`（+ `.spec.ts`）与 `gen-cordis-api.ts` **锁住 cordis 的 API 表面**——防止无意分叉。

## 5.14 分叉有多大：量化

`vendor/cordis/src` 共 **2693 行**，上游 `packages/core/src` 是 **1848 行**——多 845 行（46%）。**但绝大部分是注释。**

去掉空行与注释后的有效代码行数：

| 文件 | 上游 | vendor | 差异 |
|---|---|---|---|
| **`fiber.ts`** | 419 | **535** | **+116** |
| `reflect.ts` | 245 | 246 | +1 |
| `registry.ts` | 180 | 181 | +1 |
| `service.ts` | 69 | 69 | **0** |
| `context.ts` | 68 | 68 | **0** |
| `events.ts` | 150 | 145 | −5 |
| `utils.ts` | 236 | 229 | −7 |
| **合计** | **1367** | **1473** | **+106** |

![vendored cordis 与上游的差异构成](diagrams/05-vendor-diff.svg)

**vendored cordis 与上游的差异构成** — [交互版](diagrams/05-vendor-diff.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-vendor-diff.architecture.json)

- **差异主要是文档**：近九成新增行是注释 · 这说明 DSH 没有 fork 语义，只是补充说明 · 阅读上游 cordis 源码仍然有效
- **有效改动集中在 fiber.ts**：fiber.ts 净增 116 行 · 其余文件合计净减 10 行 · 因此只需重点关注 Fiber 的行为差异
- **唯一必须注意的坑**：行号与上游不对应 · 引用源码位置时要以 vendored 版为准 · 换算方法见 § 5.16

## 5.15 fiber.ts 的三处实质加固

这是 DSH 对 cordis 唯一的行为性改动，全在 teardown 与配置解析路径上。

### ① `effectInertia` + `runDisposable`

![effectInertia 让 dispose 等待在途任务](diagrams/05-effect-inertia.svg)

**effectInertia 让 dispose 等待在途任务** — [交互版](diagrams/05-effect-inertia.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-effect-inertia.architecture.json)

- **这是 DSH 对 cordis 的主要改动**：fiber.ts 净增的 116 行大部分与此有关 · 它补上了异步 effect 的等待语义 · 不改变任何公开 API
- **为什么用 WeakMap**：键是 Disposable 本身，不需要额外字段 · Disposable 被回收时关联自动消失 · 避免在热路径上增加对象属性
- **漏等的后果**：卸载返回后在途任务仍在写文件或发请求 · 热重载时新旧实例会短暂并存 · 因此必须在 dispose 链上统一改造

### ② `emitPluginDisposed`：隔离观察者失败

`V/fiber.ts:120-137`（上游直接 `context.emit('internal/plugin', this)`）：

```ts
function emitPluginDisposed(context: Context, fiber: Fiber) {
  const args: any[] = ['internal/plugin', fiber]
  let callbacks: Function[]
  try {
    callbacks = context.events.dispatch('emit', args)
  } catch (error) {
    context.logger.error(error)
    return
  }
  for (const callback of callbacks) {
    try {
      const returned = callback(...args)
      void Promise.resolve(returned).catch(error => context.logger.error(error))
    } catch (error) {
      context.logger.error(error)
    }
  }
}
```

💡 **注释说明动机**："Notify plugin teardown without allowing one observer to break ownership cleanup."

即：卸载时派发 `internal/plugin`，**每个监听器单独 try/catch，同步异常与 Promise rejection 都兜住**。一个坏监听器（比如 loader 的自卸载判定逻辑出错）不会中断所有权清理。

💡 **它用了上游标记为 `@deprecated` 的 `events.dispatch()`**（[cordis 06](../hello-cordis/06-event-system-and-waterfall.md) 里 `C/events.ts:84`）——因为它需要**拿到 callback 列表自己遍历**，而不是让 `emit` 一把跑完。这解释了那个 API 为什么还留着。

💡 **[05 § 5.5](05-startup-and-cordis-runtime.md) 的 `boot()` 直接依赖这个加固**：它的注释写"Root-fiber disposal contains cleanup failures per observer (Cordis fiber.ts hardening) and a repeated call returns the settled single-shot result, so this await cannot reject and replace `cause`"。

### ③ `_config` + `_resolveConfig`：每次激活重新解析配置

| 位置 | 内容 |
|---|---|
| `V/fiber.ts:192` | `public _config: any` —— 保存**未校验的原始配置** |
| `V/fiber.ts:229` | 构造时 `this._config = config` |
| `V/fiber.ts:641` | `private _resolveConfig(config: any)` |
| `V/fiber.ts:655` | `_reload()` 里 `this.config = this._resolveConfig(this._config)` |
| `V/fiber.ts:738` | `update()` 里 `this._config = config` |
| `V/fiber.ts:747` | `update()` 里 `config = this._resolveConfig(config)` |

💡 **上游只在构造时校验一次**（`C/fiber.ts:173` 的 `this.config = resolveConfig(runtime, config)`）。vendor 版每次 reload 前重新解析。

**为什么需要**：DSH 的配置里大量使用 cordis 的 JS 表达式（`!!js` 标签，[cordis 07 § 7.5](../hello-cordis/07-loader-and-configuration-tree.md)），而表达式的求值依赖当时可用的服务。`web-app` patch 的注释说得很清楚：

> Rows configured from flags inject that service, so Loader resolves their expressions only after it exists.

**一行配置在依赖服务出现前后求值出的结果不同** → 必须在每次激活时重新解析，而不能沿用首次构造时的结果。

## 5.16 行号对照表

同一符号在两边的行号：

| 符号 | 上游 `C/` | vendor `V/` | 偏移 |
|---|---|---|---|
| **fiber.ts** | | | |
| `FiberState` 枚举 | 78 | **147** | +69 |
| `class Fiber` | 103 | **184** | +81 |
| `assertActive()` | 224 | 351 | +127 |
| `effect()` 实现 | 277 | **418** | +141 |
| `_checkImpl()` | 371 | 597 | +226 |
| `_refresh()` | 385 | **611** | +226 |
| `_setEpoch()` | 399 | 625 | +226 |
| `_reload()` | 415 | 646 | +231 |
| `_unload()` | 437 | 675 | +238 |
| `await()` | 460 | 704 | +244 |
| `restart()` | 468 | 718 | +250 |
| `update()` | 476 | 736 | +260 |
| **reflect.ts** | | | |
| `static handler` | 62 | **135** | +73 |
| `provide()` | 175 | **277** | +102 |
| `notify()` | 205 | **314** | +109 |
| **registry.ts** | | | |
| `@Inject()` | 17 | 37 | +20 |
| `class RegistryService` | 125 | **195** | +70 |
| `plugin()` | 193 | **316** | +123 |
| **events.ts** | | | |
| `class EventsService` | 45 | **131** | +86 |
| `waterfall()` | 117 | **234** | +117 |
| `interface Events` | 169 | 329 | +160 |
| **service.ts / context.ts** | | | |
| `abstract class Service` | 5 | 11 | +6 |
| `class Context` | 21 | 42 | +21 |

💡 **偏移不是线性的**（fiber.ts 从 +69 到 +260），所以不能用固定量换算。**建议按符号名检索**——这也是本文档集所有篇目的通用建议。

## 5.17 DSH 怎么用 cordis 的每个原语

> 📐 **配套可跑示例**：[`M12.1 · dispatch-modes`](../../dsh-example/M12-framework-mechanisms/impl/01-dispatch-modes.ts) 在真实 `@deepseek-ai/cordis` 上把五种派发模式各跑一遍
> （含 `parallel` 的 `AggregateError`、`serial` 的截链、`waterfall` 的"最后一个实参就是内建默认"）；
> [`M12.2 · dispose-pending-timer`](../../dsh-example/M12-framework-mechanisms/scenes/02-dispose-pending-timer.ts) 演示 effect 化的定时器与 fiber 卸载时的拒绝语义。


![每个能力都是一个 cordis Service](diagrams/05-services-as-plugins.svg)

**每个能力都是一个 cordis Service** — [交互版](diagrams/05-services-as-plugins.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-services-as-plugins.architecture.json)

- **全部是普通 cordis Service**：每个都通过 provide 注册到 ctx 上 · 都可以被 inject 声明为依赖 · 都能被上层 patch 换成别的实现
- **没有一个是特权的**：连 agentLoop 也只是一个 Service · 换掉它就换掉整个 turn/step 语义 · 这是没有特权内核的最终证据
- **可跑的最小示例**：dsh-example 以 12 个方向模块组织 60 个阶段 · 例如 M12 的 cordis-timer 阶段演示如何接入定时器 · 装的是真实发布的 npm 包

## 5.18 DSH 在 cordis 之上加的一层：`Scoped<T>` 与 `core/scope`

> 📐 **配套可跑示例**：[`M01.4 · tool-restrict`](../../dsh-example/M01-tool-pipeline/impl/04-tool-restrict.ts) 是 scope 的最小落点 ——
> `agent.ctx.tools.restrict(...)` 在 plain context 上会**抛错**，示例把这条 fail-closed 连同
> "effect 归属被调用的那个 context"的实际后果一起打印出来。


cordis 的隔离粒度是 **realm**（配置级）。DSH 需要更细的粒度：**每个 Agent 一套注册**。这就是 `core/scope`（561 行）。

![core/scope 提供比 realm 更细的粒度](diagrams/05-scope-granularity.svg)

**core/scope 提供比 realm 更细的粒度** — [交互版](diagrams/05-scope-granularity.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-scope-granularity.architecture.json)

- **cordis realm 不够用的原因**：realm 的粒度是配置行，启动时定型 · subagent 是运行期动态创建的 · 无法为每个 subagent 预先写一个 realm
- **Scoped 的做法**：同一个服务实例按 scope 分层存放条目 · 查询时按当前 scope 逐层向上找 · 撤销时只影响自己那层
- **两级配合**：realm 负责启动期的静态隔离 · scope 负责运行期的动态隔离 · 两者叠加才覆盖全部场景，见 03 篇

## 5.19 DSH 侧的 cordis 相关工具

| 位置 | 作用 |
|---|---|
| `P/extensions/cordis-host-runner` | 在 host 侧跑 cordis 树 |
| `P/extensions/cordis-client-runner` | 在 client 侧跑 cordis 树 |
| `P/extensions/tool-cordis` | **让模型能操作 cordis 插件树的工具** |
| `P/extensions/ui-cordis` | 前端的 cordis 树查看器 |
| `P/test-support/loader-smoke` | loader 冒烟测试支持 |
| `scripts/cordis-walk.ts` | 遍历 cordis 树 |
| `scripts/cordis-config-files.ts` | 收集配置文件 |
| `scripts/gen-cordis-catalog.ts` | 生成插件目录 |
| `scripts/gen-cordis-inspect-catalog.ts` | 生成检视目录 |
| `scripts/gen-cordis-api.ts` | 生成 `docs/cordis-api/`（11 md） |
| `scripts/demo-cordis.mjs` | `pnpm demo:cordis` |
| `docs/cordis-primer.md` + `docs/cordis-tutorial/`（16 md） + `docs/cordis-api/`（11 md） | 上游 cordis 的官方文档实际托管在 DSH 仓库 |

💡 **`tool-cordis` 很有意思**：模型自己可以查看和操作插件树。这让 agent 能做"自我配置"——例如发现缺某个工具时自行挂载。

💡 **cordis 的官方文档实际在 DSH 仓库里**（cordis 的 homepage 指向 `deepseek-harness.github.io/.../cordis-primer`）。两个项目的关系比"上游/下游"更紧密。

## 5.20 从 cordis 概念到 DSH 概念的映射

| cordis 概念 | DSH 里的体现 | 篇目 |
|---|---|---|
| `Context`（`ctx`） | 每个插件、每个 Agent（`agent.ctx`）都有自己的视图 | [03](03-capability-seams-and-services.md) |
| `Fiber` | 一行配置的一次运行；启动审计读它的 state | [05 § 5.9](05-startup-and-cordis-runtime.md) |
| `effect()` | 全部注册（工具/prompt/监听/连接）的登记方式 | 各篇 |
| `Service` + `provide` / `inject` | 每个 `ctx.xxx` 能力 | [03](03-capability-seams-and-services.md) |
| `waterfall` | `tools/*`、`agent/pre-step`、`agent/request-error`、`llm/stream` | [07](07-request-pipeline-llm-tools-and-prompts.md) [06](06-agent-loop-and-session-log.md) [07](07-request-pipeline-llm-tools-and-prompts.md) |
| `serial` | `agent/turn-stopping`（无 `next`） | [06](06-agent-loop-and-session-log.md) |
| `emit` | `session/event` 广播 | [06](06-agent-loop-and-session-log.md) |
| `isolate` realm | agent preset 里给 provider + consumer 一个 realm | [03](03-capability-seams-and-services.md) |
| `Group`（配置分组） | 把 provider 与 consumer 圈到一个 realm 的手段 | [05 § 5.6](05-startup-and-cordis-runtime.md) |
| `include` + `applyPatches` | profile / bundle 分层 | [05 § 5.2](05-startup-and-cordis-runtime.md) |
| `hmr` | 开发期插件热重载（web-app 里被 disable） | [05 § 5.11](05-startup-and-cordis-runtime.md) |
| `timer` | 可逆定时器（`ctx.debounce` 等） | — |
| `logger` | 全仓日志 | — |
| Standard Schema（`Config`） | 配置校验；DSH 用 `schemastery`（vendored） | [09](09-host-runtime-and-storage.md) |

---

**上一篇** ← [04 扩展与生态](04-extensions-and-ecosystem.md) ｜ **下一篇** → [06 Agent 循环与会话日志](06-agent-loop-and-session-log.md)：496 行主循环逐行拆解 + append-only 会话日志的不变量。
