# Cordis 的 loader 示例：配置树到 Fiber

> 版本基线：`cordis` 4.0.0-rc.13、`@cordisjs/loader` 1.0.0-rc.10、`@cordisjs/include` 2.0.0-rc.0、`@cordisjs/group` 1.0.1、`@cordisjs/fs` 2.0.0-rc.0、`@cordisjs/fs-node` 0.1.0。
> 双运行时实测：Node v26.12.1 与 Bun 1.4.4 输出逐行一致；`tsc`（typescript 7.0.2）0 错误。
> 源码行号以 `sources/cordis/packages/loader`（下称 `L/`）与 `packages/include`（下称 `I/`）为准。

seam 示例里装配是手写的：`ctx.use(plugin)` 一行一个插件。loader 把这件事变成**声明式**：一份配置树（yml 或内存数组），每行一个 Entry，每个 Entry 背后一层或两层 Fiber。group、disabled、inject、isolate 全部可以写在配置行上，运行时还能 `update()` 打补丁——只改 config 时 Fiber 不重建。

示例用五个场景演示这条链路：配置树长什么样、patch 与重载的边界、配置层 inject 的等待语义、配置层 isolate 的 realm、disabled 开关的卸载重装。

## 手写 ctx.use() 做不到的三件事

1. **依赖缺席时等待**。插件读 `ctx.greeter`，但 greeter 还没上线——手写装配只能自己排序或自己监听事件。
2. **不重启进程改配置**。改一个 tag 就要 dispose 再 use，副作用全重来。
3. **声明式分组与禁用**。哪些插件属于一组、哪行暂时不跑，手写代码里全是 if。

loader 的答案是三层对象：**配置行（EntryOptions）→ Entry（树节点 + 持久化语义）→ Fiber（运行态）**。配置行是数据，Entry 管树结构与 commit，Fiber 管生命周期（见 [fiber 示例](../cordis-fiber-demo/README.md)）。配置层的 `inject` 还会把 Fiber 拆成 outer/inner 两层：outer 等依赖，inner 跑 `apply`。

## 机制：两棵树、两层 Fiber、一个 diff

**两棵树的 commit 语义不同。** `Loader extends EntryTree`，root 树的 `commit` 是空实现——纯内存，不写任何文件（`L/index.ts:175-177`）。`Include` 也 `extends EntryTree`，自建子树：`EntryTree` 构造时把 `entry.subtree = this`（`L/config/tree.ts:79-84`），于是 include 那行 Entry 挂着一棵子树；子树的 `commit` 会记 journal 并写回 yml 文件（`I/index.ts:357-360`、`:551-554`）。`tree.entries()` 生成器递归子树（`tree.ts:90-96`），`resolve('file:watcher')` 按 `:` 分段经 `store[part].subtree` 下降（`tree.ts:121-132`）。

**运行时 patch 走 `internal/commit`。** 插件侧 config 变化先改 `entry.options.config` 再调 `tree.commit`（`L/index.ts:105-112`）——root 树上这一步是 no-op，所以内存装配不污染文件。

**Entry.update 的决策分支**决定动还是不动 Fiber：

![Entry.update 的决策分支](diagrams/entry-update.svg)

[交互 HTML](diagrams/entry-update.html) · [IR 源](diagrams/entry-update.architecture.json)

- **create 决定合并语义**：create 为真表示新建，整份 options 直接替换；否则是增量更新，逐字段合并；值为空的字段按删除处理，而不是写入空值。
- **三条出路互斥**：禁用则销毁 Fiber 并结束；未运行则走首次 init；已运行则算 diff 再决定动作。
- **diff 决定重载还是 patch**：只有配置真的变化才动 Fiber；仅 config 字段变化可以就地 patch（场景 ② uid 不变）；涉及 name 或 inject 变化则必须重载。

## 场景 ①：配置树 → Entry → Fiber（group 与 disabled）

`cordis.yml` 里一个 `@cordisjs/group` 行包两行 watcher：`watcher` 正常、`sleeper` 带 `disabled: true`。装配入口与官方 `bin.js` 同构：`ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'`，依次 `use(Fs)` / `use(NodeFs)` / `use(Loader)`，再 `create({ name: '@cordisjs/include', config: { path: './cordis.yml' } })`，`await ctx.loader.await()` 等全部 init task。

遍历 `ctx.loader.entries()` 打印每行的 `disabled` 与 Fiber 状态：group 行本身 ACTIVE；`sleeper` 的 `disabled=true` 且 **fiber=（无）**——禁用行根本不创建 Fiber，不是创建后再停。`watcher` 的 `inject: [greeter]` 写在配置行上，插件代码里没有任何 inject 声明。

## 场景 ②：只改 config，就地 patch，uid 不变

`greeterEntry.update({ config: { tag: 'A2' } })`。diff 发现只有 config 变化 → 就地 patch：greeter 的 `apply` 重跑（计数 #2），watcher 看到新 tag，但 `innerFiber.uid` 前后相等——Fiber 没重建，重建的是配置快照。这是「改配置不重启」的精确含义：进程不重启，Fiber 也不重启，只有 config 换了。

## 场景 ③：inject 写在配置里，依赖缺席时等待

运行时 `create` 一行 `late`（watcher 插件），配置层 `inject: ['clock', 'greeter']`。此刻 clock 缺席：**outer = PENDING，inner =（无）**——outer Fiber 挂在依赖等待上，inner 还不存在。随后 `create` 一行 clock-provider，`await()` 后 late 双 ACTIVE，watcher late 的 apply 才第一次跑。依赖等待是 outer 层的职责，插件代码完全无感。

## 场景 ④：isolate 写在配置里，命名 realm

`greeter-r` 与 `watcher-r` 两行都带 `isolate: { greeter: 'realmR' }`。同 label 即同 realm（见 [isolate 示例](../cordis-isolate-demo/README.md)）：realm 内共享一份 tag=R 的 greeter，root 侧 watcher 仍见 A2。配置层 isolate 与代码里 `ctx.isolate()` 走同一套键机制，只是声明位置换到了 yml/内存行上。

## 场景 ⑤：disabled 开关，卸载再重装

`late.update({ disabled: true })` → inner = DISPOSED；`update({ disabled: false })` → inner = ACTIVE，watcher late 的 apply 计数 +1（重装是真重跑 apply，不是恢复旧闭包）。`disabled` getter 沿父链向上检查（`L/config/entry.ts:114-127`）：禁用 group 行会连带禁用整组。

## 实测输出

Node v26.12.1（`npm start`）；Bun 1.4.4（`npm run start:bun`）逐行相同（`Compare-Object` 无差异）。开头两行插件日志来自装配阶段：include 子树先挂起 watcher，greeter-a 上线后它才 apply。

```text
   [greeter A] apply #1
   [watcher] sees greeter = A，apply #1
① 配置树 → Entry → Fiber：group 与 disabled
   file:consumers     disabled=false fiber=ACTIVE
   file:watcher       disabled=false fiber=ACTIVE
   file:sleeper       disabled=true  fiber=（无）
   greeter-a          disabled=false fiber=ACTIVE
   sleeper 被禁用：根本不创建 Fiber；watcher 的 inject 来自配置行

② 只改 config：就地 patch，Fiber 不重建
   [greeter A2] apply #2
   [watcher] sees greeter = A2，apply #2
   innerFiber uid 不变： true

③ inject 写在配置里：outer/inner 两层 Fiber，依赖缺席时等待
   clock 缺席：outer = PENDING ，inner = （无）
   [clock] provider 上线
   [watcher late] sees greeter = A2，apply #1
   clock 上线：outer = ACTIVE ，inner = ACTIVE

④ isolate 写在配置里：命名 realm 共享一份 provider
   [greeter R] apply #3
   [watcher r] sees greeter = R，apply #1
   root 侧 watcher 仍见 A2，realm 侧 watcher-r 见 R（见上方插件日志）

⑤ disabled 开关：卸载再重装
   禁用后：inner = DISPOSED
   [watcher late] sees greeter = A2，apply #2
   启用后：inner = ACTIVE （apply 计数见插件日志）
演示结束
```

## 容易踩的坑

### include 子树 commit 写回文件，root 树纯内存

最容易踩的一个：以为所有 `loader.create/update` 都不碰文件。错——**只有 root 树**的 commit 是空实现；include 子树的 commit 会记 journal、写临时文件再 rename 回 yml（`I/index.ts:357-360`、`:551-554`）。若把运行时装配挂到 include 子树下，演示跑一遍 `cordis.yml` 就被改写。本示例的做法：yml 只读展示，运行时 create/patch/disabled 全走 root 内存树；跑完核对 yml 无变化。

### create 签名 Omit id，但运行时接受显式 id

`create(options: Omit<EntryOptions, 'id'>)`（`tree.ts:141`）字面量传 `id` 会 TS2353；但 `ensureId` 只在缺 id 时补随机哈希（`tree.ts:112-119`），显式 id 完全合法且必要——不显式给 include 行 id，子树 Entry 就带随机前缀（如 `56c25767:watcher`），`resolve` 没法写。绕法：helper 接收 `EntryOptions` 变量再转交，避开字面量 excess check：

```ts
const createEntry = (options: EntryOptions) => ctx.loader.create(options)
```

### 配置层 inject 必须覆盖插件所读的全部服务

watcher 读 `ctx.greeter`。若配置行只写 `inject: ['clock']`，clock 上线后 inner 直接 **FAILED**：cordis 读未声明 inject 的服务会抛「cannot get property without inject」。配置层 inject 不是「额外等待项」，而是 inner 层的服务可见性清单——插件读什么就要声明什么。

### disabled 沿父链检查，禁用行不创建 Fiber

`sleeper` 的 fiber 是「无」而不是 DISPOSED：disabled 在创建前就短路。已运行的 Entry 被禁用才走 dispose → DISPOSED（场景 ⑤）。getter 沿父链向上（`entry.ts:114-127`），所以 group 行 disabled 会整组生效。

### tsgo 下 augmentation 必须同文件写

typescript 7.0.2（tsgo native）下，独立 `env.d.ts` 里的 `declare module 'cordis'` 会**屏蔽库自身的 augmentation**——`ctx.provide`、`ctx.loader` 全部从类型上消失。安全模式是每个插件文件内同文件 `declare module`（本示例三插件皆如此），index.ts 不加 augmentation。另需 `"types": ["node"]` 才认 `process`/`node:url` 全局；`verbatimModuleSyntax` 下仅类型用途必须 `import type`。

### FiberState 是 const enum，运行时无名字

`fiber.state` 是数字，const enum 编译后不留名字表。示例按源码顺序自建 `STATE = ['PENDING','LOADING','ACTIVE','FAILED','DISPOSED','UNLOADING']` 映射。另：include 的 `watch` 是 opt-in（`I/index.ts:294-298`），默认不装 watcher，进程演示完自然退出，不会挂住。

## 从零复现：完整文件与两条运行路径

### 目录结构

```text
cordis-loader-demo/
├── package.json
├── tsconfig.json
├── cordis.yml               # 只读展示：group / disabled / 配置层 inject
├── diagrams/                # entry-update 三件套（svg/html/json）
└── src/
    ├── index.ts             # 装配入口 + 五场景
    └── plugins/
        ├── greeter.ts       # provide greeter，全局 apply 计数
        ├── watcher.ts       # 读 greeter，自身不声明 inject
        └── clock.ts         # provide clock
```

### package.json

```json
{
  "name": "cordis-loader-demo",
  "private": true,
  "type": "module",
  "description": "配置树到 Fiber：group / disabled / 配置层 inject / 配置层 isolate / 运行时 patch 与禁用开关。Node 与 Bun 双运行时。",
  "scripts": {
    "start": "node src/index.ts",
    "start:bun": "bun src/index.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@cordisjs/fs": "2.0.0-rc.0",
    "@cordisjs/fs-node": "0.1.0",
    "@cordisjs/group": "1.0.1",
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

### cordis.yml

```yaml
# 配置树示例：group / disabled / 配置层 inject 都在这里声明
# 只读展示：include 子树的 commit 会写回本文件，运行时改动走 root 内存树
- id: consumers
  name: '@cordisjs/group'
  group: true
  config:
    - id: watcher
      name: ./src/plugins/watcher.ts
      inject:            # 配置层追加依赖：插件代码里没有 inject
        - greeter
    - id: sleeper
      name: ./src/plugins/watcher.ts
      disabled: true     # 这行不创建 Fiber
      config:
        tag: sleeper
```

### src/plugins/greeter.ts

```ts
import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

let applies = 0

export function apply(ctx: Context, config: { tag: string }) {
  applies++
  console.log(`   [greeter ${config.tag}] apply #${applies}`)
  ctx.provide('greeter', { tag: config.tag })
}
```

### src/plugins/watcher.ts

```ts
import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

/** 插件本身不声明 inject：依赖由配置行追加（outer/inner 两层 Fiber）。 */
const applies = new Map<string, number>()

export function apply(ctx: Context, config: { tag?: string } = {}) {
  const key = config.tag ?? 'default'
  const n = (applies.get(key) ?? 0) + 1
  applies.set(key, n)
  const label = config.tag ? `watcher ${config.tag}` : 'watcher'
  console.log(`   [${label}] sees greeter = ${ctx.greeter.tag}，apply #${n}`)
}
```

### src/plugins/clock.ts

```ts
import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    clock: { now(): string }
  }
}

export function apply(ctx: Context) {
  console.log('   [clock] provider 上线')
  ctx.provide('clock', { now: () => 'tick' })
}
```

### src/index.ts（完整版）

```ts
/**
 * 配置树到 Fiber：group / disabled / 配置层 inject / 配置层 isolate / 运行时 patch。
 * 装配入口与 cordis 官方 bin.js 同构：Fs + NodeFs + Loader + include 读 ./cordis.yml。
 *
 * 运行：node src/index.ts / bun src/index.ts（无需构建）
 */
import { Context } from 'cordis'
import { pathToFileURL } from 'node:url'
import Fs from '@cordisjs/fs'
import NodeFs from '@cordisjs/fs-node'
import Loader from '@cordisjs/loader'
import type { EntryOptions } from '@cordisjs/loader'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** create() 的类型签名是 Omit<EntryOptions,'id'>，但运行时 ensureId 接受显式 id。 */
const createEntry = (options: EntryOptions) => ctx.loader.create(options)

/** FiberState 是 const enum，运行时拿不到名字，这里按源码顺序自建映射。 */
const STATE = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
const stateOf = (fiber?: { state: number }) => (fiber ? STATE[fiber.state] : '（无）')

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'
await ctx.use(Fs)
await ctx.use(NodeFs)
await ctx.use(Loader)
await createEntry({ id: 'file', name: '@cordisjs/include', config: { path: './cordis.yml' } })
await ctx.loader.await()
// 运行时装配走 root 内存树：Loader.commit 是空实现，不会写回任何文件
await createEntry({ id: 'greeter-a', name: './src/plugins/greeter.ts', config: { tag: 'A' } })
await ctx.loader.await()

console.log('① 配置树 → Entry → Fiber：group 与 disabled')
for (const entry of ctx.loader.entries()) {
  if (entry.options.name === '@cordisjs/include') continue
  const fiber = entry.innerFiber ?? entry.outerFiber
  console.log(`   ${entry.id.padEnd(18)} disabled=${String(entry.disabled).padEnd(5)} fiber=${stateOf(fiber)}`)
}
console.log('   sleeper 被禁用：根本不创建 Fiber；watcher 的 inject 来自配置行', '\n')

console.log('② 只改 config：就地 patch，Fiber 不重建')
const greeterEntry = ctx.loader.resolve('greeter-a')
const uidBefore = greeterEntry.innerFiber!.uid
await greeterEntry.update({ config: { tag: 'A2' } })
await ctx.loader.await()
console.log('   innerFiber uid 不变：', uidBefore === greeterEntry.innerFiber!.uid, '\n')

console.log('③ inject 写在配置里：outer/inner 两层 Fiber，依赖缺席时等待')
await createEntry({ id: 'late', name: './src/plugins/watcher.ts', inject: ['clock', 'greeter'], config: { tag: 'late' } })
await sleep(10)
const late = ctx.loader.resolve('late')
console.log('   clock 缺席：outer =', stateOf(late.outerFiber), '，inner =', stateOf(late.innerFiber))
await createEntry({ id: 'clock-provider', name: './src/plugins/clock.ts' })
await ctx.loader.await()
console.log('   clock 上线：outer =', stateOf(late.outerFiber), '，inner =', stateOf(late.innerFiber), '\n')

console.log('④ isolate 写在配置里：命名 realm 共享一份 provider')
await createEntry({ id: 'greeter-r', name: './src/plugins/greeter.ts', config: { tag: 'R' }, isolate: { greeter: 'realmR' } })
await createEntry({ id: 'watcher-r', name: './src/plugins/watcher.ts', inject: ['greeter'], config: { tag: 'r' }, isolate: { greeter: 'realmR' } })
await ctx.loader.await()
console.log('   root 侧 watcher 仍见 A2，realm 侧 watcher-r 见 R（见上方插件日志）', '\n')

console.log('⑤ disabled 开关：卸载再重装')
await late.update({ disabled: true })
await sleep(10)
console.log('   禁用后：inner =', stateOf(late.innerFiber))
await late.update({ disabled: false })
await ctx.loader.await()
console.log('   启用后：inner =', stateOf(late.innerFiber), '（apply 计数见插件日志）')

console.log('演示结束')
```

### 运行

```bash
npm install          # 整目录拷走即可独立安装
npm start            # Node >= 22.18（原生 TS type stripping，无需构建）
npm run start:bun    # Bun >= 1.4.4，输出与 Node 逐行一致
npm run typecheck    # tsc 7.0.2，0 错误
```

无需 `LLM_API_KEY`，无网络调用；include 默认不装 watcher，演示完进程自然退出。

## 小结

loader 把装配从命令变成数据：配置行 → Entry → Fiber，group/disabled/inject/isolate 全是声明。运行时 `update()` 用 diff 区分「就地 patch」（uid 不变）与「重载」（name/inject 变化），disabled 沿父链短路。两棵树的 commit 语义划出持久化边界：root 内存树随便改，include 子树改一次写一次文件。到这里，[seam](../cordis-seam-demo/README.md) 的服务装配、[fiber](../cordis-fiber-demo/README.md) 的状态机、[isolate](../cordis-isolate-demo/README.md) 的 realm 键都能写进配置了；下一篇 [hmr](../cordis-hmr-demo/README.md) 看文件变化如何触发这条链路重跑。