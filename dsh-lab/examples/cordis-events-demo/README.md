# Cordis 的事件示例

本示例演示 cordis 事件系统的五种派发模式：`emit` / `parallel` / `serial` / `bail` / `waterfall`，外加两条规则——监听器本身也是 effect（插件卸载时自动摘除），`internal/dispatch` 是能看到全部事件的观测入口。

seam 示例讲「谁提供、谁消费」，fiber 示例讲插件的生命周期，这一篇讲插件之间怎么通信。cordis 的事件系统不是 EventEmitter 的换皮：同一套监听器注册机制上，五个派发方法对应五种不同的控制流。

## 1 自己写事件总线会碰到的三个问题

不用框架管理事件时，有三件事很容易出错：

- **语义靠约定**：「通知所有人」「问谁能处理」「让中间件改写默认行为」是三种完全不同的控制流，手写总线往往只有一个 `emit`，语义靠文档和自觉维持。

- **错误处理不一致**：一个监听器抛错，是中断整条链、还是收集起来继续？每个调用点各自 try/catch，行为不可预测。

- **监听器泄漏**：插件卸载了，它注册的监听器还在总线上——回调打到已销毁的状态上，和 fiber 示例里「忘记清理的定时器」是同一类问题。

> 把控制流语义做进派发方法，把监听器生命周期绑进 fiber。

cordis 的做法：注册走 `ctx.on()`（内部是 `ctx.fiber.effect()`），派发按语义选方法，两个问题一起解决。

## 2 五种派发模式：一张表选方法

![五种事件派发模式](diagrams/dispatch-modes.svg)

交互版：[dispatch-modes.html](diagrams/dispatch-modes.html) · IR 源：[dispatch-modes.architecture.json](diagrams/dispatch-modes.architecture.json)

- **按用途选模式**：只想广播用 emit，不关心结果 · 想问「谁能处理」用 bail 或 serial · 想改写或替换默认行为用 waterfall
- **非空判定的陷阱**：数字 0 与空字符串都被判为非空 · 监听器返回 0 会意外中断整条链 · 要表达「我不处理」必须返回 null、false 或不返回
- **同步与异步的对应关系**：bail 与 serial 语义相同，差别只在是否 await · emit 与 parallel 同为无返回值的通知 · parallel 用 allSettled，单个失败不影响其余

源码里五个方法共用一个预处理 `_resolve()`（events.ts:86-96）：shift 掉可选的 thisArg 与事件名、必要时触发 `internal/dispatch`、按 `Context.filter` 筛监听器。差别只在筛完之后怎么跑：

| 模式 | 同步/异步 | 中断条件 | 返回值 | 源码位置 |
|---|---|---|---|---|
| `emit` | 同步 | 不中断 | `void` | events.ts:121 |
| `parallel` | 异步 | 不中断（收集全部错误） | `Promise<void>` | events.ts:110 |
| `bail` | 同步 | 首个 `isBailed` | 该值 | events.ts:137 |
| `serial` | 异步 | 首个 `isBailed` | `Promise<该值>` | events.ts:128 |
| `waterfall` | 取决于监听器 | 由 `next()` 控制 | 链的返回值 | events.ts:146 |

## 3 emit 与 parallel：两种错误语义

emit 是同步广播：逐个 `Reflect.apply`，**不接异常**——监听器抛错直接穿透给调用方。parallel 是并发上报：`Promise.allSettled` 等所有监听器 settle，失败的收集成带事件名的 `AggregateError`：

```ts
ctx.on('lab/report', async (msg) => { await sleep(20); console.log('[上报 A] 完成', msg) })
ctx.on('lab/report', async () => { await sleep(10); throw new Error('上报 B 失败') })
await ctx.parallel('lab/report', 'metrics')
// 抛 AggregateError: one or more listeners of event "lab/report" failed
// 但上报 A 仍然完成了——allSettled 不因单个失败取消其余
```

实测里 A 的完成日志先于 AggregateError 出现：B 在 10ms 就失败了，parallel 仍等到 20ms A 完成才抛错。这就是「收集全部错误」的字面意思。而 emit 的对照实验里，监听器抛的 `监听器抛错` 原样穿透到调用方的 catch——两种通知方法，两种错误处理方式，选方法就是选错误语义。

## 4 bail 与 serial：0 也算认领

bail 是询问式派发：「谁来处理？」依次问监听器，首个「非空」返回值即认领并中断。判定函数只有三行（events.ts:6-8）：

```ts
export function isBailed(value: any) {
  return value !== null && value !== false && value !== undefined
}
```

注意它**不是** truthy 判定：`0`、`''`、`NaN` 都算认领。示例里五个监听器依次返回 `undefined / null / false / 0 / 'E'`，实测只问到 D——返回 0 的那个——E 永远没被问到。要表达「我不处理」，必须显式返回 `null`、`false` 或什么都不返回；意外返回一个计数 0，整条链就被你截断了。

serial 是 bail 的异步版：逐个 `await`，同样认 `isBailed`。示例里第三个监听器埋了一个「不会被执行」的 throw，实测它确实没跑——第二个监听器返回字符串后链就停了。责任链语义（「恰好一个接盘者」）与 waterfall 的中间件语义的分界，见下一节。

## 5 waterfall：洋葱模型

![waterfall：监听器组成中间件链](diagrams/waterfall-chain.svg)

交互版：[waterfall-chain.html](diagrams/waterfall-chain.html) · IR 源：[waterfall-chain.sequence.json](diagrams/waterfall-chain.sequence.json)

- **waterfall 与其余四种派发的区别**：emit / parallel / serial / bail 都是把监听器当独立处理器 · waterfall 把它们串成一条可委托的链 · 每个监听器拿到的最后一个参数是 next
- **inner 的位置**：调用方传入的最后一个函数被 pop 出来当兜底 · 链全部让行时才执行，且以无参形式调用 · 这让插件可以拦截并改写框架默认行为
- **短路的代价**：监听器不调 next 就直接返回，后面的链全部跳过 · inner 也不会执行，默认行为被完全替换 · 注册顺序因此决定了拦截优先级

waterfall 的本体只有十八行（events.ts:146-163），三个动作撑起整个洋葱模型：`args.pop()` 取出末位兜底函数 inner；每次 `dispatch()` 用索引前进消费一个监听器（先跳过 `removed` 的）；给监听器的参数是 `[...args, next]` 浅拷贝。示例跑了三条轨迹：

```ts
ctx.on('lab/wrap', (_text, next) => `【A】${next()}`)   // 先注册 → 最外层
ctx.on('lab/wrap', (_text, next) => `【B】${next()}`)
ctx.waterfall('lab/wrap', '原始文本', () => '【base】')  // → 【A】【B】【base】
```

进入时从外到内、返回时从内到外，和 Koa 中间件同构，但有三处关键差异：`next()` 是裸闭包不是 Promise（同步友好）；链尽头有调用方给的 inner 兜底；链成员每次派发经 filter 现算、随 fiber 自动回收。第二条轨迹里 B 位置换成不调 next 的 `() => '【接管】'`，结果 `【外层】【接管】`——外层包装仍在，默认行为被替换。第三条轨迹同一监听器调两次 next，抛 `next() called multiple times`，防护只是闭包里的一个布尔。

两条容易写错的契约：**inner 以无参形式执行**（`return inner()`，events.ts:153），拿不到业务参数，只能自带默认值；**纯观察也必须 `return next()`**，否则等于否决整条链——waterfall 里没有「旁路监听」这个选项。

## 6 监听器即 effect

`ctx.on()` 的注册走 `ctx.fiber.effect()`（events.ts:165-173）：返回值是注销函数，fiber 卸载时监听器自动摘除。示例对比了四种注册方式：root 上手动 `on`（拿 off 函数手动摘）、插件内普通 `on`、`{ prepend: true }` 的 `on`（unshift 到链首）、`once`（响一次自摘）。

监听器插件 `src/listener.ts` 在 cordis.yml 里声明（初始禁用），场景 ④ 经行句柄启用它、两次 emit 后再 dispose：

```ts
import type { Context } from 'cordis'
import { hits } from './state.ts'

export const name = 'listener-plugin'

export function apply(ctx: Context) {
  ctx.on('lab/ping', () => hits.push('普通'))
  ctx.on('lab/ping', () => hits.push('prepend'), { prepend: true })
  ctx.once('lab/ping', () => hits.push('once'))
}
```

实测命中顺序：

```text
prepend → 手动 → 普通 → once → prepend → 手动 → 普通
```

第一次四个全响（once 响完自摘），第二次剩三个，fiber dispose 后第三次 emit 什么也不发生。prepend 决定包裹顺序这件事在 waterfall 里尤其重要：`prepend: true` = 更外层 = 更高拦截优先级。

runner 与 listener 是两个插件，命中记录放在共享模块 `src/state.ts` 里（`export const hits: string[] = []`）——跨插件传状态用共享模块，不用全局变量。

## 7 internal/dispatch：全量观测入口

`_resolve()` 里有一行审计钩子（events.ts:89-91）：非 `internal/` 开头的字符串事件与 symbol 事件，只要存在 `internal/dispatch` 监听器，就额外发一次 `emit('internal/dispatch', type, name, args, thisArg)`。观测者收到的四个参数依次是派发类型、事件名、参数数组、thisArg。示例挂一个观测器后跑四种派发，实测：

```text
emit:lab/quiet waterfall:lab/wrap serial:lab/claim-async bail:lab/claim
```

`internal/` 开头的事件不上报——否则观测器会递归观测自身。没有观测器时这一行直接跳过，零开销。dsh 的轨迹记录与可视化埋点就是站在这个入口上拿全量事件流的。

## 8 运行事件示例

装配全部写在 `cordis.yml` 里，代码里没有一处 `ctx.use()`：

```yaml
# 事件示例的装配清单：监听器插件与场景 runner 都在这里声明
- id: listener
  name: ./src/listener.ts   # 监听器即 effect：随 fiber 回收（初始禁用，④ 里启用）
  disabled: true
- id: runner
  name: ./src/index.ts      # 场景驱动：五种派发模式的演示脚本
```

`npm start` 就是 cordis CLI：读当前目录的 `cordis.yml`，loader 逐行 import 模块，把导出的 `apply`、`inject`、`name` 当作插件定义挂上去。

`runner` 行挂的 `src/index.ts` 也是一个普通插件，负责驱动五个场景。它 inject 了 loader，场景 ④ 里拿到 listener 行的句柄做启用与卸载，不再手工挂任何插件：

```ts
export const name = 'runner'
export const inject = ['loader']

export function apply(ctx: Context) {
  // apply 同步返回：runner 自己的 fiber 先 settle，run() 再等整棵树，避免互相等待
  void run(ctx)
}

async function run(ctx: Context) {
  await ctx.loader.await()
  // ……①～③ 五种派发、⑤ 观测入口……
  const listener = row(ctx, 'listener')
  await listener.update({ disabled: false })   // 启用 yml 里声明的监听器插件
  await ctx.loader.await()
  ctx.emit('lab/ping')
  ctx.emit('lab/ping')
  await listener.dispose()                     // 卸载后监听器随之摘除
  ctx.emit('lab/ping')
}
```

在本机复现只需要四条命令：

```bash
npm install             # cordis 与 loader 依赖
#
npm start               # cordis CLI 读 cordis.yml（Node）：打印 ①～⑤ 的完整时序
npm run start:bun       # Bun 下直接跑 cordis 的 bin.js：输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1；Bun 1.4.4 逐行相同）：

```text
① emit 与 parallel：同步广播 vs 并发上报
   [监听器 1] 收到 hello
   [监听器 2] 收到 hello
   [上报 A] 完成 metrics
   parallel 抛 AggregateError： one or more listeners of event "lab/report" failed ，错误数 = 1
   emit 不接异常，直接穿透： 监听器抛错

② bail 与 serial：首个「非空」返回值即认领，0 也算非空
   bail 结果： 0 （0 被 isBailed 判为认领）
   被问到的监听器： A(undefined) → B(null) → C(false) → D(返回 0)
   serial 结果： 异步认领者 （逐个 await，认领即停）

③ waterfall：洋葱模型，next() 委托，不调 next 即否决
   全链委托： 【A】【B】【base】
   中途否决： 【外层】【接管】
   重复调 next： next() called multiple times

④ 监听器即 effect：prepend 定顺序，once 只响一次，随 fiber 回收
   命中顺序： prepend → 手动 → 普通 → once → prepend → 手动 → 普通

⑤ internal/dispatch：全量事件流的观测入口
   观测到： emit:lab/quiet waterfall:lab/wrap serial:lab/claim-async bail:lab/claim
   （internal/ 开头的事件不上报，避免递归观测自身）
演示结束
```

装配路径依赖 cordis 的四个可选 peer 包：`@cordisjs/loader`、`@cordisjs/include`、`@cordisjs/fs`、`@cordisjs/fs-node`，已写进 `package.json`。

## 9 容易踩的坑

### isBailed 不是 truthy

返回 `0`、`''`、`NaN` 都会截断 bail/serial 链。监听器里写 `return count` 而 count 恰好为 0 时，后续监听器静默不执行——不报错、不告警。表达「让行」只用 `null` / `false` / 无返回。

### emit 的异常穿透调用方

emit 没有 try/catch。一个监听器抛错，后面的监听器不再执行，异常落在 emit 的调用点。要「一个失败不影响其余」的并发语义，用 parallel 并接住 AggregateError。

### waterfall 的链是派发时刻的快照

`_resolve` 过滤产出新数组，索引推进不碰 `_hooks`：派发期间新注册的监听器不影响本次链；派发期间注销的经 `removed` 标志跳过。别指望在监听器里注册下一个监听器来「动态接链」。

### 浅拷贝只复制一层

监听器收到 `[...args, next]`：重新赋值参数元素不会传导给下游，但修改对象元素的内容仍然共享可见。想改写下游看到的东西，改对象内容或靠返回值加工，不要靠重新赋值参数。

### once 的自摘发生在回调之前

`once` 的包装先调 dispose 再执行监听器（events.ts:202-208）。监听器内部再 emit 同一事件时，自己已经不在链上——不会递归触发自身。

## 10 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis 直接运行 TypeScript（Node 依赖原生类型擦除，Bun 自带转译），没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
cordis-events-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── cordis.yml            # 唯一装配入口：listener 与 runner 两行
├── .gitignore
├── src/
│   ├── index.ts          # runner 插件：五个场景的演示脚本
│   ├── listener.ts       # 监听器插件：普通 / prepend / once 三种注册
│   └── state.ts          # 跨插件共享的命中记录
└── diagrams/             # 派发模式对照 + waterfall 链：SVG / 交互 HTML / IR 源
```

### package.json

```json
{
  "name": "cordis-events-demo",
  "private": true,
  "type": "module",
  "description": "五种事件派发模式（emit / parallel / serial / bail / waterfall）、监听器即 effect、internal/dispatch 观测。Node 与 Bun 双运行时。",
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

正文第 8 节展示的是节选；这里是可直接运行的完整文件。它由 cordis.yml 的 runner 行挂载，依次演示五种派发模式、监听器随 fiber 回收、全量观测入口。

```ts
/**
 * 事件系统的五种派发模式：emit / parallel / serial / bail / waterfall。
 * 外加两条规则：监听器即 effect（随 fiber 回收）、internal/dispatch 是全量观测入口。
 *
 * runner：由 cordis.yml 的 runner 行挂载，代码里没有一处 ctx.use / ctx.plugin；
 * listener 插件在 cordis.yml 里声明（初始禁用），④ 里经行句柄启用与卸载。
 */
import type { Context } from 'cordis'
import type { Entry } from '@cordisjs/loader'
import { hits } from './state.ts'

export const name = 'runner'
export const inject = ['loader']

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

declare module 'cordis' {
  interface Events {
    'lab/notice'(msg: string): void
    'lab/boom'(): void
    'lab/report'(msg: string): void
    'lab/claim'(msg: string): string | number | null | false | undefined
    'lab/claim-async'(msg: string): Promise<string | null | undefined>
    'lab/wrap'(text: string, next: () => string): string
    'lab/gate'(text: string, next: () => string): string
    'lab/double'(text: string, next: () => string): string
    'lab/ping'(): void
    'lab/quiet'(): void
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

  console.log('① emit 与 parallel：同步广播 vs 并发上报')
  ctx.on('lab/notice', (msg) => console.log('   [监听器 1] 收到', msg))
  ctx.on('lab/notice', (msg) => console.log('   [监听器 2] 收到', msg))
  ctx.emit('lab/notice', 'hello')
  ctx.on('lab/report', async (msg) => {
    await sleep(20)
    console.log('   [上报 A] 完成', msg)
  })
  ctx.on('lab/report', async () => {
    await sleep(10)
    throw new Error('上报 B 失败')
  })
  try {
    await ctx.parallel('lab/report', 'metrics')
  } catch (error) {
    const agg = error as AggregateError
    console.log('   parallel 抛 AggregateError：', agg.message, '，错误数 =', agg.errors.length)
  }
  ctx.on('lab/boom', () => {
    throw new Error('监听器抛错')
  })
  try {
    ctx.emit('lab/boom')
  } catch (error) {
    console.log('   emit 不接异常，直接穿透：', (error as Error).message, '\n')
  }

  console.log('② bail 与 serial：首个「非空」返回值即认领，0 也算非空')
  const asked: string[] = []
  ctx.on('lab/claim', () => {
    asked.push('A(undefined)')
    return undefined
  })
  ctx.on('lab/claim', () => {
    asked.push('B(null)')
    return null
  })
  ctx.on('lab/claim', () => {
    asked.push('C(false)')
    return false
  })
  ctx.on('lab/claim', () => {
    asked.push('D(返回 0)')
    return 0
  })
  ctx.on('lab/claim', () => {
    asked.push('E(不会被问到)')
    return 'E'
  })
  const answer = ctx.bail('lab/claim', '谁来处理？')
  console.log('   bail 结果：', answer, '（0 被 isBailed 判为认领）')
  console.log('   被问到的监听器：', asked.join(' → '))
  ctx.on('lab/claim-async', async () => {
    await sleep(5)
    return null
  })
  ctx.on('lab/claim-async', async () => {
    await sleep(5)
    return '异步认领者'
  })
  ctx.on('lab/claim-async', async () => {
    throw new Error('不会被执行')
  })
  const asyncAnswer = await ctx.serial('lab/claim-async', '谁来处理？')
  console.log('   serial 结果：', asyncAnswer, '（逐个 await，认领即停）', '\n')

  console.log('③ waterfall：洋葱模型，next() 委托，不调 next 即否决')
  ctx.on('lab/wrap', (_text, next) => `【A】${next()}`)
  ctx.on('lab/wrap', (_text, next) => `【B】${next()}`)
  // inner 以无参形式执行：拿不到 '原始文本'，只能自带默认值
  console.log('   全链委托：', ctx.waterfall('lab/wrap', '原始文本', () => '【base】'))
  ctx.on('lab/gate', (_text, next) => `【外层】${next()}`)
  ctx.on('lab/gate', () => '【接管】')   // 不调 next：下游与 inner 全部跳过
  console.log('   中途否决：', ctx.waterfall('lab/gate', 'x', () => '【base】'))
  ctx.on('lab/double', (_text, next) => {
    next()
    return next()
  })
  try {
    ctx.waterfall('lab/double', 'x', () => 'base')
  } catch (error) {
    console.log('   重复调 next：', (error as Error).message, '\n')
  }

  console.log('④ 监听器即 effect：prepend 定顺序，once 只响一次，随 fiber 回收')
  const off = ctx.on('lab/ping', () => hits.push('手动'))
  // listener 插件在 cordis.yml 里声明为 disabled: true，这里启用它
  const listener = row(ctx, 'listener')
  await listener.update({ disabled: false })
  await ctx.loader.await()
  ctx.emit('lab/ping')
  ctx.emit('lab/ping')
  off()                        // on() 返回注销函数，手动监听随调随摘
  await listener.dispose()
  ctx.emit('lab/ping')         // fiber 已卸载：这次 emit 什么也不发生
  console.log('   命中顺序：', hits.join(' → '), '\n')

  console.log('⑤ internal/dispatch：全量事件流的观测入口')
  const trail: string[] = []
  ctx.on('internal/dispatch', (mode, name) => {
    trail.push(`${mode}:${String(name)}`)
  })
  ctx.emit('lab/quiet')
  ctx.waterfall('lab/wrap', 't', () => 'base')
  await ctx.serial('lab/claim-async', 'q')
  ctx.bail('lab/claim', 'q')
  console.log('   观测到：', trail.join(' '))
  console.log('   （internal/ 开头的事件不上报，避免递归观测自身）')

  console.log('演示结束')
  // cordis CLI 靠文件 watch 保持进程存活；演示做完主动退出
  process.exit(0)
}
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `cordis` 与 `@cordisjs/loader`。

2. `npm start` 打印 ①～⑤ 五段，末行是「演示结束」，与第 8 节的输出逐行一致。

3. `npm run start:bun` 输出与上一条逐行相同——同一份清单，两个运行时。

4. `npm run typecheck` 无任何输出、退出码 0，说明事件名与载荷的类型契约成立。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。Node 需 22.18 以上（原生类型擦除），低于此版本改用 `npm run start:bun`。

## 11 小结

事件系统的五个方法是五种控制流：emit 广播、parallel 并发收错、bail/serial 询问认领、waterfall 委托改写。选方法就是选错误处理方式与中断条件；`isBailed` 的三值排除和 inner 的无参契约是最容易写错的两处。监听器注册即 fiber effect，卸载自动摘除——事件通信和生命周期管理在 effect 这一层用的是同一套机制。下一篇 isolate 示例讲「哪些监听器看得见这次派发」：`Context.filter` 与 realm 隔离。