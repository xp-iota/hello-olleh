# 07 · dsh 的 trajectory 探针示例

本示例演示怎么把会话事件流折叠成可读的 trajectory：turn 大纲、逐事件明细、模型表面，以及 dispose 之后从盘上渲染。word-count 工具与脚本化适配器都在 cordis.patch.yml 里声明，boot 后全程在位，代码里没有一处 `ctx.plugin()`。

全部场景离线、不需要 key；版本面 `@deepseek-ai/*` 0.2.2-rc.3、`@deepseek-ai/cordis` 4.1.0，Node 26.12.1 与 Bun 1.4.4 输出逐行一致（首行 runtime 标识与随机会话 id 除外）。

## 1 渲染逻辑要钉在真实事件上

会话日志（见 [dsh-session-demo](../12-dsh-session-demo/README.md)）是 append-only 事件流，但人想看的是 **trajectory**：每个 turn 干了什么、调了几次工具、花了多少 token、模型最终看到了什么。这层折叠渲染有一个测试困境：

> turn 大纲、工具行、token 用量这些代码路径，只有会话里真的跑过 turn 之后才有内容。

播种空会话只能照出「不崩」，照不出折叠逻辑的 bug——比如「消息体有两种形状」的缺陷，所有 user 行渲染成空行都看不出来。探针的答案：脚本化 LlmAdapter（见 [dsh-agent-loop-demo](../11-dsh-agent-loop-demo/README.md)）离线播种**两个真实 turn**，然后用同一套折叠/渲染代码处理它们，并对每个数字做断言对账。

## 2 最小树：十六行，与 session-demo 相同

行清单与 [dsh-session-demo](../12-dsh-session-demo/README.md) 逐行相同（仅头注释不同）：九行底座 + 五行会话设施 + 两行自写插件。渲染需要 `sessionQuery` 的精确读/标题/表面，「从盘上渲染」需要 JSONL 落盘。模型侧同样不挂真实 provider：scripted-adapter 插件的 apply 里一句 `ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())` 把剧本路由挂上，`registerAdapter()` 内部走 `ctx.effect`，fiber 销毁时路由自动回收。一个类型层面的细节：`ctx.sessionQuery` 的类型增补（`import type {} from '@deepseek-ai/dsh-session-query-sqlite'`）必须出现在渲染器文件里（trajectory.ts 顶部），否则 typecheck 报 TS2339。

## 3 折叠器 foldTurns

`src/trajectory.ts` 的核心是一个纯函数：输入事件序列，输出 turn 列表。骨架：

```ts
for (const event of events) {
  switch (event.type) {
    case 'turn/start':   // 开新 turn：编号、起始 seq
    case 'user/message': // 只取 turn 里第一条人类消息作提示词（source.kind 过滤注入块）
    case 'step/start':   // steps += 1
    case 'tool/call':    // toolCalls += 1
    case 'assistant/message': // 累加 data.usage 的 inputTokens / outputTokens
    case 'turn/end':     // 收口：endSeq + reasonOf(data.reason)（{ kind } 对象不是字符串）
  }
}
```

三个只有真实 turn 才照得出的边界，全部固化在代码里：

- **消息体两种形状**：`user/message` / `assistant/message` 的负载在 `data` 本身；`tool/result` 的负载在 `data.message`（它记录的是「一条 tool 消息」）。`messageOf()` 两种都认；
- **user/message 不全是人话**：runtime-context 等注入块也是 user/message，按 `source.kind === 'user'`（或缺席）过滤，否则大纲提示词会被注入块污染。提示词只取 turn 内第一条人类消息：steer 插话、注入块都不该盖掉开头那句，`current.prompt === ''` 守卫 + `isHumanMessage` 过滤缺一不可；
- **纯 tool-call 的 assistant 消息**：只取 text 会渲染成空行，`describeAssistantContent()` 把工具名标成 `→ word_count`。

## 4 五个场景

```ts
// S1 播种两个 turn：同一个 model 路由，step 计数续接（1 工具步 2 回答步 3 回答步）
agent.followup(userMsg('统计一下这段文本的词数')); await agent.whenIdle()
agent.followup(userMsg('再用一句话总结'));         await agent.whenIdle()

// S2 对账：折叠结果的每个数字都断言
const turns = foldTurns(snapshot.events)
assert(turns.length === 2 && first.steps === 2 && first.toolCalls === 1, …)
assert(totalIn === 4200 && totalOut === 60, 'token 合计应当等于脚本产出的 usage 之和')

// S3/S4 渲染：概览 + turn 大纲 + 明细；surface 视图换 readSurface
await renderTrajectory(ctx, String(sessionId))
await renderTrajectory(ctx, String(sessionId), { events: false, surface: true })

// S5 从盘上渲染：flush → dispose → readSession 回落持久化语料
await ctx.sessions.flush(agent.session)
await handle.dispose()
await renderTrajectory(ctx, String(sessionId), { events: false })
```

token 对账的预算来自脚本本身：step1 usage 1200/24、step2 1500/18、step3 1500/18，合计 **4200 in / 60 out**——渲染出的数字必须与适配器产出的分毫不差。注意 step 计数跨 turn 续接：同一个 model 路由的第二个 turn 从 step3 开始——脚本按 step 数决定行为时要把这一点算进去（本例 turn2 恰好落在「给文本」分支）。

## 5 机制解释

### 读取面是唯一数据来源

渲染器不解析 JSONL 文件，只走 `ctx.sessionQuery.readSession()`——它做一次完整 replay 校验，读出来的序列就是被信任的那一份。`readTitle` / `readSurface` 同理。这意味着渲染器对 live 会话与盘上会话一视同仁：S5 dispose 之后 `readSession` 自动回落持久化语料（live-preferred，见 session-demo 第 5 节），渲染一行不改。但从盘上渲染前必须 flush：dispose 不自动保证落盘完整，S5 先 `sessions.flush` 再 dispose。

### 折叠是纯函数，渲染是薄壳

`foldTurns(events)` 是纯函数：输入事件序列，输出 turn 列表，不碰 ctx、不做 I/O——可以单独断言（S2 就是这么做的）。`renderTrajectory()` 只是把折叠结果与逐事件摘要排版成文本。两个事件形状容易读错：turn/end 的 reason 是对象 `{ kind: 'completed' }`，直接 `String(reason)` 会印出 `[object Object]`，`reasonOf()` 取 kind；usage 挂在 assistant/message 事件上（不是独立的 usage 事件），折叠器从 `data.usage` 累加，脚本的 usage chunk 是它的唯一来源。渲染刻意用纯文本、不带 ANSI 颜色与耗时列，让双运行时输出逐行可比（时间戳每次运行都不同，会污染对比）。

### 探针与真实 provider 验证的分工

脚本化适配器钉住的是**循环与渲染的机制**：事件形状、折叠逻辑、表面对账。它不替代真实 provider 验证（网络、序列化、provider 专有字段）——那是 dsh-llm-adapter-demo 的主题。两层验证各管一段，合起来才覆盖「模型回答 → 事件流 → 人可读视图」的完整链路。

## 6 运行trajectory探针示例

根配置留空，装配全部来自 patch 清单：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

```yaml
# Trajectory 探针的最小树：与 dsh-session-demo 相同的十六行——
# 渲染需要 sessionQuery 的精确读/标题/表面，从盘上渲染需要 JSONL 落盘。
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

`npm start` 直接跑 `src/index.ts`：入口是官方 `boot()`，读 cordis.yml 与 patch 清单建起整棵服务树，工具与适配器随装配就位：

```ts
const ctx = await boot(
  'dsh-trajectory-probe-demo', CONFIG,
  loadOverlayPatches('dsh-trajectory-probe-demo', PATCH),
  undefined, BASE_URL,
)
// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。
// ……S1～S5：播种、对账、三种渲染……
await ctx.fiber.dispose()
console.log('\nTRAJ_PROBE_OK')
```

在本机复现只需要四条命令：

```bash
npm install             # @deepseek-ai/* 依赖（含自动安装的 peer）
#
npm start               # Node：五场景全离线，末行 TRAJ_PROBE_OK
npm run start:bun       # Bun：不挂 ptc/subprocess，无需任何补丁，输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1，`.dsh-home` 为空的首跑；Bun 1.4.4 除首行 `runtime = bun 1.4.4` 与随机会话 id 外逐行一致）：

```text
runtime = node v26.12.1

=== S1 脚本化播种两个 turn ===
会话 traj-probe-mwlut4p4 播种完成，status=idle

=== S2 foldTurns 折叠对账 ===
turn 1：2 步 / 1 工具 / 2700 in 42 out
turn 2：1 步 / 0 工具 / 1500 in 18 out
合计：4200 in / 60 out（脚本预算 4200 / 60）

=== S3 trajectory 渲染 ===

trajectory traj-probe-mwlut4p4
  标题      统计一下这段文本的词数
  事件      25 条
  turn      2 个
  工具调用  1 次
  token     4200 in / 60 out

turn 大纲
  #   seq        步  工具  结局        提示词
   1     1→16     2     1  completed   统计一下这段文本的词数
   2    18→24     1     0  completed   再用一句话总结

事件明细
     1  turn 1 开始
     3  step 1 开始
     5  user      统计一下这段文本的词数
     9  assistant → word_count
    10  tool      word_count {"text":"deepseek harness scripted turn"}
    11  result   4 词 / 30 字符
    12  step 1 结束
    13  step 2 开始
    14  assistant 工具结果已经拿到了。
    15  step 2 结束
    16  turn 1 结束 (completed)
    18  turn 2 开始
    20  step 1 开始
    21  user      再用一句话总结
    22  assistant 这是续跑后的补充回答。
    23  step 1 结束
    24  turn 2 结束 (completed)

=== S4 模型表面视图 ===

trajectory traj-probe-mwlut4p4
  标题      统计一下这段文本的词数
  事件      25 条
  turn      2 个
  工具调用  1 次
  token     4200 in / 60 out

turn 大纲
  #   seq        步  工具  结局        提示词
   1     1→16     2     1  completed   统计一下这段文本的词数
   2    18→24     1     0  completed   再用一句话总结

模型表面（readSurface）
  system/message     You are an AI agent powered by DeepSeek Harness.
  user/message       统计一下这段文本的词数
  assistant/message  → word_count
  tool/result        4 词 / 30 字符
  assistant/message  工具结果已经拿到了。
  user/message       再用一句话总结
  assistant/message  这是续跑后的补充回答。

=== S5 从盘上渲染（live agent 已销毁）===

trajectory traj-probe-mwlut4p4
  标题      统计一下这段文本的词数
  事件      25 条
  turn      2 个
  工具调用  1 次
  token     4200 in / 60 out

turn 大纲
  #   seq        步  工具  结局        提示词
   1     1→16     2     1  completed   统计一下这段文本的词数
   2    18→24     1     0  completed   再用一句话总结

盘上读回 25 条事件（live 快照 25 条），渲染不依赖 live agent

TRAJ_PROBE_OK
```

三个值得注意的事实：

- **25 条事件 → 大纲 2 行 → 表面 7 条**：同一份日志的三种投影，各自服务不同读者（运维看明细、人看大纲、模型看表面）；
- **seq 有空洞**（明细里 1→3→5→9…）：被跳过的是 request/header、assistant/attempt 等记账事件，默认不展开但 seq 连续——渲染过滤不等于日志缺失；
- **token 4200/60 精确对账**：usage 从适配器的 chunk 一路流到 assistant/message 事件再到折叠器，任何一环丢失都会被断言抓住。

## 7 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis fork 直接运行 TypeScript，没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
dsh-trajectory-probe-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── .gitignore            # node_modules/ + .dsh-home/
├── cordis.yml            # []：根配置留空
├── cordis.patch.yml      # 十六行最小树（见第 6 节全文）
└── src/
    ├── index.ts          # 五场景主程序：boot() + 播种 + 对账 + 渲染
    ├── trajectory.ts     # foldTurns + renderTrajectory（纯文本）
    └── plugins/
        ├── word-count.ts       # 最小工具插件（与 tool-pipeline-demo 逐字相同）
        └── scripted-adapter.ts # 脚本化适配器（与 agent-loop-demo 逐字相同）
```

### package.json

```json
{
  "name": "dsh-trajectory-probe-demo",
  "private": true,
  "type": "module",
  "description": "Trajectory 探针：脚本化适配器播种多 turn 会话，把事件流折叠成 turn 大纲、逐事件明细与模型表面；dispose 后从盘上渲染。Node 与 Bun 双运行时。",
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

dependencies / devDependencies / tsconfig.json 与 [dsh-session-demo](../12-dsh-session-demo/README.md) 完全相同（仅 name/description 不同）；两个插件文件复制 [dsh-agent-loop-demo](../11-dsh-agent-loop-demo/README.md) 同名文件（该 README 第 3 节有适配器全文镜像）。

### src/trajectory.ts（完整版）

```ts
/**
 * trajectory.ts —— 把会话事件流渲染成可读的 trajectory（纯文本版）。
 *
 * 数据来源是官方 ctx.sessionQuery 的精确读面：readSession() 做一次完整 replay
 * 校验，读出来的事件序列就是真正被信任的那一份。渲染分三层：
 *   1. 概览 —— id、标题、事件数、turn 数、工具调用、token 用量；
 *   2. turn 大纲 —— foldTurns() 把事件流折叠成每个 turn 的编号/起止/步数/提示词；
 *   3. 逐事件明细与模型表面（可选）。
 *
 * 折叠逻辑里有三个只有跑过真实 turn 才看得见的坑（旧教材实测踩过）：
 *   - 消息体有两种形状：user/assistant 事件负载在 data 本身，tool/result 在 data.message；
 *   - user/message 不全是人说的话：runtime-context 等注入块要按 source.kind 过滤；
 *   - turn/end 的 reason 是结构化对象 { kind }，不是字符串。
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query-sqlite'

/** 一个 turn 的折叠结果。 */
export interface Turn {
  readonly number: number
  readonly startSeq: number
  readonly endSeq: number | undefined
  readonly reason: string | undefined
  readonly prompt: string
  readonly steps: number
  readonly toolCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/** 取 content（block 数组或字符串）里的纯文本。 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: { type?: string; text?: string }) => (block?.type === 'text' ? (block.text ?? '') : ''))
    .filter(Boolean)
    .join(' ')
}

/** 两种消息形状都认：data 本身（user/assistant）或 data.message（tool/result）。 */
function messageOf(data: Record<string, unknown>): { content?: unknown; isError?: boolean } | undefined {
  const direct = data as { content?: unknown; role?: string; isError?: boolean }
  if (direct.role !== undefined && direct.content !== undefined) return direct
  return data.message as { content?: unknown; isError?: boolean } | undefined
}

/** 只保留人真正说的话：source.kind 缺席或为 'user' 才算人类消息。 */
function isHumanMessage(data: Record<string, unknown>): boolean {
  const source = data.source as { kind?: string } | undefined
  return source?.kind === undefined || source.kind === 'user'
}

/** turn/end 的 reason 是 { kind: 'completed' } 这样的对象。 */
function reasonOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && 'kind' in value) {
    return String((value as { kind: unknown }).kind)
  }
  return String(value)
}

/** assistant 内容摘要：纯 tool-call 的消息不能渲染成空行，要标出调了什么。 */
function describeAssistantContent(content: unknown): string {
  const text = textOf(content)
  if (!Array.isArray(content)) return text
  const calls = content
    .filter((block: { type?: string }) => block?.type === 'tool-call')
    .map((block: { name?: string }) => block.name ?? '?')
  if (calls.length === 0) return text
  const callText = `→ ${calls.join(', ')}`
  return text === '' ? callText : `${text} ${callText}`
}

/** 截断到一行。 */
function oneLine(text: string, limit = 100): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + '…'
}

/** 把事件序列折叠成 turn 列表。 */
export function foldTurns(events: readonly SessionEvent[]): Turn[] {
  const turns: Turn[] = []
  let current: { number: number; startSeq: number; prompt: string; steps: number; toolCalls: number; inputTokens: number; outputTokens: number } | undefined
  let endSeq: number | undefined
  let reason: string | undefined
  const close = () => {
    if (current === undefined) return
    turns.push({ ...current, endSeq, reason })
    current = undefined
    endSeq = undefined
    reason = undefined
  }
  for (const event of events) {
    const data = (event as { data?: Record<string, unknown> }).data ?? {}
    switch (event.type) {
      case 'turn/start':
        close()
        current = { number: Number(data.turn), startSeq: event.seq, prompt: '', steps: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 }
        break
      case 'user/message':
        // 只取 turn 里第一条人类消息，否则后续插话会盖掉开头那句。
        if (current !== undefined && current.prompt === '' && isHumanMessage(data)) {
          current.prompt = textOf(messageOf(data)?.content)
        }
        break
      case 'step/start':
        if (current !== undefined) current.steps += 1
        break
      case 'tool/call':
        if (current !== undefined) current.toolCalls += 1
        break
      case 'assistant/message': {
        const usage = (data as { usage?: { inputTokens?: number; outputTokens?: number } }).usage
        if (current !== undefined && usage !== undefined) {
          current.inputTokens += usage.inputTokens ?? 0
          current.outputTokens += usage.outputTokens ?? 0
        }
        break
      }
      case 'turn/end':
        endSeq = event.seq
        reason = reasonOf(data.reason)
        close()
        break
      default:
        break
    }
  }
  close()
  return turns
}

/** 把一个事件渲染成一行摘要；返回 undefined 表示不展示。 */
function describeEvent(event: SessionEvent): string | undefined {
  const data = (event as { data?: Record<string, unknown> }).data ?? {}
  switch (event.type) {
    case 'turn/start':
      return `turn ${String(data.turn)} 开始`
    case 'turn/end':
      return `turn ${String(data.turn)} 结束 (${reasonOf(data.reason)})`
    case 'step/start':
      return `step ${String(data.step)} 开始`
    case 'step/end':
      return `step ${String(data.step)} 结束`
    case 'user/message': {
      const text = textOf(messageOf(data)?.content)
      if (!isHumanMessage(data)) return `context  ${oneLine(text, 70)}`
      return `user      ${oneLine(text, 90)}`
    }
    case 'assistant/message':
      return `assistant ${oneLine(describeAssistantContent(messageOf(data)?.content), 90)}`
    case 'tool/call':
      return `tool      ${String(data.name)} ${oneLine(String(data.arguments ?? ''), 70)}`
    case 'tool/result': {
      const message = messageOf(data)
      return `${message?.isError === true ? 'result✗' : 'result'}   ${oneLine(textOf(message?.content), 80)}`
    }
    default:
      // request/header、assistant/attempt、投影记录等默认不展开。
      return undefined
  }
}

/** 打印一条会话的 trajectory（概览 + turn 大纲 + 明细 + 可选表面）。 */
export async function renderTrajectory(
  ctx: Context,
  sessionId: string,
  options: { surface?: boolean; events?: boolean } = {},
): Promise<void> {
  const id = SessionId(sessionId)
  const snapshot = await ctx.sessionQuery.readSession(id)
  const events = snapshot.events
  const turns = foldTurns(events)
  const title = await ctx.sessionQuery.readTitle(id).catch(() => undefined)
  const inputTokens = turns.reduce((sum, turn) => sum + turn.inputTokens, 0)
  const outputTokens = turns.reduce((sum, turn) => sum + turn.outputTokens, 0)
  const toolCalls = turns.reduce((sum, turn) => sum + turn.toolCalls, 0)

  console.log(`\ntrajectory ${snapshot.session.id}`)
  if (title?.title !== undefined && title.title !== '') console.log(`  标题      ${title.title}`)
  console.log(`  事件      ${events.length} 条`)
  console.log(`  turn      ${turns.length} 个`)
  console.log(`  工具调用  ${toolCalls} 次`)
  console.log(`  token     ${inputTokens} in / ${outputTokens} out`)

  if (turns.length > 0) {
    console.log('\nturn 大纲')
    console.log('  #   seq        步  工具  结局        提示词')
    for (const turn of turns) {
      console.log(
        `  ${String(turn.number).padStart(2)}  ` +
        `${String(turn.startSeq).padStart(4)}→${String(turn.endSeq ?? '-').padEnd(4)}  ` +
        `${String(turn.steps).padStart(2)}  ${String(turn.toolCalls).padStart(4)}  ` +
        `${String(turn.reason ?? '-').padEnd(10)}  ${oneLine(turn.prompt, 60)}`,
      )
    }
  }

  if (options.events !== false) {
    console.log('\n事件明细')
    for (const event of events) {
      const detail = describeEvent(event)
      if (detail !== undefined) console.log(`  ${String(event.seq).padStart(4)}  ${detail}`)
    }
  }

  if (options.surface === true) {
    console.log('\n模型表面（readSurface）')
    const surface = await ctx.sessionQuery.readSurface(id)
    for (const event of surface.events) {
      const data = ((event as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>
      console.log(`  ${String(event.type).padEnd(18)} ${oneLine(describeAssistantContent(messageOf(data)?.content), 100)}`)
    }
  }
}
```

### src/index.ts（完整版）

```ts
/**
 * dsh-trajectory-probe-demo —— Trajectory 探针，全部离线：
 *   S1 脚本化适配器播种两个 turn（工具步 + 回答步 / 纯回答步）；
 *   S2 foldTurns 折叠断言：turn 数、步数、工具数、token 用量全部对账；
 *   S3 渲染 trajectory：概览 + turn 大纲 + 逐事件明细；
 *   S4 模型表面视图：readSurface 折叠后模型实际看到什么；
 *   S5 dispose 之后从盘上渲染：flush 过的会话不依赖 live agent。
 * 探针的价值：turn 大纲、工具行、token 用量这些渲染路径，只有会话里真的跑过
 * turn 之后才有内容——播种空会话照不出折叠逻辑的 bug。
 * word-count 工具与脚本化适配器在 cordis.patch.yml 里声明，全程在位。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { foldTurns, renderTrajectory } from './trajectory.ts'

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
  'dsh-trajectory-probe-demo', CONFIG,
  loadOverlayPatches('dsh-trajectory-probe-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。

const userMsg = (text: string) =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

// ── S1：播种两个 turn ──────────────────────────────────────────────────────
console.log('\n=== S1 脚本化播种两个 turn ===')
const sessionId = SessionId(`traj-probe-${Date.now().toString(36)}`)
const handle = await ctx.agents.create({
  sessionId,
  meta: { cwd: process.cwd() },
  agentOptions: { provider: 'lab-scripted', model: 'probe' },
})
const agent = handle.agent
// turn 1：脚本第 1 步调 word_count，第 2 步给回答。
agent.followup(userMsg('统计一下这段文本的词数'))
await agent.whenIdle()
// turn 2：脚本第 3 步直接给回答（同一个 model 路由，step 计数续接）。
agent.followup(userMsg('再用一句话总结'))
await agent.whenIdle()
console.log(`会话 ${sessionId} 播种完成，status=${agent.status}`)

// ── S2：foldTurns 对账 ─────────────────────────────────────────────────────
console.log('\n=== S2 foldTurns 折叠对账 ===')
const snapshot = await ctx.sessionQuery.readSession(sessionId)
const turns = foldTurns(snapshot.events)
assert(turns.length === 2, '应当恰好两个 turn')
const [first, second] = turns
assert(first !== undefined && second !== undefined, 'turn 解构失败')
assert(first.steps === 2 && first.toolCalls === 1, 'turn 1 应当是 2 步 1 工具')
assert(second.steps === 1 && second.toolCalls === 0, 'turn 2 应当是 1 步 0 工具')
assert(first.reason === 'completed' && second.reason === 'completed', '两个 turn 都应当 completed')
assert(first.prompt === '统计一下这段文本的词数' && second.prompt === '再用一句话总结', '提示词应当取每个 turn 的首条人类消息')
// 脚本的 usage：step1 1200/24，step2 1500/18，step3 1500/18。
const totalIn = turns.reduce((sum, turn) => sum + turn.inputTokens, 0)
const totalOut = turns.reduce((sum, turn) => sum + turn.outputTokens, 0)
console.log(`turn 1：${first.steps} 步 / ${first.toolCalls} 工具 / ${first.inputTokens} in ${first.outputTokens} out`)
console.log(`turn 2：${second.steps} 步 / ${second.toolCalls} 工具 / ${second.inputTokens} in ${second.outputTokens} out`)
console.log(`合计：${totalIn} in / ${totalOut} out（脚本预算 4200 / 60）`)
assert(totalIn === 4200 && totalOut === 60, 'token 合计应当等于脚本产出的 usage 之和')

// ── S3：渲染 trajectory ────────────────────────────────────────────────────
console.log('\n=== S3 trajectory 渲染 ===')
await renderTrajectory(ctx, String(sessionId))

// ── S4：模型表面视图 ───────────────────────────────────────────────────────
console.log('\n=== S4 模型表面视图 ===')
await renderTrajectory(ctx, String(sessionId), { events: false, surface: true })

// ── S5：dispose 之后从盘上渲染 ─────────────────────────────────────────────
console.log('\n=== S5 从盘上渲染（live agent 已销毁）===')
await ctx.sessions.flush(agent.session)
await handle.dispose()
// readSession 走 live-preferred：live 不在时回落到持久化语料，渲染照常。
await renderTrajectory(ctx, String(sessionId), { events: false })
const after = await ctx.sessionQuery.readSession(sessionId)
assert(after.events.length >= snapshot.events.length, '盘上读回的事件不应少于 live 快照')
console.log(`\n盘上读回 ${after.events.length} 条事件（live 快照 ${snapshot.events.length} 条），渲染不依赖 live agent`)

await ctx.fiber.dispose()
console.log('\nTRAJ_PROBE_OK')
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `@deepseek-ai/dsh-app-boot` 与 `@deepseek-ai/dsh-session-query-sqlite`。
2. `npm start` 打印 S1～S5 五段，末行 `TRAJ_PROBE_OK`，与第 6 节实测输出逐行一致（随机会话 id 除外）。
3. `npm run start:bun` 除首行 runtime 标识与会话 id 外逐行相同。
4. `npm run typecheck` 无输出、退出码 0。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。

## 8 小结

这个示例验证了六件事：

- 探针用脚本化适配器播种真实 turn，把折叠/渲染逻辑钉在真实事件序列上；
- foldTurns 是纯函数：turn 数、步数、工具数、token 全部可断言对账（4200/60 精确）；
- 消息体双形状、人类消息过滤、tool-call 摘要——三个真实 turn 才照得出的边界全部固化；
- 同一份日志三种投影：明细（运维）、大纲（人）、表面（模型）；
- 渲染只走 sessionQuery：flush 过的会话 dispose 后从盘上照常渲染；
- 自写插件走 patch 清单声明，Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-session-demo](../12-dsh-session-demo/README.md)；下一篇：[dsh-hitl-demo](../14-dsh-hitl-demo/README.md)——审批与人机协作。