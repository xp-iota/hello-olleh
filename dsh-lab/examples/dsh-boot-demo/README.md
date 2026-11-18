# dsh-boot-demo：boot() 声明式装配——最小树、overlay 层、fail-loud 与服务驱动激活

> 独立示例：本目录拷到任何位置，`npm install && npm start` 即可运行（Node ≥ 22.18 原生 TypeScript；`npm run start:bun` 走 Bun）。
> 版本面：`@deepseek-ai/dsh-app-boot` **0.2.2-rc.3**（npm `next` 通道，与 `sources/deepseek-harness` 快照同版）、`@deepseek-ai/cordis` **4.1.0**。
> 本文所有运行输出均为实测粘贴（Node v26.12.1 / Bun 1.4.4，Windows）。

## 1. 问题：一个 Harness 应用是怎么"长出来"的

dsh 的 CLI、Web 服务、headless runner 共用同一套启动胶水 `@deepseek-ai/dsh-app-boot`。它回答四个问题：

1. **装配从哪来**——不是代码里手写 `ctx.plugin(...)` 长链，而是一份 `cordis.yml` 加若干 patch 层（YAML 清单）；
2. **宿主逻辑插在哪**——`prepare` 回调在 Loader 装好之后、任何配置条目挂载之前运行，宿主服务从这里进树；
3. **坏了怎么办**——fail-loud：required 行没激活就抛 `StartupError` 拒绝启动，而不是带病运行；
4. **没坏但没齐怎么办**——缺服务的行停在 PENDING，服务何时可用何时激活，启动审计只 warn 不拦。

本示例用一棵**五行最小树**把这四件事全部跑一遍，不碰模型、不碰网络、不需要 key。

## 2. 契约：boot() 的签名与启动时序

权威来源：`sources/deepseek-harness/packages/boot/app-boot/src/index.ts`（rc.3 快照，1287 行）。

```ts
export async function boot(
  binName: string,                    // 诊断前缀
  absoluteConfigPath: string,         // 根配置，必须绝对路径
  patches?: PatchOptions[],           // overlay patch 层，按数组顺序叠加
  prepare?: (ctx: Context) => Promise<void> | void,  // 宿主准备
  bareModuleBaseUrl?: string,         // 裸包名的解析基准（默认配置目录）
): Promise<Context>
```

内部时序（index.ts:1220-1286）：

```text
new Context()
  → ctx.baseUrl = 配置目录
  → ctx.provide('dshHomePath', dshHomePath)     // !!js 表达式可用的 home 解析器
  → ctx.plugin(Loader)                          // Loader 先就位
  → prepare?.(ctx)                              // ← 宿主服务在这里进树
  → mountRootInclude(...)                       // 挂 cordis:include，加载根配置 + patches
  → ctx.get('loader')?.await()                  // 等整棵树 settle
  → auditStartupEntries(ctx, binName)           // 启动审计
  → return ctx
```

两个失败标签值得记住：`prepare` 抛错标 **`host preparation failed`**（此时还没有任何配置条目挂载）；之后抛错标 **`plugin tree failed to load`**。失败路径先 `ctx.fiber.dispose()` 再抛——不会留下半棵树。

启动审计的规则（`auditStartupEntries`，index.ts:1173-1187）：

- 全局 required 清单（index.ts:966-977）：`agent-loop`、`tool-executor-native`、`tool-executor-ptc`、`webserver`、`web-runtime`、`modules`、`connection`、`headless-runner`、`acp`、`sdk-jsonrpc-server`；
- **缺席的 required id 被忽略**——清单是"挂了就必须活"，不是"必须挂"；
- required 行 inactive → 抛 `StartupError`（message 里连同所有 inactive 行一起列出）；
- 非 required 行 inactive → 只打一条 warning，成功的兄弟行继续运行。

## 3. 最小树与依赖链

五行清单（`cordis.patch.yml`）：

| 行 id | 包 | 为什么需要 |
|---|---|---|
| `timer` | `@deepseek-ai/cordis-plugin-timer` | 基础设施，effect 化的定时器 |
| `system-prompt` | `@deepseek-ai/dsh-system-prompt` | `ToolsService.static inject = ['systemPrompt']`（core/tools/src/index.ts:100），不挂它 tools 永远 PENDING |
| `tools` | `@deepseek-ai/dsh-tools` | 工具注册表 |
| `tool-executor-native` | `@deepseek-ai/dsh-tool-executor-native` | `inject = ['tools']`；0.2.2 起执行器与注册表分离，且行 id 在 required 清单里 |
| `hello` | `./src/plugins/hello.ts`（本地） | 本示例的观察点：`inject = ['labMark']`，labMark 由宿主提供 |

依赖链一眼可见：`systemPrompt → tools → tool-executor-native`，`labMark（宿主）→ hello`。这条链就是"服务可用性驱动激活"的实体。

## 4. 实现代码

### 4.1 本地插件 `src/plugins/hello.ts`

```ts
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 宿主在 prepare 阶段（或运行时）提供的标记服务。 */
    labMark?: string
  }
}

export const name = 'hello'
export const inject = ['labMark']

export function apply(ctx: Context, config: { tag?: string } = {}): void {
  console.log(`[hello] ACTIVE tag=${config.tag ?? '(unset)'} labMark=${ctx.labMark}`)
  ctx.effect(() => {
    console.log('[hello] effect#1 mount')
    return () => console.log('[hello] effect#1 dispose')
  })
  ctx.effect(() => {
    console.log('[hello] effect#2 mount')
    return () => console.log('[hello] effect#2 dispose')
  })
}
```

### 4.2 三个 YAML 层

`cordis.yml`（根配置刻意留空——装配全部来自 patch 层，这正是 dsh 的哲学：根文件是项目自己的清单，patch 层是发行版/宿主的清单）：

```yaml
[]
```

`cordis.patch.yml`（第一层：插入最小树）：

```yaml
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'
    - id: system-prompt
      name: '@deepseek-ai/dsh-system-prompt'
    - id: tools
      name: '@deepseek-ai/dsh-tools'
    - id: tool-executor-native
      name: '@deepseek-ai/dsh-tool-executor-native'
    - id: hello
      name: './src/plugins/hello.ts'
      config:
        tag: base
```

`cordis.overlay.yml`（第二层：整配置替换）：

```yaml
- id: hello
  config:
    tag: overlay-wins
```

`cordis.broken.yml`（fail-loud 演示层：占用 required id）：

```yaml
- insert:
    - id: agent-loop
      name: './src/plugins/broken.ts'
```

`src/plugins/broken.ts` 只有一句 `throw new Error('broken plugin: deliberate activation failure')`。

### 4.3 主程序 `src/index.ts`（五场景）

```ts
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches, StartupError } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')
const OVERLAY = resolve(ROOT, 'cordis.overlay.yml')
const BROKEN = resolve(ROOT, 'cordis.broken.yml')

// home 收进本示例目录：整目录拷走仍然自洽。
const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

// FiberState 是 const enum，没有运行时对象可 import；按值镜像（app-boot 同款做法）。
const STATE_NAMES = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING']

function helloState(ctx: Context): string {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === 'hello')
  const state = entry?.fiber?.state
  return state === undefined ? '(no fiber)' : STATE_NAMES[state] ?? String(state)
}

const basePatch = () => loadOverlayPatches('dsh-boot-demo', PATCH)
const provideMark = (ctx: Context) => { ctx.provide('labMark', 'from-prepare') }

// S1+S2：prepare 提供 labMark，两层 patch 叠加
const ctxA = await boot('dsh-boot-demo', CONFIG,
  [...basePatch(), ...loadOverlayPatches('dsh-boot-demo', OVERLAY)],
  provideMark, BASE_URL)

// S3：required 行失败 → StartupError
try {
  await boot('dsh-boot-demo', CONFIG,
    [...basePatch(), ...loadOverlayPatches('dsh-boot-demo', BROKEN)],
    provideMark, BASE_URL)
} catch (error) {
  if (!(error instanceof StartupError)) throw error
  // error.entries / error.composition 携带失败清单与树快照
}

// S4：无 prepare → PENDING；运行时 provide → ACTIVE
const ctxB = await boot('dsh-boot-demo', CONFIG, basePatch(), undefined, BASE_URL)
ctxB.provide('labMark', 'late-provide')
await ctxB.loader.await()

// S5：dispose 逆序回收
await ctxB.fiber.dispose()
await ctxA.fiber.dispose()
```

（完整可运行版本见本目录 `src/index.ts`，含逐场景日志与树状态打印。）

## 5. 实测运行输出

`npm start`（Node v26.12.1）：

```text
runtime = node v26.12.1

=== S1 boot(): prepare + patch + overlay → 最小树 settle ===
[hello] ACTIVE tag=overlay-wins labMark=from-prepare
[hello] effect#1 mount
[hello] effect#2 mount
  include                ACTIVE
  timer                  ACTIVE
  system-prompt          ACTIVE
  tools                  ACTIVE
  tool-executor-native   ACTIVE
  hello                  ACTIVE
=== S2 overlay 语义：hello 的 tag 应为 overlay-wins（整配置替换，后写胜出）===
hello state = ACTIVE（tag 见上方 [hello] 日志）

=== S3 fail-loud: required 行 agent-loop 激活失败 → StartupError ===
[hello] ACTIVE tag=base labMark=from-prepare
[hello] effect#1 mount
[hello] effect#2 mount
[hello] effect#2 dispose
[hello] effect#1 dispose
捕获 StartupError，message 首行：dsh-boot-demo: startup failed: 1 required plugin did not activate
  entries: id=agent-loop required=true outcome=failed
  composition.failed = [include:agent-loop]

=== S4 服务可用性驱动：无 prepare → PENDING → provide → ACTIVE ===
dsh-boot-demo: warning: 1 entry did not activate
hello (file:///D:/coding/creative/hello-olleh/dsh-lab/examples/dsh-boot-demo/src/plugins/hello.ts): pending (waiting for service: labMark)
provide 之前 hello state = PENDING
[hello] ACTIVE tag=base labMark=late-provide
[hello] effect#1 mount
[hello] effect#2 mount
provide 之后 hello state = ACTIVE

=== S5 dispose：effect 按挂载逆序回收 ===
[hello] effect#2 dispose
[hello] effect#1 dispose
[hello] effect#2 dispose
[hello] effect#1 dispose

BOOT_DEMO_OK
```

`npm run start:bun`（Bun 1.4.4）：除首行 `runtime = bun 1.4.4` 外**逐行一致**，同样以 `BOOT_DEMO_OK` 结束。本示例不挂 ptc/subprocess，Bun 无需任何补丁（对比：需要 `stripTypeScriptTypes` 或 subprocess runner 的示例要自带迷你 runtime 层，见 dsh-jobs-demo / dsh-sandbox-demo）。

`npm run typecheck`：退出码 0。

四个值得盯住的细节：

- **S3 里 hello 先 ACTIVE 又立刻 dispose**——boot 失败路径会回收已经挂载的兄弟行，且 effect 按逆序（#2 先于 #1）撤销；
- **S4 的 warning 来自 boot 内部审计**——hello 不在 required 清单，PENDING 不拦启动；`provide` 之后无需重启，Loader 自动把它激活；
- **composition.failed 的 id 是 `include:agent-loop`**——诊断快照用带树前缀的完整 id；
- 树状态打印里的 `include` 行是 boot 挂的 bootstrap Include（`cordis:include` 内建），它也在审计范围内：根配置读不了同样是致命错误。

## 6. 机制解释

### 6.1 patch 层是"按 key 整体替换"，不是深合并

`applyPatches`（vendor/include/src/patch.ts:47-109）对非 insert 行的处理只有三句：

```ts
for (const [key, value] of Object.entries(overrides)) {
  if (key === 'id') continue
  target[key] = value
}
```

所以 overlay 层的 `config: { tag: overlay-wins }` 把 hello 的整个 config 换掉——如果第一层还有别的 config key，它们会**消失**而不是保留。多层叠加时同一个 key 后写的层胜出（`PatchIndex` 按 patch 数组下标记录每个 key 的 owner）。insert 行则相反：追加进目标 group（或根），且每个插入条目都会被 `ensureIds` 补上 id，运行时变更才能按 id 路由回来。

### 6.2 prepare 的位置决定了它能做什么

`prepare` 在 `ctx.plugin(Loader)` 之后、`mountRootInclude` 之前（index.ts:1244-1247）。这意味着：

- prepare 里 `ctx.provide(...)` 的服务，配置树挂载时**已经可见**——hello 第一层就能 ACTIVE；
- prepare 抛错时还没有任何配置条目挂载，所以错误标签是 `host preparation failed`，与插件树的失败干净分开；
- 不给 prepare 也完全合法：缺服务的行停在 PENDING，等运行时任何人 `provide` 补齐（S4）。激活的驱动力是**服务可用性**，不是启动顺序。

### 6.3 fail-loud 的边界：required 清单是全局的

`requiredStartupEntryIds` 是硬编码全局表，不是 profile 元数据。三条推论：

1. 最小树不挂 `agent-loop`/`webserver` 等行完全没问题——**缺席被忽略**；
2. 一旦挂了某个 required id（哪怕指向一个本地坏插件），它就必须激活，否则 `StartupError`；
3. 非 required 行失败只 warn。想演示"启动被拒绝"，必须占用一个 required id——这就是 `cordis.broken.yml` 用 `agent-loop` 而不是随便一个 id 的原因。

`StartupError` 携带三份证据：`entries`（每个 inactive 行的 id/module/required/fiberState/outcome）、`composition`（dispose 前抓的树快照，含每行状态与缺失服务）、`startup`（根配置路径 + 启动期 warn/error 日志）。排查启动失败不需要复现，读错误对象就够了。

### 6.4 FiberState 按值镜像

cordis 的 `FiberState` 是 const enum，编译后没有运行时对象。app-boot 自己的做法（index.ts:954-957）就是按值镜像：`PENDING=0 / LOADING=1 / ACTIVE=2 / FAILED=3 / DISPOSED=4 / UNLOADING=5`。本示例的 `STATE_NAMES` 数组同款。

## 7. 边界与坑

1. **`loader.entries()` 返回 Generator 不是数组**。直接 `.find()` 会在 typecheck 报 TS2339（本示例实测踩过）；先 `[...ctx.loader.entries()]` 展开。
2. **最小树漏挂 system-prompt 会连环失败**：tools PENDING → tool-executor-native PENDING → 它是 required → 整个 boot 抛 StartupError。错误信息会列出缺失服务链，但第一因在树上最深处。
3. **overlay 不是深合并**（§6.1）。想只改一个字段又保留其余字段，得把其余字段也写进 overlay 层。
4. **相对插件名锚定 patch 文件目录**，不是 cwd（`anchorInsertedPluginNames`，index.ts:567-577）。`./src/plugins/hello.ts` 相对的是 `cordis.patch.yml` 所在目录——所以 patch 文件和插件目录要一起搬。
5. **`DSH_HOME` 必须在 boot 之前设置**。boot 内部 `provide('dshHomePath', ...)` 供 `!!js` 表达式用；本示例把 home 收进 `<示例>/.dsh-home`（gitignore），整目录拷走不污染用户主目录。
6. **boot 已经自带审计**，返回后再手动 `auditStartupEntries` 是可选的二次检查，不是必须。
7. **Bun 差异为零的前提是不碰两条缝**：`node:module.stripTypeScriptTypes`（ptc 运行时）与 subprocess runner 的 `--` 分隔符。本示例两者都不挂，`start:bun` 直接 `bun src/index.ts`；挂了的示例必须自带 preload 补丁（素材见仓库 `runtime/`，各示例独立副本）。
8. **npm 会自动安装 peerDependencies**：`dsh-tools` 的 peer 面（llm/agent/scope/session/user-approval 等）没有写进本示例 package.json，但 `npm install` 后都在（共 47 包）。声明的只是本主题直接用到或直接引用的包。

## 8. 从零复现

目录结构：

```text
dsh-boot-demo/
├── package.json
├── tsconfig.json
├── .gitignore
├── cordis.yml            # []
├── cordis.patch.yml      # 第一层：最小树 insert
├── cordis.overlay.yml    # 第二层：hello config 整段替换
├── cordis.broken.yml     # fail-loud 层：占用 required id agent-loop
└── src/
    ├── index.ts          # 五场景主程序
    └── plugins/
        ├── hello.ts      # inject labMark + 两个可逆 effect
        └── broken.ts     # apply 里故意抛错
```

`package.json`：

```json
{
  "name": "dsh-boot-demo",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/index.ts",
    "start:bun": "bun src/index.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@deepseek-ai/cordis": "4.1.0",
    "@deepseek-ai/cordis-plugin-group": "1.1.0",
    "@deepseek-ai/cordis-plugin-include": "1.1.0",
    "@deepseek-ai/cordis-plugin-loader": "1.1.0",
    "@deepseek-ai/cordis-plugin-timer": "1.2.0",
    "@deepseek-ai/dsh-app-boot": "0.2.2-rc.3",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.3",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.3",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-executor-native": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.3"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

`tsconfig.json`：

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

`.gitignore`：`node_modules/` 与 `.dsh-home/` 两行。

YAML 三层的完整内容见 §4.2；`hello.ts` 见 §4.1；`broken.ts` 全文：

```ts
export const name = 'broken-on-purpose'

export function apply(): void {
  throw new Error('broken plugin: deliberate activation failure')
}
```

`src/index.ts` 直接复制本目录同名文件（§4.3 是节选）。验证步骤：

```bash
npm install          # 47 packages（含自动安装的 peer）
npm start            # 末行 BOOT_DEMO_OK
npm run start:bun    # 与 Node 逐行一致（首行 runtime 标识除外）
npm run typecheck    # 退出码 0
```

## 9. 小结

- [x] `boot()` 五参签名与内部时序：Loader → prepare → 配置树 → settle → 审计；
- [x] patch 层语义：insert 追加、非 insert 按 key 整体替换、后写胜出；
- [x] fail-loud 的真实边界：required 清单"缺席忽略、挂了必须活"，非 required 只 warn；
- [x] `StartupError` 三份证据：entries / composition / startup；
- [x] 服务可用性驱动激活：PENDING 不是错误，是等待；运行时 provide 即激活；
- [x] dispose 逆序回收 effect，boot 失败路径同样回收已挂载的兄弟行；
- [x] Node 与 Bun 双运行时逐行一致，不碰 ptc/subprocess 就无需补丁。

下一篇：[dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md)——在这棵树的 `tools` 服务上走完注册→可见性→waterfall→执行→回收的全管线。