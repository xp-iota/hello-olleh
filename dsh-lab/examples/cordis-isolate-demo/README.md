# Cordis 的 isolate 示例：同名服务，两个世界

这是一篇可以照抄的实战笔记。seam 示例讲「谁提供、谁消费」，fiber 示例讲「插件的一生」，events 示例讲「插件之间怎么说话」，这一篇讲「哪些插件活在同一个世界」：`ctx.isolate(name)` 不改任何插件代码，单方面把某个服务名划进一个新的 realm——同名服务在不同 realm 是不同实体，可以同时存活、独立卸载。我们用四个场景看存储键怎么变、隔离为什么按名字生效、事件可见性怎么跟着 realm 走、以及共享 label 的语义。示例基于 cordis 4.0.0-rc.13（当前 latest），在 Node 26.12.1 与 Bun 1.4.4 上实测通过；代码就在本目录，`npm install && npm start` 即可运行。

读完你会得到三样东西：一张「isolate 只改一个存储键」的机制图、一条「隔离是调用方的决定，不是插件的义务」的设计纪律，以及测试里「给插件换一套假服务」的标准做法。

## 先看清问题：全局单例服务的三笔账

服务注册表若是全局单例（一个名字只能有一份实现），三件事迟早出错：

- **测试污染**：集成测试想给插件换假数据库，只能改全局注册表——并行跑的测试互相踩。
- **多租户串味**：两个租户各要一份「自己的」配置服务，全局名字放不下第二份。
- **替换即全局事故**：换一次 provider，所有消费者一起重启，哪怕只想影响其中一个子系统。

cordis 的主张：服务名到实现的映射不是全局字典，而是**每个上下文一张 isolate 表**，表里存的是 symbol 键；store 以 symbol 键存实现。`ctx.isolate(name)` 就是给这张表加一个 own 属性、指向新 symbol——于是同一个名字在不同上下文解析到不同实现，互不知情。

## 机制：isolate 只改一个键

![isolate 前后的存储键变化](diagrams/isolate-realm.svg)

交互版：[isolate-realm.html](diagrams/isolate-realm.html) · IR 源：[isolate-realm.architecture.json](diagrams/isolate-realm.architecture.json)

- **变的只有一个键**：root 的 isolate 映射始终是 { greeter: Sym_A } · realm 的新视图多出一个 own 属性 greeter 指向 Sym_B · root 侧的消费者完全不受影响
- **store 里新增而非替换**：Sym_A 的 outer 实现仍在 · Sym_B 的 inner 实现是新记录 · 两者可以同时存活（示例场景 ①）
- **这就是空间可组合性**：同名服务在不同 realm 是不同实体 · 无需插件配合，调用方单方面决定 · 传同一个 label 即共享 realm（示例场景 ④）

源码只有五行（context.ts:65-69）：

```ts
isolate(name: string, label?: symbol) {
  const shadow = Object.create(this[symbols.isolate])   // 原型链继承旧表
  shadow[name] = label ?? Symbol(name)                  // own 属性覆盖一个名字
  return this.extend({ [symbols.isolate]: shadow })     // 派生一个新上下文
}
```

三个细节决定全部行为：新表以旧表为原型（没被 isolate 的名字沿原型链回落到 root 的键）；不传 label 时每次调用都是新 Symbol（完全私有）；返回的是派生上下文，原上下文一个字节都没改。服务解析 `locate()` 沿 fiber 链向上走时，用「当前表到 fiber 上下文表之间是否 own 了这个名字」判定隔离边界（reflect.ts:93-96）——realm 里的消费者看不到 realm 外的同名 provider，反之亦然。

## 场景 ①：同名两份实现同时 ACTIVE

root 与 realm 各挂一个 `inject: ['greeter']` 的消费者，再各挂一个 provider：

```ts
const rootFiber = ctx.use(consumerRoot)      // PENDING
const realm = ctx.isolate('greeter')
const realmFiber = realm.use(consumerRealm)  // PENDING
await ctx.use(providerOuter)                 // provide('greeter', outer)
await realm.use(providerInner)               // provide('greeter', inner)
```

实测两个消费者分别拿到 `outer` 与 `inner`，且**同时 ACTIVE**。没有 isolate 时第二次 provide 会抛 `service "greeter" has been registered at <...>`（reflect.ts:226）——store 以 symbol 键查重，isolate 换了键，查重自然通过。这就是「测试换假服务」的标准做法：被测插件一行不改，调用方把它挂进 realm 即可。

## 场景 ②：隔离按名字生效

realm 只 shadow 了 `greeter`。root 上 `ctx.provide('clock', ...)` 之后，realm 里 `inject: ['clock']` 的消费者照常激活，拿到 root 的实现——因为 realm 的 isolate 表里 `clock` 不是 own 属性，沿原型链回到 root 的键。隔离是**逐名字**的声明，不是「这个上下文从此与世隔绝」：想隔离几个名字就 isolate 几次（或链式调用），其余服务照常共享。

## 场景 ③：事件可见性跟着 realm 走

events 示例留了一个伏笔：`_resolve()` 按 `thisArg[Context.filter]` 筛监听器。Service 基类实现了这个 filter（service.ts:39-41）：比较监听器上下文与**服务所属上下文**的 isolate 键。所以以服务实例为 thisArg 派发的事件，只有同 realm 的监听器看得见：

```ts
class Ticker extends Service {
  constructor(ctx: Context) { super(ctx, 'ticker') }
  tick() { this.ctx.emit(this, 'lab/tick') }   // thisArg = 服务实例
}
ctx.on('lab/tick', ...)                        // root 监听器
const tickRealm = ctx.isolate('ticker')
tickRealm.on('lab/tick', ...)                  // realm 监听器
new Ticker(ctx).tick()                         // 只有 root 监听器响
new Ticker(tickRealm).tick()                   // 只有 realm 监听器响
```

实测两次 tick 共 2 次命中（`root 听到 → realm 听到`）；若无隔离应为 4 次。注意这里必须 `ctx.isolate('ticker')` 而不是复用场景 ① 的 greeter realm：isolate 表只 own 被 isolate 的名字，greeter realm 里 `ticker` 的键仍继承 root——在那里 provide ticker 会和 root 的撞键。**想隔离哪个服务的行为，就 isolate 哪个名字**，事件可见性用的也是服务名的键，不是事件名。

## 场景 ④：同 label 即同 realm

`isolate(name, label)` 的第二参决定共享范围：两个上下文传同一个 Symbol，就是同一个 realm 的两个入口。示例里 realmA 挂 provider、realmB 挂消费者，消费者照常拿到 `shared`；卸载 realmA 的 provider 后，realmB 的消费者回 PENDING，而 root 的消费者仍 ACTIVE——卸载的影响范围精确等于 realm 的成员范围。loader 层把这个能力包装成配置里的 `isolate: { db: true }`（私有）与 `isolate: { db: 'realmName' }`（命名 realm），下一篇 loader 示例会跑到它。

## 实测输出

`npm start`（Node 26.12.1；`npm run start:bun` 逐行相同）：

```text
① 同名服务两份实现：isolate 按名字划出 realm
   无 provider 时： PENDING / PENDING
   [consumer-root] greeter = outer
   [consumer-realm] greeter = inner
   两个 consumer 同时： ACTIVE / ACTIVE

② 隔离按名字生效：没被 isolate 的服务穿透 realm
   [realm-clock] clock.now() = root-clock
   realm 只 shadow 了 greeter，clock 沿原型链回到 root

③ 事件跟着 realm 走：以服务为 thisArg 派发，跨 realm 监听器不可见
   两次 tick 的命中： root 听到 → realm 听到 （无隔离时应为 4 次）

④ 同 label 即同 realm：卸载只影响本 realm 的消费者
   [consumer-shared] greeter = shared
   共享 provider 卸载后：consumer-shared = PENDING ，consumer-root = ACTIVE
演示结束
```

## 边界与容易踩的坑

### isolate 返回新上下文，原上下文不变

`const realm = ctx.isolate('db')` 之后继续用 `ctx` 挂插件，插件活在 root realm。隔离只作用于**从 realm 派生出去的挂载**：`realm.use(...)`、`realm.on(...)`、realm 里插件的 inner ctx。忘记换挂载入口是「隔离没生效」的第一原因。

### 没被 isolate 的名字全部共享

isolate 表是原型链 shadow，不是拷贝。realm 里 provide 一个没被 isolate 的名字，写的是 root 的键——会影响 root 的所有消费者。想完全私有就逐名字 isolate，或理解「realm 是选择性隔离」这个默认。

### 事件隔离的键是服务名，不是事件名

Service 的 filter 比较的是 `isolate[this.name]`。以服务为 thisArg 派发时，隔离粒度跟着**服务**走；普通 `ctx.emit('evt')`（无 thisArg）没有 filter，所有 realm 的监听器都看得见。想要 realm 级事件总线，要么以服务为 thisArg，要么每个 realm 用独立事件名。

### 撞键报错发生在 provide，不在 isolate

isolate 本身永不报错；报错在 `provide` 发现 store 里同键已有实现时。排查 `service "x" has been registered` 先看两个 provider 是否落在同一个 isolate 键上——通常就是漏了 isolate 或 label 传重了。

## 从零复现：完整文件与两条运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。无构建步骤，本目录拷到任何位置都能独立安装运行。

### 目录结构

```text
cordis-isolate-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── .gitignore
├── src/
│   └── index.ts          # 四个场景：双实现 / 按名字 / 事件可见性 / 共享 label
└── diagrams/             # 存储键变化：SVG / 交互 HTML / IR 源
```

### package.json

```json
{
  "name": "cordis-isolate-demo",
  "private": true,
  "type": "module",
  "description": "ctx.isolate 的 realm 隔离：同名服务多份实现、按名字隔离、事件可见性、共享 label。Node 与 Bun 双运行时。",
  "scripts": {
    "start": "node src/index.ts",
    "start:bun": "bun src/index.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
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
 * ctx.isolate 的 realm 隔离：同名服务多份实现、按名字隔离、事件可见性、共享 label。
 *
 * 运行：node src/index.ts / bun src/index.ts（无需构建）
 */
import { Context, Service } from 'cordis'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** FiberState 是 const enum，运行时拿不到名字，这里按源码顺序自建映射。 */
const STATE = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
const stateOf = (fiber: { state: number }) => STATE[fiber.state]

declare module 'cordis' {
  interface Context {
    greeter: { greet(): string }
    clock: { now(): string }
  }
  interface Events {
    'lab/tick'(): void
  }
}

/** 以服务实例为 thisArg 派发事件：Service 的 filter 按 isolate 键筛监听器。 */
class Ticker extends Service {
  constructor(ctx: Context) {
    super(ctx, 'ticker')
  }
  tick() {
    this.ctx.emit(this, 'lab/tick')
  }
}

const ctx = new Context()

console.log('① 同名服务两份实现：isolate 按名字划出 realm')
const consumerRoot = {
  name: 'consumer-root',
  inject: ['greeter'],
  apply(inner: Context) {
    console.log('   [consumer-root] greeter =', inner.greeter.greet())
  },
}
const consumerRealm = {
  name: 'consumer-realm',
  inject: ['greeter'],
  apply(inner: Context) {
    console.log('   [consumer-realm] greeter =', inner.greeter.greet())
  },
}
const rootFiber = ctx.use(consumerRoot)
const realm = ctx.isolate('greeter')
const realmFiber = realm.use(consumerRealm)
await sleep(10)
console.log('   无 provider 时：', stateOf(rootFiber), '/', stateOf(realmFiber))
const outerFiber = ctx.use({
  name: 'provider-outer',
  apply(inner: Context) {
    inner.provide('greeter', { greet: () => 'outer' })
  },
})
await outerFiber
const innerFiber = realm.use({
  name: 'provider-inner',
  apply(inner: Context) {
    inner.provide('greeter', { greet: () => 'inner' })
  },
})
await innerFiber
console.log('   两个 consumer 同时：', stateOf(rootFiber), '/', stateOf(realmFiber), '\n')

console.log('② 隔离按名字生效：没被 isolate 的服务穿透 realm')
ctx.provide('clock', { now: () => 'root-clock' })
const clockFiber = realm.use({
  name: 'realm-clock',
  inject: ['clock'],
  apply(inner: Context) {
    console.log('   [realm-clock] clock.now() =', inner.clock.now())
  },
})
await clockFiber
console.log('   realm 只 shadow 了 greeter，clock 沿原型链回到 root', '\n')

console.log('③ 事件跟着 realm 走：以服务为 thisArg 派发，跨 realm 监听器不可见')
const hits: string[] = []
ctx.on('lab/tick', () => hits.push('root 听到'))
const tickRealm = ctx.isolate('ticker')
tickRealm.on('lab/tick', () => hits.push('realm 听到'))
const rootTicker = new Ticker(ctx)
const realmTicker = new Ticker(tickRealm)
rootTicker.tick()
realmTicker.tick()
console.log('   两次 tick 的命中：', hits.join(' → '), '（无隔离时应为 4 次）', '\n')

console.log('④ 同 label 即同 realm：卸载只影响本 realm 的消费者')
const tag = Symbol('shared-greeter')
const realmA = ctx.isolate('greeter', tag)
const realmB = ctx.isolate('greeter', tag)
const sharedFiber = realmB.use({
  name: 'consumer-shared',
  inject: ['greeter'],
  apply(inner: Context) {
    console.log('   [consumer-shared] greeter =', inner.greeter.greet())
  },
})
const sharedProviderFiber = realmA.use({
  name: 'provider-shared',
  apply(inner: Context) {
    inner.provide('greeter', { greet: () => 'shared' })
  },
})
await sharedProviderFiber
await sharedFiber
await sharedProviderFiber.dispose()
await sleep(10)
console.log('   共享 provider 卸载后：consumer-shared =', stateOf(sharedFiber), '，consumer-root =', stateOf(rootFiber))

console.log('演示结束')
```

### 运行

```bash
npm install
npm start          # Node：node src/index.ts（原生 TS type stripping，无需构建）
npm run start:bun  # Bun：bun src/index.ts，输出逐行相同
npm run typecheck  # tsc --noEmit，exit 0
```

## 小结

isolate 的本质是「服务名 → symbol 键」这张表的原型链 shadow：改一个 own 属性，就划出一个新世界；store 以键存实现，所以同名服务可以多份并存、独立卸载。隔离是调用方单方面的决定，插件无需配合——这正是 seam（时间可组合）之外的空间可组合性。下一篇 loader 示例把这套机制交给配置树：`cordis.yml` 里的每一行 entry 如何变成 fiber，`isolate:` 字段如何变成命名 realm。