---
title: "启动流程与 Cordis 落地"
---
# 启动流程与 Cordis 落地

> **本篇回答**：`dsh web` 敲下回车后发生的全部事情，以及这一切底下的 cordis 是什么样的。前半是 profile 解析、bundle patch 分层、根 include 挂载、"启动必须响亮失败"；后半是 DSH vendored 的那份 cordis —— 分叉有多大、三处 fiber 加固（第三处在 rc.3 被重写为 `_configRevision` 代次机制）、行号怎么读、以及 DSH 在 cordis 之上补的 `Scoped<T>`。
> **路径缩写**：`P/` = `packages/`，`AB/` = `packages/boot/app-boot/src/`，`V/` = `vendor/cordis/src/`；上游用 `C/` = cordis 仓库的 `packages/core/src/`。行号：DSH 侧对应 `38a6a5c9`（tag `dsh-v0.2.2-rc.3`）；vendored cordis 为 **4.1.0**，上游基线是 cordis `4.0.0-rc.11`（commit `0b96d9fd`，见 `vendor/README.md` 清单），该上游版本不在本仓库快照内。
>
> 🧭 **本篇导览**：5.1–5.12 启动、Profile 与 Bundle → 5.13–5.16 vendored cordis 分叉 → 5.17–5.20 Cordis 原语与 DSH Scope。
>

## 5.1 两个概念：Profile 与 Bundle

> 📐 **配套可跑示例**：[`cordis.yml`](../../dsh-lab/examples/dsh-chat-demo/cordis.yml) + [`cordis.patch.yml`](../../dsh-lab/examples/dsh-chat-demo/cordis.patch.yml) 是**真实的装配清单** ——
> 根表是空的，全部行由 patch 层一次性挂载；每一行就是本节说的那种配置行（`id` / `name` / `config`），
> 由官方 `boot()` 应用到根表上。这与本节讲的"profile 叠加 bundle"是同一套语义，只是换了个文件放。


![Bundle 与 Profile 的关系](diagrams/05-bundle-and-profile.svg)

**Bundle 与 Profile 的关系** — [交互版](diagrams/05-bundle-and-profile.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-bundle-and-profile.architecture.json)

- **Bundle 是可分发的**：它是 npm 包，同时带配置行与实现代码 · 一个 bundle 可被任意 profile 引用 · 版本随包管理器解析
- **Profile 是本机的组合**：住在 Harness home 的 profiles 目录下 · 只声明要叠哪些 bundle 加自己的定制 · 因此切 profile 就切整套能力
- **每行都是普通配置行**：形如 id / name / config 三要素 · 任何一行都可被上层按 id 覆盖 · 这正是没有特权内核的落地方式

💡 **profile 是"用户拥有"的，bundle 是"分发方拥有"的**。profile 目录里还有 `pnpm-workspace.yaml` 模板（`AB/profile.ts:184 PROFILE_PNPM_WORKSPACE`）——**profile 本身就是一个 pnpm 工作区**，用户能往里装第三方插件包。

## 5.2 分层顺序

`docs/architecture.md`（171 行）的原文：

> Layers apply to an empty entry list in this order: the profile's ordered bundles, its `cordis.patch.yml`, the home patch, then `--patch` overlays. A patch targets a row by id and replaces its whole config, or inserts new rows. A `preset` patch applies these operations inside that declaration's `config.plugins`, with the same layer precedence.

![四层 patch 的叠加顺序](diagrams/05-layer-order.svg)

**四层 patch 的叠加顺序** — [交互版](diagrams/05-layer-order.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-layer-order.architecture.json)

- **一次调用完成全部叠加**：composeEntries() 位于 AB/profile.ts:755 · 它把所有层 flat 成一个 patch 数组 · 然后只调用一次 applyEntryPatches
- **底层就是 cordis 的 applyPatches**：与 cordis include 用的是同一套语义 · insert 追加、按 id 覆盖两条路径 · 见 cordis 07 篇 § 7.5
- **顺序决定优先级**：后叠的层覆盖先叠的 · 命令行 --patch 优先级最高 · 便于临时调试而不改文件

`composeEntries()` 全文（`AB/profile.ts:755-762`，762 行文件的收尾函数）：

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

💡 **`applyEntryPatches` / `entryListSchema` 这两个导出本身就是 vendored 分叉**：`vendor/README.md` 的修改记录 V11 注明，`include/src/index.ts` 把上游 `applyPatches` 以 `applyEntryPatches` 之名导出、把 `!!js` YAML 方言以 `entryListSchema` 之名导出，正是为了让 `dsh --dump-config` 用与挂载完全相同的算法合成配置。

## 5.3 patch 的三条硬语义（DSH 侧的表述）

`dsh-base/cordis.patch.yml`（`P/bundle/base/`，550 行、99 条 id 行）的头部注释（前 11 行）把语义讲得比 cordis 文档更清楚：

```yaml
# The dsh-base bundle patch: the shared core of each base-backed profile, applied as
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

💡 **`web-app` patch 里能看到这个约束的实际后果**：它重述了 `system-prompt` 的整个 `personaPrefix`、`session-query-sqlite` 的整个 config——即使只想改一个字段。

💡 **base 里的 `hmr` 行现在带条件**（`base/cordis.patch.yml:28-32`）：

```yaml
# Profile configuration reloads by default; module roots are opt-in.
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: !!js "!ctx.get('profileContext')"
  config:
    root: []
```

即：**profile 配置默认热重载，模块根目录的热重载是选进的**；没有 `profileContext` 服务时这行整体 disabled。web-app 不再关 hmr，而是自带 `client-hmr` 行（web-app patch :222）。`disabled` 仍是 `EntryOptions` 的独立字段，**patch 可以只写 `disabled: true` 而不写 config**（[cordis 07 § 7.2](../hello-cordis/07-loader-and-configuration-tree.md)）。

## 5.4 `loadProfile()`：解析一个 profile

`AB/profile.ts:728-745`：

![loadProfile 的分支与模板初始化](diagrams/05-load-profile.svg)

**loadProfile 的分支与模板初始化** — [交互版](diagrams/05-load-profile.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-load-profile.architecture.json)

- **报错必须可操作**：找不到 profile 且无模板时直接抛错 · 错误信息给出完整创建命令（`dsh plugin --profile <name> add <package>`） · 不做静默创建，避免产生意料外的配置
- **模板初始化写三个文件**：initProfile（AB/profile.ts:198）写 package.json（声明 profile 与要叠的 bundle）、空的 cordis.patch.yml、pnpm-workspace.yaml · 已存在的文件一律不碰，重复运行是幂等的
- **读取前先治理**：removeLinkProvisions 清掉 0.1.5 链接后端留下的 `.dsh-module-fallback`（:229）· dropRetiredBundles 移除已退役 bundle · normalizeShippedProfile 把安装方拥有的 bundle 元组归一到模板（:596）

```ts
export function loadProfile(
  binName: string, name: string, installAnchor: string, home: string = resolveDshHome(),
  options: { userLayer?: boolean } = {},
): Profile {
  const dir = resolveProfileDir(name, home)
  if (!existsSync(join(dir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[name]
    if (template === undefined) {
      throw new Error(
        `${binName}: profile ${JSON.stringify(name)} does not exist; create it with 'dsh plugin --profile ${name} add <package>'`,
      )
    }
    initProfile(dir, template.bundles)
  }
  removeLinkProjections(dir)
  normalizeShippedProfile(name, dir, readProfileManifest(binName, dir))
  return loadProfileDirectory(binName, dir, installAnchor, options)
}
```

💡 **`options.userLayer !== false`** 这个双重否定是刻意的：默认（`undefined`）**包含**用户层；只有显式传 `false` 才跳过。config dump 的"只看 bundle 层"模式会用到（JSDoc：`--dump-default-config` 等"bundles-only 消费方"不能因损坏的用户层而失败）。

💡 **profile 模板治理是 rc.3 的正式机制**。模板不再写死在 app-boot 里，而是来自 `@deepseek-ai/dsh-official-bundles`（`P/util/official-bundles/src/bundles.ts`）：

| 机制 | 位置 | 作用 |
|---|---|---|
| `PROFILE_TEMPLATES` | bundles.ts:10-25 | 五个随安装发布的模板：acp / web / headless / sdk / sdk-minimal |
| `INSTALLATION_OWNED_PROFILE_TUPLES` | :32-34 | 早期版本写进 shipped profile 的 bundle 元组；精确匹配时替换成同名模板的当前 bundle 列表 |
| `RETIRED_BUNDLES` | :37- | 安装方不再携带的 bundle（如 `dsh-experimental-schedule-bundle`）；loadProfile 时自动从 profile 的 bundle 列表移除并写回 manifest |
| `OPTIONAL_BUNDLES` / `ON_DEMAND_BUNDLES` | :56 / :76 | 可选与按需安装的 bundle 清单 |

配套的官方迁移事实源是 `docs/upgrade-guide/`：**13 个逐版本目录**（`v0.1.7-rc.2` → `v0.2.2-rc.1`），`RETIRED_BUNDLES` 的注释直接链到对应版本的 guide（`docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md`）。

💡 **"profile 在 home 目录、代码在安装目录"的解析复杂度**现在由 `AB/profile-resolution/`（resolver / service / worker-bootstrap / legacy-links 四文件）与 `resolveBundleDir()`（`AB/profile.ts:651`，先安装锚点、后 pnpm 布局探测）承担。旧版的 `healProfilesModuleFallback()` / `ensureSymlink()` 已删除——它们要治的 `.dsh-module-fallback` 链接投影只剩 `removeLinkProjections()` 的清除路径（:229）。

## 5.5 `boot()`：主启动函数

`AB/index.ts:1220-1286`（文件 1286 行）。函数体 67 行，注释仍比代码多。

![boot() 的两段式启动](diagrams/05-boot-sequence.svg)

**boot() 的两段式启动** — [交互版](diagrams/05-boot-sequence.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-boot-sequence.sequence.json)

- **两段 stage 标签的作用**：第一段 host preparation failed（任何配置树行挂载之前）· 第二段 plugin tree failed to load · 报错时用户能立刻分清是环境问题还是配置问题
- **启动中退出不是失败**：表面可以在启动仍在途时拆掉整棵插件树 · `await ctx.get('loader')?.await()` 之后重新取 loader，消失就直接 return ctx · Ctrl+C 不会被报成崩溃
- **失败诊断独立于插件树**：一个独立的 diagnostics Context 先行收集 warn/error（:1230-1238）· 它比根 fiber 活得久 · StartupError 额外携带配置组合快照与启动日志

`boot()` 的错误处理（`AB/index.ts:1257-1282`）值得逐条看：

```ts
} catch (cause) {
  if (cause instanceof StartupError) {
    try { cause.composition = captureStartupComposition(ctx) } catch (error) {
      ctx.logger.warn('Startup composition diagnostic unavailable', error)
    }
  }
  // Root-fiber disposal contains cleanup failures per observer (Cordis
  // fiber.ts hardening) and a repeated call returns the settled single-shot
  // result, so this await cannot reject and replace `cause`.
  await ctx.fiber.dispose()
  if (cause instanceof StartupError) {
    cause.startup = { configurationPath: absoluteConfigPath, messages: startupLogs }
    throw cause
  }
  const detail = cause instanceof Error ? cause.message : String(cause)
  // A wrapper can carry an activation error whose original stack names the failed plugin.
  let deepest: unknown = cause
  const seen = new Set<Error>()
  while (deepest instanceof Error && !seen.has(deepest) && deepest.cause !== undefined) {
    seen.add(deepest)
    deepest = deepest.cause
  }
  const stack = deepest instanceof AggregateError
    ? `\n${deepest.stack ?? deepest.message}\n${deepest.errors.map(error => formatActivationError(error)).join('\n')}`
    : deepest instanceof Error && deepest !== cause ? `\n${deepest.stack ?? deepest.message}` : ''
  throw new Error(`${binName}: ${stage}: ${detail}${stack}`, { cause })
} finally {
  await diagnostics.fiber.dispose()
}
```

💡 **四个设计点**：
1. **`StartupError` 走富诊断通道**：先 `captureStartupComposition` 抓配置组合快照，`fiber.dispose()` 后把 `startupLogs`（诊断 Context 收集的 warn/error）挂上去再原样抛出——调用方能拿到"失败那一刻树长什么样"。
2. **先 `ctx.fiber.dispose()`**，注释说明"根 fiber 卸载会按观察者隔离清理失败（cordis fiber.ts 加固），重复调用返回已 settle 的单次结果，所以这个 await 不会 reject 并替换 `cause`"。**这正是 [01 § 1.6](01-overview.md) 提到的 vendored cordis 的 `emitPluginDisposed` 加固在起作用。**
3. **沿 `error.cause` 链找最深的错误**，`seen` Set 防循环引用；`AggregateError` 会把每个 activation error 逐条格式化列出——Loader 事务性更新把失败层层包裹，最深的 cause 才是插件真正抛出的错误。
4. **`stage` 两段标签**：`prepare` 在任何配置树行挂载之前跑，它失败就是宿主问题而非插件树问题。

💡 **启动审计是"可用应用"的定义者**：`auditStartupEntries()`（`AB/index.ts:1173`）以 `requiredStartupEntryIds`（agent-loop、tool-executor-native、tool-executor-ptc、webserver、web-runtime、modules、connection、headless-runner、acp…）核对激活结果——清单是**全局的而非 profile 元数据**：缺失或 disabled 的 id 不影响启动，但声明启用的必备 id 没激活就算启动失败。

💡 **启动链从"两段 stage"演进为带预检与诊断的结构**。app-boot（`AB/`）在 rc.3 拆出了一批新文件：

| 文件 | 行数 | 职责 |
|---|---|---|
| `startup-diagnostics.ts` | 104 | 失败启动在拆插件前的无配置快照 |
| `compatibility-preflight.ts` | 187 | DSH 拥有的组合入口上的兼容性预检（不做 Loader 插桩） |
| `plugin-compatibility.ts` | 117 | `evaluatePluginCompatibility()`（:87）：bundle/插件声明的 dsh 要求与宿主事实比对 |
| `bundle-platform.ts` | 35 | `assertBundlePlatform()`（:27）：按宿主平台拒绝不支持的 bundle |
| `profile-sanitize.ts` | 34 | 拥有 profile 关停与写排除的调用方的文件系统恢复 |
| `profile-resolution/` | 4 文件 | 包元数据经一次运行期拦截解析（service.ts）；SEA/链接历史归 legacy-links.ts |
| `config-schema/` | 7 文件 | 配置 schema 的收集、原生化、投影与文档化 |

💡 **boot 组从 2 包扩到 6 包**：`P/boot/` 现为 app-boot、cmdline、**hmr**（vendored hmr 之外的 DSH 侧封装，profile patch 热监听在这里，见 § 5.10）、**config-editor**、**plugin-manager**（`dsh plugin` 命令与 base patch 里的 `plugin-manager` 行）、**plugin-market**（插件市场索引与解析）。

## 5.6 `mountRootInclude()`：把配置文件挂成根

`AB/index.ts:758-805`。这一步把 cordis 的 `Include` 插件作为 **id 固定为 `'include'`** 的一行挂到 loader 上。

![mountRootInclude 如何挂 builtins](diagrams/05-mount-root-include.svg)

**mountRootInclude 如何挂 builtins** — [交互版](diagrams/05-mount-root-include.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-mount-root-include.architecture.json)

- **为什么要动态子类**：宿主可能把插件装在非默认位置 · 裸模块名需要从宿主给的基准 URL 解析 · 覆写 import 是最小侵入的做法
- **group 必须是 builtin**：isolate realm 要用 group 行做容器 · 若 group 不是 builtin 就无法在配置里直接用 · 见 § 5.6 与 03 篇的两级隔离
- **这一步是 cordis 与 DSH 的接缝**：把 cordis 的 Include 与 Group 接进 DSH 的解析策略 · 之后整棵插件树的加载都走这套规则 · 改这里等于改整个模块解析行为

💡 **为什么 id 写死为 `'include'`**（`:784-786` 注释）：

> Pinned id: the bootstrap include is app glue, not a config row, and its id appears in Loader failure chains — a random id would make startup diagnostics unstable across runs (and snapshot fixtures).

即：**随机 id 会让启动诊断信息在每次运行间变化，也会破坏快照测试**。

💡 **两个 builtin 的注释解释了 `cordis:group` 为什么必须内置**（`:778-782`）：

> a group row is how a composition gives one `isolate` realm to a provider and its consumers together, and an agent preset living outside this workspace cannot resolve `@deepseek-ai/cordis-plugin-group` by name.

即：**group 行是"给 provider 和它的 consumer 一个共同的 isolate realm"的手段**（对应 [cordis 07 § 7.7](../hello-cordis/07-loader-and-configuration-tree.md)），而 workspace 外的 agent preset 无法按名字解析到 group 包——所以必须作为 builtin 注入。这直接关联 [03 篇](03-capability-seams-and-services.md) 的 seam 隔离机制。

💡 **补丁在根 include 挂载前就准备好**（`:787-788` 注释）：`prepareProfilePatches()` 的注释说明"兼容性判定必须在根 Include import 任何东西之前做出，且它们不改动任何 profile patch 层、manifest 或 bundle 列表"——这是 § 5.5 那批预检文件的接线点。

## 5.7 `--dump-config`：看真实的插件树

`docs/architecture.md` 给的命令：

```sh
dsh --profile web --dump-config
```

实现在 `AB/index.ts`：

| 符号 | 行号 | 作用 |
|---|---|---|
| `ConfigDumpLayer` | 612 | 一层的描述 |
| `renderConfigDump()` | 651 | 渲染输出 |
| `groupedDump()` | 716 | 按组织分组打印 |

💡 **这是排查启动问题的第一工具**。它打印的每一行都能被你自己的 patch 按 id 覆盖。

## 5.8 环境变量的分层加载

`AB/index.ts` 有一套专门的 env 处理：

| 符号 | 行号 | 作用 |
|---|---|---|
| `loadEnv()` | 119 | 加载单个 env 文件 |
| `BOOTSTRAP_NAMES` | 134 | 白名单：哪些变量属于"引导期" |
| `BOOTSTRAP_PREFIXES` | 158 | `['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']` |
| `isBootstrapOnly()` | 191 | 判定 |
| `readEnvLayer()` | 206 | 读一层 |
| **`loadLayeredEnv()`** | **256** | 分层合并 |

💡 **区分"引导期变量"与"应用变量"的意义**：引导期变量（`DSH_*`、`XDG_*`、`DYLD_*`、`BASH_FUNC_*`）影响 dsh 自身怎么启动，不应该被 `.env` 文件覆盖或传给子进程；应用变量则相反。这是 [08 篇](08-execution-services.md)（子进程环境）与 [08 篇](08-execution-services.md)（沙箱环境）的前置。

## 5.9 "响亮失败"：`installFailLoud` 与激活审计

DSH 对启动失败的态度很明确：**不允许静默降级**。

![installFailLoud：不允许静默降级](diagrams/05-fail-loud.svg)

**installFailLoud：不允许静默降级** — [交互版](diagrams/05-fail-loud.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-fail-loud.architecture.json)

- **两个进程事件一律致命**：unhandledRejection 与 uncaughtException 都变成一条带标签的 stderr 诊断 + `exit(1)` · 控制权从不交回失败的操作
- **认领窗口只对启动审计开放**：已被 auditStartupEntries 折叠进启动诊断的 rejection 在进程检查点被忽略（assembledActivationRejections，AB/index.ts:827-846）· 其余 rejection 一个不漏、全部致命
- **release 是硬上限下的收尾机会**：终端宿主交还终端的钩子最多等 `FAIL_LOUD_RELEASE_TIMEOUT_MS = 2_000` 毫秒（:854）· 超时也照常退出——卡死的 disposer 只能拖延失败，不能取消失败

💡 **`installFailLoud`（`AB/index.ts:899`）的三个细节**：
1. **诊断用 `util.inspect(err)` 而非 `err.stack`**：`node:fs` 错误的 `code`/`syscall`/`path` 与 `cause` 链是可枚举属性，stack 行看不到，而它们才是 crash report 需要的；handler 装好后 Node 自己一行也不会再打。
2. **`release` 钩子解决"终端状态悬空"**：Loader 并发挂载条目，持终端的表面可能恰在兄弟条目失败时占着终端；直接退出会把 raw mode、bracketed paste、键盘协议悬空在用户 shell 上。`release` 是终端宿主交还终端的机会，在 2 秒硬上限内被等待；诊断**先写**再等 release，挂死的 disposer 吞不掉失败原因。
3. **handler 在 release 期间保持安装**：中途摘掉会让第二个并发 rejection 变成 uncaught、在拆除途中杀死进程——latch 保证第一个 rejection 是被上报的那个。

## 5.10 用户 patch 的热监听

app-boot 侧只保留"读与校验"的符号：

| 符号 | 行号 | 作用 |
|---|---|---|
| `userPatchesSchema` | 286 | `entryListSchema` 校验 |
| `loadOptionalPatches()` | 536 | 文件可选（不存在返回 undefined） |
| `loadOverlayPatches()` | 556 | 文件必需 |
| `parsePatchList()` | 591 | 解析 + 校验 |

💡 **`loadOptionalPatches` 与 `loadOverlayPatches` 的区别**：前者用于"可能不存在"的层（profile patch、home patch），后者用于"声明了就必须有"的层（bundle 的 `dsh.bundle.patch`）。

💡 **精确的 profile patch 热监听已移交 boot 组的 hmr 包**：`P/boot/hmr/src/watch-config.ts` 的 `watchConfig()`（:38）负责监听 profile patch 文件变化，配合 cordis include 的 `refresh()`（[cordis 07 § 7.5](../hello-cordis/07-loader-and-configuration-tree.md)）即时生效。这正是 vendored hmr 修改记录 V9 的一句话："exact profile patch watching is owned by `packages/boot/hmr/src/watch-config.ts`"。对应测试仍在 app-boot：`config-reload.spec.ts`（304 行）与 `user-patches.spec.ts`（493 行）。

## 5.11 `dsh-base` patch 里都装了什么

前 100 行的行 id（`P/bundle/base/cordis.patch.yml`，共 **99 条 id 行**）：

| id | 行号 | 插件 | 说明 |
|---|---|---|---|
| `tool-plugin-manager` | 16 | `@deepseek-ai/dsh-plugin-manager/tools` | 默认 disabled |
| `plugin-manager` | 20 | `@deepseek-ai/dsh-plugin-manager` | 条件 disabled（无 `profileContext` 时关） |
| `timer` | 24 | `@deepseek-ai/cordis-plugin-timer` | 可逆定时器 |
| `hmr` | 28 | `@deepseek-ai/dsh-hmr` | 热重载（条件 disabled，见 § 5.3） |
| `llm` | 34 | `@deepseek-ai/dsh-llm` | LLM 服务定义 |
| `deepseek-llm-api-extensions` | 37 | `@deepseek-ai/dsh-deepseek-llm-api-extensions` | 官方 DeepSeek API 线上扩展 |
| `session` | 40 | `@deepseek-ai/dsh-session` | 会话日志 |
| `session-log-deepseek` | 43 | `@deepseek-ai/dsh-session-log-deepseek` | 会话日志的 DeepSeek 侧扩展 |
| `typert` / `typert-loader` / `typert-gateway` | 46 / 49 / 52 | typert 三件套 | 类型运行时注册表（gateway = api-gateway） |
| `remote-access` | 57 | `@deepseek-ai/dsh-api-remote-access` | 非 owner Peer 的方法级访问控制 |
| `session-title` / `session-title-llm` | 60 / 67 | 会话标题 | `fallbackMaxWords` 等；LLM provider 用首个 prompt |
| `user-questions` | 79 | `@deepseek-ai/dsh-user-questions` | |
| `agent` | 82 | `@deepseek-ai/dsh-agent` | Agent 注册表 |
| **`agent-default-model`** | **90** | `@deepseek-ai/dsh-agent-default-model` | **`provider: deepseek-official` / `model: deepseek-flash`** |
| `jobs` | 96 | `@deepseek-ai/dsh-jobs-local` | 后台任务 |
| `llm-retry` | 99 | `@deepseek-ai/dsh-llm-retry` | LLM 重试 |

💡 **默认模型是 `deepseek-official` / `deepseek-flash`**（0.1.5 是 `deepseek-v4-flash`）。注释说明这是"入口点创建 Agent 时的、与传输无关的默认值；设置可以提供已保存的选择，消费方在创建时读取"。

💡 **注意 `agent` 与 `agent-loop` 是两行**：前者是接口与注册表（:82），后者是默认驱动（id 行在 :532）。**把 `agent-loop` 那行换掉就能换掉整个主循环**——这是"everything is a plugin"最有力的证据。

## 5.12 `cmdline`：命令行解析

`P/boot/cmdline/src/index.ts`（239 行）：

| 符号 | 行号 | 作用 |
|---|---|---|
| `CmdlineArgs` | 27 | 参数结构 |
| `AppExit` | 36 | 退出契约 |
| `AppReady` | 45 | 就绪契约 |
| `CmdlineHost` | 67 | 宿主接口 |
| `provideCmdline()` | 84 | 把 cmdline 作为服务提供出去 |
| `internals`（stdout/stderr/stdin 可注入） | 102 | **测试可替换输出流** |
| `parseCmdline()` | 165 | 用 commander 解析 |
| `hasAction()` | 199 | 判断是否有子命令动作 |
| `configureExitAndOutput()` | 213 | 接管 commander 的退出与输出 |
| `isCommanderError()` | 234 | 识别 commander 错误 |

💡 **`internals` 对象让 stdout/stderr 可注入**——这样测试能捕获输出而不污染真实控制台。同样的手法在 `installFailLoud` 的 `FailLoudProcess` 接口（`AB/index.ts:814`）里也用了：**只声明需要的 `process` 切片**（`on` / `off` / `exit` / `stderr.write`），测试传假对象即可。

💡 **`webStartup` 服务是 flag 与配置的桥**（`web-app` patch 头部注释）：

> The web-startup plugin injects `cmdlineArgs` and provides `webStartup` as an ordinary Cordis service. Rows configured from flags inject that service, so Loader resolves their expressions only after it exists.

以及：

> `dsh --profile web --help` provides no `webStartup`, so no server binds.

即：**命令行参数通过一个普通 cordis 服务传给配置行**，配置里的 JS 表达式（[cordis 07 § 7.5](../hello-cordis/07-loader-and-configuration-tree.md) 的 `!!js` 标签）依赖该服务，因此**只在服务就绪后才求值**。`dsh --profile web --help` 不提供这个服务，所以不会真的绑定端口。

---

> 📎 **以下承接原「04 Cordis 在 DSH 中的落地」。**
> 本篇是跨仓库桥接篇：DSH 的 vendored cordis 与上游的精确差异、行号怎么读、以及 DSH 怎么用 cordis 的每一个原语（Service / effect / waterfall / isolate / Fiber）。
> 路径缩写：`P/` = `packages/`，`V/` = `vendor/cordis/src/`；上游用 `C/` = cordis 仓库的 `packages/core/src/`。行号：DSH 侧对应 `38a6a5c9`（`dsh-v0.2.2-rc.3`）；vendored cordis 4.1.0 的上游基线是 cordis `4.0.0-rc.11`（commit `0b96d9fd`）。

## 5.13 vendored 全家桶清单

DSH 不依赖 npm 上的 cordis，而是把整套 vendor 进 `vendor/` 并 rescope 到 `@deepseek-ai/*`。上游版本与 commit 以 `vendor/README.md` 的清单表为准：

| `vendor/` 目录 | rescope 后的包名 | 版本 | 上游对应 |
|---|---|---|---|
| `cordis` | `@deepseek-ai/cordis` | **4.1.0** | `cordis@4.0.0-rc.11`（commit `0b96d9fd`） |
| `loader` | `@deepseek-ai/cordis-plugin-loader` | 1.1.0 | `@cordisjs/plugin-loader@1.0.0-rc.8` |
| `include` | `@deepseek-ai/cordis-plugin-include` | 1.1.0 | `@cordisjs/plugin-include@1.1.1` |
| `hmr` | `@deepseek-ai/cordis-plugin-hmr` | 1.1.0 | `@cordisjs/plugin-hmr@1.0.15`（commit `ed8a7755`） |
| `group` | `@deepseek-ai/cordis-plugin-group` | 1.1.0 | `@cordisjs/plugin-group@1.0.0` |
| `timer` | `@deepseek-ai/cordis-plugin-timer` | 1.2.0 | `@cordisjs/plugin-timer@1.1.4` |
| `logger-console` | `@deepseek-ai/cordis-plugin-logger-console` | 1.1.0 | `@cordisjs/plugin-logger-console@1.0.0` |
| `cosmokit` | `@deepseek-ai/cosmokit` | 1.9.0 | `cosmokit@1.8.1`（commit `02e691c5`） |
| `schemastery` | `@deepseek-ai/schemastery` | 3.19.0 | `schemastery@3.18.0`（commit `cf0b7e54`） |

`pnpm-workspace.yaml` 强制指向本地（:19-21）：

```yaml
overrides:
  'extract-zip>yauzl': '3.4.0'
  '@deepseek-ai/cosmokit': 'link:vendor/cosmokit'
  '@deepseek-ai/schemastery': 'link:vendor/schemastery'
```

💡 **为什么 vendor 而不是直接依赖**：cordis 上游 README 明示 API 不稳定（[cordis 01 § 1.9](../hello-cordis/01-overview-and-design-philosophy.md)）。DSH 要在这个基础上做产品，必须锁死一个可控的副本。同时 DSH 也在给它加文档与加固（§ 5.15）。

💡 **配套的校验脚本**：`scripts/rescope-vendor.ts`（+ `.spec.ts`）做 rescope、`scripts/check-vendor-manifest.sh` 校验清单。`scripts/cordis-core-api.ts`（+ `.spec.ts`）与 `gen-cordis-api.ts` **锁住 cordis 的 API 表面**——防止无意分叉。（0.1.5 的 `scripts/verify-vendored-links.ts` 已删除。）

## 5.14 分叉有多大：以 vendor/README.md 的修改日志为准

`vendor/cordis/src` 共 **2811 行**（0.1.5 是 2693 行），其中 **`logger.ts`（276 行）是 rc.3 新增**——`LoggerService` 拆成了独立文件。逐文件（`wc -l` 实测）：

| 文件 | 行数 | 备注 |
|---|---|---|
| **`fiber.ts`** | **820** | 唯一的行为性改动所在地（§ 5.15） |
| `reflect.ts` | 436 | |
| `events.ts` | 371 | |
| `registry.ts` | 337 | |
| `utils.ts` | 294 | |
| **`logger.ts`** | **276** | 新文件 |
| `context.ts` | 146 | |
| `service.ts` | 115 | |
| `index.ts` | 16 | |

**上游差异的权威记录**：vendored cordis 4.1.0 的上游基线是 `4.0.0-rc.11`（commit `0b96d9fd`），该版本不在本仓库快照里（本地 `sources/cordis` 已同步到 `4.0.0-rc.13`），所以"比上游多几百行"这类数字不能本地复算。替代的事实源是 `vendor/README.md` 的 **Local modifications** 日志：每条差异一个稳定 ID（下一条是 V28），逐条记录分叉与理由——V6 是 fiber 生命周期加固（即 § 5.15 ①②③）、V7 是全量 JSDoc 文档化（**comment-only, no code changes**）、V9 是 HMR 模块监听器就绪修正、V11 是 `applyEntryPatches` / `entryListSchema` 导出。

![vendored cordis 与上游的差异构成](diagrams/05-vendor-diff.svg)

**vendored cordis 与上游的差异构成** — [交互版](diagrams/05-vendor-diff.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-vendor-diff.architecture.json)

- **差异主要是文档**：V7 是 comment-only 的 JSDoc 补全，动机是官网 API 参考生成器对未文档化成员直接报错 · 分叉语义集中在 V6 一条 · 阅读上游 cordis 源码仍然有效
- **有效改动集中在 fiber.ts**：V6 的三处加固全在 teardown 与配置更新路径 · 其余文件保持上游语义
- **唯一必须注意的坑**：行号与上游不对应 · 引用源码位置时要以 vendored 版为准 · 读法见 § 5.16

## 5.15 fiber.ts 的三处实质加固

这是 DSH 对 cordis 唯一的行为性改动（V6），全在 teardown 与配置路径上。

### ① `effectInertia` + `runDisposable`

![effectInertia 让 dispose 等待在途任务](diagrams/05-effect-inertia.svg)

**effectInertia 让 dispose 等待在途任务** — [交互版](diagrams/05-effect-inertia.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-effect-inertia.architecture.json)

- **公开 disposer 仍是单发，但可加入已在途的清理**：`V/fiber.ts:112` 的 WeakMap 把 disposer 映射到在途清理 · 结构性 owner 与外层 effect 能加入别人已开始的 cleanup（runDisposable，:114）
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

💡 **它用了上游标记为 `@deprecated` 的 `events.dispatch()`**（[cordis 06](../hello-cordis/06-event-system-and-waterfall.md)）——因为它需要**拿到 callback 列表自己遍历**，而不是让 `emit` 一把跑完。V7 记录甚至注明："上游 `EventsService.dispatch()` 的弃用标注被刻意省略：DSH 要逐个枚举 callback 以独立兜底每个观察者的失败，类型化的派发方法提供不了这个。"

💡 **[05 § 5.5](05-startup-and-cordis-runtime.md) 的 `boot()` 直接依赖这个加固**：它的注释写"Root-fiber disposal contains cleanup failures per observer (Cordis fiber.ts hardening) and a repeated call returns the settled single-shot result, so this await cannot reject and replace `cause`"。

### ③ `_configRevision`：配置代次计数（rc.3 重写了 0.1.5 的方案）

0.1.5 的做法（`_config` 字段保存原始配置 + 私有 `_resolveConfig()`，每次 reload 前重新解析）已整体替换为**公开解析原语 + 代次计数**：

| 位置 | 内容 |
|---|---|
| `V/fiber.ts:210` | `private _configRevision = 0` —— 配置代次计数 |
| `V/fiber.ts:255` | 激活路径里 `const config = this.resolveConfig(this.config)` —— **每次激活仍重新解析** |
| `V/fiber.ts:649` / `:654` | `get/set rawConfig`：原始（未求值）配置的存取面；setter 写入即 `this.ctx.fiber._configRevision++`（`:656`） |
| `V/fiber.ts:663` | `get effectiveConfig`：最近一次成功发布的结果 |
| `V/fiber.ts:676` | `resolveConfig(config)`：**公开**方法，走 `internal/config` waterfall + runtime schema 校验，但不发布结果 |
| `V/fiber.ts:783` | `update()`：`++fiber._configRevision`（`:791`）记录本次更新的代次 |
| `V/fiber.ts:798-803` | `publish()`：仅当 `_configRevision`、epoch、`committed` 三者都未变才提交 `_effectiveConfig` —— **竞态判定** |

💡 **与 0.1.5 的两点差异**：
1. **重新解析从 reload 的内部细节变成可组合原语**：`resolveConfig()` 公开，插件经 `internal/config` waterfall 就能参与解析；原始配置有了正式的 `rawConfig` 存取面，"已生效配置"有了 `effectiveConfig` 读取面。
2. **新增竞态防护**：`update()` 触发的 restart 是异步的，期间若又有一次 update，旧回调的 `publish()` 会因代次（或 epoch、committed）不匹配而放弃提交——**过期的解析结果不会被发布出去**。`set rawConfig` 也会递增代次，让在途发布同样失效。

💡 **上游只在构造时校验一次的老问题依然由"激活时重新解析"解决**（`:255`）。**为什么需要**：DSH 的配置里大量使用 cordis 的 JS 表达式（`!!js` 标签，[cordis 07 § 7.5](../hello-cordis/07-loader-and-configuration-tree.md)），而表达式的求值依赖当时可用的服务。`web-app` patch 的注释说得很清楚：

> Rows configured from flags inject that service, so Loader resolves their expressions only after it exists.

**一行配置在依赖服务出现前后求值出的结果不同** → 必须在每次激活时重新解析，而不能沿用首次构造时的结果。

## 5.16 行号怎么读

同一符号在 vendored `V/` 的行号（`38a6a5c9` 实测；上游列无法本地复核，理由见 § 5.14）：

| 符号 | `V/` 行号 |
|---|---|
| **fiber.ts** | |
| `effectInertia` / `runDisposable` | **112** / **114** |
| `emitPluginDisposed()` | **120** |
| `FiberState` 枚举 | **147** |
| `class Fiber` | **184** |
| `_configRevision` | **210** |
| `assertActive()` | 357 |
| `effect()` 实现 | **424** |
| `_checkImpl()` | 603 |
| `_refresh()` | 617 |
| `get/set rawConfig` | 649 / 654 |
| `resolveConfig()` | 676 |
| `_reload()` | 681 |
| `_unload()` | 712 |
| `await()` | 754 |
| `restart()` | 768 |
| `update()` | **783** |
| **reflect.ts** | |
| `static handler` | **143** |
| `provide()` | **291** |
| `notify()` | **335** |
| **registry.ts** | |
| `class RegistryService` | **195** |
| `plugin()` | **316** |
| **events.ts** | |
| `class EventsService` | **130** |
| `waterfall()` | **246** |
| `interface Events` | **334** |
| **service.ts / context.ts** | |
| `abstract class Service` | 11 |
| `class Context` | 42 |

💡 **上游偏移不可本地换算**（上游基线 rc.11 不在快照内，且历史经验显示偏移随文件推进非线性增长）。**建议一律按符号名检索**——这也是本文档集所有篇目的通用建议。

## 5.17 DSH 怎么用 cordis 的每个原语

> 📐 **配套可跑示例**：[`M12 · Cordis 运行时与装配树`](../../dsh-lab/examples/cordis-seam-demo/src/index.ts) 在真实 `@deepseek-ai/cordis` 上逐条演示本节说的原语 ——
> [M12.1 · 可逆 effect](../../dsh-lab/examples/cordis-seam-demo/src/index.ts)：插件卸载时它注册的 section 与监听器随 fiber 一起回收；
> [M12.2 · 依赖注入：缺席即不启动](../../dsh-lab/examples/cordis-seam-demo/src/index.ts)：依赖不满足时 `apply` 根本不被调用，插件停在 pending；
> [M12.3 · 行 id 与 patch 覆盖](../../dsh-lab/examples/cordis-seam-demo/src/index.ts)：同一行 id 在后一层 patch 里被整段替换；
> [M12.4 · 失败即大声](../../dsh-lab/examples/cordis-seam-demo/src/index.ts)：非法配置在装配期就抛错，不允许带病运行。
>
> ⚠️ 与旧版示例的差别：配套工程**没有**逐一跑 `parallel` / `serial` / `bail` / `waterfall` 五种派发模式的阶段——那五种模式的覆盖在 cordis 自身的测试里，本模块聚焦的是装配语义。


![每个能力都是一个 cordis Service](diagrams/05-services-as-plugins.svg)

**每个能力都是一个 cordis Service** — [交互版](diagrams/05-services-as-plugins.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-services-as-plugins.architecture.json)

- **全部是普通 cordis Service**：每个都通过 provide 注册到 ctx 上 · 都可以被 inject 声明为依赖 · 都能被上层 patch 换成别的实现
- **没有一个是特权的**：连 agentLoop 也只是一个 Service · 换掉它就换掉整个 turn/step 语义 · 这是没有特权内核的最终证据
- **可跑的最小示例**：配套工程 dsh-lab 以 21 个独立示例组织（cordis 6 + dsh 15）· 例如 cordis-seam-demo 演示可逆 effect、行 id 覆盖与失败即大声 · 装的是真实发布的 npm 包（0.2.2-rc.3）· 装配全部写在各示例自己的 `cordis.patch.yml` 里，没有一行是代码里手工 new 出来的

## 5.18 DSH 在 cordis 之上加的一层：`Scoped<T>` 与 `core/scope`

> 📐 **配套可跑示例**：[`M01.4 · 按 agent 收紧可见工具`](../../dsh-lab/examples/dsh-tool-pipeline-demo/src/index.ts) 是 scope 的最小落点 ——
> 它在 `ctx.agents.create()` 的 `setup` 里对 **agent 作用域**调 `agentCtx.tools.restrict({ allow: [...] })`，
> 并断言"收紧只影响这个 agent 的下一轮装配、不外溢到全局"：全局工具集合条数不变。
> 与旧版示例不同：配套工程**没有**在 plain context 上调用 `restrict` 去撞那条 fail-closed 报错——
> 它改用"收紧是否外溢"这个更贴近真实用法的断言。


cordis 的隔离粒度是 **realm**（配置级）。DSH 需要更细的粒度：**每个 Agent 一套注册**。这就是 `core/scope`（471 行）。

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
| `scripts/cordis-core-api.ts` / `scripts/verify-cordis-config.ts` / `scripts/cordis-yaml.ts` | 锁 API 表面 / 校验配置访问 / YAML 方言工具 |
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
| `waterfall` | `tools/*`、`agent/pre-step`、`agent/request`（已标 deprecated）、`agent/request-error`、`llm/stream` | [07](07-request-pipeline-llm-tools-and-prompts.md) [06](06-agent-loop-and-session-log.md) [07](07-request-pipeline-llm-tools-and-prompts.md) |
| `serial` | `agent/created`（创建即初始化钩子）、`agent/turn-stopping`（无 `next()`） | [06](06-agent-loop-and-session-log.md) |
| `emit` | `session/event` 广播、`agent/assistant-stream` 流式帧 | [06](06-agent-loop-and-session-log.md) |
| `isolate` realm | agent preset 里给 provider + consumer 一个 realm | [03](03-capability-seams-and-services.md) |
| `Group`（配置分组） | 把 provider 与 consumer 圈到一个 realm 的手段 | [05 § 5.6](05-startup-and-cordis-runtime.md) |
| `include` + `applyPatches` | profile / bundle 分层 | [05 § 5.2](05-startup-and-cordis-runtime.md) |
| `hmr` | 开发期热重载（base 行条件 disabled：profile 配置默认热重载，模块根选进） | [05 § 5.3](05-startup-and-cordis-runtime.md) |
| `timer` | 可逆定时器（`ctx.debounce` 等） | — |
| `logger` | 全仓日志（rc.3 起在 vendor 内是独立文件 `logger.ts`） | — |
| Standard Schema（`Config`） | 配置校验；DSH 用 `schemastery`（vendored） | [09](09-host-runtime-and-storage.md) |

---

**上一篇** ← [04 扩展与生态](04-extensions-and-ecosystem.md) ｜ **下一篇** → [06 Agent 循环与会话日志](06-agent-loop-and-session-log.md)：751 行主循环逐行拆解 + append-only 会话日志的不变量。
