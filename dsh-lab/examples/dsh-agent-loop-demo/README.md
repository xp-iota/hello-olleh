# dsh 的 agent 循环示例

本示例演示怎么在不写循环的前提下干预 agent 循环：turn/step 边界观察、turn-stopping 时 steer 续跑、三条 inbox 通道、在途取消、status 事件。word-count 工具与脚本化适配器都在 cordis.patch.yml 里声明，boot 后全程在位，代码里没有一处 `ctx.plugin()`。

dsh 的 agent 循环由 `dsh-agent-loop` 独占驱动：宿主只往 inbox 里塞消息，turn/step 的推进、工具执行、历史装配全部由 driver 负责。全部场景离线、不需要 key；版本面 `@deepseek-ai/*` 0.2.2-rc.3、`@deepseek-ai/cordis` 4.1.0，Node 26.12.1 与 Bun 1.4.4 输出逐行一致（首行 runtime 标识除外）。

## 1 不写循环，怎么干预循环

干预点只有四类：

- **观察**：`session/event`（turn/step 边界、工具调用、助手消息）与 `agent/status`；
- **续跑**：`agent/turn-stopping` 事件时 `steer()`，让即将结束的 turn 再走一步；
- **排队**：`send()` / `followup()` / `inject()` 三条 inbox 通道，唤醒与否可选；
- **取消**：`cancel()`，空闲幂等、在途真实中止。

> 这些观察点大多只在「真的跑过一个 turn」之后才有内容，而真实 turn 需要模型。

本示例的答案是**脚本化 LlmAdapter**——在 provider 缝上注册一个按剧本产出 StreamChunk 的适配器，driver 对它的驱动与真实 provider 完全一致，于是每个干预点都能离线真实触发。

## 2 最小树：九行底座 + 两个自写插件

与 [dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md) 相同的九行底座（timer / system-prompt / tools / tool-executor-native / session / session-projection / agent / llm / agent-loop），再追加两行自写插件：

```yaml
# 自写插件也走声明式：工具与脚本化适配器全程在位，随整树 dispose 回收。
- id: word-count
  name: ./src/plugins/word-count.ts

- id: scripted-adapter
  name: ./src/plugins/scripted-adapter.ts
```

模型侧**不挂任何真实 provider 行**：scripted-adapter 插件的 apply 里一句 `ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())` 就把剧本路由挂上。`registerAdapter()` 内部走 `ctx.effect`（llm/src/index.ts:423），fiber 销毁时路由自动回收——插件里不需要手动 release，整树 dispose 即清场。工具侧的 word-count 与 tool-pipeline 示例逐字相同（`word_count`），供脚本的第一个 step 调用。

## 3 脚本化适配器

`LlmAdapter` 是抽象类，唯一必须实现的方法是 `stream()`（llm/src/index.ts:317）；`providerInfo` / `resolveModel` / `prepareCall` 都有可用默认。协议是原始 StreamChunk 序列：`block-start → delta → block-end → usage → finish`。`src/plugins/scripted-adapter.ts` 全文：

```ts
/**
 * scripted-adapter —— 脚本化 LlmAdapter：离线驱动真实 agent 循环。
 *
 * LlmAdapter 是 dsh 的 provider 缝：唯一必须实现的方法是 stream()，
 * 产出原始 StreamChunk 协议（block-start → delta → block-end → usage → finish）。
 * 注册进 ctx.llm.registerAdapter() 后，agent-loop 对它的驱动与真实 provider
 * 完全一致——turn/step 边界、工具执行、inbox 消费全都真实发生，只是"模型回答"
 * 由脚本决定。这让循环干预的每个观察点都不需要 API key。
 *
 * 两条路由：
 *   - scripted：第 1 个 step 产出 word_count 工具调用，之后的 step 给最终文本；
 *   - hang：产出 block-start 后挂起，直到 options.signal 中止才抛错——
 *     用于演示在途取消（LlmRuntime 会把抛出规范化为 aborted 终局）。
 *
 * 文件末尾的 name/inject/apply 是 cordis 插件形态：本文件在 cordis.patch.yml
 * 里声明为一行，registerAdapter 内部走 ctx.effect，fiber 销毁时路由自动回收。
 */
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'

export class ScriptedAdapter extends LlmAdapter {
  /** 每个 model 路由独立的 step 计数：不同场景用不同 model id，互不串步。 */
  private readonly steps = new Map<string, number>()

  override providerInfo(provider: string) {
    return { id: provider, name: '脚本化（离线演示用）' }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const step = (this.steps.get(options.model) ?? 0) + 1
    this.steps.set(options.model, step)

    if (options.model === 'hang') {
      // 挂起路由：只开一个文本块，然后等取消信号。适配器契约要求尊重 signal。
      yield { type: 'block-start', index: 0, blockType: 'text' }
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) return resolve()
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      options.signal?.throwIfAborted()
      return
    }

    if (step === 1) {
      // 第一个 step：产出一个 tool-call，让循环进入工具执行。
      const callId = ToolCallId(`scripted-call-${options.model}`)
      const args = JSON.stringify({ text: 'deepseek harness scripted turn' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: callId, name: 'word_count', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'word_count', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 1200, outputTokens: 24 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    // 后续 step：给最终文本回答（steer 续跑时也走这里）。
    const text = step === 2 ? '工具结果已经拿到了。' : '这是续跑后的补充回答。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1500, outputTokens: 18 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'scripted-adapter'
export const inject = ['llm']

export function apply(ctx: Context): void {
  // registerAdapter 内部是 ctx.effect：不需要手动 release，fiber 销毁即回收。
  ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())
}
```

每个场景用不同的 model id（`s1`…`s5`、`hang`），step 计数互不串扰。agent 创建时路由走 `agentOptions`：

```ts
ctx.agents.create({
  sessionId: SessionId(`agent-loop-s1-${suffix}`),
  meta: { cwd: process.cwd() },                        // root 会话 header 只接受 { cwd }
  agentOptions: { provider: 'lab-scripted', model: 's1' },
})
```

## 4 五个场景

```ts
// S1 观察边界：followup 唤醒 driver，whenIdle 等收敛
agent.followup(userMsg('统计一下这段文本的词数'))
await agent.whenIdle()          // session/event 里收集 turn/step 边界

// S2 steer 续跑：turn-stopping 是 serial 事件，payload.agent 由融合分发器注入
const offStopping = ctx.on('agent/turn-stopping', (payload) => {
  if (payload.agent !== agent || steered) return
  steered = true
  agent.steer(userMsg('再补一句：这句话是 steer 注入的。'))
})

// S3 只入队不唤醒：send 的第三个参数是 wakeup
agent.send(userMsg('排队但不唤醒'), 'next-turn', false)   // status 仍 idle
agent.inject(userMsg('下一步边界再消费'))                  // = send(next-step, false)
agent.inbox.clear()

// S4 在途取消：hang 路由挂起 → 等 running 事件 → cancel → aborted 收尾
hangAgent.followup(userMsg('这个请求会一直挂起'))
await running                    // agent/status 里等到 running
hangAgent.cancel({ kind: 'user' })
await hangAgent.whenIdle()       // turn/end reason = aborted

// S5 status 事件：一个完整 turn 恰好 running → idle
```

## 5 机制解释

### LlmAdapter 是 provider 缝，stream 是唯一必需方法

`LlmAdapter`（llm/src/index.ts:223）把 provider 差异收敛成一个抽象类：`providerInfo` / `providerRetryPolicy` / `resolveModel` / `prepareCall` 都有默认实现，只有 `stream()` 是 abstract。`ctx.llm.registerAdapter(providers, adapter)` 把实例绑到一组路由上，返回解除句柄 + 原子换路由能力（:324-330）；注册本身登记为调用方 fiber 的 effect，所以插件形态下无需手动解除。agent-loop 组装好 `GenerateOptions`（完整历史、工具 schema、signal、sessionId）后调用 `llm.stream()`，对脚本化适配器与真实 provider 一视同仁——这正是「缝」的价值：**替换模型来源不需要碰循环的任何一行**。

### turn 的形状：step 循环 + 两个 inbox 检查点

driver 的一个 turn 内（agent-loop/src/agent.ts:360-407）：每个 step 写 `step/start` → 执行模型请求与工具批 → 写 `step/end`；step 结束后若 `turnEnds && inbox.nextStep.length === 0`，先 serial 分发 `agent/turn-stopping`，**再检查一次** nextStep——steer 就是利用这个检查点让 turn 续跑。turn 收尾必写 `turn/end`（含 reason：completed / max-tokens / aborted / error），然后若 inbox 还有 next-turn 待办，开下一个 turn。

### 三条通道是同一 send 的三种包装

agent.ts:171-190 一目了然：

| API | 等价形式 | 语义 |
|---|---|---|
| `followup(msg)` | `send(msg, 'next-turn', true)` | 排队一个完整 turn 并唤醒 |
| `steer(msg)` | `send(msg, 'next-step', true)` | 在当前 turn 的下一步边界插入并唤醒 |
| `inject(msg)` | `send(msg, 'next-step', false)` | 只入队，等下次自然边界消费 |

`wakeup=false` 时 driver 完全不启动（S3 实测 status 保持 idle）——inbox 是**持久化的待办**，不是即时调用。`cancel()` 默认先 `inbox.clear()` 再中止在途活动；`keepInbox: true` 保留排队工作（agent.ts:192-202）。

### agent 事件的 payload 由融合分发器注入 agent

`agent/status`、`agent/turn-stopping` 的 emit 侧只传 `{ status }` / `{ turn, signal }`；`agentEvents()`（core/agent/src/dispatch.ts:107-148）构造融合分发器，把 agent 主体注入 payload 并绑定 scope carrier——**subject 与 scope key 不可能分叉**。所以根 ctx 上的监听器用 `payload.agent === agent` 过滤即可，类型声明里 payload 本来就带 `agent` 字段（runtime-types.ts:310、:418）。

### 适配器必须尊重 signal，失败会被规范化

StreamChunk 协议文档（types.ts:489-494）明确：适配器可以抛错，`LlmRuntime.stream()` 会把失败规范化为终局 `error` 或 `aborted` finish 再暴露给消费者。hang 路由的实现因此非常简单：等 signal abort → `throwIfAborted()`，剩下的交给运行时。cancel 的 cause（`{ kind: 'user' }`）沿 signal 传到 turn/end 的 `reason: { kind: 'aborted', reason: cause }`。

## 6 运行agent循环示例

根配置留空，装配全部来自 patch 清单：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

```yaml
# Agent 循环的最小树：与 dsh-tool-pipeline-demo 相同的九行——
# 循环干预需要真实的 agent 与 driver，而 agents.create() 需要
# agent-loop 注册的 factory（否则报 no agent factory registered）。
# 模型侧不挂任何真实 provider：脚本化 LlmAdapter 与 word-count 工具
# 都是自写插件，声明在下方两行，全程在位。
# 依赖链：systemPrompt → tools → tool-executor-native；
#         sessionProjections → agent；
#         agents + sessions + llm + tools + systemPrompt + sessionProjections → agent-loop。
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

    # agent-loop 是 required 行：挂了就必须激活。它注册 AgentFactory，
    # 没有它 agents.create() 直接抛 no agent factory registered。
    - id: agent-loop
      name: '@deepseek-ai/dsh-agent-loop'
      config:
        agents: []

    # 自写插件也走声明式：工具与脚本化适配器全程在位，随整树 dispose 回收。
    - id: word-count
      name: ./src/plugins/word-count.ts

    - id: scripted-adapter
      name: ./src/plugins/scripted-adapter.ts
```

`npm start` 直接跑 `src/index.ts`：入口是官方 `boot()`，读 cordis.yml 与 patch 清单建起整棵服务树，工具与适配器随装配就位：

```ts
const ctx = await boot(
  'dsh-agent-loop-demo', CONFIG,
  loadOverlayPatches('dsh-agent-loop-demo', PATCH),
  undefined, BASE_URL,
)
// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。
// ……S1～S5：创建 agent、塞 inbox、观察事件……
await ctx.fiber.dispose()
console.log('\nAGENT_LOOP_OK')
```

在本机复现只需要四条命令：

```bash
npm install             # @deepseek-ai/* 依赖（含自动安装的 peer）
#
npm start               # Node：五场景全离线，末行 AGENT_LOOP_OK
npm run start:bun       # Bun：不挂 ptc/subprocess，无需任何补丁，输出逐行一致
#
npm run typecheck       # tsc --noEmit：类型契约校验（无输出即通过）
```

下面是 `npm start` 的实测输出（Node 26.12.1；Bun 1.4.4 除首行 `runtime = bun 1.4.4` 外逐行一致）：

```text
runtime = node v26.12.1

=== S1 脚本化 turn：turn/step 边界 ===
边界事件：turn/start → step/start → step/end → step/start → step/end → turn/end
tool/call × 1，assistant/message × 2

=== S2 turn-stopping 时 steer ===
turn 1 即将结束，steer 注入续跑消息
steer 触发：true，本 turn 共 3 个 step（无 steer 时是 2 个）

=== S3 inbox 三通道：followup / steer / inject ===
初始：next-turn 0 条，next-step 0 条
send(next-turn, wakeup=false) 后：next-turn 1 条，status=idle
inject 后：next-step 1 条，status=idle
clear 后：next-turn 0 条，next-step 0 条

=== S4 取消在途工作 ===
空闲时连续 cancel 不报错，status=idle
默认 cancel 清空 inbox：剩 0 条
keepInbox cancel 保留排队：剩 1 条
turn 已在途：status=running
cancel 后：status=idle，turn/end reason=aborted

=== S5 agent/status 事件 ===
初始 status：idle
status 变化：running → idle

AGENT_LOOP_OK
```

三个值得注意的事实：

- **S1 的边界序列**是 driver 真实写进会话日志的事件，不是模拟打印——工具步与回答步各一对 step/start/end；
- **S2 的 3 个 step**：steer 不是「打断」，而是在 turn-stopping 检查点往 next-step 塞消息，循环发现 inbox 非空就继续；
- **S4 的 aborted**：取消真实穿透到适配器的 `options.signal`，hang 路由抛出后被 LlmRuntime 规范化为 aborted 终局，turn/end 如实记录。

## 7 边界与坑

1. **rc.3 的 FinishReason 是对象不是字符串**：`{ kind: 'tool-calls' }` / `{ kind: 'stop' }`（types.ts:163-172，merge-extensible）。旧探针里的 `reason: 'tool-calls' as never` 写法在 rc.3 上过不了 typecheck。
2. **模型路由在 agentOptions，不在 meta**：root 会话的 header 只接受 `{ cwd }`，`origin` 是子 agent 专用；provider/model 填进 meta 会被 validateSessionHeader 拒掉。
3. **turn-stopping 的 payload 没有显式 agent 传入**：emit 侧只有 `{ turn, signal }`，`agent` 是融合分发器注入的——直接读 `payload.agent` 即可，不要自己拼。
4. **steer 只在检查点生效**：turn-stopping 之后循环立刻复查 nextStep；在别的时机 steer 只是普通入队。一个 turn 里 steer 多次会续跑多步，示例用 `steered` 标志只注入一次。
5. **根 ctx 监听器不随 agent dispose 销毁**：每个场景都拿 `ctx.on` 返回的 off 句柄手动解除（沿用 tool-pipeline-demo 的教训）。插件 apply 里的注册（工具、适配器路由）则随 fiber 自动回收，两者处置不同。
6. **step 计数要按 model 路由隔离**：同一个适配器实例服务所有场景，共用计数会让 S2 的第一个 step 直接给文本、跳过工具步。
7. **在途取消要等 running 再 cancel**：followup 之后 driver 异步启动，立刻 cancel 可能打在空闲态上（幂等但测不到在途路径）。用 agent/status 事件等到 running 是确定性做法。
8. **本示例不挂 ptc/subprocess**，Bun 无需补丁；会话日志落在本目录 `.dsh-home/`（gitignored）。

## 8 从零复现：完整文件与运行路径

前置条件：Node 22.18 以上（本文用 26.12.1 验证）或 Bun 1.4.4 以上、npm。cordis fork 直接运行 TypeScript，没有构建步骤；下面每个文件都可以原样复制。本目录就是完整工程，拷到任何位置都能独立安装运行。

### 目录结构

```text
dsh-agent-loop-demo/
├── package.json          # 依赖与脚本（Node / Bun 双运行时）
├── tsconfig.json         # 只做类型检查，不产出 JS
├── .gitignore            # node_modules/ + .dsh-home/
├── cordis.yml            # []：根配置留空
├── cordis.patch.yml      # 十一行最小树（见第 6 节全文）
└── src/
    ├── index.ts          # 五场景主程序：boot() + inbox 干预
    └── plugins/
        ├── word-count.ts       # 最小工具插件（与 tool-pipeline-demo 逐字相同）
        └── scripted-adapter.ts # 脚本化适配器（见第 3 节全文）
```

### package.json

```json
{
  "name": "dsh-agent-loop-demo",
  "private": true,
  "type": "module",
  "description": "Agent 循环干预：脚本化 LlmAdapter 离线驱动真实 turn——turn/step 边界、turn-stopping 时 steer 续跑、三条 inbox 通道、在途取消、status 事件。Node 与 Bun 双运行时。",
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
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.3",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.3",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.3",
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

tsconfig.json 与 [dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md) 逐字相同；`word-count.ts` 直接复制该示例同名文件（第 3 节有全文镜像）。

### src/index.ts（完整版）

```ts
/**
 * dsh-agent-loop-demo —— Agent 循环干预，全部离线（脚本化 LlmAdapter，不需要 key）：
 *   S1 脚本化适配器驱动真实 turn：观察 turn/step 边界与工具执行；
 *   S2 agent/turn-stopping 时 steer：turn 续跑一个 step；
 *   S3 三条 inbox 通道：followup / steer / inject 与"只入队不唤醒"；
 *   S4 取消：空闲幂等、keepInbox 语义、在途 turn 的真实中止；
 *   S5 agent/status 现场事件。
 * 关键认识：不要自己写循环——只往 inbox 塞消息，推进完全由 dsh-agent-loop 负责。
 * word-count 工具与脚本化适配器在 cordis.patch.yml 里声明，全程在位。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

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
  'dsh-agent-loop-demo', CONFIG,
  loadOverlayPatches('dsh-agent-loop-demo', PATCH),
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
    sessionId: SessionId(`agent-loop-${tag}-${suffix}`),
    meta: { cwd: process.cwd() },
    // 模型路由走 agentOptions，不在 meta 里（meta 只接受 { cwd }）。
    agentOptions: { provider: 'lab-scripted', model },
  })

// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。

// ── S1：脚本化适配器驱动真实 turn ──────────────────────────────────────────
console.log('\n=== S1 脚本化 turn：turn/step 边界 ===')
{
  const handle = await makeAgent('s1', 's1')
  const agent = handle.agent
  const boundaries: string[] = []
  let toolCalls = 0
  let assistantMessages = 0
  const off = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(agent.id)) return
    if (['turn/start', 'turn/end', 'step/start', 'step/end'].includes(event.type)) boundaries.push(event.type)
    if (event.type === 'tool/call') toolCalls += 1
    if (event.type === 'assistant/message') assistantMessages += 1
  })
  agent.followup(userMsg('统计一下这段文本的词数'))
  await agent.whenIdle()
  off()
  console.log(`边界事件：${boundaries.join(' → ')}`)
  console.log(`tool/call × ${toolCalls}，assistant/message × ${assistantMessages}`)
  assert(boundaries[0] === 'turn/start' && boundaries.at(-1) === 'turn/end', 'turn 边界不完整')
  assert(boundaries.filter(t => t === 'step/start').length === 2, '应当恰好两个 step（工具步 + 回答步）')
  assert(toolCalls === 1 && assistantMessages >= 1, '工具调用或助手消息缺失')
  await handle.dispose()
}

// ── S2：turn-stopping 时 steer 续跑 ────────────────────────────────────────
console.log('\n=== S2 turn-stopping 时 steer ===')
{
  const handle = await makeAgent('s2', 's2')
  const agent = handle.agent
  let steered = false
  let steps = 0
  const offEvent = ctx.on('session/event', (session, event) => {
    if (String(session.id) === String(agent.id) && event.type === 'step/start') steps += 1
  })
  // agent/turn-stopping：turn 即将结束（serial 事件，payload 由融合分发器注入 agent）。
  // 此刻 steer 会往 next-step 塞一条消息，循环检查 inbox 非空 → 再走一个 step。
  const offStopping = ctx.on('agent/turn-stopping', (payload) => {
    if (payload.agent !== agent || steered) return
    steered = true
    console.log(`turn ${payload.turn} 即将结束，steer 注入续跑消息`)
    agent.steer(userMsg('再补一句：这句话是 steer 注入的。'))
  })
  agent.followup(userMsg('说一句话'))
  await agent.whenIdle()
  offStopping()
  offEvent()
  console.log(`steer 触发：${steered}，本 turn 共 ${steps} 个 step（无 steer 时是 2 个）`)
  assert(steered && steps === 3, 'steer 应当让 turn 多走一个 step')
  await handle.dispose()
}

// ── S3：三条 inbox 通道 ────────────────────────────────────────────────────
console.log('\n=== S3 inbox 三通道：followup / steer / inject ===')
{
  const handle = await makeAgent('s3', 's3')
  const agent = handle.agent
  console.log(`初始：next-turn ${agent.inbox.nextTurn.length} 条，next-step ${agent.inbox.nextStep.length} 条`)
  // send(..., false)：只入队、不唤醒——inbox 是持久化待办，不是即时调用。
  agent.send(userMsg('排队但不唤醒'), 'next-turn', false)
  console.log(`send(next-turn, wakeup=false) 后：next-turn ${agent.inbox.nextTurn.length} 条，status=${agent.status}`)
  assert(agent.inbox.nextTurn.length === 1 && agent.status === 'idle', 'wakeup=false 不应唤醒 driver')
  // inject = send(next-step, false)：同样只入队；steer = send(next-step, true) 会唤醒。
  agent.inject(userMsg('下一步边界再消费'))
  console.log(`inject 后：next-step ${agent.inbox.nextStep.length} 条，status=${agent.status}`)
  assert(agent.inbox.nextStep.length === 1 && agent.status === 'idle', 'inject 不应唤醒 driver')
  agent.inbox.clear()
  console.log(`clear 后：next-turn ${agent.inbox.nextTurn.length} 条，next-step ${agent.inbox.nextStep.length} 条`)
  assert(agent.inbox.nextTurn.length === 0 && agent.inbox.nextStep.length === 0, 'clear 未清空')
  await handle.dispose()
}

// ── S4：取消（空闲幂等 + keepInbox + 在途中止）─────────────────────────────
console.log('\n=== S4 取消在途工作 ===')
{
  const handle = await makeAgent('s4', 's4')
  const agent = handle.agent
  agent.cancel({ kind: 'user' })
  agent.cancel({ kind: 'user' })
  console.log(`空闲时连续 cancel 不报错，status=${agent.status}`)
  agent.send(userMsg('会被默认取消清掉'), 'next-turn', false)
  agent.cancel({ kind: 'user' })
  console.log(`默认 cancel 清空 inbox：剩 ${agent.inbox.nextTurn.length} 条`)
  assert(agent.inbox.nextTurn.length === 0, '默认 cancel 应当清空 inbox')
  agent.send(userMsg('keepInbox 保留'), 'next-turn', false)
  agent.cancel({ kind: 'user' }, { keepInbox: true })
  console.log(`keepInbox cancel 保留排队：剩 ${agent.inbox.nextTurn.length} 条`)
  assert(agent.inbox.nextTurn.length === 1, 'keepInbox 应当保留排队工作')
  agent.inbox.clear()
  await handle.dispose()

  // 在途取消：hang 路由的 stream 挂起等待 signal，cancel 真实中止一个进行中的 turn。
  const hangHandle = await makeAgent('s4-hang', 'hang')
  const hangAgent = hangHandle.agent
  let turnEndReason = ''
  const offEvent = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(hangAgent.id) || event.type !== 'turn/end') return
    turnEndReason = (event.data as { reason?: { kind?: string } }).reason?.kind ?? '?'
  })
  const running = new Promise<void>((resolveRunning) => {
    const offStatus = ctx.on('agent/status', (payload) => {
      if (payload.agent === hangAgent && payload.status === 'running') {
        offStatus()
        resolveRunning()
      }
    })
  })
  hangAgent.followup(userMsg('这个请求会一直挂起'))
  await running
  console.log(`turn 已在途：status=${hangAgent.status}`)
  hangAgent.cancel({ kind: 'user' })
  await hangAgent.whenIdle()
  offEvent()
  console.log(`cancel 后：status=${hangAgent.status}，turn/end reason=${turnEndReason}`)
  assert(hangAgent.status === 'idle' && turnEndReason === 'aborted', '在途取消应当以 aborted 收尾')
  await hangHandle.dispose()
}

// ── S5：agent/status 现场事件 ──────────────────────────────────────────────
console.log('\n=== S5 agent/status 事件 ===')
{
  const handle = await makeAgent('s5', 's5')
  const agent = handle.agent
  const statuses: string[] = []
  const off = ctx.on('agent/status', (payload) => {
    if (payload.agent === agent) statuses.push(payload.status)
  })
  console.log(`初始 status：${agent.status}`)
  agent.followup(userMsg('跑一个完整 turn'))
  await agent.whenIdle()
  off()
  console.log(`status 变化：${statuses.join(' → ')}`)
  assert(statuses.join(' → ') === 'running → idle', '一个完整 turn 应当产生 running → idle')
  await handle.dispose()
}

await ctx.fiber.dispose()
console.log('\nAGENT_LOOP_OK')
```

### 按顺序验证

1. `npm install` 成功，`node_modules` 中出现 `@deepseek-ai/dsh-app-boot` 与 `@deepseek-ai/dsh-agent-loop`。
2. `npm start` 打印 S1～S5 五段，末行 `AGENT_LOOP_OK`，与第 6 节实测输出逐行一致。
3. `npm run start:bun` 除首行 runtime 标识外逐行相同。
4. `npm run typecheck` 无输出、退出码 0。

示例不依赖任何环境变量、端口或外部服务，安装完即可离线跑通。

## 9 小结

这个示例验证了六件事：

- 脚本化 LlmAdapter 让真实 turn 离线可跑：provider 缝替换模型来源不碰循环；
- turn/step 边界是会话日志里的真实事件，steer 在 turn-stopping 检查点续跑；
- followup / steer / inject 是同一 send 的三种包装，wakeup=false 只入队不唤醒；
- cancel 空闲幂等、默认清 inbox、keepInbox 保留排队、在途真实中止（aborted 收尾）；
- agent 事件 payload 的 agent 字段由融合分发器注入，subject 与 scope 不分叉；
- 自写插件走 patch 清单声明，registerAdapter 随 fiber 自动回收，Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-context-demo](../dsh-context-demo/README.md)；下一篇：[dsh-session-demo](../dsh-session-demo/README.md)——会话日志的结构、落盘、恢复与读取面。