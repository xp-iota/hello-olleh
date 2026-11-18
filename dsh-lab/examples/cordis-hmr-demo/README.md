# Cordis 的 HMR 示例：原位替换，Fiber 身份不变

> 版本基线：`cordis` 4.0.0-rc.13、`@cordisjs/hmr` 2.0.0-rc.0。
> 双运行时实测：Node v26.12.1（`--expose-internals`）走完整 hmr 事务；Bun 1.4.4 走 core `registry.replace()` 同一条缝。`tsc`（typescript 7.0.2）0 错误。
> 源码行号：`H/` = `sources/cordis/packages/hmr/src/`，`C/` = `packages/core/src/`。

改一行插件代码，进程不重启、Fiber 不拆建、配置不丢、无关插件不受影响——这是 rc.13 的 HMR 承诺。旧版「先 `registry.delete` 再注册新 Fiber」的模型已经删除：新版是**缓存级事务 + `registry.replace()` 原位替换**，同一个 Fiber 对象只换 runtime 与 inject，`ctx.use()` 拿到的引用持续有效。

本示例五个场景：基线、改文件原位替换 + 依赖者级联、导出损坏 aborted 回滚、修好重试、host module skipped。Node 与 Bun 各跑一条路径，演示的是同一条核心缝。

## 先看清问题：改代码的三笔账

1. **重启进程**：状态全丢，连接全断，最贵。
2. **拆了重建 Fiber**：新 uid 意味着依赖方 epoch 全变、配置写回判定容易写坏文件（旧版 loader case 4 就是为此打的补丁）。
3. **全量重载**：无关插件陪跑，副作用重来。

rc.13 的答案把三笔账分别消掉：事务只驱逐**改动模块及其 importer**（反向 BFS）；替换复用旧 Fiber（uid 不变）；级联只波及 inject 了该服务的 Fiber（epoch 机制免费赠送）。

## 机制：缓存级事务 + 原位替换

**入口是 `ctx.hmr.reconcile(callback)`**（`H/index.ts:286-301`）：callback 是事务体，返回要调和的根路径（绝对路径）。事务串行排队，`AsyncLocalStorage` 拒绝嵌套。七步机制（`H/README.md` § Mechanism 就是规格书）归并成三个阶段：

- **Stage 1 先校验后动手**：sweep 失败 job → 失效解析缓存 → 匹配 changed → 反向 BFS 驱逐（`:335-342`）→ 发现 stale 组件并按并查集分 unit → 全部重新 import 并当场校验导出（`:617-661`）。失败只恢复该 unit 的缓存，**不动任何 Fiber**。
- **Stage 2 原位替换**：`registry.replace(old, new)` 同步一步（`:734`；`C/registry.ts:187-211`），对旧 runtime 的每个 fiber 调 `fiber._replace(target, inject)`（`C/fiber.ts:401-416`）：只换 runtime 与 inject、清 `_error`、`_revision++`。
- **Stage 3 级联与 settle**：`_refresh()` 以 `_revision` 起始新 epoch（`C/fiber.ts:420`），依赖方 epoch 编码了被依赖 impl 的 uid，自动重载；统一 await 后返回 `Hmr.Result { settled, aborted, skipped }`。**Stage 3 失败不回滚**——FAILED 与冷启动语义一致，下次文件变化重试。

![HMR 换代：缓存驱逐到原位替换（rc.13）](diagrams/hmr-swap.svg)

[交互 HTML](diagrams/hmr-swap.html) · [IR 源](diagrams/hmr-swap.sequence.json)

- **先校验后动手**：Stage 1 全部新模块 import 成功并校验导出形态；失败按 unit aborted 并恢复缓存；不动任何 Fiber，旧组件继续运行。
- **原位替换而非拆建**：registry.replace 复用旧 runtime 的 fiber 列表；_replace 只换 runtime 与 inject，_revision++；Fiber 身份、config、entry 全部不变。
- **级联是免费的**：epoch 以 _revision 起始，_refresh 必产新 epoch；只有 inject 了该服务的 Fiber 会重载；HMR 代码里没有一行处理依赖者。

**hostModules 划出「重启才生效」的边界**：`closure()` 从 `process.argv[1]` 沿静态依赖边遍历（`:43-56`、`:245-259`），主入口静态可达的模块全是 host——改了只记 `skipped`（reason `host-module`），是否重启交给宿主。所以**插件必须动态 import**：静态 import 进 host 集合，reconcile 直接跳过。

**运行时边界**：hmr 要摸 Node 内部模块加载器，`--expose-internals` 或 `node-addon-require-builtin` 二选一，且 Node ≥ 22；拿不到构造函数直接抛错，**没有降级路径**（`:166-168`）。Bun 没有这套内部接口，故本示例 Bun 分支不装 hmr，改演示 hmr 自己用的那条 core 缝：新模块身份重导入 + 导出校验 + `registry.replace()`。两条路径的 Fiber 语义完全相同。

## 场景 ①：基线

三个插件动态 import 后 `ctx.use(namespace)`：greeter（provide greeter）、consumer（`export const inject = ['greeter']`）、clock（无依赖）。模块 namespace 整体就是组件——`apply` 与 `inject` 都是导出，`_discover` 的 `unwrapExports` 与 `registry.replace` 认这种形态。记录 greeter Fiber 的 uid 供后续比对。

## 场景 ②：改文件 → reconcile，原位替换 + 级联

把 greeter.ts 的 `tag` 从 v1 写成 v2，`reconcile(() => [greeterFile])`。Node 路径：`settled = 1` 且该 Fiber uid 与基线相同——原位替换实锤；consumer 的 apply 计数 #2 且看到 v2——epoch 级联实锤；clock 保持 #1——精确级联实锤。Bun 路径：写一个新路径的修订文件重导入（见坑节），`registry.replace` 返回的 fibers uid 同样不变。

## 场景 ③：导出损坏 → aborted，旧组件继续运行

把文件写成 `export const apply = 42`。Node：Stage 1 校验导出形态失败 → `aborted = 1, settled = 0`，首错 `invalid component at ... expect function or object with an "apply" method`；缓存已恢复，`ctx.greeter.tag` 仍是 v2。Bun：重导入后手动做同一条校验（`typeof ns.apply === 'function'`），不通过就拒绝 replace——「先校验后动手」在 core 缝上手工复现。

## 场景 ④：修好 → 重试成功

写 v4 再 reconcile：`settled = 1`，tag = v4，consumer #3。aborted 不是终态：watch 路径会把相关文件 retained 到下一批（`:226-229`），程序路径下一次 reconcile 自然重试。

## 场景 ⑤：host module → skipped

`reconcile(() => [index.ts 自身路径])`：index.ts 是主入口静态可达的 host module → `skipped[0].reason = 'host-module'`，缓存恢复、进程不动。Bun 分支没有 hostModules 概念（那是 hmr 在 Node 缓存层的判定），打印说明并以 clock 计数佐证无关组件不受影响。

## 实测输出

Node v26.12.1，`npm start`（即 `node --expose-internals src/index.ts`）：

```text
运行时：Node（@cordisjs/hmr reconcile 事务）
   [greeter] apply tag=v1
   [clock] apply #1（与 greeter 无关）
   [consumer] apply #1 sees greeter = v1
① 基线：greeter uid = 1
   [greeter] apply tag=v2
   [consumer] apply #2 sees greeter = v2
② 改文件 → reconcile：原位替换，Fiber 身份不变，依赖者经 epoch 级联
   settled = 1 ，greeter uid 不变 = true ，tag = v2
③ 导出损坏 → aborted：恢复缓存，旧组件继续运行
   aborted = 1 ，settled = 0 ，tag 仍 = v2
   首错: Error: invalid component at src\plugins\greeter.ts, expect function or object with an "apply" method, received object
   [greeter] apply tag=v4
   [consumer] apply #3 sees greeter = v4
④ 修好文件 → 再 reconcile：aborted unit 重试成功
   settled = 1 ，tag = v4
⑤ host module（index.ts 自身）→ skipped：重启后才生效
   reason = host-module ；clock 与 greeter 无关，apply 计数见上方日志
演示结束（插件文件已恢复原状）
```

Bun 1.4.4，`npm run start:bun`：

```text
运行时：Bun（core registry.replace 缝）
   [greeter] apply tag=v1
   [clock] apply #1（与 greeter 无关）
   [consumer] apply #1 sees greeter = v1
① 基线：greeter uid = 1
② 新修订新 URL 重导入 → registry.replace（HMR Stage 2/3 同一条缝）
   [greeter] apply tag=v2
   [consumer] apply #2 sees greeter = v2
   replaced fibers = 1 ，uid 不变 = true ，tag = v2
③ 导出损坏 → 先校验后动手：拒绝 replace，旧组件继续运行
   导出校验通过 = false ，tag 仍 = v2
④ 修好 → 重导入 → 再 replace
   [greeter] apply tag=v4
   [consumer] apply #3 sees greeter = v4
   tag = v4
⑤ hostModules/skipped 是 hmr 在 Node 缓存层的概念；Bun 演示 core 缝；clock 不受影响见日志
演示结束（插件文件已恢复原状）
```

两条路径的插件日志序列一致（greeter v1→v2→v4、consumer #1→#2→#3、clock 恒 #1）；差异只在事务报告字段（Node 有 Result，Bun 手工校验）。演示结束 greeter.ts 恢复 v1、Bun 修订临时文件删除，仓库不留痕。

## 边界与容易踩的坑

### hmr 在 Bun 上起不来，且没有降级路径

构造函数拿不到 Node internals 直接抛 `loader internals are unavailable...`（`H/index.ts:166-168`），`ModuleLoader.fromInternal()` 要求 Node ≥ 22（`H/runtime/internal.ts:161`）。所以「双运行时」不等于「双运行时都装 hmr」：Bun 分支演示 core 缝是诚实的做法，假装 hmr 跨运行时才是坑。

### Bun 的模块缓存不吃 query 后缀

实测探针：改文件后 `import(url + '?v=2')` 在 Bun 仍返回旧模块（`QUERY_BUST v1 v1`）；Node ESM 按完整 URL（含 query）键控缓存则天然失效。故 Bun 分支每修订写一个**新路径**（`.greeter-rN.ts`）再 import——等价于 Node 缓存驱逐后产生的新模块身份。结束统一 `rm` 清理。

### 插件静态 import 会被 skipped

hostModules 是主入口的静态闭包。插件若写进 index.ts 的静态 import，reconcile 它只会得到 `skipped: host-module`。动态 `await import()` 不进静态依赖边，才是可热替换的组件入口。

### namespace 作为组件：apply 与 inject 都是导出

`ctx.use(await import(...))` 时组件是模块 namespace 对象：`apply` 导出让它成为合法组件，`export const inject = [...]` 让依赖清单随 namespace 携带（namespace 是冻结对象，不能事后挂属性）。`_discover` 的 `unwrapExports`（`:128-135`）与 `registry.replace` 都认这种形态。

### Stage 3 失败不回滚是刻意选择

换 Fiber 阶段失败 → 组件保持 FAILED，与冷启动失败表现一致，保留注册、父级与 config，下次文件变化重试（`:744-748` 注释）。可靠性边界全压在 Stage 1 的「先校验后动手」上；回滚到一个已知有问题的旧实例没有意义。

### 事务串行且拒绝嵌套

`reconcile` 排队执行（`_queue`），事务体内再开事务直接 reject（`:288-290`）。watch 批与批也串行；aborted unit 的文件 retained 到下一批（`:226-229`），否则修复它的改动会被漏掉。

## 从零复现：完整文件与两条运行路径

### 目录结构

```text
cordis-hmr-demo/
├── package.json             # start 带 --expose-internals
├── tsconfig.json
├── diagrams/                # hmr-swap 三件套（svg/html/json）
└── src/
    ├── index.ts             # 双分支：Node hmr 事务 / Bun core 缝
    └── plugins/
        ├── greeter.ts       # provide greeter，tag 写在文件里
        ├── consumer.ts      # export const inject = ['greeter']
        └── clock.ts         # 无依赖对照组
```

### package.json

```json
{
  "name": "cordis-hmr-demo",
  "private": true,
  "type": "module",
  "description": "HMR 原位替换：Node 走 @cordisjs/hmr reconcile 事务（--expose-internals），Bun 走 core registry.replace 同一条缝。双运行时。",
  "scripts": {
    "start": "node --expose-internals src/index.ts",
    "start:bun": "bun src/index.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@cordisjs/hmr": "2.0.0-rc.0",
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

### src/plugins/greeter.ts

```ts
import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

export const tag = 'v1'

export function apply(ctx: Context) {
  console.log(`   [greeter] apply tag=${tag}`)
  ctx.provide('greeter', { tag })
}
```

### src/plugins/consumer.ts

```ts
import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

/** inject 以导出常量声明：模块 namespace 整体作为组件时携带依赖清单。 */
export const inject = ['greeter']

let applies = 0

export function apply(ctx: Context) {
  applies++
  console.log(`   [consumer] apply #${applies} sees greeter = ${ctx.greeter.tag}`)
}
```

### src/plugins/clock.ts

```ts
import type { Context } from 'cordis'

/** 与 greeter 无任何依赖边：HMR 换代时 epoch 不变，apply 计数应保持 #1。 */
let applies = 0

export function apply(ctx: Context) {
  applies++
  console.log(`   [clock] apply #${applies}（与 greeter 无关）`)
}
```

### src/index.ts（完整版）

```ts
/**
 * HMR 原位替换：Node 走 @cordisjs/hmr 的 reconcile 事务（需 --expose-internals）；
 * Bun 拿不到 Node 内部模块缓存，走 core registry.replace() 同一条缝（新 URL 重导入 + 先校验后动手）。
 * 插件一律动态 import：静态 import 会进 hostModules，被 hmr 记为 skipped。
 */
import { Context } from 'cordis'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const isBun = !!(process.versions as Record<string, string | undefined>).bun

const greeterUrl = new URL('./plugins/greeter.ts', import.meta.url)
const greeterFile = fileURLToPath(greeterUrl)
const source = await readFile(greeterFile, 'utf8')
const write = (tag: string) => writeFile(greeterFile, source.replaceAll('v1', tag))
const writeBroken = () => writeFile(greeterFile, "export const tag = 'v3'\nexport const apply = 42\n")

const ctx = new Context()
// 模块 namespace 整体作为组件：apply 与 inject 都是导出，_discover / replace 认这种形态
const greeter = await import(greeterUrl.href)
const consumer = await import('./plugins/consumer.ts')
const clock = await import('./plugins/clock.ts')

console.log(isBun ? '运行时：Bun（core registry.replace 缝）' : '运行时：Node（@cordisjs/hmr reconcile 事务）')
const greeterFiber = ctx.use(greeter)
ctx.use(consumer)
ctx.use(clock)
await sleep(10)
console.log('① 基线：greeter uid =', greeterFiber.uid)

if (!isBun) {
  const { default: Hmr } = await import('@cordisjs/hmr')
  await ctx.use(Hmr)

  await write('v2')
  const r2 = await ctx.hmr.reconcile(() => [greeterFile])
  await sleep(20)
  console.log('② 改文件 → reconcile：原位替换，Fiber 身份不变，依赖者经 epoch 级联')
  console.log('   settled =', r2.settled.length, '，greeter uid 不变 =', r2.settled.some((f) => f.uid === greeterFiber.uid), '，tag =', ctx.greeter.tag)

  await writeBroken()
  const r3 = await ctx.hmr.reconcile(() => [greeterFile])
  console.log('③ 导出损坏 → aborted：恢复缓存，旧组件继续运行')
  console.log('   aborted =', r3.aborted.length, '，settled =', r3.settled.length, '，tag 仍 =', ctx.greeter.tag)
  console.log('   首错:', String(r3.aborted[0]?.error).split('\n')[0])

  await write('v4')
  const r4 = await ctx.hmr.reconcile(() => [greeterFile])
  await sleep(20)
  console.log('④ 修好文件 → 再 reconcile：aborted unit 重试成功')
  console.log('   settled =', r4.settled.length, '，tag =', ctx.greeter.tag)

  const r5 = await ctx.hmr.reconcile(() => [fileURLToPath(import.meta.url)])
  console.log('⑤ host module（index.ts 自身）→ skipped：重启后才生效')
  console.log('   reason =', r5.skipped[0]?.reason, '；clock 与 greeter 无关，apply 计数见上方日志')
} else {
  // Bun 的模块缓存不吃 query 后缀（实测 ?v=2 仍命中旧模块），
  // 故每修订写一个新路径：等价于 Node 缓存驱逐后产生的新模块身份。
  const revUrl = (n: number) => new URL(`./plugins/.greeter-r${n}.ts`, import.meta.url)
  const writeRev = async (n: number, content: string) => {
    await writeFile(revUrl(n), content)
    return import(revUrl(n).href)
  }

  console.log('② 新修订新 URL 重导入 → registry.replace（HMR Stage 2/3 同一条缝）')
  const ns2 = await writeRev(2, source.replaceAll('v1', 'v2'))
  const fibers2 = ctx.registry.replace(greeter, ns2)
  await sleep(20)
  console.log('   replaced fibers =', fibers2.length, '，uid 不变 =', fibers2.some((f) => f.uid === greeterFiber.uid), '，tag =', ctx.greeter.tag)

  console.log('③ 导出损坏 → 先校验后动手：拒绝 replace，旧组件继续运行')
  const ns3 = await writeRev(3, "export const tag = 'v3'\nexport const apply = 42\n")
  const ok3 = typeof ns3.apply === 'function'
  if (ok3) ctx.registry.replace(greeter, ns3)
  console.log('   导出校验通过 =', ok3, '，tag 仍 =', ctx.greeter.tag)

  console.log('④ 修好 → 重导入 → 再 replace')
  const ns4 = await writeRev(4, source.replaceAll('v1', 'v4'))
  ctx.registry.replace(greeter, ns4)
  await sleep(20)
  console.log('   tag =', ctx.greeter.tag)
  console.log('⑤ hostModules/skipped 是 hmr 在 Node 缓存层的概念；Bun 演示 core 缝；clock 不受影响见日志')
  await Promise.all([2, 3, 4].map((n) => rm(revUrl(n), { force: true })))
}

if (!isBun) await writeFile(greeterFile, source)
console.log('演示结束（插件文件已恢复原状）')
```

### 运行

```bash
npm install          # 整目录拷走即可独立安装
npm start            # Node >= 22，--expose-internals 已写在脚本里
npm run start:bun    # Bun >= 1.4.4，走 core registry.replace 缝
npm run typecheck    # tsc 7.0.2，0 错误
```

无需 `LLM_API_KEY`。Node 路径要求未带 `--preserve-symlinks`（模块 URL 须为 realpath）；演示结束插件文件恢复原状。

## 小结

HMR 的可靠性不在「换得快」，而在「换之前先校验、换的时候不动身份、换错了能按 unit 回滚」。rc.13 把这三件事分别压在 Stage 1 的导出校验、`registry.replace` 的原位语义、`ModuleBackup.restore` 的选择性恢复上；级联重载则完全交给 Fiber 的 epoch 机制，HMR 本体一行依赖者代码都没有。Node 与 Bun 两条路径殊途同归：前者多了一层 Node 模块缓存事务，后者直接站在 core 缝上。配合 [loader](../cordis-loader-demo/README.md) 的配置树与 [fiber](../cordis-fiber-demo/README.md) 的状态机，cordis 六个示例闭环；阶段 C 起进入 dsh 侧。