# 04 · Cordis 的 isolate 示例

本示例演示 `ctx.isolate` 的 realm 隔离：同名服务多份实现、按名字隔离、事件可见性、共享 label。realm 划分全部写在 cordis.yml 配置行的 `isolate:` 字段里，代码里没有一处 `ctx.use()`——runner 只经行句柄做启用 / 禁用。

前面几篇讲了谁提供谁消费、插件的生命周期、插件之间怎么通信，这一篇讲哪些插件能看见彼此的服务。isolate 不改任何插件代码，单方面把某个服务名划进一个新的 realm：同名服务在不同 realm 里是不同实体，可以同时存活、独立卸载。看完你会明白 isolate 其实只改了一个存储键，以及测试里怎么给插件换一套假服务。

## 1 全局只能有一份服务时，会碰到这三个问题

服务注册表若是全局单例（一个名字只能有一份实现），有三件事很容易出错：

- **测试污染**：集成测试想给插件换假数据库，只能改全局注册表——并行跑的测试互相踩。

- **多租户互相干扰**：两个租户各要一份「自己的」配置服务，全局名字放不下第二份。

- **替换即全局事故**：换一次 provider，所有消费者一起重启，哪怕只想影响其中一个子系统。

> 隔离是调用方的决定，不是插件的义务。

cordis 的做法：服务名到实现的映射不是全局字典，而是**每个上下文一张 isolate 表**，表里存的是 symbol 键；store 以 symbol 键存实现。`ctx.isolate(name)` 就是给这张表加一个 own 属性、指向新 symbol——于是同一个名字在不同上下文解析到不同实现，互不知情。

## 2 机制：isolate 只改一个键

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

loader 把这个能力包装成配置字段：`isolate: { greeter: true }` 给这一行一个完全私有的 realm；`isolate: { greeter: 'realm-1' }` 用字符串 label 划出命名 realm——**label 相同的行共享同一个 realm**。本示例全部用后者，四组场景就是四组 label。realm 跟着挂载入口走，不跟着插件走：API 层面 `ctx.isolate('db')` 之后若继续用原 `ctx` 挂插件，插件仍活在 root realm，必须改用返回的派生上下文；漏写 isolate 字段或忘换挂载入口，是「隔离没生效」的第一原因。

## 3 同名两份实现同时 ACTIVE

root 与 realm 各声明一个 `inject: ['greeter']` 的消费者，再各声明一个 provider。realm 侧两行写同一个 label：

```yaml
- id: consumer-realm
  name: ./src/plugins/greeter-consumer.ts   # 与 provider-inner 同 label = 同 realm
  isolate:
    greeter: realm-1
  config:
    label: consumer-realm
- id: provider-inner
  name: ./src/plugins/greeter-provider.ts   # 同名服务第二份实现
  disabled: true
  isolate:
    greeter: realm-1
  config:
    text: inner
```

两个 provider 行初始禁用，runner 依次启用：

```ts
await row(ctx, 'provider-outer').update({ disabled: false })   // root 侧：outer
await ctx.loader.await()
await row(ctx, 'provider-inner').update({ disabled: false })   // realm 侧：inner
await ctx.loader.await()
```

实测两个消费者分别拿到 `outer` 与 `inner`，且**同时 ACTIVE**。没有 isolate 时第二次 provide 会抛 `service "greeter" has been registered at <...>`（reflect.ts:226）——store 以 symbol 键查重，isolate 换了键，查重自然通过。这就是「测试换假服务」的标准做法：被测插件一行不改，配置里给它写个 isolate 字段即可。isolate 本身永不报错——报错发生在 provide 发现 store 里同键已有实现时；排查 `service "x" has been registered` 先看两个 provider 是否落在同一个 isolate 键上，通常就是漏了 isolate 或 label 传重了。

注意 consumer 与 provider 用的是**同一个插件文件**（`greeter-consumer.ts` / `greeter-provider.ts`），差别全在配置行的 `isolate:` 与 `config:`——插件不知道自己活在哪个 realm。

## 4 隔离按名字生效

realm-1 只 shadow 了 `greeter`。root 上启用 clock-provider 之后，realm 里 `inject: ['clock']` 的 realm-clock 行照常激活，拿到 root 的实现——因为 realm 的 isolate 表里 `clock` 不是 own 属性，沿原型链回到 root 的键。隔离是**逐名字**的声明，不是「这个上下文从此与世隔绝」：想隔离几个名字就在 `isolate:` 下写几个键，其余服务照常共享。反面同样成立：在 realm 里 provide 一个没被 isolate 的名字，写的是 root 的键，会影响 root 的所有消费者——想完全私有就逐名字 isolate（或配置里写 `true`）。

## 5 事件可见性跟着 realm 走

events 示例里提过：`_resolve()` 按 `thisArg[Context.filter]` 筛监听器。Service 基类实现了这个 filter（service.ts:39-41）：比较监听器上下文与**服务所属上下文**的 isolate 键。所以以服务实例为 thisArg 派发的事件，只有同 realm 的监听器看得见。

Ticker 服务定义在 `src/seam.ts`，ticker 插件构造即注册；root 行与 realm 行各挂一份，监听器也各挂一份：

```ts
/** 以服务实例为 thisArg 派发事件：Service 的 filter 按 isolate 键筛监听器。 */
export class Ticker extends Service {
  constructor(ctx: Context) { super(ctx, 'ticker') }
  tick() { this.ctx.emit(this, 'lab/tick') }
}
```

```yaml
- id: ticker-realm
  name: ./src/plugins/ticker.ts
  isolate:
    ticker: tick-realm        # 监听器行写同一个 label
```

runner 在各自 fiber 的 ctx 上取服务再 tick：

```ts
row(ctx, 'ticker-root').innerFiber!.ctx.get('ticker')!.tick()
row(ctx, 'ticker-realm').innerFiber!.ctx.get('ticker')!.tick()
```

这里用 `innerFiber.ctx.get()` 而不是 `entry.ctx.ticker`：行句柄的 ctx 直接读服务会做 inject 校验，runner 没声明 inject ticker，走 fiber 内部的 ctx 取。

实测两次 tick 共 2 次命中（`root 听到 → realm 听到`）；若无隔离应为 4 次。注意这里必须 isolate `ticker` 而不是复用场景 ① 的 greeter realm：isolate 表只 own 被 isolate 的名字，realm-1 里 `ticker` 的键仍继承 root——在那里 provide ticker 会和 root 的撞键。**想隔离哪个服务的行为，就 isolate 哪个名字**，事件可见性用的也是服务名的键，不是事件名。普通 `ctx.emit('evt')`（无 thisArg）没有 filter，所有 realm 的监听器都看得见；想要 realm 级事件总线，要么以服务为 thisArg 派发，要么每个 realm 用独立事件名。

## 6 同 label 即同 realm

`isolate(name, label)` 的第二参决定共享范围：两个上下文传同一个 symbol，就是同一个 realm 的两个入口；配置层的字符串 label 同理。示例里 consumer-shared 与 provider-shared 两行都写 `greeter: shared-greeter`，消费者照常拿到 `shared`；runner 把 provider 行禁用后，realm 里的消费者回 PENDING，而 root 的消费者仍 ACTIVE——卸载的影响范围精确等于 realm 的成员范围。

## 7 运行isolate示例

装配全部写在 `cordis.yml` 里，四组场景就是四组 isolate label：

```yaml
# realm 隔离全部写在配置层：isolate 为 true 是独立 realm，字符串 label 相同即共享 realm
- id: consumer-root
  name: ./src/plugins/greeter-consumer.ts   # ① root 侧消费者
  config:
    label: consumer-root
- id: consumer-realm
  name: ./src/plugins/greeter-consumer.ts   # ① realm 侧消费者：与 provider-inner 同 label
  isolate:
    greeter: realm-1
  config:
    label: consumer-realm
- id: provider-outer
  name: ./src/plugins/greeter-provider.ts   # ① root 侧 provider：运行时启用
  disabled: true
  config:
    text: outer
- id: provider-inner
  name: ./src/plugins/greeter-provider.ts   # ① realm 侧 provider：同名服务第二份实现
  disabled: true
  isolate:
    greeter: realm-1
  config:
    text: inner
- id: clock-provider
  name: ./src/plugins/clock-provider.ts     # ② root 侧 clock：没被 isolate，穿透 realm
  disabled: true
- id: realm-clock
  name: ./src/plugins/realm-clock.ts        # ② realm 侧消费者：只 shadow 了 greeter
  isolate:
    greeter: realm-1
- id: tick-listener-root
  name: ./src/plugins/tick-listener.ts      # ③ root 侧监听器
  config:
    label: root 听到
- id: tick-listener-realm
  name: ./src/plugins/tick-listener.ts      # ③ realm 侧监听器：跟着 ticker 的 isolate 走
  isolate:
    ticker: tick-realm
  config:
    label: realm 听到
- id: ticker-root
  name: ./src/plugins/ticker.ts             # ③ root 侧 Ticker 服务
- id: ticker-realm
  name: ./src/plugins/ticker.ts             # ③ realm 侧 Ticker 服务
  isolate:
    ticker: tick-realm
- id: consumer-shared
  name: ./src/plugins/greeter-consumer.ts   # ④ 共享 label 的消费者
  isolate:
    greeter: shared-greeter
  config:
    label: consumer-shared
- id: provider-shared
  name: ./src/plugins/greeter-provider.ts   # ④ 共享 label 的 provider：与消费者同 realm
  disabled: true
  isolate:
    greeter: shared-greeter
  config:
    text: shared
- id: runner
  name: ./src/index.ts                      # 场景驱动：不挂插件，只对上面的行做运行时开关
```

`npm start` 就是 cordis CLI：读当前目录的 `cordis.yml`，loader 逐行 import 模块，按 `isolate:` 字段划 realm，把导出的 `apply`、`inject`、`name` 当作插件定义挂上去。

`runner` 行挂的 `src/index.ts` 也是一个普通插件，负责驱动四个场景。它 inject 了 loader，按 id 拿到各行的句柄做启用与禁用，不再手工挂任何插件：

```ts
export const name = 'runner'
export const inject = ['loader']

export function apply(ctx: Context) {
  // apply 同步返回：runner 自己的 fiber 先 settle，run() 再等整棵树，避免互相等待
  void run(ctx)
}

async function run(ctx: Context) {
  await ctx.loader.await()
  // ……①～④ 四个场景，全部经行句柄操作……
  const providerShared = row(ctx, 'provider-shared')
  await providerShared.update({ disabled: false })   // 共享 realm 的 provider 上线
  await ctx.loader.await()
  await providerShared.update({ disabled: true })    // 禁用只影响本 realm 的消费者
  process.exit(0)   // cordis CLI 靠文件 watch 保持进程存活；演示做完主动退出
}
```

在本机复现只需要四条命令：

```bash
npm install             # cordis 与 loader 依赖
#
npm start               # cordis CLI 读 cordis.yml（Node）：打印 ①～④ 的完整时序
npm run start:bun       # Bun 下直接跑 cordis 的 bin.js：输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1；Bun 1.4.4 逐行相同）：

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

装配路径依赖 cordis 的四个可选 peer 包：`@cordisjs/loader`、`@cordisjs/include`、`@cordisjs/fs`、`@cordisjs/fs-node`，已写进 `package.json`。

## 8 源码视角：一个存储键如何撑起四个场景

core 摘录取自本仓 vendored 源码 `deepseek-harness/vendor/cordis/src`（4.1.0，rc.11 基线）；本示例运行 cordis 4.0.0-rc.13，本节机制两个版本一致。配置层摘录取自 `@cordisjs/loader` 1.0.0-rc.10（本示例锁定的版本）。逐行精读见 [Context 与 Reflect Proxy](../../../docs/hello-cordis/04-context-and-reflect-proxy.md)、[服务注册与依赖解析](../../../docs/hello-cordis/05-service-registration-and-dependency-resolution.md)。

### 8.1 键从哪来：provide 的两行

第 2 节展示了 isolate 怎么改表，这里看 provide 怎么用表（`reflect.ts:300-306`）：

```ts
this.ctx.root[symbols.isolate][name] ??= Symbol(name)
const key = this.ctx[symbols.isolate][name]
const impl: Impl = { uid: ++this._implCounter, name, value, ctx: this.ctx, check, isolate: key, dependents: new Set() }
if (this.store[key]) {
  throw new Error(`service "${name}" has been registered at <${this.store[key].ctx.fiber.name}>`)
}
this.store[key] = impl
```

第一行保证 root 表里每个名字有个默认 symbol；第二行从**当前上下文**的表取键——realm 的表 own 了这个名字就取新键，没 own 就沿原型链取 root 键。于是：场景 ① 两个 provider 键不同，查重通过、两份 impl 并存；场景 ② realm 里 provide 没被 isolate 的名字，取的还是 root 键，影响全局。第 3 节那句「isolate 本身永不报错，报错在 provide 查重」就是这里第 4～6 行。

### 8.2 解析边界：键不同就停

消费者沿 fiber 父链向上找服务时，每一步都比对 isolate 键（`reflect.ts:177`，完整查找链见 [01 篇 7.3](../01-cordis-seam-demo/README.md#73-访问必须有声明proxy-get-陷阱)）：

```ts
if (fiber.parent[symbols.isolate][prop] !== key) throw error
```

realm 消费者的键是 Sym_B，走到 realm 边界时父上下文的键是 Sym_A，不等就抛错——不会继续向上拿到 root 的同名实现。场景 ① 里两个消费者各拿各的，靠的就是这一行在各自链上生效。

### 8.3 事件可见性：Service 自带的 filter

以服务实例为 thisArg 派发时，`_resolve` 取 `thisArg[Context.filter]` 筛监听器（见 [03 篇 9.1](../03-cordis-events-demo/README.md#91-五个方法共用一个预处理_resolve)）。Service 基类实现的 filter 只有两行（`service.ts:61-63`）：

```ts
protected [symbols.filter](ctx: Context) {
  return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name]
}
```

比较的是**服务名**在两个上下文里的 isolate 键：监听器与服务同 realm 才可见。场景 ③ 的 2 次命中而非 4 次就是这两行筛出来的；也解释了为什么必须 isolate `ticker` 而不是复用 greeter 的 realm——filter 查的是 `this.name` 的键。

### 8.4 服务变更通知也按 realm 过滤

provide/unprovide 触发的 `notify` 自带一个默认过滤器（`reflect.ts:335`）：

```ts
notify(names: string[], filter = (ctx: Context, name: string) => ctx[symbols.isolate][name] === this.ctx[symbols.isolate][name]) {
```

只有同键的 fiber 会被 `_checkImpl` + `_refresh`。所以场景 ④ 禁用共享 provider 时，root 消费者的 epoch 根本没被碰过——「卸载影响范围精确等于 realm 成员范围」不是调度层的照顾，是通知层就没发给它。

### 8.5 配置层：字符串 label 如何变成共享 symbol

yml 里的 `isolate: { greeter: 'realm-1' }` 由 loader 翻译。`@cordisjs/loader` 为每个字符串 label 维护一个 GlobalRealm，同名 label 拿到同一个实例（`lib/index.js`，源文件 `src/config/isolate.ts`）：

```js
realm = realms[label] ??= new GlobalRealm(label);
// …
return this.store[key] ??= Symbol(`${key}${this.suffix}`);
```

同一个 GlobalRealm 里同一个服务名只创建一次 symbol——这就是「label 相同即共享 realm」的实现。`isolate: true` 走 LocalRealm，后缀是 `#entry.id`，每行私有。core 的 `ctx.isolate(name, label)` 只认 symbol，字符串到 symbol 的翻译完全在 loader 这一层。

## 9 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis 直接运行 TypeScript（Node 依赖原生类型擦除，Bun 自带转译），没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
cordis-isolate-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── cordis.yml            # 唯一装配入口：12 个插件行 + runner，realm 全在 isolate 字段
├── .gitignore
├── src/
│   ├── index.ts          # runner 插件：四个场景的演示脚本
│   ├── seam.ts           # Ticker 服务与类型声明
│   ├── state.ts          # 跨插件共享的命中记录
│   └── plugins/
│       ├── greeter-consumer.ts  # ①④ 消费者：config.label 决定日志前缀
│       ├── greeter-provider.ts  # ①④ provider：config.text 决定实现
│       ├── clock-provider.ts    # ② root 侧 clock
│       ├── realm-clock.ts       # ② realm 侧 clock 消费者
│       ├── tick-listener.ts     # ③ 监听器：config.label 决定命中记录
│       └── ticker.ts            # ③ Ticker 服务：构造即注册
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

正文第 7 节展示的是节选；完整文件就在本目录 [src/index.ts](src/index.ts)，由 cordis.yml 的 runner 行挂载，依次演示双实现、按名字隔离、事件可见性、共享 label。脚手架各写法的含义见 [01 篇第 5 节的速览表](../01-cordis-seam-demo/README.md#脚手架速览照抄即可原理在-05-篇展开)。

### src/seam.ts

```ts
import { Service } from 'cordis'
import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { greet(): string }
    clock: { now(): string }
    ticker: Ticker
  }
  interface Events {
    'lab/tick'(): void
  }
}

/** 以服务实例为 thisArg 派发事件：Service 的 filter 按 isolate 键筛监听器。 */
export class Ticker extends Service {
  constructor(ctx: Context) {
    super(ctx, 'ticker')
  }
  tick() {
    this.ctx.emit(this, 'lab/tick')
  }
}
```

### src/state.ts

```ts
/** runner 与 tick 监听插件共享的命中记录。 */
export const hits: string[] = []
```

### src/plugins/greeter-consumer.ts

```ts
import type { Context } from 'cordis'

export const name = 'greeter-consumer'
export const inject = ['greeter']

export function apply(ctx: Context, config: { label: string }) {
  console.log(`   [${config.label}] greeter =`, ctx.greeter.greet())
}
```

### src/plugins/greeter-provider.ts

```ts
import type { Context } from 'cordis'

export const name = 'greeter-provider'

export function apply(ctx: Context, config: { text: string }) {
  ctx.provide('greeter', { greet: () => config.text })
}
```

### src/plugins/clock-provider.ts

```ts
import type { Context } from 'cordis'

export const name = 'clock-provider'

export function apply(ctx: Context) {
  ctx.provide('clock', { now: () => 'root-clock' })
}
```

### src/plugins/realm-clock.ts

```ts
import type { Context } from 'cordis'

export const name = 'realm-clock'
export const inject = ['clock']

export function apply(ctx: Context) {
  console.log('   [realm-clock] clock.now() =', ctx.clock.now())
}
```

### src/plugins/tick-listener.ts

```ts
import type { Context } from 'cordis'
import { hits } from '../state.ts'

export const name = 'tick-listener'

export function apply(ctx: Context, config: { label: string }) {
  ctx.on('lab/tick', () => hits.push(config.label))
}
```

### src/plugins/ticker.ts

```ts
import type { Context } from 'cordis'
import { Ticker } from '../seam.ts'

export const name = 'ticker'

export function apply(ctx: Context) {
  new Ticker(ctx)   // 构造即注册：root 行与 realm 行各有一份 ticker
}
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `cordis` 与 `@cordisjs/loader`。
2. `npm start` 打印 ①～④ 四段，末行「演示结束」，与第 7 节实测输出逐行一致。
3. `npm run start:bun` 输出逐行相同。
4. `npm run typecheck` 无输出、退出码 0。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。

## 10 小结

isolate 的本质是「服务名 → symbol 键」这张表的原型链 shadow：改一个 own 属性，就划出一个新世界；store 以键存实现，所以同名服务可以多份并存、独立卸载。隔离是调用方单方面的决定，插件无需配合——配置层的 `isolate:` 字段把这个决定也变成了声明：`true` 是私有 realm，字符串 label 相同即共享。下一篇 loader 示例展开配置树本身：`cordis.yml` 里的每一行 entry 如何变成 fiber，include 与 patch 如何组合出整棵装配树。