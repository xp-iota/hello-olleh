# 03 · Cordis 的事件示例

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

emit 是同步广播：逐个 `Reflect.apply`，**不接异常**——一个监听器抛错，后面的监听器不再执行，异常直接穿透落在 emit 的调用点。parallel 是并发上报：`Promise.allSettled` 等所有监听器 settle，失败的收集成带事件名的 `AggregateError`：

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

还有两条派发时刻的语义。其一，**链是派发时刻的快照**：`_resolve` 过滤产出新数组，索引推进不碰 `_hooks`——派发期间新注册的监听器不影响本次链，派发期间注销的经 `removed` 标志跳过；别指望在监听器里注册下一个监听器来「动态接链」。其二，**浅拷贝只复制一层**：监听器收到 `[...args, next]`，重新赋值参数元素不会传导给下游，但修改对象元素的内容仍然共享可见——想改写下游看到的东西，改对象内容或靠返回值加工，不要靠重新赋值参数。

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

第一次四个全响（once 响完自摘），第二次剩三个，fiber dispose 后第三次 emit 什么也不发生。prepend 决定包裹顺序这件事在 waterfall 里尤其重要：`prepend: true` = 更外层 = 更高拦截优先级。once 的自摘发生在回调之前：包装先调 dispose 再执行监听器（events.ts:202-208），监听器内部再 emit 同一事件时，自己已经不在链上——不会递归触发自身。

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

## 9 源码视角：五种控制流在 Cordis 内部如何做到

摘录取自本仓 vendored 源码 `deepseek-harness/vendor/cordis/src`（4.1.0，rc.11 基线）；本示例运行 cordis 4.0.0-rc.13，差异处单独标注。逐行精读见 [事件系统与 waterfall](../../../docs/hello-cordis/06-event-system-and-waterfall.md)。

### 9.1 五个方法共用一个预处理：_resolve

正文第 2 节表格里的「源码位置」之外，更值得读的是五个方法共同的第一步（`events.ts:162-171`）：

```ts
private _resolve(type: string, args: any[]) {
  const thisArg = typeof args[0] === 'object' || typeof args[0] === 'function' ? args.shift() : null
  const name: string | symbol = args.shift()
  if ((typeof name !== 'string' || !name.startsWith('internal/')) && this._hooks['internal/dispatch']?.length) {
    this.emit('internal/dispatch', type, name, args, thisArg)
  }
  const filter = thisArg?.[Context.filter]
  return [thisArg, (this._hooks[name] || [])
    .filter(hook => hook.global || !filter || filter.call(thisArg, hook.ctx)).map(hook => hook.callback)] as const
}
```

四件事一次做完：shift 出可选 thisArg 与事件名；非 internal 事件且存在观测器时补发 `internal/dispatch`（第 7 节的观测入口就是这一行，`?.length` 保证没有观测器时零开销）；取 thisArg 上的 `Context.filter`（isolate 篇的事件过滤从这里进来）；filter + map 产出**新数组**——这就是「链是派发时刻的快照」的出处。五个派发方法的差别只在拿到这个数组之后怎么跑：emit 是裸 for 循环，parallel 是 `Promise.allSettled` 后收集 rejected 抛 `AggregateError`（`events.ts:191-196`），bail/serial 逐个跑并按 `isBailed` 停。

### 9.2 waterfall：一个递归闭包

洋葱模型的本体（`events.ts:246-261`）：

```ts
waterfall(...args: any[]) {
  const [thisArg, callbacks] = this._resolve('waterfall', args)
  const inner = args.pop()
  const dispatch = () => {
    const callback = callbacks.shift()
    if (!callback) return inner()
    let called = false
    const next = () => {
      if (called) throw new Error('next() called multiple times')
      called = true
      return dispatch()
    }
    return Reflect.apply(callback, thisArg, [...args, next])
  }
  return dispatch()
}
```

三个动作对应第 5 节的三条契约：`args.pop()` 取出 inner，链尽头 `return inner()` 无参调用；不调 next 就不递归，下游与 inner 全跳过；重复调 next 被闭包里的布尔挡住。`[...args, next]` 是浅拷贝一层。rc.13 把 `shift()` 改成索引推进并跳过 `removed` 标志的监听器（派发期间被注销的监听器不再执行），快照语义不变；本摘录的 rc.11 形态里 shift 直接消费快照数组，效果等价。

### 9.3 once 为什么不会递归触发自身

once 不是特殊注册类型，就是一层包装（`events.ts:317-323`）：

```ts
once(name: string | symbol, listener: (...args: any) => any, options?: boolean | EventOptions) {
  const dispose = this.on(name, function (...args: any[]) {
    dispose()
    return listener.apply(this, args)
  }, options)
  return dispose
}
```

`dispose()` 在 `listener` 之前执行——回调内部再 emit 同一事件时，自己已经不在链上。第 6 节「自摘发生在回调之前」不是时序巧合，是这两行的书写顺序。

### 9.4 监听器即 effect：注册与回收的同一条缝

`on` 最终走 `register`，注册包在 fiber effect 里（`events.ts:263-270`）：

```ts
private register(label: string, name: string | symbol, callback: any, options: EventOptions): () => void {
  const method = options.prepend ? 'unshift' : 'push'
  return this.ctx.fiber.effect(() => {
    const hooks = this._hooks[name] ??= []
    hooks[method]({ ctx: this.ctx, callback, ...options })
    return () => this.unregister(name, callback)
  }, label)
}
```

`prepend` 就是 unshift 与 push 的区别——第 6 节命中顺序里 prepend 排最前、waterfall 里 prepend 是最外层，都从这一行来。清理函数 `unregister` 挂在 fiber 上，dispose 时按 [02 篇 8.3](../02-cordis-fiber-demo/README.md#83-逆序启动并发执行两行源码定死的行为) 的流程自动执行。事件通信和生命周期管理在 effect 这一层确实是同一套机制。

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

正文第 8 节展示的是节选；完整文件就在本目录 [src/index.ts](src/index.ts)，由 cordis.yml 的 runner 行挂载，依次演示五种派发模式、监听器随 fiber 回收、全量观测入口。脚手架各写法的含义见 [01 篇第 5 节的速览表](../01-cordis-seam-demo/README.md#脚手架速览照抄即可原理在-05-篇展开)。

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `cordis` 与 `@cordisjs/loader`。

2. `npm start` 打印 ①～⑤ 五段，末行是「演示结束」，与第 8 节的输出逐行一致。

3. `npm run start:bun` 输出与上一条逐行相同——同一份清单，两个运行时。

4. `npm run typecheck` 无任何输出、退出码 0，说明事件名与载荷的类型契约成立。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。Node 需 22.18 以上（原生类型擦除），低于此版本改用 `npm run start:bun`。

## 11 延伸阅读

本文把五个派发方法各自当黑盒观察；waterfall 递归闭包的逐行走读、`internal/dispatch` 在 dsh 轨迹系统里的完整用法、事件与 isolate 过滤的交互，在 [事件系统与 waterfall](../../../docs/hello-cordis/06-event-system-and-waterfall.md) 一篇里展开，还附派发模式全对照表与洋葱模型的完整时序图。

## 12 小结

事件系统的五个方法是五种控制流：emit 广播、parallel 并发收错、bail/serial 询问认领、waterfall 委托改写。选方法就是选错误处理方式与中断条件；`isBailed` 的三值排除和 inner 的无参契约是最容易写错的两处。监听器注册即 fiber effect，卸载自动摘除——事件通信和生命周期管理在 effect 这一层用的是同一套机制。下一篇 isolate 示例讲「哪些监听器看得见这次派发」：`Context.filter` 与 realm 隔离。

上一篇：[02 · Cordis 的 fiber 示例](../02-cordis-fiber-demo/README.md) ｜ 下一篇：[04 · Cordis 的 isolate 示例](../04-cordis-isolate-demo/README.md)