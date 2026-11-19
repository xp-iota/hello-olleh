# 05 · Cordis 的 loader 示例

本示例演示配置树到 Fiber 的链路：group / disabled / 配置层 inject / 配置层 isolate / 运行时 patch 与禁用开关。初始装配全部写在 cordis.yml 里；代码里出现的 `loader.create()` 与 `entry.update()` 是本示例要演示的**运行时 patch 能力**——它们走 root 内存树，不写回任何文件。

前面几篇的装配要么手写、要么声明在 yml 里，这一篇讲 yml 本身：一份配置树，每行一个 Entry，每个 Entry 背后一层或两层 Fiber。group、disabled、inject、isolate 全部可以写在配置行上，运行时还能 `update()` 打补丁——只改 config 时 Fiber 不重建。

## 1 手写 ctx.use() 做不到的三件事

1. **依赖缺席时等待**。插件读 `ctx.greeter`，但 greeter 还没上线——手写装配只能自己排序或自己监听事件。

2. **不重启进程改配置**。改一个 tag 就要 dispose 再 use，副作用全重来。

3. **声明式分组与禁用**。哪些插件属于一组、哪行暂时不跑，手写代码里全是 if。

> 把装配从命令变成数据：配置行是数据，Entry 管树结构，Fiber 管生命周期。

loader 的答案是三层对象：**配置行（EntryOptions）→ Entry（树节点 + 持久化语义）→ Fiber（运行态）**。配置层的 `inject` 还会把 Fiber 拆成 outer/inner 两层：outer 等依赖，inner 跑 `apply`。Fiber 的状态机见 [fiber 示例](../02-cordis-fiber-demo/README.md)。

## 2 机制：两棵树、两层 Fiber、一个 diff

**两棵树的 commit 语义不同。** `Loader extends EntryTree`，root 树的 `commit` 是空实现——纯内存，不写任何文件（loader 包 index.ts:175-177）。`Include` 也 `extends EntryTree`，自建子树：`EntryTree` 构造时把 `entry.subtree = this`（config/tree.ts:79-84），于是 include 那行 Entry 挂着一棵子树；子树的 `commit` 会记 journal 并写回 yml 文件（include 包 index.ts:357-360、:551-554）。`tree.entries()` 生成器递归子树（tree.ts:90-96），`resolve('file:watcher')` 按 `:` 分段经 `store[part].subtree` 下降（tree.ts:121-132）。

**运行时 patch 走 `internal/commit`。** 插件侧 config 变化先改 `entry.options.config` 再调 `tree.commit`（loader 包 index.ts:105-112）——root 树上这一步是 no-op，所以内存装配不污染文件。注意「不碰文件」只对 root 树成立：若把运行时装配挂到 include 子树下，演示跑一遍 `cordis.yml` 就被改写。本示例的做法：yml 只读展示，运行时 create/patch/disabled 全走 root 内存树。

**Entry.update 的决策分支**决定动还是不动 Fiber：

![Entry.update 的决策分支](diagrams/entry-update.svg)

交互版：[entry-update.html](diagrams/entry-update.html) · IR 源：[entry-update.architecture.json](diagrams/entry-update.architecture.json)

- **create 决定合并语义**：create 为真表示新建，整份 options 直接替换；否则是增量更新，逐字段合并；值为空的字段按删除处理，而不是写入空值。
- **三条出路互斥**：禁用则销毁 Fiber 并结束；未运行则走首次 init；已运行则算 diff 再决定动作。
- **diff 决定重载还是 patch**：只有配置真的变化才动 Fiber；仅 config 字段变化可以就地 patch（场景 ② uid 不变）；涉及 name 或 inject 变化则必须重载。

## 3 配置树 → Entry → Fiber：group 与 disabled

`cordis.yml` 里一个 `@cordisjs/group` 行包两行 watcher：`watcher` 正常、`sleeper` 带 `disabled: true`。装配入口不用自己写：`npm start` 就是 cordis CLI，它做的事与官方 bin.js 同构——设 baseUrl、挂 Fs / NodeFs / Loader，再 create 一行 include 读 `./cordis.yml`，`await ctx.loader.await()` 等全部 init task。runner 也是 yml 里的一行，inject loader 后遍历整棵树：

```ts
for (const entry of ctx.loader.entries()) {
  if (entry.options.name === '@cordisjs/include' || entry.options.id === 'runner') continue
  const fiber = entry.innerFiber ?? entry.outerFiber
  // options.id 是行自己的 id；entry.id 还带 include 子树前缀（CLI 随机生成，不稳定）
  console.log(`   ${entry.options.id.padEnd(18)} disabled=${String(entry.disabled).padEnd(5)} fiber=${stateOf(fiber)}`)
}
```

实测 group 行本身 ACTIVE；`sleeper` 的 `disabled=true` 且 **fiber=（无）**——禁用行根本不创建 Fiber，不是创建后再停。`watcher` 的 `inject: [greeter]` 写在配置行上，插件代码里没有任何 inject 声明。

## 4 只改 config：就地 patch，uid 不变

greeter-a 是 runner 在 root 内存树上 create 的一行（tag=A）。对它 `update({ config: { tag: 'A2' } })`：diff 发现只有 config 变化 → 就地 patch，greeter 的 `apply` 重跑（计数 #2），watcher 看到新 tag，但 `innerFiber.uid` 前后相等——Fiber 没重建，重建的是配置快照。这是「改配置不重启」的精确含义：进程不重启，Fiber 也不重启，只有 config 换了。

## 5 inject 写在配置里：outer/inner 两层 Fiber

运行时 create 一行 `late`（watcher 插件），配置层 `inject: ['clock', 'greeter']`。此刻 clock 缺席：**outer = PENDING，inner =（无）**——outer Fiber 挂在依赖等待上，inner 还不存在。随后 create 一行 clock-provider，`await()` 后 late 双 ACTIVE，watcher late 的 apply 才第一次跑。依赖等待是 outer 层的职责，插件代码完全无感。但配置层 inject 不是「额外等待项」，而是 inner 层的服务可见性清单：watcher 读 `ctx.greeter`，若配置行只写 `inject: ['clock']`，clock 上线后 inner 直接 FAILED——读未声明 inject 的服务会抛「cannot get property without inject」。插件读什么就要声明什么。

## 6 isolate 写在配置里：命名 realm

`greeter-r` 与 `watcher-r` 两行都带 `isolate: { greeter: 'realmR' }`。同 label 即同 realm（见 [isolate 示例](../04-cordis-isolate-demo/README.md)）：realm 内共享一份 tag=R 的 greeter，root 侧 watcher 仍见 A2。配置层 isolate 与代码里 `ctx.isolate()` 走同一套键机制，只是声明位置换到了配置行上。

## 7 disabled 开关：卸载再重装

`late.update({ disabled: true })` → inner = DISPOSED；`update({ disabled: false })` → inner = ACTIVE，watcher late 的 apply 计数 +1（重装是真重跑 apply，不是恢复旧闭包）。`disabled` getter 沿父链向上检查（config/entry.ts:114-127）：禁用 group 行会连带禁用整组。

## 8 运行loader示例

初始装配写在 `cordis.yml` 里，group / disabled / 配置层 inject 都是声明：

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
- id: runner
  name: ./src/index.ts   # 场景驱动：运行时 patch 走 root 内存树，不写回本文件
```

`npm start` 就是 cordis CLI：读当前目录的 `cordis.yml`，loader 逐行 import 模块，把导出的 `apply` 当作插件定义挂上去。Fs / NodeFs / Loader / include 这些基础设施由 CLI 提供，不需要自己挂。

`runner` 行挂的 `src/index.ts` 也是一个普通插件。它 inject 了 loader，演示的正是 loader 的运行时 API——create 与 update 都落在 root 内存树上：

```ts
export const name = 'runner'
export const inject = ['loader']

export function apply(ctx: Context) {
  // apply 同步返回：runner 自己的 fiber 先 settle，run() 再等整棵树，避免互相等待
  void run(ctx)
}

async function run(ctx: Context) {
  /** create() 的类型签名是 Omit<EntryOptions,'id'>，但运行时 ensureId 接受显式 id。 */
  const createEntry = (options: EntryOptions) => ctx.loader.create(options)

  await ctx.loader.await()
  // 运行时装配走 root 内存树：Loader.commit 是空实现，不会写回任何文件
  await createEntry({ id: 'greeter-a', name: './src/plugins/greeter.ts', config: { tag: 'A' } })
  await ctx.loader.await()
  // ……①～⑤ 五个场景：遍历 / patch / inject 等待 / isolate / disabled……
  process.exit(0)   // cordis CLI 靠文件 watch 保持进程存活；演示做完主动退出
}
```

两个类型与运行细节值得单独说。其一，`create()` 的签名是 `Omit<EntryOptions, 'id'>`（tree.ts:141），字面量传 `id` 会 TS2353；但 `ensureId` 只在缺 id 时补随机哈希（tree.ts:112-119），显式 id 完全合法且必要——不显式给行 id，`resolve` 没法按名字写。绕法就是上面的 helper：接收 `EntryOptions` 变量再转交，避开字面量 excess check。其二，cordis CLI 默认开文件 watch 保持进程存活（直接嵌 include 时 watch 是 opt-in），所以 runner 演示完要 `process.exit(0)` 主动退出，否则进程挂住。

在本机复现只需要四条命令：

```bash
npm install             # cordis、loader、group 与 include 依赖
#
npm start               # cordis CLI 读 cordis.yml（Node）：打印 ①～⑤ 的完整时序
npm run start:bun       # Bun 下直接跑 cordis 的 bin.js：输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1；Bun 1.4.4 逐行相同）。开头两行插件日志来自装配阶段：include 子树先挂起 watcher，greeter-a 上线后它才 apply：

```text
   [greeter A] apply #1
   [watcher] sees greeter = A，apply #1
① 配置树 → Entry → Fiber：group 与 disabled
   consumers          disabled=false fiber=ACTIVE
   watcher            disabled=false fiber=ACTIVE
   sleeper            disabled=true  fiber=（无）
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

装配路径依赖 cordis 的可选 peer 包：`@cordisjs/loader`、`@cordisjs/include`、`@cordisjs/fs`、`@cordisjs/fs-node`，加上场景 ① 用的 `@cordisjs/group`，都已写进 `package.json`。跑完核对 `cordis.yml` 无变化——运行时改动全在 root 内存树。

## 9 源码视角：配置行如何变成 Fiber

core 摘录取自本仓 vendored 源码 `deepseek-harness/vendor/cordis/src`（4.1.0，rc.11 基线）；loader 摘录取自 `@cordisjs/loader` 1.0.0-rc.10 的 `lib/index.js`（本示例锁定的版本，bundled 产物保留了源文件标注）。逐行精读见 [Loader 与配置树](../../../docs/hello-cordis/07-loader-and-configuration-tree.md)。

### 9.1 一行配置的最后一步：registry.use

Entry 初始化完成后调 `registry.use`（rc.13 改名前的 `ctx.plugin`），core 侧做的事（`registry.ts:316-330`）：

```ts
plugin(plugin: Plugin, config?: any, getOuterStack = buildOuterStack()) {
  const callback = this.resolve(plugin)
  if (!callback) throw new Error('invalid plugin, expect function or object with an "apply" method, received ' + typeof plugin)
  this.ctx.fiber.assertActive()

  let runtime = this._internal.get(callback)
  if (!runtime) {
    let name = plugin.name
    if (name === 'apply') name = undefined
    runtime = { name, callback, fibers: new DisposableList(), Config: plugin.Config }
    this._internal.set(callback, runtime)
  }

  const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack)
```

runtime 记录以 **callback 身份**为键复用（同一个插件文件挂多行共享一份 runtime，各有各的 fiber），fiber 每次挂载新建——这就是 04 篇同一个 greeter-provider.ts 能挂三行的原因。（Java 类比：BeanDefinition 按类复用，bean 实例按 scope 新建。）返回值包了一层 `then`（`registry.ts:331-335`），所以 fiber 可以直接 await。

### 9.2 outer/inner 两层：loader 的两次 use

配置层有 inject 时，loader 不直接挂插件，先挂一个带 inject 的匿名 outer 插件（`lib/index.js`，源文件 `src/config/entry.ts`）：

```js
if (this._hasOuter()) {
  this.outerFiber = this.ctx.registry.use({ ...outer, inject: this.inject }, void 0, this.getOuterStack);
} else {
  this._start(this.ctx, exports.component);
}
```

outer 的 apply 就绪后才执行 `_start`，在派生上下文里挂真正的插件：

```js
const innerContext = ctx.extend({ [Context3.intercept]: this._intercept });
this.innerFiber = innerContext.registry.use(component, this.options.config, this.getOuterStack);
```

依赖等待完全复用 core 的 epoch 机制（[02 篇 8.2](../02-cordis-fiber-demo/README.md#82-inertia-单飞与原地复活)）：outer 停在 PENDING 时 inner 根本不存在——场景 ③ 的「inner =（无）」不是状态，是对象还没创建。而 inner 的 inject 清单就是它的服务可见性清单：读未声明的服务被 Proxy get 陷阱拒绝（[01 篇 7.3](../01-cordis-seam-demo/README.md#73-访问必须有声明proxy-get-陷阱)），这就是第 5 节「只写 inject: ['clock'] 会 FAILED」的机制。

### 9.3 update 的三条出路：一段决策代码

第 2 节的决策分支图对应的源码（`src/config/entry.ts` 的 `update`）：

```js
const legacy = { ...this.options };
if (create) {
  this.options = options;
} else {
  _Entry.merge(this.options, options);
}
// …_resolveInject / _blocked 检查：禁用则 dispose 返回……
const rebuild = changed || this.options.name !== legacy.name;
if (rebuild || !this.outerFiber && !this.innerFiber?.uid) {
  await this.init(this.outerFiber || this.innerFiber?.uid ? this.dispose() : void 0);
  return;
}
const diff = Object.keys({ ...this.options, ...legacy }).filter((key) => !deepEqual(this.options[key], legacy[key]));
if (!diff.length && !force) return;
this.context.emit("loader/partial-dispose", this, legacy, true);
await this._patchContext(diff);
```

inject 变化（`changed`）或 name 变化 → rebuild：先 dispose 再 init，fiber 换新；只有 config 变化 → 走 diff + `_patchContext`，最终触发 fiber 的配置更新瀑布（core `fiber.ts` 的 `update`，经 `internal/update` 事件重跑 apply），fiber 对象本身不动——场景 ② 的 uid 不变就是这条分支。diff 为空且非 force 直接返回，连 apply 都不重跑。

### 9.4 disabled 沿父链：一个 getter

```js
get disabled() {
  if (this.options.group) return false;
  return this._verdict !== false || this._parentDisabled();
}
_parentDisabled() {
  let entry = this.parent.ctx.fiber.entry;
  while (entry) {
    if (entry._verdict !== false) return true;
    entry = entry.parent.ctx.fiber.entry;
  }
  return false;
}
```

禁用判定每次现查父链——禁用 group 行连带整组，不需要给子行逐个发通知。而 `_init` 里 `if (this.disabled || …) return` 在创建 fiber 之前就短路，所以场景 ① 的 sleeper 是「fiber=（无）」而非 DISPOSED。

### 9.5 两棵树的持久化边界：一个空函数

root 树的 commit 全文（`lib/index.js`，源文件 `src/index.ts`）：

```js
commit(_change) {
}
```

运行时 create/update 都经 `tree.commit` 走持久化通道，root 树上这一步是空操作——「内存装配不污染文件」不是约定，是实现。include 子树重写了 commit（记 journal 并写回 yml，见第 2 节引用的 include 包位置），所以同一套 API 在哪棵树上调用，决定了改的是内存还是文件。

## 10 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis 直接运行 TypeScript（Node 依赖原生类型擦除，Bun 自带转译），没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
cordis-loader-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── cordis.yml            # 唯一装配入口：group / disabled / 配置层 inject + runner
├── .gitignore
├── src/
│   ├── index.ts          # runner 插件：五个场景的演示脚本
│   └── plugins/
│       ├── greeter.ts    # provide greeter，全局 apply 计数
│       ├── watcher.ts    # 读 greeter，自身不声明 inject
│       └── clock.ts      # provide clock
└── diagrams/             # entry-update 决策分支：SVG / 交互 HTML / IR 源
```

### package.json

```json
{
  "name": "cordis-loader-demo",
  "private": true,
  "type": "module",
  "description": "配置树到 Fiber：group / disabled / 配置层 inject / 配置层 isolate / 运行时 patch 与禁用开关。Node 与 Bun 双运行时。",
  "engines": {
    "node": ">=22.18"
  },
  "scripts": {
    "start": "cordis",
    "start:bun": "bun node_modules/cordis/bin.js",
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
    "types": ["node"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

augmentation 的写法有一个版本相关的约束：typescript 7.0.2（tsgo native）下，独立 `env.d.ts` 里的 `declare module 'cordis'` 会**屏蔽库自身的 augmentation**——`ctx.provide`、`ctx.loader` 全部从类型上消失。安全模式是每个插件文件内同文件 `declare module`（下面三个插件镜像皆如此），index.ts 不加 augmentation。另需 `"types": ["node"]` 才认 `process` 全局；`verbatimModuleSyntax` 下仅类型用途必须 `import type`。

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

### src/index.ts

正文第 8 节展示的是节选；完整文件就在本目录 [src/index.ts](src/index.ts)，由 cordis.yml 的 runner 行挂载，依次演示配置树遍历、就地 patch、inject 等待、命名 realm、disabled 开关。脚手架各写法的含义见 [01 篇第 5 节的速览表](../01-cordis-seam-demo/README.md#脚手架速览照抄即可原理在-05-篇展开)。

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `cordis`、`@cordisjs/loader` 与 `@cordisjs/group`。
2. `npm start` 打印 ①～⑤ 五段，末行「演示结束」，与第 8 节实测输出逐行一致。
3. `npm run start:bun` 输出逐行相同。
4. `npm run typecheck` 无输出、退出码 0；`cordis.yml` 内容无变化。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。

## 11 延伸阅读

本文按场景观察配置树的行为；Entry 与 Fiber 的两层结构、`update()` diff 分支的完整决策树、两棵树 commit 语义的持久化边界，在 [Loader 与配置树](../../../docs/hello-cordis/07-loader-and-configuration-tree.md) 一篇里逐行展开，还附 Entry.update 决策分支与 outer/inner 两层 Fiber 的完整时序图。

## 12 小结

loader 把装配从命令变成数据：配置行 → Entry → Fiber，group/disabled/inject/isolate 全是声明。运行时 `update()` 用 diff 区分「就地 patch」（uid 不变）与「重载」（name/inject 变化），disabled 沿父链短路。两棵树的 commit 语义划出持久化边界：root 内存树随便改，include 子树改一次写一次文件。到这里，[seam](../01-cordis-seam-demo/README.md) 的服务装配、[fiber](../02-cordis-fiber-demo/README.md) 的状态机、[isolate](../04-cordis-isolate-demo/README.md) 的 realm 键都能写进配置了；下一篇 [hmr](../06-cordis-hmr-demo/README.md) 看文件变化如何触发这条链路重跑。

上一篇：[04 · Cordis 的 isolate 示例](../04-cordis-isolate-demo/README.md) ｜ 下一篇：[06 · Cordis 的 HMR 示例](../06-cordis-hmr-demo/README.md)