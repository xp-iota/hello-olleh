# Cordis 的 seam 示例

本示例将演示如何开发一个 seam，示例`greeter` 涵盖了 cordis 里四种角色：定义服务者、提供服务者、使用服务者、记录事件者。

- **插件**是实现 [**Service**](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-api/service) 的对象。它可以是一个带有可选 `inject` 和 `apply(ctx)` 字段的函数，也可以是一个 `Service` 子类，其生命周期由 Cordis 挂载到当前上下文中。

- [**上下文**](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-api/context)是 **Service** 的容器。一个 **Service** 占据一个稳定的 `ctx.<key>`（如 `ctx.tools`、`ctx.llm`、`ctx.sessions`）；其他插件通过 key 查找服务，而非导入具体实现。

- 通过 `inject` 声明服务依赖。插件声明所需的服务后，会等待这些服务就绪才启动；加载顺序通过服务依赖表达，而非手动编排启动序列。

- 类型化[**事件**](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-api/events)用于通信。服务通过 TypeScript 声明合并注册事件名，然后以 `emit`、`waterfall`（瀑布式事件）、`parallel`、`serial` 或 `bail` 方式分发，分别对应监听者观察、包装、并行扇出、按序执行或停在首个 bail 值。

- [**注册**](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-api/registry)是可逆的副作用。提示词片段、工具 schema、适配器、提供方和监听器通过 `ctx.effect()` 或 `ctx.on()` 安装，reload 和 teardown 时会按预期撤销。

## 1 插件之间不直接 import

两个插件如果直接 import 彼此，表面上少写了几行胶水，实际有三个麻烦：

- **换不了实现**：调用方 import 的是具体类，想把它换成「英文问候」之外的实现，就得改调用方。

- **启动顺序写死**：谁先被 new 出来、谁后初始化，全靠手工安排；顺序一错就是 undefined。

- **卸载顺序靠自觉**：服务先销毁、使用方还在跑，是最难查的一类空指针。

> 依赖倒置原则 Dependency Inversion Principle(DIP)

seam 的思路很简单：把「提供能力」和「消费能力」拆开，两侧都只认识一份只含词汇、不含实现的定义。provider 实现它，consumer 声明需要它，谁在什么时机被激活、被卸载，交给框架调度。这条缝在 Harness 里被称为 capability seam——文件系统、凭据、附件都各自有这样一条接缝——但它本身没有任何框架魔法，四个角色、两个 API 就够。

![seam 的四个角色](diagrams/seam-roles.svg)

交互版：[seam-roles.html](diagrams/seam-roles.html) · IR 源：[seam-roles.architecture.json](diagrams/seam-roles.architecture.json)

- 契约：服务名 greeter 两侧逐字一致；`declare module 'cordis'` 同时给出 ctx 与事件类型；事件载荷 GreetEvent 也是契约的一部分。
- 运行时由 cordis 连接：构造即注册，服务挂在 provider 的 fiber 上；inject 未满足时 consumer 停在 PENDING；卸载先撤 consumer，再注销服务。
- 两类消费者：服务型要用它完成工作、按依赖调度；事件型发生了要知道、没人听事件照发；audit 不随 provider 重启而重启。

图里没有一条线直接连在 provider 和 consumer 的「实现」之间：两条向上的线是「都依赖定义」，横向与斜向的线是「运行时由框架连接」。这正是 seam 的形状。

## 2 服务定义

定义文件回答三个问题：服务叫什么、要提供什么能力、会广播哪些事实。除此之外一行实现都不该有，这样它才能被所有插件安全依赖。

```ts
import { Service } from 'cordis'
import type { Context } from 'cordis'

/** `greeter/greet` 事件携带的数据：一次问候已经发生 */
export interface GreetEvent {
  provider: string   // 是哪个 provider 说的
  name: string       // 说给谁听
  text: string       // 具体说了什么
}

export abstract class Greeter extends Service {
  constructor(ctx: Context) {
    // 第二个参数就是服务名：构造即注册，注册在 provider 插件的 fiber 上
    super(ctx, 'greeter')
  }

  /** seam 承诺的能力：provider 必须实现，consumer 只依赖它 */
  abstract greet(name: string): string
}

declare module 'cordis' {
  interface Context {
    greeter: Greeter
  }
  interface Events {
    /** 接缝上的广播：任何 provider 说出一句问候时触发 */
    'greeter/greet'(this: Context, event: GreetEvent): void
  }
}
```

有三个细节值得单独说：

- **服务名是契约的一部分**。`super(ctx, 'greeter')` 与 consumer 的 `inject: ['greeter']` 必须逐字一致，名字改了就是破坏性变更。

- **类型靠模块增强共享**。`declare module 'cordis'` 同时给 `ctx.greeter` 和 `ctx.on('greeter/greet')` 提供类型，两侧拿到的词汇完全一致，写错属性名编译期就报错。

- **事件也是契约**。事件名带 `greeter/` 命名空间避免撞名，载荷结构由 `GreetEvent` 固定；改载荷等于改 API，和改方法签名一样需要评估。改载荷字段名时，所有监听者会静默收到 `undefined`；类型检查能挡住大部分，跨包、跨仓库时要靠版本号与变更记录兜底。

## 3 Provider：构造即注册，动作即广播

provider 只做两件事：实现能力、在动作发生时把事实广播出去。它不知道谁在消费，也不知道有没有人在听。

```ts
import type { Context } from 'cordis'
import { Greeter } from './seam.ts'

export const name = 'provider-en'
export const provide = ['greeter']   // 可选元数据，供 loader / 静态分析使用

class EnglishGreeter extends Greeter {
  greet(name: string) {
    const text = `Hello, ${name}!`
    // provider 的动作：说出问候，同时把这件事作为事实广播出去
    this.ctx.emit('greeter/greet', { provider: 'provider-en', name, text })
    return text
  }
}

export function apply(ctx: Context) {
  console.log('[provider-en] 注册 ctx.greeter')
  new EnglishGreeter(ctx)   // 构造 Service 就是注册
  // 卸载日志也是 effect：fiber 销毁时按注册逆序执行清理
  ctx.effect(() => () => console.log('[provider-en] 卸载，ctx.greeter 随即消失'))
}
```

最关键的一行是 `new EnglishGreeter(ctx)`：`Service` 的构造函数会调用 `ctx.provide('greeter', this)`，而 `ctx.provide` 又把这个服务挂到当前插件的 fiber 上。于是「provider 被卸载」与「服务消失」是同一件事，不需要任何手写的注销代码。同一隔离域里同名服务只能有一个提供者：第二个 provider 激活时直接抛 `service "greeter" has been registered at <provider-en>`。要让两套实现共存（多语言实例、多租户），用 `ctx.isolate('greeter')` 划出互相隔离的命名空间，见 [isolate 示例](../cordis-isolate-demo/README.md)。

第二关键的是 `this.ctx.emit`：动作发生的那一刻同步派发事件。此时 provider 既没有等待返回值，也不检查有没有监听者——没人听，事件就安静地过去，这是事件模型该有的样子。

最后一行的 `ctx.effect(() => () => …)` 是卸载日志的挂点：effect 的返回值是清理函数，fiber 销毁时逆序执行。它顺便演示了「注册是可逆副作用」——连一行日志的安装与撤销都走同一条机制。

## 4 两个消费者：一个问能力，一个只记事实

「消费」有两种情况。需要拿服务干活的，是强依赖，用 `inject` 声明；只想记录「发生过什么」的，是弱依赖，用 `ctx.on` 订阅。

```ts
import type { Context } from 'cordis'

export const name = 'consumer'
export const inject = ['greeter']

export function apply(ctx: Context) {
  console.log('[consumer] 激活，调用 ctx.greeter.greet() →', ctx.greeter.greet('cordis'))
  // 服务型 consumer 的卸载日志：provider 消失时 cordis 先卸载本插件，再注销服务
  ctx.effect(() => () => console.log('[consumer] 卸载'))
}
```

```ts
import type { Context } from 'cordis'

export const name = 'audit'

export function apply(ctx: Context) {
  console.log('[audit] 开始监听 greeter/greet（此刻还没有任何 provider）')
  ctx.on('greeter/greet', (event) => {
    console.log(`[audit] 记录：${event.provider} 对 ${event.name} 说了「${event.text}」`)
  })
}
```

`audit` 是那个「更适合的实体」：它不关心 provider 是否存在、是哪种语言实现，也不需要跟着 provider 重启。如果把这行记录日志的代码塞进 provider，就得在每次实现里复制一遍；如果塞进 consumer，就得让日志逻辑跟着「需要业务服务」一起被激活和卸载——两种都不对。

|维度|服务注入 inject|事件订阅 ctx.on|
|---|---|---|
|依赖强度|强：服务必须先存在|弱：provider 在不在都行|
|激活时机|cordis 按依赖调度|自己随时可挂，收到事件才跑|
|适合表达|「我要用它完成我的工作」|「这件事发生了，我要知道 / 记录 / 追加动作」|
|失败语义|服务缺失 = 这段逻辑不能跑|没人监听 = 事件照发，什么也不发生|

## 5 运行seam示例

装配全部写在 `cordis.yml` 里，代码里没有一处 `ctx.use()`。挂插件的底层 API 就是 `ctx.use()`（旧版本叫 `ctx.plugin()`，仍保留为 deprecated 别名）；本示例不直接调它，插件一律由清单声明、loader 挂载，升级时以实际类型声明为准。

```yaml
# 插件与装配分离：换实现只改这个文件，src 里的代码不用动
- id: audit
  name: ./src/audit.ts        # 事件型 consumer：只监听 greeter/greet
- id: consumer
  name: ./src/consumer.ts     # 服务型 consumer：inject 未满足时会等待
- id: provider-en
  name: ./src/provider-en.ts  # provider：注册 ctx.greeter 并广播事件
- id: provider-pirate
  name: ./src/provider-pirate.ts  # 另一个 provider：先声明为禁用，运行时再启用
  disabled: true
- id: runner
  name: ./src/index.ts        # 场景驱动：不挂插件，只对上面的行做运行时开关
```

`npm start` 就是 cordis CLI：读当前目录的 `cordis.yml`，loader 逐行 import 模块，把导出的 `apply`、`inject`、`name` 当作插件定义挂上去。consumer 声明在 provider 前面也没关系——inject 未满足就等着，服务一出现自动激活。

`runner` 行挂的 `src/index.ts` 也是一个普通插件，负责驱动演示场景。它 inject 了 loader，拿到每一行的句柄，运行时翻转 `disabled`、dispose，不再手工挂任何插件：

```ts
export const name = 'runner'
export const inject = ['loader']

export function apply(ctx: Context) {
  // apply 同步返回：runner 自己的 fiber 先 settle，run() 再等整棵树，避免互相等待
  void run(ctx)
}

async function run(ctx: Context) {
  await ctx.loader.await()
  // ……越权探针、root 侧调用……
  await row(ctx, 'provider-en').update({ disabled: true })      // 禁用一行
  await row(ctx, 'provider-pirate').update({ disabled: false }) // 启用另一行
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
[audit] 开始监听 greeter/greet（此刻还没有任何 provider）
[provider-en] 注册 ctx.greeter
[audit] 记录：provider-en 对 cordis 说了「Hello, cordis!」
[consumer] 激活，调用 ctx.greeter.greet() → Hello, cordis!

① 启动即在位：provider-en 由 cordis.yml 声明，consumer 已自动激活
   consumer 状态 = ACTIVE

② 没声明 inject 的插件直接读 ctx.greeter（本 runner 只 inject 了 loader）
   结果：cannot get property "greeter" without inject

③ 换一个调用方（root 侧 ctx.get 直接调用服务）：事件照样广播
[audit] 记录：provider-en 对 root 说了「Hello, root!」

④ 禁用 provider-en 行：entry.update({ disabled: true })
[consumer] 卸载
[provider-en] 卸载，ctx.greeter 随即消失
   consumer 状态 = PENDING
   结果：provider 卸载时先卸载依赖它的 consumer，再注销服务；audit 不受影响
   ctx.get("greeter") = undefined

⑤ 启用 provider-pirate 行（yml 里声明为 disabled: true）：consumer 的代码一行没改
[provider-pirate] 注册 ctx.greeter
[audit] 记录：provider-pirate 对 cordis 说了「Ahoy, cordis!」
[consumer] 激活，调用 ctx.greeter.greet() → Ahoy, cordis!
   consumer 状态 = ACTIVE
   结果：同一条 seam 换了实现，服务型与事件型 consumer 都被重新触发

[consumer] 卸载
[provider-pirate] 卸载，ctx.greeter 随即消失
演示结束
```

![一次完整生命周期](diagrams/seam-lifecycle.svg)

交互版：[seam-lifecycle.html](diagrams/seam-lifecycle.html) · IR 源：[seam-lifecycle.sequence.json](diagrams/seam-lifecycle.sequence.json)

- 正向：inject 未满足时 consumer 停在 PENDING；provider 一出现，cordis 自动激活 consumer；greet 调用内部同步广播事件。
- 反向：禁用 provider 行时先卸载依赖它的 consumer，再注销服务本身；audit 全程不受影响；服务消失时 consumer 回到 PENDING 而非销毁。
- 原地复活：启用 provider-pirate 行，同一 fiber 重新加载，consumer 的代码一行没改；生命周期为 PENDING → LOADING → ACTIVE → UNLOADING。

换实现也可以不用运行时开关：把 yml 里 `provider-en` 行的 name 改成 `./src/provider-pirate.ts` 再重启，输出随之变成海盗腔，audit 与 consumer 一行都没改。

装配路径依赖 cordis 的四个可选 peer 包：`@cordisjs/loader`、`@cordisjs/include`、`@cordisjs/fs`、`@cordisjs/fs-node`，已写进 `package.json`。

五个可观察现象，正好对应五条机制：

1. **pending 不执行**：注入未满足时插件停在 pending，`apply()` 从未被调用，也就没有「半初始化」的中间态。

2. **激活与挂载顺序无关**：yml 里 consumer 声明在 provider 前面，服务一出现 consumer 自动激活。依赖顺序由声明决定，不由清单顺序决定。

3. **访问必须有声明**：没 inject 却读 `ctx.greeter`，运行时抛 `cannot get property "greeter" without inject`；类型层面同样挡住，因为 `ctx.greeter` 的类型只来自 seam 的声明。

4. **卸载有方向**：注销 provider 时，cordis 先卸载依赖该服务的 consumer，再移除服务本身。所以 consumer 的清理逻辑运行时，服务还活着。

5. **事件穿过一切**：调用方换成 root 侧，事件照样广播；provider 换成海盗腔，audit 只是多一条记录，一行代码都不用动。

顺带一个和状态有关的事实：cordis 的插件生命周期是 `PENDING → LOADING → ACTIVE → UNLOADING`，服务消失时 consumer 回到 pending 而不是销毁，所以换一个 provider 挂上来，原来的 fiber 会重新加载——这就是第 ⑤ 步能「原地复活」的原因。

## 6 什么时候用服务，什么时候用事件

判断只需要一句话：**要「问」能力就用服务，要知道「发生了什么」就用事件。**把这句话写成决策路径，就是下面这张图。

![服务与事件的判断路径](diagrams/service-vs-event.svg)

交互版：[service-vs-event.html](diagrams/service-vs-event.html) · IR 源：[service-vs-event.architecture.json](diagrams/service-vs-event.architecture.json)

- 服务的语义：服务缺失 = 这段逻辑不能跑；激活时机由依赖调度决定；适合「我要用它完成我的工作」。
- 事件的语义：没人监听 = 事件照发，什么也不发生；监听者随时可挂可走，不随 provider 重启；适合「这件事发生了，我要知道」。
- 最常见的错误：把「通知别人」写成 provider 里的同步调用链，日志、统计、埋点被迫跟着 provider 一起失败；改成 emit，每个监听者各自决定响应与失败处理。

实践里最常见的错误，是把「通知别人」写成同步调用链：provider 里依次调用日志、统计、埋点。这些需求彼此无关，却被迫塞进 provider，还要跟着 provider 一起失败。改成 emit 一个事件之后，provider 只负责「发生了什么」，每个监听者各自决定要不要响应、失败了怎么处理。反过来也要守住一条边界：事件不保证有人听，关键业务动作不能「发个事件就算完成」——如果某个下游必须执行，它应该是服务调用而不是事件广播。

## 7 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis 直接运行 TypeScript（Node 依赖原生类型擦除，Bun 自带转译），没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
cordis-seam-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── cordis.yml            # 唯一装配入口：插件清单与初始开关
├── .gitignore
├── src/
│   ├── seam.ts           # 1. Service Definition
│   ├── provider-en.ts    # 2. Provider（英文）
│   ├── provider-pirate.ts# 2'. 同一 seam 的另一个实现
│   ├── consumer.ts       # 3. 服务型 Consumer
│   ├── audit.ts          # 4. 事件型 Consumer
│   └── index.ts          # runner 插件：运行时开关驱动场景
└── diagrams/             # 三张画板：SVG / 交互 HTML / IR 源
```

### package.json

```json
{
  "name": "cordis-seam-demo",
  "private": true,
  "type": "module",
  "description": "一条 greeter 接缝演示 cordis 四种角色：Service Definition / Provider / 服务型 Consumer / 事件型 Consumer。Node 与 Bun 双运行时。",
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

正文第 5 节展示的是节选；这里是可直接运行的完整文件。它由 cordis.yml 的 runner 行挂载，依次演示启动即在位、越权访问报错、root 侧调用、禁用行后的有序卸载与启用另一行后的换实现复活。

```ts
/**
 * runner：场景驱动插件，由 cordis.yml 的 runner 行挂载。
 * 这里没有一处 ctx.use / ctx.plugin——插件全部在 cordis.yml 里声明，
 * 本插件只通过 loader 的行句柄做运行时开关（disabled 翻转、dispose）。
 */
import type { Context } from 'cordis'
import type { Entry } from '@cordisjs/loader'

export const name = 'runner'
export const inject = ['loader']

// FiberState 是 const enum，没有运行时对象可 import；按值镜像。
const STATE_NAMES = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING']

// yml 的行挂在 include 子树里；entries() 会递归遍历，按 id 找行句柄
function row(ctx: Context, id: string): Entry {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === id)
  if (!entry) throw new Error(`cordis.yml 里没有 id=${id} 的行`)
  return entry
}

function consumerState(ctx: Context): string {
  const state = row(ctx, 'consumer').innerFiber?.state
  return state === undefined ? '(no fiber)' : STATE_NAMES[state] ?? String(state)
}

export function apply(ctx: Context) {
  // apply 同步返回：runner 自己的 fiber 先 settle，run() 再等整棵树，避免互相等待
  void run(ctx)
}

async function run(ctx: Context) {
  await ctx.loader.await()

  console.log('\n① 启动即在位：provider-en 由 cordis.yml 声明，consumer 已自动激活')
  console.log(`   consumer 状态 = ${consumerState(ctx)}\n`)

  console.log('② 没声明 inject 的插件直接读 ctx.greeter（本 runner 只 inject 了 loader）')
  try {
    ;(ctx as any).greeter
  } catch (error) {
    console.log('   结果：' + (error as Error).message + '\n')
  }

  console.log('③ 换一个调用方（root 侧 ctx.get 直接调用服务）：事件照样广播')
  ctx.get('greeter')!.greet('root')
  console.log('')

  console.log('④ 禁用 provider-en 行：entry.update({ disabled: true })')
  await row(ctx, 'provider-en').update({ disabled: true })
  await ctx.loader.await()
  console.log(`   consumer 状态 = ${consumerState(ctx)}`)
  console.log('   结果：provider 卸载时先卸载依赖它的 consumer，再注销服务；audit 不受影响')
  console.log('   ctx.get("greeter") =', ctx.get('greeter'), '\n')

  console.log('⑤ 启用 provider-pirate 行（yml 里声明为 disabled: true）：consumer 的代码一行没改')
  await row(ctx, 'provider-pirate').update({ disabled: false })
  await ctx.loader.await()
  console.log(`   consumer 状态 = ${consumerState(ctx)}`)
  console.log('   结果：同一条 seam 换了实现，服务型与事件型 consumer 都被重新触发\n')

  await row(ctx, 'provider-pirate').dispose()
  console.log('演示结束')
  // cordis CLI 靠文件 watch 保持进程存活；演示做完主动退出
  process.exit(0)
}
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `cordis` 与 `@cordisjs/loader`。

2. `npm start` 打印 ①～⑤ 五段，末行是「演示结束」，与第 5 节的输出逐行一致。

3. `npm run start:bun` 输出与上一条逐行相同——同一份清单，两个运行时。

4. `npm run typecheck` 无任何输出、退出码 0，说明 `ctx.greeter` 与事件载荷的类型契约成立。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。Node 需 22.18 以上（原生类型擦除），低于此版本改用 `npm run start:bun`。

## 8 小结

写一条 seam 就是四步：

1. **写定义**：一个 `abstract class X extends Service`，构造函数里钉住服务名；用模块增强导出 `ctx.x` 的类型；把要广播的事件写进 `Events` 接口。

2. **写 provider**：继承定义、实现方法、`new Impl(ctx)`；动作里 `emit` 事实，不判断有没有人听。

3. **写消费者**：需要能力就 `export const inject = ['x']`；只需要知道事实就 `ctx.on('x/event', …)`，不要为了记日志去 inject 业务服务。

4. **写清单并验证四件事**：插件全部写进 cordis.yml；启动后 consumer 是否自动激活、禁用 provider 行后是否先卸 consumer 再回到 pending、启用另一个 provider 行后 consumer 是否原地复活。

以上就是这条接缝的全部。代码在本目录，`npm start` 和 `npm run start:bun` 能直接看到上面的输出，`npm run typecheck` 验证类型契约。