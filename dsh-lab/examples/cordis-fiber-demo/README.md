# Cordis 的 fiber 示例：一个插件的一生

seam 示例讲的是「谁提供、谁消费」，这一篇讲一个插件从挂上到卸载会经历什么。cordis 给每次 `ctx.use()` 建一个 **fiber**，插件的生命周期和它产生的副作用都归这个 fiber 管。示例用五个场景演示：六个状态怎么流转、卸载时清理按什么顺序跑、为什么定时器不用手动取消。

示例基于 cordis 4.0.0-rc.13 和 `@cordisjs/timer` 1.1.5，在 Node 26.12.1 和 Bun 1.4.4 上都跑过，输出一致。代码在本目录，`npm install && npm start` 即可运行。看完你会明白：为什么插件不需要写 destroy 函数，以及注册副作用时为什么要顺手返回清理函数。

## 自己管生命周期，迟早会碰到这三个问题

不用框架管理插件生命周期时，有三件事很容易出错：

- **半初始化**：init 走到一半抛错，对象已经存在但能力不全，调用方拿到的是残废实例。
- **清理顺序**：destroy 里先关连接还是先停定时器，全靠人记；记错一次就是回调打到已关闭的资源上。
- **忘记清理**：插件卸载了，它注册的 setInterval 还在跑——进程退不掉，或者更糟，继续写已经不属于它的状态。

cordis 的做法是把「副作用」和「生命周期」绑在同一个对象上。插件的一切注册都走 `ctx.effect()`，登记在所属 fiber 上；fiber 进入卸载态时统一回收。插件作者只写「装」，不写「卸」——卸就是装的返回值。

## 六态状态机：状态是算出来的，不是存的

![Fiber 的六态状态机](diagrams/fiber-states.svg)

交互版：[fiber-states.html](diagrams/fiber-states.html) · IR 源：[fiber-states.lifecycle.json](diagrams/fiber-states.lifecycle.json)

- `_getState()` 的判定优先级：uid === null 则 DISPOSED；_error 存在则 FAILED；epoch 不等于 INACTIVE 则 ACTIVE；否则 PENDING。
- 六个状态没有任何一个字段直接保存，全部由 uid / _error / epoch 三个量推导（core 包 fiber.ts:365）；dispose() 可从 PENDING / ACTIVE / FAILED 任一状态发生。
- UNLOADING 有两条出路：卸载完成时 epoch 回 INACTIVE 则落回 PENDING，已换新值则直接进 LOADING——后者让换 provider 的热重载省掉一次回落。

`FiberState` 在源码里是 `const enum`：`PENDING, LOADING, ACTIVE, FAILED, DISPOSED, UNLOADING`。注意它**不是**一条直线：LOADING 可以掉进 FAILED，UNLOADING 可以回到 PENDING 或再进 LOADING。示例场景 ① 用一对 sleep 把 LOADING 与 UNLOADING 这两个「进行中」状态暴露在观测窗口里：

```ts
const slowFiber = ctx.use(slow)          // apply 是 async，还没跑完
console.log(stateOf(slowFiber))          // LOADING
await slowFiber
console.log(stateOf(slowFiber))          // ACTIVE
const disposing = slowFiber.dispose()    // 清理是 async，还没跑完
console.log(stateOf(slowFiber))          // UNLOADING
await disposing
console.log(stateOf(slowFiber))          // DISPOSED
```

## 场景 ②：PENDING 不是错误，是等待

inject 声明的服务缺席时，fiber 停在 PENDING，`apply()` 一次都不执行——没有半初始化中间态。服务出现自动激活；服务消失回到 PENDING 而**不是销毁**；再换一个 provider，同一个 fiber 原地复活，apply 跑第二遍：

```ts
const watcherFiber = ctx.use(watcher)    // inject: ['tick']，此刻没有 provider
// … PENDING，apply 次数 = 0
const aFiber = ctx.use(providerA)        // provide('tick', { n: 1 })
// … watcher ACTIVE，第 1 次激活
await aFiber.dispose()
// … watcher 回到 PENDING
const bFiber = ctx.use(providerB)        // provide('tick', { n: 2 })
// … watcher 再次 ACTIVE，第 2 次激活
```

这就是 seam 示例第 ⑥ 步「原地复活」的机制本体：复活不是新建 fiber，而是旧 fiber 的 epoch 换了值。

## 场景 ③：可逆 effect 的回收顺序

一个插件装两个 effect 加一个事件监听，dispose 之后监听器随 fiber 消失，再 emit 什么也不发生：

```ts
inner.effect(() => { order.push('装 A'); return () => order.push('卸 A') })
inner.effect(() => { order.push('装 B'); return () => order.push('卸 B') })
inner.on('lab/ping', () => order.push('听到 ping'))
```

实测顺序是 `装 A → 装 B → 听到 ping → 卸 B → 卸 A`。这里有一条必须写准确的源码事实（fiber.ts `_unload()`）：**清理函数按注册逆序启动，但并发执行**——同步清理因此表现为逆序完成，异步清理的完成顺序不保证。相互依赖的清理逻辑不要靠顺序表达，要用 effect 迭代器或服务依赖表达。

同一段源码还解释了 seam 示例的卸载方向：`_unload()` 先等所有依赖本 fiber 服务的 dependent 卸载完，才回收自己的 effect。所以 consumer 的清理运行时，provider 的服务还活着。

## 场景 ④：timer 也是 effect

`@cordisjs/timer` 的 `ctx.timeout(cb, delay)` 内部就是 `ctx.effect()`：装的时候 `setTimeout`，返回值是 `clearTimeout`。于是「插件卸载时取消未触发的定时器」不需要任何额外代码：

```ts
const alarms = {
  name: 'alarms',
  inject: ['timer'],
  apply(inner: Context) {
    inner.timeout(() => fired.push('早闹钟(30ms)'), 30)
    inner.timeout(() => fired.push('晚闹钟(200ms)'), 200)
  },
}
// 60ms 时 dispose：早闹钟已触发，晚闹钟被 clearTimeout，永远不响
```

Promise 形态的 `ctx.timeout(delay)` 同理：fiber 销毁时 promise 以 `Context has been disposed` reject，而不是永远挂起。`interval` 的异步迭代器形态也会在销毁时 throw 同一个错误——只要注册都走 effect，「忘记清理」这个问题就不存在。

## 场景 ⑤：FAILED 仍然可以 dispose

apply 抛错时 `_reload()` 捕获异常、记 `_error`、把 epoch 强制回 INACTIVE，状态算出来是 FAILED。它不是终态：dispose 照常工作，落到 DISPOSED。装配期失败被限制在单个 fiber 内，不会把整棵树带崩——但也不会被静默吞掉，`ctx.logger.error` 会记录原因。

## 实测输出

`npm start`（Node 26.12.1；`npm run start:bun` 逐行相同）：

```text
① 六态：PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
   use() 刚返回： LOADING
   [slow] apply 开始
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

## 容易踩的坑

### 异步清理不保证完成顺序

逆序的是**启动**，不是完成。两个 async 清理函数谁先结束取决于各自的 await；需要先后关系就把它们放进同一个 effect 迭代器，或拆成有依赖关系的服务。

### PENDING 的插件不占资源，但也不报错

inject 拼错服务名时，插件会永远安静地停在 PENDING。排查「插件装了没生效」的第一动作是看 fiber.state，而不是加日志——装配清单审计（dsh 的 `auditStartupEntries`）就是把这个状态变成启动期断言。

### FAILED 不是终态，别忘记 dispose

FAILED 的 fiber 仍然持有 uid 与已登记的部分 effect；不 dispose 它就留在树里。长跑进程里反复挂载失败插件而不 dispose，是泄漏的一种来源。

### const enum 拿不到名字

`FiberState` 是 const enum，编译后内联为数字，运行时 `FiberState.PENDING` 不存在。示例里的 `STATE` 数组按源码顺序自建映射；升级 cordis 时若枚举顺序变化，映射要跟着核对。

## 从零复现：完整文件与两条运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。无构建步骤，本目录拷到任何位置都能独立安装运行。

### 目录结构

```text
cordis-fiber-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── .gitignore
├── src/
│   └── index.ts          # 五个场景：六态 / pending / 逆序回收 / timer / FAILED
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
    "start": "node src/index.ts",
    "start:bun": "bun src/index.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
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

```ts
/**
 * Fiber 的一生：六态状态机、可逆 effect、timer 作为 effect。
 *
 * 运行：node src/index.ts / bun src/index.ts（无需构建）
 */
import { Context } from 'cordis'
import TimerService from '@cordisjs/timer'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** FiberState 是 const enum，运行时拿不到名字，这里按源码顺序自建映射。 */
const STATE = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
const stateOf = (fiber: { state: number }) => STATE[fiber.state]

declare module 'cordis' {
  interface Context {
    tick: { n: number }
  }
  interface Events {
    'lab/ping'(): void
  }
}

const ctx = new Context()

console.log('① 六态：PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED')
const slow = {
  name: 'slow',
  async apply(inner: Context) {
    console.log('   [slow] apply 开始')
    await sleep(30)
    inner.effect(() => async () => {
      console.log('   [slow] 清理开始')
      await sleep(20)
      console.log('   [slow] 清理结束')
    })
    console.log('   [slow] apply 结束')
  },
}
const slowFiber = ctx.use(slow)
console.log('   use() 刚返回：', stateOf(slowFiber))
await slowFiber
console.log('   await 之后：', stateOf(slowFiber))
const disposing = slowFiber.dispose()
console.log('   dispose() 刚返回：', stateOf(slowFiber))
await disposing
console.log('   清理完成：', stateOf(slowFiber), '\n')

console.log('② inject 缺席：PENDING 不是错误，是等待')
let applies = 0
const watcher = {
  name: 'watcher',
  inject: ['tick'],
  apply(inner: Context) {
    applies++
    console.log(`   [watcher] 第 ${applies} 次激活，tick.n =`, inner.tick.n)
  },
}
const watcherFiber = ctx.use(watcher)
await sleep(10)
console.log('   没有 provider：', stateOf(watcherFiber), '，apply 次数 =', applies)
const providerA = {
  name: 'provider-a',
  apply(inner: Context) {
    inner.provide('tick', { n: 1 })
  },
}
const aFiber = ctx.use(providerA)
await aFiber
await watcherFiber
console.log('   provider-a 上线：', stateOf(watcherFiber))
await aFiber.dispose()
await sleep(10)
console.log('   provider-a 卸载：', stateOf(watcherFiber), '（回到等待，而非销毁）')
const providerB = {
  name: 'provider-b',
  apply(inner: Context) {
    inner.provide('tick', { n: 2 })
  },
}
const bFiber = ctx.use(providerB)
await bFiber
await watcherFiber
console.log('   provider-b 上线：', stateOf(watcherFiber), '，apply 次数 =', applies, '\n')

console.log('③ 可逆 effect：同步清理按注册逆序完成，监听器随 fiber 消失')
const order: string[] = []
const noisy = {
  name: 'noisy',
  apply(inner: Context) {
    inner.effect(() => {
      order.push('装 A')
      return () => order.push('卸 A')
    })
    inner.effect(() => {
      order.push('装 B')
      return () => order.push('卸 B')
    })
    inner.on('lab/ping', () => order.push('听到 ping'))
  },
}
const noisyFiber = ctx.use(noisy)
await noisyFiber
ctx.emit('lab/ping')
await noisyFiber.dispose()
ctx.emit('lab/ping')   // 监听器已随 fiber 回收：这次 emit 什么也不发生
console.log('   顺序：', order.join(' → '), '\n')

console.log('④ timer 也是 effect：fiber 销毁，未触发的定时器一起取消')
await ctx.use(TimerService)
const fired: string[] = []
const alarms = {
  name: 'alarms',
  inject: ['timer'],
  apply(inner: Context) {
    inner.timeout(() => fired.push('早闹钟(30ms)'), 30)
    inner.timeout(() => fired.push('晚闹钟(200ms)'), 200)
  },
}
const alarmsFiber = ctx.use(alarms)
await alarmsFiber
await sleep(60)
await alarmsFiber.dispose()
await sleep(220)
console.log('   60ms 时卸载 fiber，最终触发：', fired.join('、') || '（无）', '\n')

console.log('⑤ apply 抛错：FAILED，且仍然可以 dispose')
const broken = {
  name: 'broken',
  apply() {
    throw new Error('装配期故意失败')
  },
}
const brokenFiber = ctx.use(broken)
await sleep(10)
console.log('   状态：', stateOf(brokenFiber))
await brokenFiber.dispose()
console.log('   dispose 后：', stateOf(brokenFiber))

await bFiber.dispose()
console.log('演示结束')
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `cordis` 与 `@cordisjs/timer`。
2. `npm start` 打印 ①～⑤ 五段，末行「演示结束」，与实测输出一节逐行一致。
3. `npm run start:bun` 输出逐行相同。
4. `npm run typecheck` 无输出、退出码 0。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。

## 小结

用 fiber 记住四件事就够了：

1. **一切注册走 effect**：工具、监听器、定时器、连接——装的时候返回清理函数，不写独立的 destroy。
2. **看状态而不是猜**：插件没生效先看 `fiber.state`；PENDING 是依赖缺席，FAILED 是 apply 抛错，两者处置完全不同。
3. **清理顺序只承诺启动逆序**：有先后要求的清理用 effect 迭代器或服务依赖表达，不靠并发碰运气。
4. **卸载方向由框架保证**：dependent 先卸、provider 后回收，清理代码里可以放心使用仍活着的服务。

代码在本目录，`npm start` 和 `npm run start:bun` 能直接看到上面的输出。