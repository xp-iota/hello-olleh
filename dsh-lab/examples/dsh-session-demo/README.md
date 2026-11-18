# dsh 的会话日志示例

本示例演示会话日志的六个面：append-only 事件流的结构与 seq 不变量、JSONL 落盘、live-preferred 会话列表、标题投影、模型表面、从日志恢复。word-count 工具与脚本化适配器都在 cordis.patch.yml 里声明，boot 后全程在位，代码里没有一处 `ctx.plugin()`。

dsh 没有独立的「聊天记录数据库」：**会话日志就是唯一事实来源**。turn/step 边界、消息、工具调用与结果、标题、请求锚点，全部是同一个 append-only 事件流里的记录。全部场景离线、不需要 key；版本面 `@deepseek-ai/*` 0.2.2-rc.3、`@deepseek-ai/cordis` 4.1.0，Node 26.12.1 与 Bun 1.4.4 输出逐行一致（首行 runtime 标识与随机会话 id 除外）。

## 1 唯一事实来源长什么样

围绕这条事件流有四个问题：

- 日志的结构与不变量是什么（seq、type、data、surfaceOp）？
- 怎么落盘、怎么从盘上恢复一个 agent？
- 列表页、标题、模型上下文各自读哪个面？
- 哪些事件模型看得见、哪些只是运行时记账？

> 这些观察点都需要「真的跑过一个 turn」才有内容，而真实 turn 需要模型。

本示例沿用 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md) 的脚本化适配器离线播种一条真实 turn（工具步 + 回答步），然后把六个观察点全部真实触发。

## 2 最小树：九行底座 + 五行会话设施 + 两个自写插件

在 agent-loop 的九行底座（timer / system-prompt / tools / tool-executor-native / session / session-projection / agent / llm / agent-loop）上追加五行会话设施：

| 行 id | 包 | 说明 |
|---|---|---|
| `session-log-deepseek` | `@deepseek-ai/dsh-session-log-deepseek` | 官方 v4 编解码；`inject = ['deepseekLlmApiExtensions', 'sessions']` |
| `deepseek-llm-api-extensions` | `@deepseek-ai/dsh-deepseek-llm-api-extensions` | 上一行注入的扩展字段——**缺这一行编解码行永远 pending** |
| `session-persistence-jsonl` | `@deepseek-ai/dsh-session-persistence-jsonl` | 落盘后端；config：`root: !!js dshHomePath('sessions')`、`compression: none` |
| `session-query-sqlite` | `@deepseek-ai/dsh-session-query-sqlite` | 读取面 `ctx.sessionQuery`；`static inject = ['sessions']`；`:memory:` + `openAt: never` |
| `session-title` | `@deepseek-ai/dsh-session-title` | 标题投影；`static inject = ['sessions', 'sessionProjections', 'agents']`；只挂规则回退，不挂 title-llm |

再加两行自写插件（word-count / scripted-adapter，与 agent-loop 示例逐字相同），共十六行。`compression: none` 是刻意的演示选择：默认是 **zstd**（session-persistence-jsonl/src/index.ts:69），这里要肉眼可读的落盘文件。node:sqlite（`:memory:`）在 Node 26 与 Bun 1.4.4 上都可用。

## 3 播种一条真实 turn

scripted-adapter 插件的 apply 里一句 `ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())` 就把剧本路由挂上；`registerAdapter()` 内部走 `ctx.effect`，fiber 销毁时路由自动回收。播种代码：

```ts
// 脚本第 1 步调 word_count，第 2 步给最终回答。
const sessionId = SessionId(`session-demo-${Date.now().toString(36)}`)
const handle = await ctx.agents.create({
  sessionId,
  meta: { cwd: process.cwd() },
  agentOptions: { provider: 'lab-scripted', model: 'seed' },
})
const agent = handle.agent
agent.followup(createUserMessage({
  content: [{ type: 'text', text: '统计一下这段文本的词数' }],
  source: { kind: 'user' },
}))
await agent.whenIdle()
```

之后六个场景全部围绕这一个会话展开——不再创建第二个 agent，直到 S6 的 dispose → resume。

## 4 六个场景

```ts
// S1 精确读：异步快照，seq 从 0 连续递增
const snapshot = await ctx.sessionQuery.readSession(sessionId)

// S2 落盘：flush 是唯一的耐久性检查点入口
const flushed = await ctx.sessions.flush(agent.session)   // true

// S3 列表：live（进程内在位）与 persisted（盘上有）是两个独立标志
const records = await ctx.sessionQuery.listSessions()

// S4 标题：不挂 title-llm 时走首条人类消息的规则回退
const title = await ctx.sessionQuery.readTitle(sessionId)

// S5 模型表面：历史折叠后模型可见的事件序列
const surface = await ctx.sessionQuery.readSurface(sessionId)

// S6 恢复：dispose 之后从日志重建同一个 agent
await handle.dispose()
const resumed = await ctx.agents.resume({ resumeSessionId: sessionId })
```

落盘文件的查找是递归遍历 `.dsh-home/sessions` 找包含本会话 id 的 `.jsonl`——目录按项目路径 slug 组织（见第 6 节实测路径）。

## 5 机制解释

### append-only 与 seq 不变量

`session.append()` 是唯一写入路径；每条事件带单调递增的 `seq`（从 0 连续）。surface-eligible 事件（消息类）必须带 `surfaceOp` 标记（`'append'` 或 `{ op: 'replace', startSeq, endSeq }`），声明它如何进入模型表面——这是 context-demo 里 pruner 影子计价协议的基础。同步快照直接读 `session.events` 已弃用，新代码一律走 `sessionQuery` 的异步读。

### flush 是唯一的耐久性检查点

`ctx.sessions.flush(session)`（core/session/src/index.ts:1422）分发 awaited 的 `session/flush` 事件，JSONL 后端在其中把缓冲的追加批写盘。文档明确要求：**读存储之前必须先 flush**，且必须走这个入口而不是裸发 `ctx.parallel('session/flush', …)`——一个 owner，一条检查点。持久化插件平时异步缓冲，append 本身不做 I/O。

### 落盘布局与 v4 编码

文件在 `<root>/<项目路径 slug>/<会话 id>/session.v4.jsonl`：项目 slug 把 cwd 的盘符与分隔符拍平成目录名（实测 `--D-coding-creative-…--`）。首行 `session` 头记录携带 header，其后是 v4 编码的事件行——编解码由 session-log-deepseek 注册，它依赖 deepseek-llm-api-extensions 提供的扩展字段；缺这条依赖行，编解码行永远 pending，而 boot 审计对非 required 行只 warn 不抛，症状是「落盘悄悄不工作」。默认物理编码是 zstd（`.jsonl.zstd`），`compression: none` 时是纯文本。

### live-preferred 列表与两个标志

`listSessions()` 合并进程内 live 会话与盘上持久化会话：`live` 表示当前进程持有该会话的 agent，`persisted` 表示存储后端有它的文件。两者独立——刚创建未 flush 的会话 live=true / persisted=false；dispose 且 flush 过的会话反过来。列表页优先显示 live 版本（更新），这就是 "live-preferred"。

### 标题与表面都是投影

标题由 session-title 服务折叠日志产生：有 title-llm 插件时模型摘要优先，失败或未装配时回退到首条人类消息（按 fallbackMaxWords / fallbackMaxBytes 截断）。模型表面（`readSurface`）把日志折叠成模型可见消息序列——它是「历史进入下一次请求」的原料，compaction 的 replace 事件也作用在这个面上。

### resume 是重建而不是读取

`agents.resume({ resumeSessionId })`（core/agent/src/index.ts:205、:423）加载持久化日志、重放事件、在原身份上重建 agent 与全部投影，并追加恢复锚点。disposer 是一种**能力**：持有它才能消费这个 agent。恢复后的 agent 与新建的没有任何身份差异——S6 实测 id 完全一致。因为恢复锚点是追加的，断言判据是「事件数 >= 恢复前且身份一致」，不是相等。

## 6 运行会话日志示例

根配置留空，装配全部来自 patch 清单：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

```yaml
# 会话表面的最小树：agent-loop 九行基础上追加五行会话设施——
# session-log-deepseek（v4 编解码）+ deepseek-llm-api-extensions（它注入的扩展字段，
# 缺这一行编解码行永远 pending）+ session-persistence-jsonl（落盘）
# + session-query-sqlite（读取面）+ session-title（标题投影，规则回退）。
# 依赖链：systemPrompt → tools → tool-executor-native；
#         sessionProjections → agent；
#         agents + sessions + llm + tools + systemPrompt + sessionProjections → agent-loop；
#         sessions → session-query-sqlite / session-title（后者还要 agents）。
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

    # 会话日志的官方 v4 编解码（tool/call、assistant/attempt 等事件序列化）。
    - id: session-log-deepseek
      name: '@deepseek-ai/dsh-session-log-deepseek'

    # session-log-deepseek 注入 deepseekLlmApiExtensions；缺这一行它永远 pending。
    - id: deepseek-llm-api-extensions
      name: '@deepseek-ai/dsh-deepseek-llm-api-extensions'

    # 每会话一份 JSONL，根目录在本工程 .dsh-home/sessions。
    # compression: none 是刻意的演示选择：默认 zstd，这里要肉眼可读的落盘文件。
    - id: session-persistence-jsonl
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      config:
        root: !!js dshHomePath('sessions')
        compression: none

    # 读取面：ctx.sessionQuery（精确读、列表、标题、表面）。
    # openAt: never = 不落 SQLite 索引文件；精确读照常可用。
    - id: session-query-sqlite
      name: '@deepseek-ai/dsh-session-query-sqlite'
      config:
        path: ':memory:'
        openAt: never

    # 标题投影：本示例不挂 session-title-llm，只观察首条人类消息的规则回退。
    - id: session-title
      name: '@deepseek-ai/dsh-session-title'
      config:
        fallbackMaxWords: 5
        fallbackMaxBytes: 40
        maxTitleBytes: 80

    # 自写插件也走声明式：工具与脚本化适配器全程在位，随整树 dispose 回收。
    - id: word-count
      name: ./src/plugins/word-count.ts

    - id: scripted-adapter
      name: ./src/plugins/scripted-adapter.ts
```

`npm start` 直接跑 `src/index.ts`：入口是官方 `boot()`，读 cordis.yml 与 patch 清单建起整棵服务树，工具与适配器随装配就位。两个类型层面的细节：`ctx.sessionQuery` 的 Context 增补来自 `import type {} from '@deepseek-ai/dsh-session-query-sqlite'`，缺了它运行正常但 typecheck 报 TS2339；示例的 `assert()` 辅助不做类型收窄，`assert(record !== undefined, …)` 之后 TS 仍认为 record 可能 undefined（TS18048），需要收窄的地方用显式 `if (x === undefined) throw …`：

```ts
const ctx = await boot(
  'dsh-session-demo', CONFIG,
  loadOverlayPatches('dsh-session-demo', PATCH),
  undefined, BASE_URL,
)
// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。
// ……播种 turn，然后 S1～S6 六个观察点……
await ctx.fiber.dispose()
console.log('\nSESSION_DEMO_OK')
```

在本机复现只需要四条命令：

```bash
npm install             # @deepseek-ai/* 依赖（含自动安装的 peer）
#
npm start               # Node：六场景全离线，末行 SESSION_DEMO_OK
npm run start:bun       # Bun：不挂 ptc/subprocess，无需任何补丁，输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1，`.dsh-home` 为空的首跑；Bun 1.4.4 除首行 `runtime = bun 1.4.4` 与随机会话 id 外逐行一致）。语料计数受历史运行影响：`.dsh-home/sessions` 会累积往次运行的会话，S3 的「语料会话数」随之变化——对比前先清空 `.dsh-home`（gitignored，删了不心疼）：

```text
runtime = node v26.12.1

=== S1 日志结构与 seq 不变量 ===
事件数：17
类型分布：agent/inbox/spliced×2, turn/start×1, step/start×2, system/message×1, user/message×1, request/header×1, request/context×1, session/title×1, assistant/message×2, tool/call×1, tool/result×1, step/end×2, turn/end×1
seq 连续性校验通过（从 0 开始逐条 +1）

=== S2 JSONL 落盘 ===
sessions.flush 返回：true
落盘文件：.dsh-home\sessions\--D-coding-creative-hello-olleh-dsh-lab-examples-dsh-session-demo--\session-demo-mwluihmr\session.v4.jsonl（18 行）
首行记录类型：session

=== S3 live-preferred 会话列表 ===
语料会话数：1（live 1 条）
本会话：live=true persisted=true

=== S4 标题投影 ===
当前标题：统计一下这段文本的词数

=== S5 模型表面 ===
表面事件：5 条（system/message×1, user/message×1, assistant/message×2, tool/result×1）

=== S6 从日志恢复 ===
恢复后 agent 身份：session-demo-mwluihmr（原 session-demo-mwluihmr）
事件数：恢复前 17 → 恢复后 18

SESSION_DEMO_OK
```

四个值得注意的数字：

- **17 条事件 / 18 行文件**：首行是 `session` 头记录，其后每事件一行——JSONL 名副其实；
- **表面 5 条**：17 条日志事件折叠成 5 条模型可见消息。`turn/start`、`step/*`、`tool/call`、`request/*` 全是运行时记账，**不进模型表面**；`tool/result` 进（模型要看到工具结果）；
- **恢复 17 → 18**：resume 不是丢事件，而是**追加一条恢复锚点**——日志永远只增不减；
- **标题 = 首条人类消息原文**：12 个汉字 36 字节，没超过 `fallbackMaxBytes: 40`，规则回退原样保留。

## 7 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis fork 直接运行 TypeScript，没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
dsh-session-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── .gitignore            # node_modules/ + .dsh-home/
├── cordis.yml            # []：根配置留空
├── cordis.patch.yml      # 十六行最小树（见第 6 节全文）
└── src/
    ├── index.ts          # 六场景主程序：boot() + 播种 + 六个观察点
    └── plugins/
        ├── word-count.ts       # 最小工具插件（与 tool-pipeline-demo 逐字相同）
        └── scripted-adapter.ts # 脚本化适配器（与 agent-loop-demo 逐字相同）
```

### package.json

```json
{
  "name": "dsh-session-demo",
  "private": true,
  "type": "module",
  "description": "会话日志六景：append-only 事件流结构与 seq 不变量、JSONL 落盘、live-preferred 列表、标题投影、模型表面、从日志恢复。脚本化适配器离线播种真实 turn。Node 与 Bun 双运行时。",
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
    "@deepseek-ai/dsh-deepseek-llm-api-extensions": "0.2.2-rc.3",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.3",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.3",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-log-deepseek": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-persistence-jsonl": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-query-sqlite": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-title": "0.2.2-rc.3",
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

tsconfig.json 与 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md) 逐字相同；`word-count.ts` 与 `scripted-adapter.ts` 直接复制该示例同名文件（agent-loop README 第 3 节有适配器全文镜像）。

### src/index.ts（完整版）

```ts
/**
 * dsh-session-demo —— 会话日志六景，全部离线（脚本化适配器播种真实 turn）：
 *   S1 append-only 事件流的结构与 seq 不变量；
 *   S2 JSONL 落盘（flush 后文件真实出现，肉眼可读）；
 *   S3 live-preferred 会话列表；
 *   S4 标题投影（首条人类消息的规则回退）；
 *   S5 模型表面（历史折叠后的模型可见事件）；
 *   S6 从日志恢复（dispose → resume，身份与事件守恒）。
 * 会话日志是 dsh 的唯一事实来源：turn/step、消息、工具调用与结果全在同一条事件流里。
 * word-count 工具与脚本化适配器在 cordis.patch.yml 里声明，全程在位。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query-sqlite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-session-demo', CONFIG,
  loadOverlayPatches('dsh-session-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。

// 播种一条真实 turn：脚本第 1 步调 word_count，第 2 步给最终回答。
const sessionId = SessionId(`session-demo-${Date.now().toString(36)}`)
const handle = await ctx.agents.create({
  sessionId,
  meta: { cwd: process.cwd() },
  agentOptions: { provider: 'lab-scripted', model: 'seed' },
})
const agent = handle.agent
agent.followup(createUserMessage({
  content: [{ type: 'text', text: '统计一下这段文本的词数' }],
  source: { kind: 'user' },
}))
await agent.whenIdle()

// ── S1：日志结构与 seq 不变量 ──────────────────────────────────────────────
console.log('\n=== S1 日志结构与 seq 不变量 ===')
const snapshot = await ctx.sessionQuery.readSession(sessionId)
console.log(`事件数：${snapshot.events.length}`)
const types = new Map<string, number>()
for (const event of snapshot.events) types.set(event.type, (types.get(event.type) ?? 0) + 1)
console.log(`类型分布：${[...types].map(([type, count]) => `${type}×${count}`).join(', ')}`)
assert(snapshot.events.every((event, index) => event.seq === index), 'seq 必须从 0 开始连续递增')
console.log('seq 连续性校验通过（从 0 开始逐条 +1）')
assert(types.has('turn/start') && types.has('tool/call') && types.has('assistant/message'), '播种 turn 的事件不完整')

// ── S2：JSONL 落盘 ─────────────────────────────────────────────────────────
console.log('\n=== S2 JSONL 落盘 ===')
const flushed = await ctx.sessions.flush(agent.session)
console.log(`sessions.flush 返回：${flushed}`)
// 落盘文件在 .dsh-home/sessions 下按项目目录组织；递归找出本会话的 JSONL。
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.jsonl')) out.push(full)
  }
  return out
}
const files = walk(resolve(HOME, 'sessions'))
const mine = files.find(file => readFileSync(file, 'utf8').includes(String(sessionId)))
if (mine === undefined) throw new Error('断言失败：flush 之后应当找到本会话的 JSONL 文件')
const lines = readFileSync(mine, 'utf8').trim().split('\n')
console.log(`落盘文件：${relative(ROOT, mine)}（${lines.length} 行）`)
const firstRecord = JSON.parse(lines[0]!) as { type?: string; event?: { type?: string } }
console.log(`首行记录类型：${firstRecord.type ?? firstRecord.event?.type ?? '(见文件)'}`)
assert(lines.length >= snapshot.events.length, '落盘行数不应少于事件数')

// ── S3：live-preferred 会话列表 ────────────────────────────────────────────
console.log('\n=== S3 live-preferred 会话列表 ===')
const records = await ctx.sessionQuery.listSessions()
const record = records.find(row => String(row.header.id) === String(sessionId))
if (record === undefined) throw new Error('断言失败：会话应当出现在列表里')
console.log(`语料会话数：${records.length}（live ${records.filter(row => row.live).length} 条）`)
console.log(`本会话：live=${record.live} persisted=${record.persisted}`)
assert(record.live && record.persisted, '在位且已 flush 的会话应当 live 且 persisted')

// ── S4：标题投影（规则回退）────────────────────────────────────────────────
console.log('\n=== S4 标题投影 ===')
// 不挂 session-title-llm：标题来自首条人类消息的规则回退（fallbackMaxWords/Bytes）。
const title = await ctx.sessionQuery.readTitle(sessionId)
console.log(`当前标题：${title?.title ?? '(尚无)'}`)
assert(title !== undefined && title.title.length > 0, '规则回退应当产生标题')

// ── S5：模型表面 ───────────────────────────────────────────────────────────
console.log('\n=== S5 模型表面 ===')
const surface = await ctx.sessionQuery.readSurface(sessionId)
const surfaceTypes = new Map<string, number>()
for (const event of surface.events) surfaceTypes.set(event.type, (surfaceTypes.get(event.type) ?? 0) + 1)
console.log(`表面事件：${surface.events.length} 条（${[...surfaceTypes].map(([type, count]) => `${type}×${count}`).join(', ')}）`)
assert(surface.events.length > 0, '跑过真实 turn 的会话表面不应为空')
assert(!surfaceTypes.has('turn/start') && !surfaceTypes.has('tool/call'), '边界与调用事件不进模型表面')

// ── S6：从日志恢复 ─────────────────────────────────────────────────────────
console.log('\n=== S6 从日志恢复 ===')
const before = snapshot.events.length
await handle.dispose()
const resumed = await ctx.agents.resume({ resumeSessionId: sessionId })
try {
  const after = await ctx.sessionQuery.readSession(sessionId)
  console.log(`恢复后 agent 身份：${resumed.agent.id}（原 ${sessionId}）`)
  console.log(`事件数：恢复前 ${before} → 恢复后 ${after.events.length}`)
  assert(String(resumed.agent.id) === String(sessionId), '恢复出的 agent 身份应当与原会话一致')
  assert(after.events.length >= before, '恢复不应丢事件')
} finally {
  await resumed.dispose()
}

await ctx.fiber.dispose()
console.log('\nSESSION_DEMO_OK')
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `@deepseek-ai/dsh-app-boot` 与 `@deepseek-ai/dsh-session-query-sqlite`。
2. `npm start` 打印 S1～S6 六段，末行 `SESSION_DEMO_OK`，与第 6 节实测输出逐行一致（随机会话 id 除外）。
3. `npm run start:bun` 除首行 runtime 标识与会话 id 外逐行相同。
4. `npm run typecheck` 无输出、退出码 0。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。

## 8 小结

这个示例验证了六件事：

- 会话日志是唯一事实来源：append-only、seq 从 0 连续、surfaceOp 声明表面操作；
- flush 是唯一耐久性检查点；JSONL 按项目 slug / 会话 id 组织，首行头记录；
- live 与 persisted 是两个独立标志，列表 live-preferred；
- 标题与模型表面都是日志的投影：17 条事件折叠成 5 条模型可见消息；
- resume 在原身份上重建 agent 并追加锚点——日志只增不减；
- 自写插件走 patch 清单声明，Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md)；下一篇：[dsh-trajectory-probe-demo](../dsh-trajectory-probe-demo/README.md)——把事件流渲染成可读的 trajectory。