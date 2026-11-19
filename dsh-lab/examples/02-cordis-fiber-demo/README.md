# 02 · Cordis 的 fiber 示例

本示例演示一个插件从挂上到卸载会经历什么：六态状态机、可逆 effect 的逆序回收、timer 作为 effect。插件全部在 cordis.yml 里声明，代码里没有一处 `ctx.use()`——runner 只经行句柄做启用 / 禁用 / dispose 这些运行时操作。

seam 示例讲「谁提供、谁消费」，这一篇讲生命周期本身。cordis 给每个插件行建一个 **fiber**，插件的生命周期和它产生的副作用都归这个 fiber 管。看完你会明白：为什么插件不需要写 destroy 函数，以及注册副作用时为什么要顺手返回清理函数。

## 1 自己管生命周期，迟早会碰到这三个问题

不用框架管理插件生命周期时，有三件事很容易出错：

- **半初始化**：init 走到一半抛错，对象已经存在但能力不全，调用方拿到的是残废实例。

- **清理顺序**：destroy 里先关连接还是先停定时器，全靠人记；记错一次就是回调打到已关闭的资源上。

- **忘记清理**：插件卸载了，它注册的 setInterval 还在跑——进程退不掉，或者更糟，继续写已经不属于它的状态。

> 把副作用和生命周期绑在同一个 fiber 上：插件作者只写「装」，「卸」就是装的返回值。

cordis 的做法：插件的一切注册都走 `ctx.effect()`，登记在所属 fiber 上；fiber 进入卸载态时统一回收。

## 2 六态状态机：状态是算出来的，不是存的

![Fiber 的六态状态机](diagrams/fiber-states.svg)

交互版：[fiber-states.html](diagrams/fiber-states.html) · IR 源：[fiber-states.lifecycle.json](diagrams/fiber-states.lifecycle.json)

- `_getState()` 的判定优先级：uid === null 则 DISPOSED；_error 存在则 FAILED；epoch 不等于 INACTIVE 则 ACTIVE；否则 PENDING。
- 六个状态没有任何一个字段直接保存，全部由 uid / _error / epoch 三个量推导（core 包 fiber.ts:365）；dispose() 可从 PENDING / ACTIVE / FAILED 任一状态发生。
- UNLOADING 有两条出路：卸载完成时 epoch 回 INACTIVE 则落回 PENDING，已换新值则直接进 LOADING——后者让换 provider 的热重载省掉一次回落。

`FiberState` 在源码里是 `const enum`：`PENDING, LOADING, ACTIVE, FAILED, DISPOSED, UNLOADING`。编译后内联为数字，运行时 `FiberState.PENDING` 不存在——示例的 `STATE` 数组按源码顺序自建映射；升级 cordis 时若枚举顺序变化，映射要跟着核对。注意它**不是**一条直线：LOADING 可以掉进 FAILED，UNLOADING 可以回到 PENDING 或再进 LOADING。场景 ① 的观察对象是 yml 里初始禁用的 slow 行（apply 与清理都是 async），用有界轮询 `waitFor` 把 LOADING 与 UNLOADING 这两个「进行中」状态暴露在观测窗口里：

```ts
const slow = row(ctx, 'slow')              // cordis.yml 里声明的行，初始禁用
const enabling = slow.update({ disabled: false })
await waitFor(() => stateOf(slow.innerFiber) === 'LOADING')   // apply 还在 sleep：正好落在 LOADING
console.log(stateOf(slow.innerFiber))      // LOADING
await enabling
await ctx.loader.await()
console.log(stateOf(slow.innerFiber))      // ACTIVE
const disposing = slow.dispose()           // 清理是 async，还没跑完
console.log(stateOf(slow.innerFiber))      // UNLOADING
await disposing
console.log(stateOf(slow.innerFiber))      // DISPOSED
```

`row()` 辅助有个值得注意的细节：`ctx.loader.resolve(id)` 只查根树的行；cordis CLI 把 cordis.yml 挂在 include 子树里，直接 resolve 会报 cannot resolve entry——用 `[...ctx.loader.entries()]` 递归遍历再按 `options.id` 匹配。这也要求 yml 里需要运行时寻址的行必须写显式 `id:`，否则 loader 生成随机 hex，没法按名字找。

## 3 PENDING 不是错误，是等待

inject 声明的服务缺席时，fiber 停在 PENDING，`apply()` 一次都不执行——没有半初始化中间态。服务出现自动激活；服务消失回到 PENDING 而**不是销毁**；再换一个 provider，同一个 fiber 原地复活，apply 跑第二遍。watcher 行启动即在位，两个 provider 行初始禁用，runner 依次开关：

```ts
const watcher = row(ctx, 'watcher')        // inject: ['tick']，此刻没有 provider
// … PENDING，apply 次数 = 0
await row(ctx, 'provider-a').update({ disabled: false })   // provide('tick', { n: 1 })
// … watcher ACTIVE，第 1 次激活
await row(ctx, 'provider-a').update({ disabled: true })
// … watcher 回到 PENDING
await row(ctx, 'provider-b').update({ disabled: false })   // provide('tick', { n: 2 })
// … watcher 再次 ACTIVE，第 2 次激活
```

这就是 seam 示例第 ⑥ 步「原地复活」的机制本体：复活不是新建 fiber，而是旧 fiber 的 epoch 换了值。这个机制的反面：inject 拼错服务名时，插件会永远安静地停在 PENDING，不报任何错。排查「插件装了没生效」的第一动作是看 fiber.state，而不是加日志——dsh 的装配审计（`auditStartupEntries`）就是把这个状态变成启动期断言。

## 4 可逆 effect 的回收顺序

noisy 插件装两个 effect 加一个事件监听，dispose 之后监听器随 fiber 消失，再 emit 什么也不发生：

```ts
ctx.effect(() => { order.push('装 A'); return () => order.push('卸 A') })
ctx.effect(() => { order.push('装 B'); return () => order.push('卸 B') })
ctx.on('lab/ping', () => order.push('听到 ping'))
```

实测顺序是 `装 A → 装 B → 听到 ping → 卸 B → 卸 A`。这里有一条必须写准确的源码事实（fiber.ts `_unload()`）：**清理函数按注册逆序启动，但并发执行**——同步清理因此表现为逆序完成，异步清理的完成顺序不保证。相互依赖的清理逻辑不要靠顺序表达，要用 effect 迭代器或服务依赖表达。

同一段源码还解释了 seam 示例的卸载方向：`_unload()` 先等所有依赖本 fiber 服务的 dependent 卸载完，才回收自己的 effect。所以 consumer 的清理运行时，provider 的服务还活着。

## 5 timer 也是 effect

`@cordisjs/timer` 的 `ctx.timeout(cb, delay)` 内部就是 `ctx.effect()`：装的时候 `setTimeout`，返回值是 `clearTimeout`。于是「插件卸载时取消未触发的定时器」不需要任何额外代码。alarms 插件全文：

```ts
import type { Context } from 'cordis'
import type {} from '@cordisjs/timer'
import { fired } from '../state.ts'

export const name = 'alarms'
export const inject = ['timer']

export function apply(ctx: Context) {
  ctx.timeout(() => fired.push('早闹钟(30ms)'), 30)
  ctx.timeout(() => fired.push('晚闹钟(200ms)'), 200)
}
```

runner 在 60ms 时 dispose 这一行：早闹钟已触发，晚闹钟被 clearTimeout，永远不响。timer 服务本身也是 yml 里的一行（`name: '@cordisjs/timer'`），启动即在位。

Promise 形态的 `ctx.timeout(delay)` 同理：fiber 销毁时 promise 以 `Context has been disposed` reject，而不是永远挂起。`interval` 的异步迭代器形态也会在销毁时 throw 同一个错误——只要注册都走 effect，「忘记清理」这个问题就不存在。

## 6 FAILED 仍然可以 dispose

apply 抛错时 `_reload()` 捕获异常、记 `_error`、把 epoch 强制回 INACTIVE，状态算出来是 FAILED。它不是终态：dispose 照常工作，落到 DISPOSED：

```ts
await row(ctx, 'broken').update({ disabled: false }).catch(() => {})
// … FAILED（broken 的 apply 直接 throw）
await row(ctx, 'broken').dispose()
// … DISPOSED
```

装配期失败被限制在单个 fiber 内，不会把整棵树带崩——但也不会被静默吞掉，`ctx.logger.error` 会记录原因。FAILED 的 fiber 仍然持有 uid 与已登记的部分 effect；不 dispose 它就留在树里——长跑进程里反复挂载失败插件而不 dispose，是泄漏的一种来源。

## 7 运行fiber示例

装配全部写在 `cordis.yml` 里，初始开关决定每个插件从哪个状态开始演示：

```yaml
# Fiber 示例的装配清单：初始开关决定每个插件从哪个状态开始演示
- id: slow
  name: ./src/plugins/slow.ts       # ① 六态观察对象：初始禁用，运行时启用
  disabled: true
- id: watcher
  name: ./src/plugins/watcher.ts    # ② inject tick：启动时没有 provider，停在 PENDING
- id: provider-a
  name: ./src/plugins/provider-a.ts # ② 第一个 provider：运行时启用再禁用
  disabled: true
- id: provider-b
  name: ./src/plugins/provider-b.ts # ② 第二个 provider：换实现让 watcher 复活
  disabled: true
- id: noisy
  name: ./src/plugins/noisy.ts      # ③ 可逆 effect：初始禁用
  disabled: true
- id: timer
  name: '@cordisjs/timer'           # ④ timer 服务：启动即在位
- id: alarms
  name: ./src/plugins/alarms.ts     # ④ 定时器作为 effect：初始禁用
  disabled: true
- id: broken
  name: ./src/plugins/broken.ts     # ⑤ apply 抛错：初始禁用
  disabled: true
- id: runner
  name: ./src/index.ts              # 场景驱动：不挂插件，只对上面的行做运行时开关
```

`npm start` 就是 cordis CLI：读当前目录的 `cordis.yml`，loader 逐行 import 模块，把导出的 `apply`、`inject`、`name` 当作插件定义挂上去。

`runner` 行挂的 `src/index.ts` 也是一个普通插件，负责驱动五个场景。它 inject 了 loader，按 id 拿到各行的句柄做启用与卸载，不再手工挂任何插件：

```ts
export const name = 'runner'
export const inject = ['loader']

// yml 的行挂在 include 子树里；entries() 会递归遍历，按 id 找行句柄
function row(ctx: Context, id: string): Entry {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === id)
  if (!entry) throw new Error(`cordis.yml 里没有 id=${id} 的行`)
  return entry
}

export function apply(ctx: Context) {
  // apply 同步返回：runner 自己的 fiber 先 settle，run() 再等整棵树，避免互相等待
  void run(ctx)
}

async function run(ctx: Context) {
  await ctx.loader.await()
  const slow = row(ctx, 'slow')
  const enabling = slow.update({ disabled: false })   // 启用 yml 里声明的插件
  // ……①～⑤ 五个场景，全部经行句柄操作……
  process.exit(0)   // cordis CLI 靠文件 watch 保持进程存活；演示做完主动退出
}
```

在本机复现只需要四条命令：

```bash
npm install             # cordis、loader 依赖与 @cordisjs/timer
#
npm start               # cordis CLI 读 cordis.yml（Node）：打印 ①～⑤ 的完整时序
npm run start:bun       # Bun 下直接跑 cordis 的 bin.js：输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1；Bun 1.4.4 逐行相同）：

```text
① 六态：PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
   [slow] apply 开始
   启用行刚触发： LOADING
   [slow] apply 结束
   await 之后： ACTIVE
   dispose() 刚返回： UNLOADING
   [slow] 清理开始
   [slow] 清理结束
   清理完成： DISPOSED

② inject 缺席：PENDING 不是错误，是等待
   没有 provider： PENDING ，apply 次数 = 0
   [watcher] 第 1 次激活，tick.n = 1
   provider-a 上线： ACTIVE
   provider-a 卸载： PENDING （回到等待，而非销毁）
   [watcher] 第 2 次激活，tick.n = 2
   provider-b 上线： ACTIVE ，apply 次数 = 2

③ 可逆 effect：同步清理按注册逆序完成，监听器随 fiber 消失
   顺序： 装 A → 装 B → 听到 ping → 卸 B → 卸 A

④ timer 也是 effect：fiber 销毁，未触发的定时器一起取消
   60ms 时卸载 fiber，最终触发： 早闹钟(30ms)

⑤ apply 抛错：FAILED，且仍然可以 dispose
   状态： FAILED
   dispose 后： DISPOSED
演示结束
```

装配路径依赖 cordis 的四个可选 peer 包：`@cordisjs/loader`、`@cordisjs/include`、`@cordisjs/fs`、`@cordisjs/fs-node`，加上场景 ④ 用的 `@cordisjs/timer`，都已写进 `package.json`。

## 8 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis 直接运行 TypeScript（Node 依赖原生类型擦除，Bun 自带转译），没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
cordis-fiber-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── cordis.yml            # 唯一装配入口：七个插件行 + timer 服务 + runner
├── .gitignore
├── src/
│   ├── index.ts          # runner 插件：五个场景的演示脚本
│   ├── state.ts          # 跨插件共享的观测记录
│   └── plugins/
│       ├── slow.ts       # ① async apply + async 清理
│       ├── watcher.ts    # ② inject tick 的消费者
│       ├── provider-a.ts # ② 第一个 provider
│       ├── provider-b.ts # ② 第二个 provider
│       ├── noisy.ts      # ③ 两个 effect + 一个监听器
│       ├── alarms.ts     # ④ 两个定时器
│       └── broken.ts     # ⑤ apply 抛错
└── diagrams/             # 六态状态机：SVG / 交互 HTML / IR 源
```

### package.json

```json
{
  "name": "cordis-fiber-demo",
  "private": true,
  "type": "module",
  "description": "Fiber 六态状态机、可逆 effect 的逆序回收、timer 作为 effect：一个插件的一生。Node 与 Bun 双运行时。",
  "scripts": {
    "start": "cordis",
    "start:bun": "bun node_modules/cordis/bin.js",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@cordisjs/fs": "2.0.0-rc.0",
    "@cordisjs/fs-node": "0.1.0",
    "@cordisjs/include": "2.0.0-rc.0",
    "@cordisjs/loader": "1.0.0-rc.10",
    "@cordisjs/timer": "1.1.5",
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

### src/index.ts（完整版）

正文第 7 节展示的是节选；这里是可直接运行的完整文件。它由 cordis.yml 的 runner 行挂载，依次演示六态、PENDING 等待、逆序回收、timer 回收、FAILED 处置。

```ts
/**
 * Fiber 的一生：六态状态机、可逆 effect、timer 作为 effect。
 *
 * runner：由 cordis.yml 的 runner 行挂载，代码里没有一处 ctx.use / ctx.plugin；
 * 插件全部在 cordis.yml 里声明，这里只经行句柄做启用 / 禁用 / dispose。
 */
import type { Context } from 'cordis'
import type { Entry } from '@cordisjs/loader'
import { counters, order, fired } from './state.ts'

export const name = 'runner'
export const inject = ['loader']

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 有界轮询：等谓词成立再继续，超时抛错——替代定长 sleep 的状态探针，消除碰运气的时序。 */
async function waitFor(predicate: () => boolean, { timeoutMs = 2000, intervalMs = 5, what = '' } = {}) {
  const t0 = Date.now()
  while (!predicate()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时：${what}`)
    await sleep(intervalMs)
  }
}

/** FiberState 是 const enum，运行时拿不到名字，这里按源码顺序自建映射。 */
const STATE = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
const stateOf = (fiber?: { state: number }) => (fiber ? STATE[fiber.state] : '（无）')

declare module 'cordis' {
  interface Context {
    tick: { n: number }
  }
  interface Events {
    'lab/ping'(): void
  }
}

// yml 的行挂在 include 子树里；entries() 会递归遍历，按 id 找行句柄
function row(ctx: Context, id: string): Entry {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === id)
  if (!entry) throw new Error(`cordis.yml 里没有 id=${id} 的行`)
  return entry
}

export function apply(ctx: Context) {
  // apply 同步返回：runner 自己的 fiber 先 settle，run() 再等整棵树，避免互相等待
  void run(ctx)
}

async function run(ctx: Context) {
  await ctx.loader.await()

  console.log('① 六态：PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED')
  const slow = row(ctx, 'slow')
  const enabling = slow.update({ disabled: false })
  // fiber 已创建，apply 还在 sleep：正好落在 LOADING（轮询等状态到位，不定长等待）
  await waitFor(() => stateOf(slow.innerFiber) === 'LOADING', { what: 'slow 行进入 LOADING' })
  console.log('   启用行刚触发：', stateOf(slow.innerFiber))
  await enabling
  await ctx.loader.await()
  console.log('   await 之后：', stateOf(slow.innerFiber))
  const disposing = slow.dispose()
  console.log('   dispose() 刚返回：', stateOf(slow.innerFiber))
  await disposing
  console.log('   清理完成：', stateOf(slow.innerFiber), '\n')

  console.log('② inject 缺席：PENDING 不是错误，是等待')
  const watcher = row(ctx, 'watcher')
  console.log('   没有 provider：', stateOf(watcher.innerFiber), '，apply 次数 =', counters.applies)
  const providerA = row(ctx, 'provider-a')
  await providerA.update({ disabled: false })
  await ctx.loader.await()
  console.log('   provider-a 上线：', stateOf(watcher.innerFiber))
  await providerA.update({ disabled: true })
  await waitFor(() => stateOf(watcher.innerFiber) === 'PENDING', { what: 'watcher 回到 PENDING' })
  console.log('   provider-a 卸载：', stateOf(watcher.innerFiber), '（回到等待，而非销毁）')
  const providerB = row(ctx, 'provider-b')
  await providerB.update({ disabled: false })
  await ctx.loader.await()
  console.log('   provider-b 上线：', stateOf(watcher.innerFiber), '，apply 次数 =', counters.applies, '\n')

  console.log('③ 可逆 effect：同步清理按注册逆序完成，监听器随 fiber 消失')
  const noisy = row(ctx, 'noisy')
  await noisy.update({ disabled: false })
  await ctx.loader.await()
  ctx.emit('lab/ping')
  await noisy.dispose()
  ctx.emit('lab/ping')   // 监听器已随 fiber 回收：这次 emit 什么也不发生
  console.log('   顺序：', order.join(' → '), '\n')

  console.log('④ timer 也是 effect：fiber 销毁，未触发的定时器一起取消')
  const alarms = row(ctx, 'alarms')
  await alarms.update({ disabled: false })
  await ctx.loader.await()
  await sleep(60)
  await alarms.dispose()
  await sleep(220)
  console.log('   60ms 时卸载 fiber，最终触发：', fired.join('、') || '（无）', '\n')

  console.log('⑤ apply 抛错：FAILED，且仍然可以 dispose')
  const broken = row(ctx, 'broken')
  await broken.update({ disabled: false }).catch(() => {})
  await waitFor(() => stateOf(broken.innerFiber) === 'FAILED', { what: 'broken 行进入 FAILED' })
  console.log('   状态：', stateOf(broken.innerFiber))
  await broken.dispose()
  console.log('   dispose 后：', stateOf(broken.innerFiber))

  await providerB.dispose()
  console.log('演示结束')
  // cordis CLI 靠文件 watch 保持进程存活；演示做完主动退出
  process.exit(0)
}
```

### src/state.ts

runner 与各插件共享的观测记录。跨插件传状态用共享模块，不用全局变量。

```ts
/** runner 与各插件共享的观测记录：apply 计数、effect 顺序、闹钟触发。 */
export const counters = { applies: 0 }
export const order: string[] = []
export const fired: string[] = []
```

### src/plugins/slow.ts

```ts
import type { Context } from 'cordis'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const name = 'slow'

export async function apply(ctx: Context) {
  console.log('   [slow] apply 开始')
  await sleep(30)
  ctx.effect(() => async () => {
    console.log('   [slow] 清理开始')
    await sleep(20)
    console.log('   [slow] 清理结束')
  })
  console.log('   [slow] apply 结束')
}
```

### src/plugins/watcher.ts

```ts
import type { Context } from 'cordis'
import { counters } from '../state.ts'

export const name = 'watcher'
export const inject = ['tick']

export function apply(ctx: Context) {
  counters.applies++
  console.log(`   [watcher] 第 ${counters.applies} 次激活，tick.n =`, ctx.tick.n)
}
```

### src/plugins/provider-a.ts 与 provider-b.ts

两个文件只差 provide 的值（`{ n: 1 }` / `{ n: 2 }`）与 name：

```ts
import type { Context } from 'cordis'

export const name = 'provider-a'

export function apply(ctx: Context) {
  ctx.provide('tick', { n: 1 })
}
```

### src/plugins/noisy.ts

```ts
import type { Context } from 'cordis'
import { order } from '../state.ts'

export const name = 'noisy'

export function apply(ctx: Context) {
  ctx.effect(() => {
    order.push('装 A')
    return () => order.push('卸 A')
  })
  ctx.effect(() => {
    order.push('装 B')
    return () => order.push('卸 B')
  })
  ctx.on('lab/ping', () => order.push('听到 ping'))
}
```

### src/plugins/alarms.ts

见正文第 5 节的完整镜像。

### src/plugins/broken.ts

```ts
export const name = 'broken'

export function apply() {
  throw new Error('装配期故意失败')
}
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `cordis`、`@cordisjs/loader` 与 `@cordisjs/timer`。
2. `npm start` 打印 ①～⑤ 五段，末行「演示结束」，与第 7 节实测输出逐行一致。
3. `npm run start:bun` 输出逐行相同。
4. `npm run typecheck` 无输出、退出码 0。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。

## 9 延伸阅读

- 对应的分析章节：[Fiber 模型](../../../docs/hello-cordis/03-fiber-model.md)——示例观察的是六态状态机的外显行为，这一章深入 `effect()` 支持的返回形态、epoch 用字符串实现依赖追踪的原理、`inertia` 串行化锁、依赖方卸载握手与错误处理的长堆栈——「状态是算出来的」那套源码推理全在这里。

## 10 小结

用 fiber 记住四件事就够了：

1. **一切注册走 effect**：工具、监听器、定时器、连接——装的时候返回清理函数，不写独立的 destroy。
2. **看状态而不是猜**：插件没生效先看 `fiber.state`；PENDING 是依赖缺席，FAILED 是 apply 抛错，两者处置完全不同。
3. **清理顺序只承诺启动逆序**：有先后要求的清理用 effect 迭代器或服务依赖表达，不靠并发碰运气。
4. **卸载方向由框架保证**：dependent 先卸、provider 后回收，清理代码里可以放心使用仍活着的服务。

装配在 cordis.yml，生命周期在 fiber，代码只剩场景本身。`npm start` 和 `npm run start:bun` 能直接看到上面的输出。

上一篇：[01-cordis-seam-demo](../01-cordis-seam-demo/README.md) ｜ 下一篇：[03-cordis-events-demo](../03-cordis-events-demo/README.md)