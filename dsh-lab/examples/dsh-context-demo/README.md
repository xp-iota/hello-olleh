# dsh 的上下文装配示例

本示例演示上下文装配与经济学：section 装配与可逆注册、变量插值的严格校验、token 估算、超长工具结果裁剪、大输出溢写、会话历史折叠为模型表面。big-text 工具在 cordis.patch.yml 里声明，两棵树都带上，代码里没有一处 `ctx.plugin()`。

上下文窗口有限，于是「模型看到什么」是一门经济学。全部场景离线、不需要 key；版本面 `@deepseek-ai/*` 0.2.2-rc.3、`@deepseek-ai/cordis` 4.1.0，Node 26.12.1 与 Bun 1.4.4 输出逐行一致（首行 runtime 标识、随机会话 id 与溢写临时目录名除外）。

配套文章：[07 请求管线](../../../docs/hello-dsh/07-request-pipeline-llm-tools-and-prompts.md)（System Prompt 装配、工具结果与上下文节流）。

## 1 模型每次请求到底看到什么

dsh 把「模型看到什么」拆成两层：

- **装配层**：System Prompt 由有序 section 与变量拼装，工具 schema 随 agent 装配，运行时上下文作为快照注入；
- **节流层**：三件配套机制控制进入窗口的字节数——token 计量（token-meter）、超长工具结果裁剪（tool-result-pruner）、大输出溢写（spill-policy）。

> 装配层的每个贡献都是可逆的，节流层的每个决定都有出处：插值失败是硬错误，裁剪留影子计价，溢写留文件路径。

本示例把六个观察点全部真实触发，而不是只验证「服务在位」。其中裁剪与溢写各有一个容易误判的挂点，第 4 节如实记录。

## 2 最小树：十行底座 + 五行经济学设施 + 一行自写工具

在 [dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md) 的十行基础上追加六行，共 **16 行**：

| 行 id | 包 | 说明 |
|---|---|---|
| `token-meter` | `@deepseek-ai/dsh-token-meter` | `static inject = ['sessionProjections']`；估算器在子路径 `/estimate` 导出 |
| `tool-result-pruner` | `@deepseek-ai/dsh-compaction-tool-result-pruner` | `static inject = ['tokenMeter']`；config：thresholdChars 8192 / headChars 4096 / tailChars 1024 |
| `spill-local` | `@deepseek-ai/dsh-spill-local` | 溢写存储后端，提供 `spillStore` |
| `spill-policy` | `@deepseek-ai/dsh-spill-policy` | `inject = ['tools']`；config：maxInlineTokens 12500 |
| `session-query-sqlite` | `@deepseek-ai/dsh-session-query-sqlite` | `static inject = ['sessions']`；config：`path: ':memory:'`、`openAt: never`，进程退出即消失 |
| `big-text` | `./src/plugins/big-text.ts` | 自写工具插件；可控大小文本，两棵树都带上 |

另有第二棵树用的 overlay `cordis.noprune.yml`（`disabled: true` 关掉 pruner，演示配置层开关，见第 4 节）。

## 3 六个场景

```ts
// S1 section 装配：注册返回精确的解除函数
const removeSection = ctx.systemPrompt.section({ name: 'demo:context', order: 1500, text: '…' })
const assembly = await ctx.systemPrompt.assemble()   // { sections, tools }
removeSection()                                       // 可逆 effect

// S2 变量插值：装配期求值；未定义变量让 renderPrompt 抛错
const removeVariable = ctx.systemPrompt.variable('demo_stage', () => 'S2')
renderPrompt(await ctx.systemPrompt.assemble())      // 含 {{demo_missing}} 时抛错

// S3 token 估算：子路径导出的纯函数
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
estimateContent([{ type: 'text', text }])

// S4 裁剪：pruner 是会话表面服务——往 session 追加超大 tool/result，再 pruneSession
session.append('tool/result', { turn: 0, step: 0, message: bigMessage }, { surfaceOp: 'append' })
const { pruned, charsRemoved } = ctx.toolResultPruner.pruneSession(session)

// S5 溢写：第二棵树禁用 pruner；调用必须带 agent（spill 需要会话 owner）
const huge = await callTool(ctxB, 'big_text', { size: 'huge' }, handleB.agent)

// S6 模型表面：会话历史折叠成模型可见事件序列
const surface = await ctx.sessionQuery.readSurface(handle.agent.session.id)
```

可控大小的文本来自 big-text 插件的 `makeText(words)`：`word0 word1 word2 …` 逐词编号。词互不相同是刻意的——重复字符会被估算器压得很低，测不出真实压力。medium（3000 词，25889 字符 ≈ 6477 token）超过 pruner 的 8192 字符阈值但低于 spill 的 12500 token 预算；huge（16000 词，148889 字符）超过 spill 预算。`callTool` 封装与 dsh-tool-pipeline-demo 完全相同（批接口、JSON 字符串参数、可选 agent）。

## 4 机制解释

### section 与 variable 都是可逆贡献

`ctx.systemPrompt.section()` / `.variable()` 返回精确的解除函数，注册挂在调用方 fiber 的 effect 链上。装配结果 `assemble()` 是 `{ sections, tools }`：section 按 order 排序合并，工具 schema 来自当前装配范围。S1 的「工具 schema 数：1」正是 patch 里声明的 big_text——全局视角下这棵树只有这一个工具；带 agent 的装配见 dsh-tool-pipeline-demo S4。返回的 section 对象不带可枚举的 order：输出里的 `order=?` 不是 bug，排序信息在装配内部；想看顺序直接看 sections 数组的排列。

### 插值失败是硬错误

`renderPrompt` 遇到未注册变量直接抛 `unknown prompt variable "{{demo_missing}}" in section "demo:broken"`，而不是把 `{{x}}` 原样送给模型。上下文里的每个占位符都必须有出处——这和 boot 的 fail-loud 是同一个思路。

### pruner 是会话表面服务，不是 post-execute 监听

这是本示例最重要的纠正（很容易误以为它是执行后拦截）。rc.3 源码里 `ToolResultPruner`（compaction-tool-result-pruner/src/index.ts:44）**没有任何 `ctx.on`**——它是纯服务，提供 `pruneSession(session)`：

1. 遍历 session 当前表面的 `tool/result` 节点；
2. 超过 thresholdChars 的，按 head/tail 预算确定性裁剪；
3. **影子计价协议**：先追加一条 `compaction/prune` 事件（用 tokenMeter 给被影子节点计价），再紧挨着追加替换的 `tool/result`，`surfaceOp: { op: 'replace', startSeq, endSeq }` 引用被替换节点。

替换保留完整事件数据、只改 content，且引用原节点——**重放可以恢复替换输入**。调用方是 compaction-basic：每次请求前 `ctx.get('toolResultPruner')?.pruneSession(agent.session)`。所以裁剪发生在「历史进入下一次请求」的路上，不是工具执行的那一刻。想手动触发裁剪，要往会话表面追加 `tool/result` 再调 `pruneSession`——`tool/result` 是 surface-eligible 事件，`session.append` 缺第三个参数 `{ surfaceOp: 'append' }` 会直接抛 `requires a surfaceOp marker`。

### spill 以 prepend 挂链；pruner 在位与否不影响它

`spill-policy` 的监听器带 `{ prepend: true }`（spill-policy/src/index.ts:151），且第一句是 `await next()`——它先拿到下游整条链的决定，再对结果计价。pruner 不在 post-execute 链上，所以它在位与否不影响 spill：只挂 patch（pruner 在位）直接调 huge，同样溢写（148889 → 49932 字符，通知在场）。第二棵树保留 `cordis.noprune.yml` 是为了演示「同一份 patch + 不同 overlay = 不同机制组合」的配置层开关，不是触发 spill 的必要条件。

spill 自身还有两条硬约束：结果估算超过 maxInlineTokens 才动手；**必须有会话 owner**（`exec.agent?.session.header.id`），否则 warn 一声保留内联内容。落盘走 `spillStore.saveText()`，文件在系统临时目录的 `dsh-spill-*` 私有根下按会话分目录；模型看到的替换内容是「头 + 尾 + 溢写通知（含精确字节数与文件路径）」，并提示用 read offset/limit 或 grep 取回全文。一个细节：溢写通知里的路径后面紧跟句号——用正则提取路径要把句末 `.` 一起剥掉，否则 `existsSync` 差一个字符判 false。

### 模型表面是历史的投影

`sessionQuery.readSurface(sessionId)` 返回会话历史折叠后的模型可见事件序列。SQLite 索引配 `:memory:` + `openAt: never` 时完全在内存里，进程退出即消失——机制演示不需要落盘索引。node:sqlite 在 Node 26 与 Bun 1.4.4 上都可用，这一行不需要任何运行时补丁。

## 5 运行上下文装配示例

根配置留空，装配全部来自 patch 清单：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml。
[]
```

`cordis.patch.yml` 全文（16 行清单）：

```yaml
# 上下文装配与经济学的最小树：在 dsh-tool-pipeline-demo 的十行基础上，
# 追加 token-meter / tool-result-pruner / spill-local / spill-policy / session-query-sqlite。
# 依赖链：sessionProjections → token-meter；sessions → session-query-sqlite；
#         tools → spill-policy（inject = ['tools']）。
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'

    - id: system-prompt
      name: '@deepseek-ai/dsh-system-prompt'

    - id: tools
      name: '@deepseek-ai/dsh-tools'

    - id: tool-executor-native
      name: '@deepseek-ai/dsh-tool-executor-native'

    - id: session
      name: '@deepseek-ai/dsh-session'

    - id: session-projection
      name: '@deepseek-ai/dsh-session-projection'

    - id: agent
      name: '@deepseek-ai/dsh-agent'

    - id: llm
      name: '@deepseek-ai/dsh-llm'

    - id: agent-loop
      name: '@deepseek-ai/dsh-agent-loop'
      config:
        agents: []

    - id: token-meter
      name: '@deepseek-ai/dsh-token-meter'

    # 超长工具结果裁剪：会话表面服务（不是 post-execute 监听），
    # compaction-basic 每次请求前调 pruneSession：影子计价 + replace 事件。
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024

    - id: spill-local
      name: '@deepseek-ai/dsh-spill-local'

    # 大输出溢写：超过内联 token 预算的结果落到文件，模型只看到预览 + 路径。
    - id: spill-policy
      name: '@deepseek-ai/dsh-spill-policy'
      config:
        maxInlineTokens: 12500

    # 会话查询索引：内存 SQLite，进程退出即消失，不落盘。
    - id: session-query-sqlite
      name: '@deepseek-ai/dsh-session-query-sqlite'
      config:
        path: ':memory:'
        openAt: never

    # 自写工具插件也走声明式：两棵树都带上，S5 在第二棵树上调用。
    - id: big-text
      name: ./src/plugins/big-text.ts
```

第二棵树的 overlay `cordis.noprune.yml` 全文：

```yaml
# 第二棵树的 overlay：禁用 pruner，演示配置层 disabled 开关。
# rc.3 实测：pruner 是会话表面服务，不在 tools/post-execute 链上，
# 所以它在位与否都不影响 spill 触发（探针验证：两棵树 huge 输出同样溢写）。
# 保留第二棵树是为了展示「同一份 patch + 不同 overlay = 不同机制组合」。
- id: tool-result-pruner
  disabled: true
```

`npm start` 直接跑 `src/index.ts`：入口是官方 `boot()`，S5 前再 boot 第二棵树（同一份 patch 叠加 noprune overlay）：

```ts
const patches = () => loadOverlayPatches('dsh-context-demo', PATCH)
const ctx = await boot('dsh-context-demo', CONFIG, patches(), undefined, BASE_URL)
// ……S1～S4、S6 在第一棵树上……
await ctx.fiber.dispose()

// S5：第二棵树 = 同一份 patch + noprune overlay
const ctxB = await boot(
  'dsh-context-demo', CONFIG,
  [...patches(), ...loadOverlayPatches('dsh-context-demo', NOPRUNE)],
  undefined, BASE_URL,
)
// big_text 工具由 patch 清单声明，boot 后已在位。
// ……S5 溢写观察……
await ctxB.fiber.dispose()
console.log('\nCONTEXT_DEMO_OK')
```

在本机复现只需要四条命令：

```bash
npm install             # @deepseek-ai/* 依赖（含自动安装的 peer）
#
npm start               # Node：六场景全离线，末行 CONTEXT_DEMO_OK
npm run start:bun       # Bun：不挂 ptc/subprocess，无需任何补丁，输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1；Bun 1.4.4 除首行 runtime 标识、随机会话 id 与溢写临时目录名外逐行一致）：

```text
runtime = node v26.12.1

=== S1 system prompt：section 装配与可逆注册 ===
section 数：4
  [harness:identity] order=?
  [deployment:persona-prefix] order=?
  [demo:context] order=?
  [deployment:persona-suffix] order=?
工具 schema 数：1
移除后 section 已消失（注册是可逆 effect）

=== S2 变量插值：装配期求值，未定义变量直接抛错 ===
插值成功：true
未定义变量按预期报错：unknown prompt variable "{{demo_missing}}" in section "demo:broken"; registered

=== S3 token 估算：estimateContent ===
50 词（339 字符）≈ 89 token
3000 词（25889 字符）≈ 6477 token

=== S4 tool-result-pruner：真实触发会话表面裁剪 ===
pruned 条数：1，charsRemoved = 20730
  seq 0 → 2：25889 → 5159 字符

=== S6 会话历史折叠为模型表面 ===
会话 context-surface-mwlvmjqi 的模型表面事件：0 条

=== S5 spill-policy：真实触发溢写（第二棵树禁用 pruner）===
原始文本 148889 字符 → 模型可见 49932 字符
模型可见头部：word0 word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word1…
模型可见尾部：rd15996 word15997 word15998 word15999 (Omitted 99189 bytes. Full formatted result stored at: C:\Users\feuye\AppData\Local\Temp\dsh-spill-EAbyS1\session-960e468b5e5d\263c006e9d3c-big_text.txt. Use read with offset/limit, or grep this path to search within it.)
溢写文件存在 = true（C:\Users\feuye\AppData\Local\Temp\dsh-spill-EAbyS1\session-960e468b5e5d\263c006e9d3c-big_text.txt）

CONTEXT_DEMO_OK
```

三个值得注意的数字：

- **S4：25889 → 5159 字符**——head 4096 + tail 1024 + 省略通知，正是 config 的三个数；seq 0 → 2 中间隔的那条就是影子计价事件；
- **S5：148889 → 49932 字符**——spill 不是数量级压缩，而是「内联预算内的头尾保留 + 超出部分落盘」（99189 字节进了文件）；
- **S6：0 条**——新建会话还没有任何事件，模型表面是空的；真实 turn 的事件流见 dsh-session-demo 与 dsh-trajectory-probe-demo。

## 6 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis fork 直接运行 TypeScript，没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
dsh-context-demo/
├── package.json              # 22 依赖，全部精确 pin
├── tsconfig.json             # 只做类型检查，不产出 JS
├── .gitignore                # node_modules/ + .dsh-home/
├── cordis.yml                # []：根配置留空
├── cordis.patch.yml          # 16 行装配清单（第 5 节全文）
├── cordis.noprune.yml        # 第二棵树：disabled: true 关掉 pruner
└── src/
    ├── index.ts              # 六场景主程序，169 行
    ├── tools.ts              # 单次调用封装（与 tool-pipeline-demo 相同）
    └── plugins/
        └── big-text.ts       # 可控大小文本工具，37 行
```

### package.json（完整版）

```json
{
  "name": "dsh-context-demo",
  "private": true,
  "type": "module",
  "description": "上下文装配与经济学：section 装配、变量插值校验、token 估算、超长结果裁剪、大输出溢写、会话模型表面。Node 与 Bun 双运行时。",
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
    "@deepseek-ai/dsh-agent": "0.2.2-rc.3",
    "@deepseek-ai/dsh-agent-loop": "0.2.2-rc.3",
    "@deepseek-ai/dsh-app-boot": "0.2.2-rc.3",
    "@deepseek-ai/dsh-compaction-tool-result-pruner": "0.2.2-rc.3",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.3",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.3",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-query-sqlite": "0.2.2-rc.3",
    "@deepseek-ai/dsh-spill-local": "0.2.2-rc.3",
    "@deepseek-ai/dsh-spill-policy": "0.2.2-rc.3",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.3",
    "@deepseek-ai/dsh-token-meter": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-executor-native": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.3"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

tsconfig.json 与 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md) 逐字相同；`tools.ts` 与 [dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md) 的同名文件逐字节相同（批接口封装，该示例 README 有全文镜像）。

### src/plugins/big-text.ts（完整版）

```ts
/**
 * big-text —— 产出可控大小文本的工具，服务于裁剪与溢写两个场景。
 * medium：3000 个互不相同的词（约 2 万字符、数千 token）——超过 pruner 的
 *         8192 字符阈值，但低于 spill 的 12500 token 预算；
 * huge：  16000 个互不相同的词（约 11 万字符、数万 token）——超过 spill 预算。
 * 词互不相同是刻意的：重复字符会被估算器压得很低，测不出真实压力。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'tool-big-text'
export const inject = ['tools']

export function makeText(words: number): string {
  return Array.from({ length: words }, (_, i) => `word${i}`).join(' ')
}

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'big_text',
      description: '产出指定规模的文本，用于观察上下文经济学机制。',
      parameters: {
        size: { type: 'string', required: true, description: 'medium 或 huge' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args: unknown) {
        const { size } = args as { size: string }
        return makeText(size === 'huge' ? 16000 : 3000)
      },
    }),
  )
}
```

### src/index.ts（完整版）

```ts
/**
 * dsh-context-demo —— 上下文装配与经济学，六个场景全部离线：
 *   S1 system prompt 的 section 装配与可逆注册；
 *   S2 变量插值与未定义变量的严格失败；
 *   S3 token 估算（estimateContent）；
 *   S4 超长工具结果裁剪（tool-result-pruner 真实触发）；
 *   S5 大输出溢写（spill-policy 真实触发，第二棵树禁用 pruner）；
 *   S6 会话历史折叠为模型表面（sessionQuery.readSurface）。
 * big-text 工具在 cordis.patch.yml 里声明，两棵树都带上，S5 在第二棵树上调用。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolResultMessage } from '@deepseek-ai/dsh-session'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import type {} from '@deepseek-ai/dsh-session-query-sqlite'
import { makeText } from './plugins/big-text.ts'
import { callTool, preview } from './tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')
const NOPRUNE = resolve(ROOT, 'cordis.noprune.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const patches = () => loadOverlayPatches('dsh-context-demo', PATCH)
const ctx = await boot('dsh-context-demo', CONFIG, patches(), undefined, BASE_URL)

// ── S1：section 装配 ───────────────────────────────────────────────────────
console.log('\n=== S1 system prompt：section 装配与可逆注册 ===')
const removeSection = ctx.systemPrompt.section({
  name: 'demo:context',
  order: 1500,
  text: '本节由运行时注册：dsh 把 System Prompt 的每一段都当作可寻址的贡献。',
})
const assembly = await ctx.systemPrompt.assemble()
console.log(`section 数：${assembly.sections.length}`)
for (const section of assembly.sections.slice(0, 8)) {
  console.log(`  [${section.name}] order=${(section as { order?: number }).order ?? '?'}`)
}
assert(assembly.sections.some(s => s.name === 'demo:context'), '运行时注册的 section 未出现在装配结果里')
console.log(`工具 schema 数：${assembly.tools.length}`)
removeSection()
const after = await ctx.systemPrompt.assemble()
assert(!after.sections.some(s => s.name === 'demo:context'), '移除 section 后仍在')
console.log('移除后 section 已消失（注册是可逆 effect）')

// ── S2：变量插值与严格校验 ─────────────────────────────────────────────────
console.log('\n=== S2 变量插值：装配期求值，未定义变量直接抛错 ===')
const removeVariable = ctx.systemPrompt.variable('demo_stage', () => 'S2')
const removeVarSection = ctx.systemPrompt.section({
  name: 'demo:variable',
  order: 1501,
  text: '当前场景：{{demo_stage}}。这句话里的变量在装配期插值。',
})
const rendered = renderPrompt(await ctx.systemPrompt.assemble())
assert(rendered.includes('当前场景：S2'), '变量没有插值进 System Prompt')
console.log(`插值成功：${rendered.includes('当前场景：S2')}`)
const removeBroken = ctx.systemPrompt.section({
  name: 'demo:broken',
  order: 1502,
  text: '未定义变量：{{demo_missing}}',
})
let threw = false
try {
  renderPrompt(await ctx.systemPrompt.assemble())
} catch (error) {
  threw = true
  console.log(`未定义变量按预期报错：${error instanceof Error ? error.message.slice(0, 80) : ''}`)
}
assert(threw, '未定义变量应当让渲染失败')
removeBroken()
removeVarSection()
removeVariable()

// ── S3：token 估算 ─────────────────────────────────────────────────────────
console.log('\n=== S3 token 估算：estimateContent ===')
const shortText = makeText(50)
const longText = makeText(3000)
const shortTokens = estimateContent([{ type: 'text', text: shortText }])
const longTokens = estimateContent([{ type: 'text', text: longText }])
console.log(`50 词（${shortText.length} 字符）≈ ${shortTokens} token`)
console.log(`3000 词（${longText.length} 字符）≈ ${longTokens} token`)
assert(longTokens > shortTokens, '更长的文本应当估算出更多 token')

// ── S4：裁剪超长工具结果（pruner 是会话表面服务，不是 post-execute 监听）─────
console.log('\n=== S4 tool-result-pruner：真实触发会话表面裁剪 ===')
const handle4 = await ctx.agents.create({
  sessionId: SessionId(`context-prune-${Date.now().toString(36)}`),
  meta: { cwd: process.cwd() },
})
const session4 = handle4.agent.session
const callId = ToolCallId(`demo-prune-${Date.now().toString(36)}`)
const bigMessage: ToolResultMessage = {
  id: MessageId(`demo-prune-msg-${Date.now().toString(36)}`),
  role: 'tool',
  toolCallId: callId,
  isError: false,
  source: { kind: 'tool', callId },
  content: [{ type: 'text', text: longText }],
}
session4.append('tool/result', { turn: 0, step: 0, message: bigMessage }, { surfaceOp: 'append' })
const pruneResult = ctx.toolResultPruner.pruneSession(session4)
console.log(`pruned 条数：${pruneResult.pruned.length}，charsRemoved = ${pruneResult.charsRemoved}`)
for (const p of pruneResult.pruned) {
  console.log(`  seq ${p.originalSeq} → ${p.replacementSeq}：${p.charsBefore} → ${p.charsAfter} 字符`)
}
assert(pruneResult.pruned.length === 1 && pruneResult.charsRemoved > 0, '裁剪没有发生')
await handle4.dispose()

// ── S6：会话模型表面（在 ctx 上，先于第二棵树）─────────────────────────────
console.log('\n=== S6 会话历史折叠为模型表面 ===')
const handle = await ctx.agents.create({
  sessionId: SessionId(`context-surface-${Date.now().toString(36)}`),
  meta: { cwd: process.cwd() },
})
const surface = await ctx.sessionQuery.readSurface(handle.agent.session.id)
console.log(`会话 ${handle.agent.session.id} 的模型表面事件：${surface.events.length} 条`)
await handle.dispose()
await ctx.fiber.dispose()

// ── S5：大输出溢写（第二棵树：禁用 pruner）─────────────────────────────────
console.log('\n=== S5 spill-policy：真实触发溢写（第二棵树禁用 pruner）===')
const ctxB = await boot(
  'dsh-context-demo', CONFIG,
  [...patches(), ...loadOverlayPatches('dsh-context-demo', NOPRUNE)],
  undefined, BASE_URL,
)
// big_text 工具由 patch 清单声明，boot 后已在位。
// spill 需要会话 owner（exec.agent.session.header.id）：不传 agent 会 warn 并保留内联内容。
const handleB = await ctxB.agents.create({
  sessionId: SessionId(`context-spill-${Date.now().toString(36)}`),
  meta: { cwd: process.cwd() },
})
const huge = await callTool(ctxB, 'big_text', { size: 'huge' }, handleB.agent)
assert(!huge.isError, `huge 调用失败：${huge.content}`)
const hugeOriginal = makeText(16000)
console.log(`原始文本 ${hugeOriginal.length} 字符 → 模型可见 ${huge.content.length} 字符`)
console.log(`模型可见头部：${preview(huge.content, 80)}`)
console.log(`模型可见尾部：${preview(huge.content.slice(-260), 260)}`)
// spill 的保留策略是"头尾 + 溢写通知"，内联预算 maxInlineTokens 内的内容仍保留，
// 所以压缩比不是数量级而是"超出预算的部分落盘"。
assert(huge.content.length < hugeOriginal.length, '溢写没有发生')
const pathMatch = huge.content.match(/[A-Za-z]:[\\/][^\s'"]+|\/[^\s'"]+spill[^\s'"]*/)
assert(pathMatch !== null, '溢写通知里没有文件路径')
const spilled = pathMatch![0].replace(/[.'")\]]+$/, '')
console.log(`溢写文件存在 = ${existsSync(spilled)}（${spilled}）`)
assert(existsSync(spilled), '溢写文件应当落盘')
await handleB.dispose()
await ctxB.fiber.dispose()

console.log('\nCONTEXT_DEMO_OK')
```

### 按顺序验证

```bash
npm install             # 22 依赖精确 pin（含自动安装的 peer）
#
npm run typecheck       # tsc 0 错误
npm start               # Node：末行 CONTEXT_DEMO_OK
npm run start:bun       # Bun：随机 id/临时目录名除外逐行一致
```

示例不依赖任何环境变量、端口或外部服务。运行时状态落在工程内 `.dsh-home/`（已 gitignore），溢写文件落在系统临时目录的 `dsh-spill-*` 私有根下。

## 7 小结

这个示例验证了七件事：

- System Prompt 是有序 section + 变量的可逆贡献，插值失败是硬错误；
- token 计量有纯函数估算器（`/estimate` 子路径），真实计量发生在每次请求后；
- pruner 裁剪的是**会话表面**：影子计价 + replace 事件，重放可恢复——它不在 post-execute 链上；
- spill 以 prepend + next 挂链，需要会话 owner，头尾保留 + 超出落盘；pruner 在位与否不影响它（rc.3 探针实测）；
- 配置层 `disabled: true` 是观察机制组合的正确手段：同一份 patch + 不同 overlay = 不同树；
- 模型表面是历史的投影，内存 SQLite 即可演示；
- Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md)；下一篇：[dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md)——turn/step 事件与脚本化适配器驱动的循环。