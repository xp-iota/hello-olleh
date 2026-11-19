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

`FiberState` 在源码里是 `const enum`：`PENDING, LOADING, ACTIVE, FAILED, DISPOSED, UNLOADING`。编译后内联为数字，运行时 `FiberState.PENDING` 不存在——示例的 `STATE` 数组按源码顺序自建映射；升级 cordis 时若枚举顺序变化，映射要跟着核对。注意它**不是**一条直线：LOADING 可以掉进 FAILED，UNLOADING 可以回到 PENDING 或再进 LOADING。场景 ① 的观察对象是 yml 里初始禁用的 slow 行（apply 与清理都是 async）：启用行后用有界轮询 `waitFor` 等 LOADING 到位，`dispose()` 刚返回时清理还没跑完、状态必然落在 UNLOADING——两个「进行中」状态都暴露在观测窗口里，且不靠定长 sleep 碰运气：

```ts
const slow = row(ctx, 'slow')              // cordis.yml 里声明的行，初始禁用
const enabling = slow.update({ disabled: false })
// fiber 已创建，apply 还在 sleep：正好落在 LOADING（轮询等状态到位，不定长等待）
await waitFor(() => stateOf(slow.innerFiber) === 'LOADING', { what: 'slow 行进入 LOADING' })
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
const providerA = row(ctx, 'provider-a')
await providerA.update({ disabled: false })   // provide('tick', { n: 1 })
// … watcher ACTIVE，第 1 次激活
await providerA.update({ disabled: true })
await waitFor(() => stateOf(watcher.innerFiber) === 'PENDING', { what: 'watcher 回到 PENDING' })
// … watcher 回到 PENDING
await row(ctx, 'provider-b').update({ disabled: false })   // provide('tick', { n: 2 })
// … watcher 再次 ACTIVE，第 2 次激活
```

这就是 seam 示例第 ⑤ 步「原地复活」的机制本体：复活不是新建 fiber，而是旧 fiber 的 epoch 换了值。这个机制的反面：inject 拼错服务名时，插件会永远安静地停在 PENDING，不报任何错。排查「插件装了没生效」的第一动作是看 fiber.state，而不是加日志——dsh 的装配审计（`auditStartupEntries`）就是把这个状态变成启动期断言。

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
const broken = row(ctx, 'broken')
await broken.update({ disabled: false }).catch(() => {})
await waitFor(() => stateOf(broken.innerFiber) === 'FAILED', { what: 'broken 行进入 FAILED' })
// … FAILED（broken 的 apply 直接 throw）
await broken.dispose()
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

## 8 源码视角：状态机与回收在 Cordis 内部如何做到

摘录取自本仓 vendored 源码 `deepseek-harness/vendor/cordis/src`（4.1.0，rc.11 基线）；本示例运行 cordis 4.0.0-rc.13，本节机制两个版本一致。逐行精读见 [Fiber 模型](../../../docs/hello-cordis/03-fiber-model.md)。

### 8.1 六态是现算的，过渡态是显式赋的

`_getState()` 只回答「静止时是什么状态」（`fiber.ts:580-585`）：

```ts
private _getState() {
  if (this.uid === null) return FiberState.DISPOSED
  if (this._error) return FiberState.FAILED
  if (this._runner.epoch !== INACTIVE) return FiberState.ACTIVE
  return FiberState.PENDING
}
```

LOADING 与 UNLOADING 这两个「进行中」状态不在上面的推导里，而是过渡启动时由 `_updateState` 的回调显式返回（`fiber.ts:637-644`）：

```ts
this._updateState(() => {
  if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
    this.inertia = this._reload()
    return FiberState.LOADING
  } else {
    this.inertia = this._unload()
    return FiberState.UNLOADING
  }
})
```

所以场景 ① 的轮询探针必然等到观测窗口：apply 还在 await，`_reload` 没返回，状态就停在 LOADING；清理还在 await，状态就停在 UNLOADING。

### 8.2 inertia 单飞与「原地复活」

`_setEpoch` 里有一行 `if (this.inertia) return`（`fiber.ts:636`）：过渡进行中不启动新过渡，只更新目标指纹。等当前过渡做完，再对比最新目标决定下一步——`_unload` 的收尾（`fiber.ts:738-745`）：

```ts
this._updateState(() => {
  if (this._runner.epoch === INACTIVE) {
    this.inertia = undefined
  } else {
    this.inertia = this._reload()
    return FiberState.LOADING
  }
})
```

这就是场景 ② 后半段的机制：provider-a 消失让 watcher 进入 UNLOADING，卸载期间 provider-b 上线改了 epoch，于是卸载一完成直接追进 LOADING，省掉一次回落 PENDING。（Java 类比：单线程 executor 里的 reconcile 任务——执行期间来的新变更只改目标，做完再比一次。）`_reload` 的收尾有对称的一段（`fiber.ts:702-709`）：加载期间目标又变了，就转头去卸载。

### 8.3 逆序启动、并发执行：两行源码定死的行为

清理列表的 `clear()` 返回**反转后的数组**（`utils.ts:27-31`）：

```ts
clear() {
  const values = [...this.map.values()]
  this.map.clear()
  return values.reverse()
}
```

而 `_unload` 拿到这个逆序数组后直接 `Promise.all`（`fiber.ts:720`）：

```ts
await Promise.all(this._disposables.clear().map(async (dispose) => {
```

两行合起来就是第 4 节那条必须写准确的事实：启动顺序逆序，执行并发。同步清理函数在 `map` 回调里立即跑完，所以表现为逆序完成；异步清理的完成顺序由各自耗时决定。要表达「先关 A 再关 B」，用 effect 迭代器把多个清理 yield 在同一个 effect 里（同一 effect 内部按 yield 逆序串行），或干脆用服务依赖表达。

### 8.4 timer 为什么自动取消

`@cordisjs/timer`（1.1.5，本示例 package.json 锁定的版本）的 `timeout` 回调形态全文就是下面这段（`lib/index.js:26-32`）：

```js
const dispose = this.ctx.effect(() => {
  const timer = setTimeout(() => {
    dispose();
    callback();
  }, delay);
  return () => clearTimeout(timer);
}, "ctx.timeout()");
```

安装时 `setTimeout`，返回的清理函数 `clearTimeout`；触发后先 `dispose()` 把自己从 fiber 的清理列表摘掉，再执行回调。fiber 卸载时 8.3 的回收流程自动执行还没摘掉的清理——场景 ④ 的晚闹钟被取消不是 timer 包的特殊逻辑，而是「一切注册走 effect」的免费推论。Promise 形态（`lib/index.js:36-42`）的清理函数多一行 `reject(new Error("Context has been disposed"))`，这就是第 5 节那句「销毁时 reject 而非永远挂起」的出处。

### 8.5 FAILED 为什么不是终态

`_reload` 捕获 apply 抛出的异常（`fiber.ts:693-700`）：

```ts
} catch (reason) {
  // impl guarantees that the error is non-null (?)
  this.ctx.logger.error(reason)
  // A superseded load still needs cleanup, but cannot fail the new target.
  if (this._runner.epoch === oldEpoch) {
    this._error = reason
    this._runner.epoch = INACTIVE
  }
}
```

记下 `_error`、epoch 回 INACTIVE，于是 `_getState` 算出 FAILED。注意 uid 没有被动过——dispose() 把 uid 置 null 后，同一个 `_getState` 立刻算出 DISPOSED，所以场景 ⑤ 的 FAILED → DISPOSED 不需要任何专门通道。失败被限制在单个 fiber：异常没有向父 fiber 传播的路径，只进 `ctx.logger.error`。

## 9 从零复现：完整文件与运行路径

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

### src/index.ts

正文第 7 节展示的是节选；完整文件就在本目录 [src/index.ts](src/index.ts)，由 cordis.yml 的 runner 行挂载，依次演示六态、PENDING 等待、逆序回收、timer 回收、FAILED 处置。脚手架各写法的含义见 [01 篇第 5 节的速览表](../01-cordis-seam-demo/README.md#脚手架速览照抄即可原理在-05-篇展开)。

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

## 10 延伸阅读

本文把 fiber 当作黑盒状态机观察；epoch 指纹如何驱动加载与卸载、inertia 单飞的收敛时序、`_reload` / `_unload` 的完整源码走读，在 [Fiber 模型](../../../docs/hello-cordis/03-fiber-model.md) 一篇里逐行展开，还给出六态状态机与原地复活的完整时序图。

## 11 小结

用 fiber 记住四件事就够了：

1. **一切注册走 effect**：工具、监听器、定时器、连接——装的时候返回清理函数，不写独立的 destroy。
2. **看状态而不是猜**：插件没生效先看 `fiber.state`；PENDING 是依赖缺席，FAILED 是 apply 抛错，两者处置完全不同。
3. **清理顺序只承诺启动逆序**：有先后要求的清理用 effect 迭代器或服务依赖表达，不靠并发碰运气。
4. **卸载方向由框架保证**：dependent 先卸、provider 后回收，清理代码里可以放心使用仍活着的服务。

装配在 cordis.yml，生命周期在 fiber，代码只剩场景本身。`npm start` 和 `npm run start:bun` 能直接看到上面的输出。

上一篇：[01 · Cordis 的 seam 示例](../01-cordis-seam-demo/README.md) ｜ 下一篇：[03 · Cordis 的事件示例](../03-cordis-events-demo/README.md)