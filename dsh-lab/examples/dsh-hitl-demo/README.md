# dsh 的人在回路示例

本示例演示人在回路的四个面：审批 waterfall 的判决链、结构化提问、自定义斜杠命令、todo 清单。word-count 工具与脚本化适配器都在 cordis.patch.yml 里声明，boot 后全程在位，代码里没有一处 `ctx.plugin()`。

agent 循环不能是黑箱：模型要执行敏感操作时，人在哪里介入？介入的判决如何被记录、被回放、被审计？全部场景离线、不需要 key；版本面 `@deepseek-ai/*` 0.2.2-rc.3、`@deepseek-ai/cordis` 4.1.0，Node 26.12.1 与 Bun 1.4.4 输出逐行一致（首行 runtime 标识除外）。

## 1 四个互不替代的面

dsh 把「人在回路」拆成四个面：

| 面 | 服务/工具 | 回答的问题 |
|:---|:---------|:-----------|
| 审批 | `ctx.approval`（user-approval） | 这个操作**允许吗**？ |
| 提问 | `ctx.userQuestions`（user-questions） | 这个决策**选哪个**？ |
| 命令 | `ctx.commands`（commands） | 用户直接**下达指令**（不经模型） |
| 清单 | `todo_write`（tool-todo） | 模型**自报进度**给人看 |

> 审批不是「弹个框」——它是 turn 内的审计事件对 + 封闭结果词汇 + fail-closed 兜底。

本示例把四个面全部离线触发，并重点拆解审批的判决链。

## 2 最小树：九行底座 + 四行交互面 + 两个自写插件

在 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md) 的九行底座上追加四行交互面：

| 行 id | 包 | 说明 |
|---|---|---|
| `user-approval` | `@deepseek-ai/dsh-user-approval` | 审批服务；config `policy: ask` = 交给 waterfall 回答器组合 |
| `user-questions` | `@deepseek-ai/dsh-user-questions` | 结构化提问；`ask()` → `user-questions/request` waterfall |
| `commands` | `@deepseek-ai/dsh-commands` | 斜杠命令注册表；无额外服务依赖 |
| `tool-todo` | `@deepseek-ai/dsh-tool-todo` | todo_write 工具 + todos 投影；`allowParallelInProgress` 是 **required** 配置 |

再加两行自写插件（word-count / scripted-adapter，与 agent-loop 示例逐字相同），共十五行。依赖链很短：user-approval / user-questions / tool-todo 都注入 `sessionProjections`（底座已有），tool-todo 另注入 `tools`。`allowParallelInProgress` 缺了装配直接失败。

## 3 把代码放进真实 turn 内部

审批必须 turn 内发起（第 5 节解释为什么），而脚本化适配器驱动的 turn 转瞬即逝。本示例用 `agent/turn-stopping` 作挂点：此刻 turn 尚未 end，`approvalState` 投影的 `turnOpen` 仍为 true，serial 事件会等异步监听完成——`insideTurn()` 辅助函数就靠它把任意代码放进一个真实 turn 内部：

```ts
async function insideTurn<T>(agent: Agent, fn: () => Promise<T>): Promise<T> {
  let result: T | undefined
  let failure: unknown
  const off = ctx.on('agent/turn-stopping', async (payload) => {
    if (payload.agent !== agent) return
    off()
    try {
      result = await fn()
    } catch (error) {
      failure = error
    }
  })
  agent.followup(userMsg('跑一个 turn，供人在回路演示'))
  await agent.whenIdle()
  if (failure !== undefined) throw failure
  if (result === undefined) throw new Error('turn-stopping 未触发，fn 没有执行')
  return result
}
```

scripted-adapter 插件的 apply 里一句 `ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())` 把剧本路由挂上；`registerAdapter()` 内部走 `ctx.effect`，fiber 销毁时路由自动回收。每个场景用不同的 model id（`s1`…`s6`、`s3a`/`s3b`），step 计数互不串扰。

## 4 六个场景

```ts
// S1 审批词汇表：五种路径各走一遍，审计对落会话日志
const offAllow = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '演示批准' }))
// …rejected / 无回答器 / 回答器抛错 / signal abort 竞态……

// S2 turn 约束 + never 覆盖
setApprovalPolicy(agent.session, 'never')   // 落 approval/policy 事件，先于回答器判决

// S3 权限门正路：pre-execute 返回 ask，管线自动走审批缝
ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name === 'word_count') return { kind: 'ask', reason: 'word_count 需要人工批准' }
  return next()
})

// S4 结构化提问：回答器返回答案即认领
const answer = await ctx.userQuestions.ask({ agent, questions: [{ id: 'scope', … }] })

// S5 自定义斜杠命令：不经模型，handler 直接执行
ctx.commands.register({ name: 'lab-note', description: '…', handler })
await ctx.commands.execute(agent, '/lab-note 双运行时一致', [], signal)

// S6 todo_write：有 agent 才能写，counts 汇总
await callTool(ctx, 'todo_write', { todos }, agent)
```

## 5 机制解释

### 审批词汇表与 fail-closed

`ApprovalOutcome` 是封闭联合：`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`（user-approval/src/types.ts:32）。五种路径各走一遍：

1. 回答器返回 `allowed-once` → 批准；
2. 回答器返回 `rejected` → 拒绝；
3. **没有回答器** → waterfall 兜底 `unavailable`（fail-closed，不抛错）；
4. **回答器抛错** → 异常被缝包容，问题关闭为 `unavailable`，不漏给调用方；
5. 回答器挂起不答、`signal` abort 赢得竞态 → `cancelled`，迟到的回答被构造性丢弃。

每次 `request()` 都先落 `approval/asked`、判决后落 `approval/decided`，同一 `id` 配对（index.ts:251-259）。五次请求 = 五对审计事件，全部落在会话日志里。

### turn 约束与 never 覆盖

- turn 外裸调 `approval.request()` 直接抛 `outside an open turn`：审计对必须被 turn 包络，否则崩溃重载时会留下不完整的垃圾记录（index.ts:244-250）。
- `setApprovalPolicy(session, 'never')` 落一条 `approval/policy` 事件作为持久覆盖；之后即使有回答器想批准，结果仍是 `rejected`——**never 在服务自己的请求路径上、先于任何 waterfall 分发判决**（index.ts:296-301）。源码注释明说：`prepend: true` 的监听器也拦不住它，监听器形状的门禁无法做出这个保证。

### 真实工具审批：pre-execute 的 ask 决定

这是权限门的正路，不需要自己调 `approval.request`。管线收到 `ask` 后自己走审批缝（core/tools/src/pipeline.ts:440-480）：`ctx.get('approval')` 机会性消费服务 → 带真实 `callId` 调 `request()` → 四个结果一一映射：`allowed-once` 放行；其余三个变成带 `ApprovalError`（`APPROVAL_REJECTED` / `APPROVAL_CANCELLED` / `APPROVAL_UNAVAILABLE`）的 deny，拒绝原因作为工具结果传给模型。两条降级也实测了：没装配 approval 服务、或调用没有 agent（无会话可审计、无 UI 可路由）→ 一律降级 deny。

### 结构化提问

`userQuestions.ask({ agent, questions })` 走 `user-questions/request` waterfall；回答器返回 `{ answers: [{ id, selected }] }` 即认领，答案按问题 id 回声。空问题批抛 `UserQuestionError` code `EMPTY_QUESTIONS`。与审批不同，ask 不要求 open turn，但要求 agent 是注册表里的精确活实例（`CALLER_NOT_LIVE`），且拒绝 subagent 身份的委派调用方（`DELEGATED_CALLER`）。

### 自定义斜杠命令

`commands.register({ name, description, handler })` 返回解除句柄；`execute(agent, '/lab-note …', [], signal)` 先落 `command/run`、handler 结算后落 `command/done`（同一 `commandId` 配对）。命令**不经模型**——handler 直接对接收 agent 执行。未注册的名字返回 `undefined` 而不是抛错。

### todo_write

清单是「每 agent 会话」的状态：工具把整份清单落成 `todo/write` 事件，返回 `counts` 汇总；`todos` 投影在下一个 `turn/start` 清零（turn/end 保留完成的清单可见）。没有归属 agent 的调用被明确拒绝（`todo_write requires an owning agent session`），而不是静默 no-op。

## 6 运行人在回路示例

根配置留空，装配全部来自 patch 清单：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

```yaml
# 人在回路的最小树：九行 base（与 dsh-agent-loop-demo 相同）+ 四行交互面。
# 模型侧不挂任何真实 provider：脚本化 LlmAdapter 与 word-count 工具
# 都是自写插件，声明在末尾两行，全程在位。
# 依赖链：user-approval / user-questions / tool-todo 都注入 sessionProjections（base 已有）；
#         tool-todo 另注入 tools；commands 无额外服务依赖。
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

    # 配置态 agent 保持空表：本示例的 agent 全部由运行时 agents.create() 创建。
    - id: agent
      name: '@deepseek-ai/dsh-agent'

    - id: llm
      name: '@deepseek-ai/dsh-llm'

    - id: agent-loop
      name: '@deepseek-ai/dsh-agent-loop'
      config:
        agents: []

    # ── 人在回路四行 ──────────────────────────────────────────────────────
    # 审批服务：policy ask = 交给 approval/request waterfall 的回答器组合，
    # 无回答器时 fail-closed（unavailable）；会话内可用 setApprovalPolicy 覆盖。
    - id: user-approval
      name: '@deepseek-ai/dsh-user-approval'
      config:
        policy: ask

    # 结构化提问：userQuestions.ask() → user-questions/request waterfall。
    - id: user-questions
      name: '@deepseek-ai/dsh-user-questions'

    # 斜杠命令注册表：register / list / execute，生命周期落 command/run + command/done。
    - id: commands
      name: '@deepseek-ai/dsh-commands'

    # todo_write 工具 + todos 投影。allowParallelInProgress 是 required 配置。
    - id: tool-todo
      name: '@deepseek-ai/dsh-tool-todo'
      config:
        allowParallelInProgress: true

    # 自写插件也走声明式：工具与脚本化适配器全程在位，随整树 dispose 回收。
    - id: word-count
      name: ./src/plugins/word-count.ts

    - id: scripted-adapter
      name: ./src/plugins/scripted-adapter.ts
```

`npm start` 直接跑 `src/index.ts`：入口是官方 `boot()`，读 cordis.yml 与 patch 清单建起整棵服务树，工具与适配器随装配就位：

```ts
const ctx = await boot(
  'dsh-hitl-demo', CONFIG,
  loadOverlayPatches('dsh-hitl-demo', PATCH),
  undefined, BASE_URL,
)
// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。
// ……S1～S6：审批、提问、命令、todo……
await ctx.fiber.dispose()
console.log('\nHITL_OK')
```

在本机复现只需要四条命令：

```bash
npm install             # @deepseek-ai/* 依赖（含自动安装的 peer）
#
npm start               # Node：六场景全离线，末行 HITL_OK
npm run start:bun       # Bun：不挂 ptc/subprocess，无需任何补丁，输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1；Bun 1.4.4 除首行 `runtime = bun 1.4.4` 外逐行一致）：

```text
runtime = node v26.12.1

=== S1 审批 waterfall：四个结果 + fail-closed ===
五次请求的结果：allowed-once → rejected → unavailable → unavailable → cancelled
审计对：approval/asked × 5，approval/decided × 5

=== S2 turn 约束 + never 策略覆盖 ===
turn 外裸调：approval.request() outside an open turn: the approval/asked + approval/decided …
setApprovalPolicy('never') 后：结果=rejected（回答器在场也被拒），approval/policy 事件 × 1

=== S3 真实 turn 内的工具审批 ===
批准路径：decided=allowed-once，callId 在审计里=true
拒绝路径：decided=rejected，模型看到：Error: the user rejected tool "word_count"
无 agent 降级：isError=true，Error: tool "word_count" requires approval, but the call has no agent to route …

=== S4 userQuestions.ask ===
回答：[{"id":"scope","selected":["只读"]}]
空问题批：UserQuestionError code=EMPTY_QUESTIONS

=== S5 commands.register + execute ===
lab-note 可见：true
execute 结果：kind=success，text=已记录：双运行时一致
生命周期事件：command/run → command/done；未注册命令返回 undefined

=== S6 todo_write ===
有 agent：isError=false，Updated todo list: 1 pending, 1 in progress, 1 completed.
无 agent：isError=true，Error: todo_write requires an owning agent session

HITL_OK
```

三个值得注意的事实：

- **S1 的两个 unavailable**：无回答器与回答器抛错得到同一个结果——fail-closed 把「没人能答」和「答的人崩了」都收敛成封闭词汇里的正常值，调用方永远拿不到异常；
- **S3 的 callId**：管线把真实工具调用 id 带进 `approval/asked`，审计事件能和 `tool/call` 精确对账——自己裸调 `request()` 没有这个字段；
- **S3 的拒绝路径 turn 照常收尾**：拒绝不是崩溃，模型收到 `Error: the user rejected tool "word_count"` 作为工具结果，继续走回答步。

## 7 边界与坑

1. **审批必须 turn 内发起**。turn 外裸调抛错，不是返回 unavailable——想演示审批，先有一个真实 turn（本示例用 `agent/turn-stopping` 挂点，见 `insideTurn()`）。
2. **never 先于回答器**。别想用 `prepend` 监听器在 never 策略下「抢救」批准；判决发生在服务的请求路径上，早于 waterfall 分发。
3. **回答器抛错 ≠ 调用失败**。缝把异常包容成 `unavailable`（fail-closed），调用方拿到的是封闭词汇里的值，不是异常。
4. **waterfall 监听挂在根 ctx 上不随插件 fiber 销毁**——每个 `ctx.on` 都要拿 `off` 句柄手动解除，否则 S1 的回答器会泄漏到 S3。插件 apply 里的注册（工具、适配器路由）则随 fiber 自动回收，两者处置不同。
5. **tool-todo 的 `allowParallelInProgress` 是 required**，patch 里必须显式给。
6. **类型增补靠导入**：`ctx.approval` / `ctx.userQuestions` / `ctx.commands` 的 Context 增补分别来自三个包，`import type {} from '…'` 不能省。
7. **本示例不挂 ptc/subprocess**，Bun 无需补丁；会话日志落在本目录 `.dsh-home/`（gitignored）。

## 8 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis fork 直接运行 TypeScript，没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
dsh-hitl-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── .gitignore            # node_modules/ + .dsh-home/
├── cordis.yml            # []：根配置留空
├── cordis.patch.yml      # 十五行最小树（见第 6 节全文）
└── src/
    ├── index.ts          # 六场景主程序：boot() + insideTurn + 四个交互面
    ├── tools.ts          # callTool 单次调用封装（批接口 → 单调用）
    └── plugins/
        ├── word-count.ts       # 最小工具插件（与 tool-pipeline-demo 逐字相同）
        └── scripted-adapter.ts # 脚本化适配器（与 agent-loop-demo 逐字相同）
```

### package.json

```json
{
  "name": "dsh-hitl-demo",
  "private": true,
  "type": "module",
  "description": "人在回路：审批 waterfall 词汇表与 fail-closed、turn 约束与会话级策略覆盖、pre-execute ask 的真实工具审批、结构化提问、自定义斜杠命令、todo 工具。Node 与 Bun 双运行时。",
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
    "@deepseek-ai/dsh-commands": "0.2.2-rc.3",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.3",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.3",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.3",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-executor-native": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-todo": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.3",
    "@deepseek-ai/dsh-user-approval": "0.2.2-rc.3",
    "@deepseek-ai/dsh-user-questions": "0.2.2-rc.3"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

tsconfig.json 与 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md) 逐字相同；`word-count.ts` 与 `scripted-adapter.ts` 直接复制该示例同名文件（agent-loop README 第 3 节有适配器全文镜像）。

### src/tools.ts（完整版）

```ts
/**
 * tools.ts —— 单次工具调用的便利封装。
 *
 * 0.2.2 起 `ctx.tools.execute()` 的输入是一整批模型原始调用（ToolBatchInput，
 * calls 里是 ToolCallBlock，参数为 JSON 字符串），返回 ToolBatchResult。
 * 这里把"单次调用"这层封装固定下来，场景代码只关心一次调用的结果。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

/** 一次调用的精简结果。 */
export interface CalledTool {
  readonly isError: boolean
  readonly content: string
  /** 成功时的规范值（canonical JSON value）。 */
  readonly value: unknown
}

/** 把 content block 数组拼成一行文本。 */
export function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: { type?: string; text?: string }) => (block?.type === 'text' ? (block.text ?? '') : `[${block?.type ?? '?'}]`))
    .join(' ')
}

/**
 * 执行一个已注册的工具（不经过模型），返回原生 ToolExecutionResult。
 * 批接口要求 ToolCallBlock.arguments 是模型产出的 JSON 字符串——这是真实协议形状。
 */
export async function executeTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
): Promise<ToolExecutionResult> {
  const batch = await ctx.tools.execute({
    calls: [
      {
        type: 'tool-call',
        id: ToolCallId(`demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
        name,
        arguments: args === undefined ? '{}' : JSON.stringify(args),
      },
    ],
    ...(agent === undefined ? {} : { agent }),
    signal: new AbortController().signal,
  })
  const settled = batch.results[0]
  if (settled === undefined) throw new Error(`工具 ${name} 没有返回结果（批次为空）`)
  return settled.result
}

/** 调用一个已注册的工具并压成一行可打印结果。 */
export async function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
): Promise<CalledTool> {
  const result = await executeTool(ctx, name, args, agent)
  const isError = result.isError === true
  return {
    isError,
    content: blocksToText(result.content),
    value: isError ? undefined : result.value,
  }
}

/** 截断到一行，便于日志。 */
export function preview(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + '…'
}
```

### src/index.ts（完整版）

```ts
/**
 * dsh-hitl-demo —— 人在回路（Human-in-the-loop），全部离线（脚本化 LlmAdapter，不需要 key）：
 *   S1 审批 waterfall 的四个结果词汇 + fail-closed + 取消竞态，审计对落会话日志；
 *   S2 approval.request 的 turn 约束 + setApprovalPolicy 会话级覆盖（never 先于回答器判决）；
 *   S3 真实工具审批：pre-execute 返回 ask → 管线自动走 approval 缝（批准/拒绝/无 agent 降级）；
 *   S4 userQuestions.ask 结构化提问与回答器 waterfall；
 *   S5 commands.register 自定义斜杠命令 + execute 生命周期事件；
 *   S6 todo_write 工具：有 agent 才能写，counts 汇总。
 * 关键认识：审批不是"弹个框"——它是 turn 内的审计事件对 + 封闭结果词汇 + fail-closed 判决链。
 * word-count 工具与脚本化适配器在 cordis.patch.yml 里声明，全程在位。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { blocksToText, callTool, preview } from './tools.ts'

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
  'dsh-hitl-demo', CONFIG,
  loadOverlayPatches('dsh-hitl-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const userMsg = (text: string) =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

const suffix = Date.now().toString(36)
const makeAgent = (tag: string, model: string) =>
  ctx.agents.create({
    sessionId: SessionId(`hitl-${tag}-${suffix}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'lab-scripted', model },
  })

// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。

/**
 * 在一个真实 turn 内部执行 fn。挂点选 agent/turn-stopping：此刻 turn 尚未 end
 * （approvalState 投影的 turnOpen 仍为 true），serial 事件会等异步监听完成。
 * 审批必须 turn 内发起——这是 S2 要演示的硬约束。
 */
async function insideTurn<T>(agent: Agent, fn: () => Promise<T>): Promise<T> {
  let result: T | undefined
  let failure: unknown
  const off = ctx.on('agent/turn-stopping', async (payload) => {
    if (payload.agent !== agent) return
    off()
    try {
      result = await fn()
    } catch (error) {
      failure = error
    }
  })
  agent.followup(userMsg('跑一个 turn，供人在回路演示'))
  await agent.whenIdle()
  if (failure !== undefined) throw failure
  if (result === undefined) throw new Error('turn-stopping 未触发，fn 没有执行')
  return result
}

/** 收集一个 agent 会话上的审批审计对（approval/asked + approval/decided）。 */
function collectAudit(agent: Agent) {
  const asked: { id: string; toolName: string; callId?: string }[] = []
  const decided: { id: string; outcome: string }[] = []
  const off = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(agent.id)) return
    if (event.type === 'approval/asked') asked.push(event.data as { id: string; toolName: string; callId?: string })
    if (event.type === 'approval/decided') decided.push(event.data as { id: string; outcome: string })
  })
  return { asked, decided, off }
}

// ── S1：审批词汇表与 fail-closed ───────────────────────────────────────────
console.log('\n=== S1 审批 waterfall：四个结果 + fail-closed ===')
{
  const handle = await makeAgent('s1', 's1')
  const agent = handle.agent
  const audit = collectAudit(agent)
  const outcomes = await insideTurn(agent, async () => {
    const seen: ApprovalOutcome[] = []
    // a) 回答器认领并批准
    const offAllow = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
    seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '演示批准' }))
    offAllow()
    // b) 回答器认领并拒绝
    const offReject = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'rejected')
    seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '演示拒绝' }))
    offReject()
    // c) 没有回答器 → 兜底 unavailable（fail-closed，不是抛错）
    seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '无回答器' }))
    // d) 回答器抛错 → 问题被关闭为 unavailable，而不是把异常漏给调用方
    const offThrow = ctx.on('approval/request', () => { throw new Error('回答器崩溃') })
    seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '回答器抛错' }))
    offThrow()
    // e) 撤回：回答器挂起不答，signal abort 赢得竞态 → cancelled，迟到的回答被丢弃
    const controller = new AbortController()
    const offHang = ctx.on('approval/request', () => new Promise<ApprovalOutcome>(() => {}))
    const timer = setTimeout(() => controller.abort(), 20)
    seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '演示撤回', signal: controller.signal }))
    clearTimeout(timer)
    offHang()
    return seen
  })
  audit.off()
  console.log(`五次请求的结果：${outcomes.join(' → ')}`)
  console.log(`审计对：approval/asked × ${audit.asked.length}，approval/decided × ${audit.decided.length}`)
  assert(outcomes.join(',') === 'allowed-once,rejected,unavailable,unavailable,cancelled', '审批词汇表结果不符')
  assert(audit.asked.length === 5 && audit.decided.length === 5, '审计对数量不符')
  assert(audit.asked.every((a, i) => a.id === audit.decided[i]?.id), '审计对 id 未按序配对')
  assert(audit.decided.map(d => d.outcome).join(',') === outcomes.join(','), '审计结果与返回值不一致')
  await handle.dispose()
}

// ── S2：turn 约束与会话级策略覆盖 ──────────────────────────────────────────
console.log('\n=== S2 turn 约束 + never 策略覆盖 ===')
{
  const handle = await makeAgent('s2', 's2')
  const agent = handle.agent
  let outsideError = ''
  try {
    await ctx.approval.request({ agent, toolName: 'demo-tool' })
  } catch (error) {
    outsideError = (error as Error).message
  }
  console.log(`turn 外裸调：${preview(outsideError, 80)}`)
  assert(outsideError.includes('outside an open turn'), 'turn 外调用应当被拒绝')

  // 会话级覆盖落 approval/policy 事件；never 在服务自己的请求路径上先于任何
  // 回答器判决——注册顺序再靠前也拦不住它（prepend 监听器也不行）。
  let policyEvents = 0
  const offPolicy = ctx.on('session/event', (session, event) => {
    if (String(session.id) === String(agent.id) && event.type === 'approval/policy') policyEvents += 1
  })
  setApprovalPolicy(agent.session, 'never')
  const offAllow = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
  const outcome = await insideTurn(agent, () =>
    ctx.approval.request({ agent, toolName: 'demo-tool', reason: '回答器想批准' }))
  offAllow()
  offPolicy()
  console.log(`setApprovalPolicy('never') 后：结果=${outcome}（回答器在场也被拒），approval/policy 事件 × ${policyEvents}`)
  assert(outcome === 'rejected' && policyEvents === 1, 'never 策略应当先于回答器判决')
  await handle.dispose()
}

// ── S3：真实工具审批（pre-execute ask → 管线走 approval 缝）────────────────
console.log('\n=== S3 真实 turn 内的工具审批 ===')
{
  // pre-execute 返回 { kind: 'ask' }：管线自己调 approval.request（带 callId），
  // 把四个结果一一映射为 allow / 三种带 ApprovalError 的 deny。这就是权限门的正路。
  const offPre = ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'word_count') return { kind: 'ask', reason: 'word_count 需要人工批准' }
    return next()
  })

  // a) 批准：脚本化 turn 的第一步工具调用被放行，审计对带 callId。
  const allowHandle = await makeAgent('s3-allow', 's3a')
  const allowAudit = collectAudit(allowHandle.agent)
  const offAllow = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
  allowHandle.agent.followup(userMsg('统计一下这段文本的词数'))
  await allowHandle.agent.whenIdle()
  offAllow()
  allowAudit.off()
  console.log(`批准路径：decided=${allowAudit.decided[0]?.outcome}，callId 在审计里=${allowAudit.asked[0]?.callId !== undefined}`)
  assert(allowAudit.decided[0]?.outcome === 'allowed-once', '批准路径结果不符')
  assert(allowAudit.asked[0]?.callId !== undefined, '管线应当把真实 callId 带进审批')
  await allowHandle.dispose()

  // b) 拒绝：工具结果变成模型可见的拒绝原因，turn 照常收尾。
  const denyHandle = await makeAgent('s3-deny', 's3b')
  const denyAudit = collectAudit(denyHandle.agent)
  let denialText = ''
  const offResult = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(denyHandle.agent.id) || event.type !== 'tool/result') return
    const message = (event.data as { message?: { content?: unknown } }).message
    denialText = blocksToText(message?.content)
  })
  const offReject = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'rejected')
  denyHandle.agent.followup(userMsg('统计一下这段文本的词数'))
  await denyHandle.agent.whenIdle()
  offReject()
  offResult()
  denyAudit.off()
  console.log(`拒绝路径：decided=${denyAudit.decided[0]?.outcome}，模型看到：${preview(denialText, 80)}`)
  assert(denyAudit.decided[0]?.outcome === 'rejected', '拒绝路径结果不符')
  assert(denialText.includes('rejected'), '拒绝原因应当传给模型')
  await denyHandle.dispose()

  // c) 无 agent 的调用也要求审批 → 没有会话可审计、没有 UI 可路由 → 降级 deny。
  const orphan = await callTool(ctx, 'word_count', { text: 'no agent here' })
  console.log(`无 agent 降级：isError=${orphan.isError}，${preview(orphan.content, 80)}`)
  assert(orphan.isError && orphan.content.includes('no agent'), '无 agent 的 ask 应当降级拒绝')
  offPre()
}

// ── S4：结构化提问 ─────────────────────────────────────────────────────────
console.log('\n=== S4 userQuestions.ask ===')
{
  const handle = await makeAgent('s4', 's4')
  const agent = handle.agent
  // 回答器监听 user-questions/request：返回答案即认领，next() 交给下一个。
  const offAnswer = ctx.on('user-questions/request', async (request) => ({
    answers: request.questions.map(q => ({ id: q.id, selected: [q.options?.[0]?.label ?? ''] })),
  }))
  const answer = await ctx.userQuestions.ask({
    agent,
    questions: [{
      id: 'scope',
      question: '本次演示允许哪种访问？',
      header: '访问范围',
      options: [{ label: '只读' }, { label: '读写' }],
    }],
  })
  offAnswer()
  console.log(`回答：${JSON.stringify(answer.answers)}`)
  assert(answer.answers[0]?.id === 'scope' && answer.answers[0]?.selected[0] === '只读', '回答未按问题 id 回声')

  let emptyCode = ''
  try {
    await ctx.userQuestions.ask({ agent, questions: [] })
  } catch (error) {
    emptyCode = (error as { code?: string }).code ?? ''
  }
  console.log(`空问题批：UserQuestionError code=${emptyCode}`)
  assert(emptyCode === 'EMPTY_QUESTIONS', '空问题批应当报 EMPTY_QUESTIONS')
  await handle.dispose()
}

// ── S5：自定义斜杠命令 ─────────────────────────────────────────────────────
console.log('\n=== S5 commands.register + execute ===')
{
  const handle = await makeAgent('s5', 's5')
  const agent = handle.agent
  const offCommand = ctx.commands.register({
    name: 'lab-note',
    description: '把一句话记进演示日志',
    handler: invocation => ({ kind: 'success', text: `已记录：${invocation.rawInput.trim()}` }),
  })
  const names = ctx.commands.list(agent).map(command => command.name)
  console.log(`lab-note 可见：${names.includes('lab-note')}`)
  assert(names.includes('lab-note'), '自定义命令未出现在 list 里')

  const lifecycle: string[] = []
  const offEvent = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(agent.id)) return
    if (event.type === 'command/run' || event.type === 'command/done') lifecycle.push(event.type)
  })
  const execution = await ctx.commands.execute(agent, '/lab-note 双运行时一致', [], new AbortController().signal)
  const unknown = await ctx.commands.execute(agent, '/nope', [], new AbortController().signal)
  offEvent()
  offCommand()
  console.log(`execute 结果：kind=${execution?.result.kind}，text=${execution?.result.kind === 'success' ? execution.result.text : '?'}`)
  console.log(`生命周期事件：${lifecycle.join(' → ')}；未注册命令返回 ${unknown === undefined ? 'undefined' : '意外值'}`)
  assert(execution?.result.kind === 'success', '命令执行应当成功')
  assert(lifecycle.join(',') === 'command/run,command/done', '命令生命周期事件不完整')
  assert(unknown === undefined, '未注册命令应当返回 undefined')
  await handle.dispose()
}

// ── S6：todo_write 工具 ────────────────────────────────────────────────────
console.log('\n=== S6 todo_write ===')
{
  const handle = await makeAgent('s6', 's6')
  const agent = handle.agent
  const todos = [
    { content: '读源码', status: 'completed' },
    { content: '写示例', status: 'in_progress' },
    { content: '双运行时验证', status: 'pending' },
  ]
  const written = await callTool(ctx, 'todo_write', { todos }, agent)
  const counts = (written.value as { counts?: { pending: number; inProgress: number; completed: number } })?.counts
  console.log(`有 agent：isError=${written.isError}，${written.content}`)
  assert(!written.isError && counts?.pending === 1 && counts?.inProgress === 1 && counts?.completed === 1, 'todo counts 不符')

  // 清单是"每 agent 会话"的状态：没有归属会话的调用被拒绝，而不是静默 no-op。
  const orphan = await callTool(ctx, 'todo_write', { todos })
  console.log(`无 agent：isError=${orphan.isError}，${preview(orphan.content, 80)}`)
  assert(orphan.isError && orphan.content.includes('owning agent session'), '无 agent 的 todo_write 应当被拒绝')
  await handle.dispose()
}

await ctx.fiber.dispose()
console.log('\nHITL_OK')
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `@deepseek-ai/dsh-user-approval` 与 `@deepseek-ai/dsh-tool-todo`。
2. `npm start` 打印 S1～S6 六段，末行 `HITL_OK`，与第 6 节实测输出逐行一致。
3. `npm run start:bun` 除首行 runtime 标识外逐行相同。
4. `npm run typecheck` 无输出、退出码 0。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。

## 9 小结

这个示例验证了六件事：

- 审批 = turn 内审计事件对（`approval/asked` + `approval/decided`）+ 封闭结果词汇 + fail-closed 判决链；`unavailable` 是正常结果，不是异常；
- never 策略在服务请求路径上先于任何回答器判决，prepend 监听器也拦不住；
- 权限门正路是 pre-execute 返回 `{ kind: 'ask' }`，管线自动带 `callId` 走审批缝，并把拒绝原因翻译成模型可见的工具结果；
- 提问、命令、todo 是另外三个独立面：结构化回答、不经模型的指令、每会话进度清单；
- 无 agent 的调用一律明确拒绝（审批降级 deny、todo 报错），不静默 no-op；
- 自写插件走 patch 清单声明，Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-trajectory-probe-demo](../dsh-trajectory-probe-demo/README.md)；下一篇：[dsh-subagent-demo](../dsh-subagent-demo/README.md)——委派与子 agent。兄弟示例：[dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md)（pre/post-execute 与 guard）、[dsh-session-demo](../dsh-session-demo/README.md)（审计事件的持久化与回放）。