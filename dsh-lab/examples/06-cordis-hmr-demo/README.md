# 06 · Cordis 的 HMR 示例

本示例演示 HMR 的原位替换：改一行插件代码，进程不重启、Fiber 不拆建、配置不丢、无关插件不受影响。装配写在 cordis.yml 里，插件由 loader 动态 import——正是 hmr 能追踪的形态；hmr 行在 yml 里声明为禁用，只在 Node 分支运行时启用。

旧版「先 `registry.delete` 再注册新 Fiber」的模型已经删除：rc.13 是**缓存级事务 + `registry.replace()` 原位替换**，同一个 Fiber 对象只换 runtime 与 inject，行句柄拿到的引用持续有效。示例五个场景：基线、改文件原位替换 + 依赖者级联、导出损坏 aborted 回滚、修好重试、host module skipped。Node 与 Bun 各跑一条路径，演示的是同一条核心缝。

## 1 改代码时，三种做法各有代价

1. **重启进程**：状态全丢，连接全断，最贵。

2. **拆了重建 Fiber**：新 uid 意味着依赖方 epoch 全变、配置写回判定容易写坏文件（旧版 loader case 4 就是为此打的补丁）。

3. **全量重载**：无关插件也跟着重新初始化，副作用重来。

> 换之前先校验，换的时候不动身份，换错了按 unit 回滚。

rc.13 把这三个代价分别消掉：事务只驱逐**改动模块及其 importer**（反向 BFS）；替换复用旧 Fiber（uid 不变）；级联只波及 inject 了该服务的 Fiber（epoch 机制自带）。

## 2 机制：缓存级事务 + 原位替换

**入口是 `ctx.hmr.reconcile(callback)`**（hmr 包 index.ts:286-301）：callback 是事务体，返回要调和的根路径（绝对路径）。事务串行排队，`AsyncLocalStorage` 拒绝嵌套。七步机制（hmr 包 README § Mechanism 就是规格书）归并成三个阶段：

- **Stage 1 先校验后动手**：sweep 失败 job → 失效解析缓存 → 匹配 changed → 反向 BFS 驱逐（:335-342）→ 发现 stale 组件并按并查集分 unit → 全部重新 import 并当场校验导出（:617-661）。失败只恢复该 unit 的缓存，**不动任何 Fiber**。
- **Stage 2 原位替换**：`registry.replace(old, new)` 同步一步（:734；core 包 registry.ts:187-211），对旧 runtime 的每个 fiber 调 `fiber._replace(target, inject)`（core 包 fiber.ts:401-416）：只换 runtime 与 inject、清 `_error`、`_revision++`。
- **Stage 3 级联与 settle**：`_refresh()` 以 `_revision` 起始新 epoch（fiber.ts:420），依赖方 epoch 编码了被依赖 impl 的 uid，自动重载；统一 await 后返回 `Hmr.Result { settled, aborted, skipped }`。**Stage 3 失败不回滚**——FAILED 与冷启动语义一致，下次文件变化重试。

![HMR 换代：缓存驱逐到原位替换（rc.13）](diagrams/hmr-swap.svg)

交互版：[hmr-swap.html](diagrams/hmr-swap.html) · IR 源：[hmr-swap.sequence.json](diagrams/hmr-swap.sequence.json)

- **先校验后动手**：Stage 1 全部新模块 import 成功并校验导出形态；失败按 unit aborted 并恢复缓存；不动任何 Fiber，旧组件继续运行。
- **原位替换而非拆建**：registry.replace 复用旧 runtime 的 fiber 列表；_replace 只换 runtime 与 inject，_revision++；Fiber 身份、config、entry 全部不变。
- **级联是免费的**：epoch 以 _revision 起始，_refresh 必产新 epoch；只有 inject 了该服务的 Fiber 会重载；HMR 代码里没有一行处理依赖者。

**hostModules 划出「重启才生效」的边界**：`closure()` 从 `process.argv[1]` 沿静态依赖边遍历（:43-56、:245-259），主入口静态可达的模块全是 host——改了只记 `skipped`（reason `host-module`），是否重启交给宿主。cordis CLI 的主入口是 bin.js，插件由 loader 动态 import，天然不在 host 集合里；若自己写主入口并静态 import 插件，reconcile 它只会得到 skipped。动态 `await import()` 不进静态依赖边，才是可热替换的组件入口。

**运行时边界**：hmr 要摸 Node 内部模块加载器，`--expose-internals` 或 `node-addon-require-builtin` 二选一，且 Node ≥ 22；构造函数拿不到 internals 直接抛 `loader internals are unavailable...`（hmr 包 index.ts:166-168），`ModuleLoader.fromInternal()` 要求 Node ≥ 22（runtime/internal.ts:161），**没有降级路径**。Bun 没有这套内部接口，故本示例 Bun 分支不启用 hmr 行，改演示 hmr 自己用的那条 core 缝：新模块身份重导入 + 导出校验 + `registry.replace()`。两条路径的 Fiber 语义完全相同。「双运行时」不等于「双运行时都装 hmr」：把 hmr 行声明为 `disabled: true`、只在 Node 分支启用，就是把这个边界写进了装配清单。

## 3 基线

greeter / consumer / clock 三行在 cordis.yml 里声明，loader 动态 import 挂载：greeter（provide greeter）、consumer（`export const inject = ['greeter']`）、clock（无依赖）。模块 namespace 整体就是组件——`apply` 与 `inject` 都是导出（namespace 是冻结对象，不能事后挂属性，依赖清单只能随导出携带），`_discover` 的 `unwrapExports`（:128-135）与 `registry.replace` 认这种形态。runner 再 `await import()` 同一个 URL 拿到同一个 namespace（Node 与 Bun 的模块缓存都按 URL 键控），并记录 greeter 行 innerFiber 的 uid 供后续比对。

## 4 改文件 → reconcile：原位替换 + 级联

把 greeter.ts 的 `tag` 从 v1 写成 v2，`reconcile(() => [greeterFile])`。Node 路径：`settled = 1` 且该 Fiber uid 与基线相同——确认是原位替换；consumer 的 apply 计数 #2 且看到 v2——确认发生了 epoch 级联；clock 保持 #1——确认级联只波及依赖者。Bun 路径：写一个新路径的修订文件重导入（缓存原因见下），`registry.replace` 返回的 fibers uid 同样不变。

Bun 分支有个缓存细节：**Bun 的模块缓存不吃 query 后缀**——改文件后 `import(url + '?v=2')` 仍返回旧模块（实测探针 `QUERY_BUST v1 v1`）；Node ESM 按完整 URL（含 query）键控缓存则天然失效。故 Bun 分支每修订写一个**新路径**（`.greeter-rN.ts`）再 import——等价于 Node 缓存驱逐后产生的新模块身份，结束统一 `rm` 清理。

事务还有两条调度约束：`reconcile` 排队执行（`_queue`），事务体内再开事务直接 reject（:288-290）；watch 批与批也串行，aborted unit 的文件 retained 到下一批（:226-229），否则修复它的改动会被漏掉。

## 5 导出损坏 → aborted：旧组件继续运行

把文件写成 `export const apply = 42`。Node：Stage 1 校验导出形态失败 → `aborted = 1, settled = 0`，首错 `invalid component at ... expect function or object with an "apply" method`；缓存已恢复，greeter 仍是 v2。Bun：重导入后手动做同一条校验（`typeof ns.apply === 'function'`），不通过就拒绝 replace——「先校验后动手」在 core 缝上手工复现。

## 6 修好 → 重试成功

写 v4 再 reconcile：`settled = 1`，tag = v4，consumer #3。aborted 不是终态：watch 路径会把相关文件 retained 到下一批（:226-229），程序路径下一次 reconcile 自然重试。另一个刻意选择：**Stage 3（换 Fiber 阶段）失败不回滚**——组件保持 FAILED，与冷启动失败表现一致，保留注册、父级与 config，下次文件变化重试（:744-748 注释）。可靠性边界全压在 Stage 1 的「先校验后动手」上；回滚到一个已知有问题的旧实例没有意义。

## 7 host module → skipped

`reconcile(() => [cordis/bin.js 的路径])`：bin.js 是 CLI 主入口，静态闭包里的模块全是 host → `skipped[0].reason = 'host-module'`，缓存恢复、进程不动。runner 自己由 loader 动态导入，不在 host 集合——这也是为什么场景 ② 改 greeter.ts 能成功替换。Bun 分支没有 hostModules 概念（那是 hmr 在 Node 缓存层的判定），打印说明并以 clock 计数佐证无关组件不受影响。

## 8 运行hmr示例

装配全部写在 `cordis.yml` 里，hmr 行初始禁用：

```yaml
# HMR 示例的装配清单：插件由 loader 动态 import，正是 hmr 能追踪的形态
- id: greeter
  name: ./src/plugins/greeter.ts    # 被改写的目标插件
- id: consumer
  name: ./src/plugins/consumer.ts   # 依赖 greeter：换代时经 epoch 级联
- id: clock
  name: ./src/plugins/clock.ts      # 与 greeter 无关：apply 计数应保持 #1
- id: hmr
  name: '@cordisjs/hmr'             # 只在 Node 启用（构造需要 --expose-internals）
  disabled: true
  config:
    watch:
      enabled: false                # 演示手动 reconcile，不开文件 watch
- id: runner
  name: ./src/index.ts              # 场景驱动：改文件 + reconcile / registry.replace
```

`npm start` 是带 `--expose-internals` 的 cordis CLI：读 `cordis.yml` 装配，同时把 Node 内部模块加载器暴露给 hmr。

`runner` 行挂的 `src/index.ts` 也是一个普通插件。Node 分支先经行句柄启用 hmr 行，再改文件、reconcile；Bun 分支走 core 缝：

```ts
export const name = 'runner'
export const inject = ['loader']

async function run(ctx: Context) {
  await ctx.loader.await()
  // 与 loader 导入的是同一个 URL：模块 namespace 即组件身份，replace 认它
  const greeter = await import(greeterUrl.href)
  const greeterFiber = row(ctx, 'greeter').innerFiber!

  if (!isBun) {
    // hmr 行在 cordis.yml 里声明为 disabled: true，Node 分支运行时启用
    await row(ctx, 'hmr').update({ disabled: false })
    await ctx.loader.await()
    const hmr = ctx.get('hmr')!
    await write('v2')
    const r2 = await hmr.reconcile(() => [greeterFile])
    // ……③ aborted / ④ 重试 / ⑤ host module……
  } else {
    // Bun：新修订新 URL 重导入 → registry.replace（同一条缝）
  }
}
```

在本机复现只需要四条命令：

```bash
npm install             # cordis、loader 依赖与 @cordisjs/hmr
#
npm start               # Node：--expose-internals + cordis CLI，走完整 hmr 事务
npm run start:bun       # Bun：cordis CLI，走 core registry.replace 缝
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1）。开头三行插件日志来自装配阶段；uid 的具体数值取决于 CLI 基础设施建了多少 fiber，重要的是前后不变：

```text
   [greeter] apply tag=v1
   [clock] apply #1（与 greeter 无关）
   [consumer] apply #1 sees greeter = v1
运行时：Node（@cordisjs/hmr reconcile 事务）
① 基线：greeter uid = 6
   [greeter] apply tag=v2
   [consumer] apply #2 sees greeter = v2
② 改文件 → reconcile：原位替换，Fiber 身份不变，依赖者经 epoch 级联
   settled = 1 ，greeter uid 不变 = true ，tag = v2
③ 导出损坏 → aborted：恢复缓存，旧组件继续运行
   aborted = 1 ，settled = 0 ，tag 仍 = v2
   首错: Error: invalid component at src\plugins\greeter.ts, expect function or object with an "apply" method, received object
   [greeter] apply tag=v4
   [consumer] apply #3 sees greeter = v4
④ 修好文件 → 再 reconcile：aborted unit 重试成功
   settled = 1 ，tag = v4
⑤ host module（cordis/bin.js 主入口）→ skipped：重启后才生效
   reason = host-module ；clock 与 greeter 无关，apply 计数见上方日志
演示结束（插件文件已恢复原状）
```

`npm run start:bun` 的实测输出（Bun 1.4.4）：

```text
   [clock] apply #1（与 greeter 无关）
   [greeter] apply tag=v1
   [consumer] apply #1 sees greeter = v1
运行时：Bun（core registry.replace 缝）
① 基线：greeter uid = 7
② 新修订新 URL 重导入 → registry.replace（HMR Stage 2/3 同一条缝）
   [greeter] apply tag=v2
   [consumer] apply #2 sees greeter = v2
   replaced fibers = 1 ，uid 不变 = true ，tag = v2
③ 导出损坏 → 先校验后动手：拒绝 replace，旧组件继续运行
   导出校验通过 = false ，tag 仍 = v2
④ 修好 → 重导入 → 再 replace
   [greeter] apply tag=v4
   [consumer] apply #3 sees greeter = v4
   tag = v4
⑤ hostModules/skipped 是 hmr 在 Node 缓存层的概念；Bun 演示 core 缝；clock 不受影响见日志
演示结束（插件文件已恢复原状）
```

两条路径的换代序列一致（greeter v1→v2→v4、consumer #1→#2→#3、clock 恒 #1）；差异在事务报告字段（Node 有 Result，Bun 手工校验）与装配期日志的先后（两个运行时的 init task 调度顺序不同）。演示结束 greeter.ts 恢复 v1、Bun 修订临时文件删除，仓库不留痕。

装配路径依赖 cordis 的四个可选 peer 包：`@cordisjs/loader`、`@cordisjs/include`、`@cordisjs/fs`、`@cordisjs/fs-node`，加上 `@cordisjs/hmr`，都已写进 `package.json`。

## 9 源码视角：原位替换与事务在源码里长什么样

本篇摘录取自本示例锁定的 **cordis 4.0.0-rc.13** 与 **@cordisjs/hmr 2.0.0-rc.0** 编译产物（`node_modules/…/lib/index.js`，装完依赖可直接读）。注意 `registry.replace` / `fiber._replace` 是 rc.13 新增的缝，本仓 vendored 的 4.1.0 fork（rc.11 基线）里没有它们——前五篇引用的 fork 源码与本篇不重叠。逐行精读见 [HMR](../../../docs/hello-cordis/08-hmr.md)。

### 9.1 registry.replace：认模块身份，复用 fiber 列表

```js
replace(oldComponent, newComponent) {
  const source = this._forward(oldComponent);
  if (!source) throw new Error('invalid component, expect function or object with an "apply" method, received ' + typeof oldComponent);
  const key = this.resolve(newComponent);
  if (!key) throw new Error('invalid component, expect function or object with an "apply" method, received ' + typeof newComponent);
  // …alias 与 runtime 迁移省略…
  const fibers = runtime ? [...runtime.fibers] : [];
  if (!fibers.length) return fibers;
  target ??= this._create(key, newComponent);
  for (const fiber of fibers) {
    fiber._replace(target, Inject.resolve(newComponent.inject));
  }
  return fibers;
}
```

组件身份就是模块 namespace（[05 篇 9.1](../05-cordis-loader-demo/README.md#91-一行配置的最后一步registryuse) 里 runtime 以 callback 为键）：replace 按旧 namespace 找到 runtime，把它名下的 fiber 逐个交给新 runtime——**没有 new Fiber，没有 dispose**。这就是场景 ② uid 不变、行句柄引用持续有效的全部原因。Bun 分支手工调的也是这个函数。

### 9.2 fiber._replace：换内容不动身份，级联是免费推论

```js
_replace(runtime, inject) {
  if (runtime !== this.runtime) {
    this._remove();
    this._remove = runtime.fibers.push(this);
    this.runtime = runtime;
  }
  this.inject = inject;
  this.context.emit("internal/replace", this);
  this._store = Object.create(null);
  for (const name of Object.keys(this.inject)) {
    this._checkImpl(name);
  }
  this._error = void 0;
  this._revision++;
  this._refresh();
}
```

逐行看：把自己从旧 runtime 的列表摘到新的；换 inject 清单；重建依赖快照 `_store`；清掉旧的 FAILED 错误；`_revision++` 后 `_refresh()`。uid、config、父级、entry 一个都没碰。而 epoch 指纹以 `_revision` 起始（[02 篇 8.2](../02-cordis-fiber-demo/README.md#82-inertia-单飞与原地复活)）——修订号变了，自己的 epoch 必变，provide 的服务 impl 换新 uid，依赖者的 epoch 跟着变，自动卸载再重装。**HMR 代码里没有一行处理依赖者**，场景 ② 的 consumer #2 与 clock 恒 #1 都是 epoch 机制的免费推论。

### 9.3 Stage 1：先校验后动手，失败只恢复缓存

hmr 重新 import 每个 stale 组件后当场校验（`@cordisjs/hmr lib/index.js`）：

```js
const exports = await load(stale.url);
if (!this.ctx.registry.resolve(exports)) {
  throw new Error(`invalid component at ${this._relative(stale.url)}, expect function or object with an "apply" method, received ${typeof exports}`);
}
```

校验失败记 `attempt.failed = true`，随后按并查集 unit 分类：

```js
const aborted = units.filter((unit) => unit.attempts.some((attempt) => attempt.failed));
const skipped = units.filter((unit) => !aborted.includes(unit) && unit.attempts.some((attempt) => attempt.skip));
const committed = units.filter((unit) => !aborted.includes(unit) && !skipped.includes(unit));
// …
backup.restore(restored);
```

`backup.restore` 只恢复 aborted/skipped unit 涉及的模块缓存——**到这一行为止没有任何 Fiber 被碰过**。场景 ③ 的 `export const apply = 42` 就死在第一个 if：`registry.resolve` 认不出组件形态，unit 整体 aborted，旧 greeter 继续跑。Bun 分支的 `typeof ns.apply === 'function'` 是这条校验的手工等价物。

### 9.4 Stage 3：替换失败不回滚

committed unit 逐个 replace，异常只 warn 不抛：

```js
try {
  const replaced2 = this.ctx.registry.replace(component, attempt.replacement);
  if (!replaced2.length) continue;
  this.ctx.logger.info("reload component at %C", path);
  fibers.push(...replaced2);
} catch (error) {
  this.ctx.logger.warn("failed to reload component at %C", path);
  this.ctx.logger.warn(error);
}
// …
await Promise.all(fibers.map((fiber) => fiber.await().catch(() => {})));
result.settled = fibers.filter((fiber) => fiber.uid !== null);
```

新组件 apply 抛错时 fiber 落 FAILED（[02 篇 8.5](../02-cordis-fiber-demo/README.md#85-failed-为什么不是终态)），与冷启动失败语义一致：保留注册、父级与 config，等下次文件变化重试。可靠性边界全压在 Stage 1——回滚到一个已知有问题的旧实例没有意义。

### 9.5 host module：静态闭包划边界

reconcile 开头对每个根路径判定（同文件）：

```js
result.skipped.push({ urls: [url], reason: _Hmr.SkipReason.HostModule });
```

判定依据是 `closure()` 从 `process.argv[1]` 沿静态 import 边遍历出的集合：主入口静态可达的模块改了只记 skipped（场景 ⑤ 的 bin.js），动态 `await import()` 的插件不在集合里（场景 ② 的 greeter.ts）。「哪些能热换」不是配置出来的，是模块图的拓扑性质。

## 10 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证，start 脚本已带 `--expose-internals`）或 Bun 1.4.4 以上、npm。cordis 直接运行 TypeScript（Node 依赖原生类型擦除，Bun 自带转译），没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
cordis-hmr-demo/
├── package.json          # start 带 --expose-internals（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── cordis.yml            # 唯一装配入口：三插件 + hmr（初始禁用）+ runner
├── .gitignore
├── src/
│   ├── index.ts          # runner 插件：Node hmr 事务 / Bun core 缝双分支
│   └── plugins/
│       ├── greeter.ts    # provide greeter，tag 写在文件里（被改写的目标）
│       ├── consumer.ts   # export const inject = ['greeter']
│       └── clock.ts      # 无依赖对照组
└── diagrams/             # hmr-swap 时序：SVG / 交互 HTML / IR 源
```

### package.json

```json
{
  "name": "cordis-hmr-demo",
  "private": true,
  "type": "module",
  "description": "HMR 原位替换：Node 走 @cordisjs/hmr reconcile 事务（--expose-internals），Bun 走 core registry.replace 同一条缝。双运行时。",
  "scripts": {
    "start": "node --expose-internals node_modules/cordis/bin.js",
    "start:bun": "bun node_modules/cordis/bin.js",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@cordisjs/fs": "2.0.0-rc.0",
    "@cordisjs/fs-node": "0.1.0",
    "@cordisjs/hmr": "2.0.0-rc.0",
    "@cordisjs/include": "2.0.0-rc.0",
    "@cordisjs/loader": "1.0.0-rc.10",
    "cordis": "4.0.0-rc.13"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "7.0.2"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

### src/plugins/greeter.ts

```ts
import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

export const tag = 'v1'

export function apply(ctx: Context) {
  console.log(`   [greeter] apply tag=${tag}`)
  ctx.provide('greeter', { tag })
}
```

### src/plugins/consumer.ts

```ts
import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

/** inject 以导出常量声明：模块 namespace 整体作为组件时携带依赖清单。 */
export const inject = ['greeter']

let applies = 0

export function apply(ctx: Context) {
  applies++
  console.log(`   [consumer] apply #${applies} sees greeter = ${ctx.greeter.tag}`)
}
```

### src/plugins/clock.ts

```ts
import type { Context } from 'cordis'

/** 与 greeter 无任何依赖边：HMR 换代时 epoch 不变，apply 计数应保持 #1。 */
let applies = 0

export function apply(ctx: Context) {
  applies++
  console.log(`   [clock] apply #${applies}（与 greeter 无关）`)
}
```

### src/index.ts

正文第 8 节展示的是节选；完整文件就在本目录 [src/index.ts](src/index.ts)，由 cordis.yml 的 runner 行挂载，Node 分支走 hmr reconcile 事务，Bun 分支走 core registry.replace 缝。脚手架各写法的含义见 [01 篇第 5 节的速览表](../01-cordis-seam-demo/README.md#脚手架速览照抄即可原理在-05-篇展开)。

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `cordis`、`@cordisjs/loader` 与 `@cordisjs/hmr`。
2. `npm start` 打印 ①～⑤ 五段，末行「演示结束（插件文件已恢复原状）」，与第 8 节 Node 实测输出一致（uid 数值可能不同，前后不变即可）。
3. `npm run start:bun` 走 core 缝，换代序列与 Node 一致。
4. `npm run typecheck` 无输出、退出码 0；`src/plugins/greeter.ts` 恢复 v1，无 `.greeter-rN.ts` 残留。

示例不依赖任何环境变量、端口或外部服务。Node 路径要求未带 `--preserve-symlinks`（模块 URL 须为 realpath）。

## 11 小结

HMR 的可靠性不在「换得快」，而在「换之前先校验、换的时候不动身份、换错了能按 unit 回滚」。rc.13 把这三件事分别压在 Stage 1 的导出校验、`registry.replace` 的原位语义、`ModuleBackup.restore` 的选择性恢复上；级联重载则完全交给 Fiber 的 epoch 机制，HMR 本体一行依赖者代码都没有。Node 与 Bun 两条路径最终落到同一条缝上：前者多了一层 Node 模块缓存事务，后者直接用 core 的 `registry.replace()`。到这里 cordis 的六个示例就都跑完了；接下来是 dsh 侧的示例。