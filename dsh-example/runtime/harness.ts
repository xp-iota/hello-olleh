/**
 * harness.ts —— 用**真实发布的 dsh npm 包**组装一个能跑的 agent。
 *
 * 这一层不是 dsh 的模拟或缩样：下面 import 的每一个 `@deepseek-ai/*` 都是
 * npm 公共 registry 上真实发布的包（版本线 `0.1.5-rc.2`，见工程根 `package.json`）。
 * 它替代的角色相当于真实产品里的 **bundle / profile**（`@deepseek-ai/dsh-base`
 * 之类）：把 core 服务与本地 seam 后端按依赖顺序装进一个 cordis `Context`，
 * 好让每个示例只关心自己那一个扩展点。
 *
 * 装配清单（全部是真实 Service）：
 *   cordis-plugin-timer     → ctx.timer / ctx.timeout / ctx.interval / ctx.throttle / ctx.debounce
 *   dsh-settings            → ctx.settings（抽象；本文件给一个内存 provider 子类）
 *   dsh-session             → ctx.sessions
 *   dsh-system-prompt       → ctx.systemPrompt
 *   dsh-llm                 → ctx.llm
 *   dsh-user-approval       → ctx.approval
 *   dsh-tools               → ctx.tools
 *   dsh-commands            → ctx.commands
 *   dsh-skill               → ctx.skills
 *   dsh-subagent            → ctx.subagents
 *   dsh-fs-local            → ctx.fs（FileSystem seam 的本地后端）
 *   dsh-subprocess-local    → ctx.subprocess
 *   dsh-bash-local          → ctx.shell（ShellExecutor seam 的本地后端）
 *   dsh-jobs-local          → ctx.jobs
 *   dsh-agent               → ctx.agents
 *   dsh-goal                → ctx.goals
 *   dsh-session-projection  → ctx.sessionProjections（投影单元；agent-loop 的必需依赖）
 *   dsh-agent-loop          → ctx.agentLoop（真实 turn/step 主循环 + AgentFactory）
 *
 * **刻意不默认装载**两个 seam，因为示例自己要当 provider：
 *   - `CompactionEngine`（见 M02；真实后端是 `@deepseek-ai/dsh-compaction-basic`）
 *   - `SandboxProvider`（见 M07；真实后端是 `@deepseek-ai/dsh-sandbox-local`）
 */
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import LlmRuntime, { ToolCallId, LlmAdapter, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import AgentRegistry, { assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import GoalService from '@deepseek-ai/dsh-goal'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import './env.ts'
import { MemorySettingsProvider } from './settings-memory.ts'
import { MockAdapter, ToolCallingMockAdapter } from './llm-mock.ts'
import { MinimaxAnthropicAdapter } from './llm-minimax.ts'
import { CountingMinimaxAdapter, REAL_MODE, REAL_PROVIDER, realConfig } from './real.ts'

/** 每个示例默认拿到的 agent 会话 id。 */
export const DEMO_SESSION = 'demo-session' as SessionId

// 工程根 .env 的加载集中在 runtime/env.ts（import 即生效）。

export interface HarnessOptions {
  /** 默认 mock 适配器的固定回复；示例可自己注册适配器覆盖 `mock` 路由前先传 `mock: false`。 */
  reply?: string
  /** 传 false 时不注册内置 mock 适配器（示例要自己占用 `mock` 路由时用）。 */
  mock?: boolean
  /** 用自定义适配器占住 `mock` 路由（例如会调工具的 {@link ToolCallingMockAdapter}）。 */
  adapter?: LlmAdapter
  /** agent 的 provider 路由，默认读 `DSH_PROVIDER`（未设则 `mock`）。 */
  provider?: string
  /** agent 的 model，默认读 `DSH_MODEL`。 */
  model?: string
  /** 会话 id，默认 {@link DEMO_SESSION}。 */
  sessionId?: SessionId
  /**
   * 在**创建 agent 之前**就装载的插件（`[插件模块, config?]`）。
   * `agent/session-start` 只在会话开始那一刻派发一次，想收到它的插件必须先在场 ——
   * 真实产品里插件由 profile/bundle 在启动阶段装载，也先于 agent 存在。
   */
  plugins?: Array<[plugin: unknown, config?: unknown]>
}

export interface TurnOutcome {
  /** 本轮所有 assistant 文本块拼起来的结果（来自真实会话日志的 surface 投影）。 */
  text: string
  /** 本轮真实发生的 step 数（数会话日志里的 `step/start`）。 */
  steps: number
  /** 本轮是否被中途引导（会话日志里出现过 `target: 'next-step'` 的 inbox 拼接）。 */
  steerRequested: boolean
  /** 中途引导次数。 */
  steerCount: number
  /** 真实 Session 对象。 */
  session: Session
}

export interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  /** 已加载的示例插件 fiber（按加载顺序）。 */
  readonly plugins: Fiber[]
  /** 加载一个 cordis 形状的插件（函数式或 Service 类式），返回它的 fiber。 */
  loadPlugin(plugin: unknown, config?: unknown): Promise<Fiber>
  /** 走完整工具管线调用一个工具（真实 `ctx.tools.execute`）。 */
  callTool(name: string, args: unknown, options?: { agent?: Agent | undefined; callId?: string }): Promise<ToolExecutionResult>
  /** 该 agent 视角下模型可见的工具名（真实 `ctx.tools.schemas(scope)`）。 */
  visibleTools(agent?: Agent): string[]
  /** 该 agent 的提示装配上下文（真实 `assembleContextFor`）。 */
  assembleContext(agent?: Agent): AssembleContext
  /** 跑一个真实 turn：喂一条用户消息 → 等主循环空闲 → 从会话日志读结果。 */
  runTurn(options?: { prompt?: string }): Promise<TurnOutcome>
  /** 卸载 agent 与整棵 context（真实 effect 反注册）。 */
  dispose(): Promise<void>
}

/** 真实包里的插件既有函数式（`apply`）也有 Service 类式（`export default class`）。 */
function entryOf(plugin: any): any {
  if (typeof plugin === 'function') return plugin
  if (plugin && typeof plugin.default === 'function') return plugin.default
  return plugin
}

/**
 * 组装 harness。全部服务按依赖顺序 `ctx.plugin(...)` 装载，并逐个 `await fiber.await()`：
 * cordis 的注入是异步的（`static inject` 未满足时 fiber 停在 PENDING），
 * 不等它 ACTIVE 就访问 `ctx.tools` 会拿到 undefined。
 */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const ctx = new Context()

  const plan: Array<[unknown, unknown?]> = [
    [TimerService],
    [MemorySettingsProvider],
    [SessionStore],
    [SystemPrompt],
    [LlmRuntime],
    [ApprovalService],
    [ToolRuntime],
    [CommandRuntime],
    [SkillRegistry],
    [SubagentRuntime],
    [LocalFileSystem],
    [LocalSubprocessRuntime],
    [LocalBashExecutor],
    [LocalJobRegistry],
    [AgentRegistry],
    [GoalService],
    // 0.1.5 起 AgentLoop 的 static inject 多了 sessionProjections：不装它，
    // agent-loop 的 fiber 会停在 PENDING —— 依赖未满足时 cordis 不执行插件，
    // 症状是 ctx.agents.create() 报 'no agent factory registered'，而不是报缺依赖。
    [SessionProjectionRegistry],
    // agent-loop 注入 agents/sessions/llm/tools/systemPrompt/sessionProjections，必须最后装。
    [AgentLoop, { agents: [] }],
  ]
  for (const [plugin, config] of plan) {
    await (config === undefined ? ctx.plugin(plugin as any) : ctx.plugin(plugin as any, config)).await()
  }

  // 真实模式（默认；`--mock` 才关）：密钥缺失当场失败，绝不静默退回 mock。
  // 计数适配器把真实 chunk 一条不改地透传给 agent-loop，同时留下调用证据。
  const real = REAL_MODE ? realConfig() : undefined
  if (real) {
    ctx.llm.registerAdapter([REAL_PROVIDER], new CountingMinimaxAdapter(real))
  } else if (process.env.LLM_API_KEY) {
    // 离线模式下也注册这条路由，方便 `DSH_PROVIDER=anthropic-compat` 单点试跑。
    ctx.llm.registerAdapter([REAL_PROVIDER], new MinimaxAnthropicAdapter({
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_BASE_URL,
      defaultModel: process.env.LLM_MODEL,
    }))
  }
  if (options.mock !== false) {
    // 真实模式忽略示例传入的 mock 适配器：模型该做的决定必须由真实模型做。
    // `mock` 路由仍然在场，因为 M01/M03 有几个阶段就是在演示"路由与适配器协议"本身。
    const fallback = new MockAdapter(options.reply ?? '好的，我已经看过了。')
    ctx.llm.registerAdapter(['mock'], real ? fallback : (options.adapter ?? fallback))
  }

  const provider = options.provider ?? (real ? REAL_PROVIDER : process.env.DSH_PROVIDER ?? 'mock')
  const model = options.model
    ?? (real ? real.model : process.env.DSH_MODEL ?? (provider === REAL_PROVIDER ? 'MiniMax-M3' : 'mock-1'))

  const plugins: Fiber[] = []
  const loadPlugin = async (plugin: unknown, config?: unknown): Promise<Fiber> => {
    const entry = entryOf(plugin)
    const fiber = config === undefined ? ctx.plugin(entry, undefined as any) : ctx.plugin(entry, config as any)
    await fiber.await()
    plugins.push(fiber)
    return fiber
  }
  // 先装插件再造 agent：`agent/session-start` 只派发一次，插件必须先在场。
  for (const [plugin, config] of options.plugins ?? []) await loadPlugin(plugin, config)

  const handle = await ctx.agents.create({
    sessionId: options.sessionId ?? DEMO_SESSION,
    agentOptions: { provider, model },
  })
  const agent = handle.agent

  let callSeq = 0

  const harness: Harness = {
    ctx,
    agent,
    plugins,

    loadPlugin,

    callTool(name, args, opts = {}) {
      callSeq += 1
      return ctx.tools.execute({
        callId: ToolCallId(opts.callId ?? `call-${callSeq}`),
        name,
        arguments: args,
        agent: 'agent' in opts ? opts.agent : agent,
        signal: new AbortController().signal,
      })
    },

    visibleTools(which = agent) {
      return ctx.tools.schemas(assembleContextFor(which).scope).map((schema) => schema.name)
    },

    assembleContext(which = agent) {
      return assembleContextFor(which)
    },

    async runTurn({ prompt = '你好' } = {}) {
      const session = agent.session
      const before = session.seq
      agent.followup(userText(prompt))
      // 真实主循环是异步的：followup 唤醒 driver，whenIdle() 等它把整轮跑完。
      await agent.whenIdle()
      const fresh = session.snapshotEvents().filter((event) => event.seq >= before)
      return summarize(session, fresh)
    },

    async dispose() {
      await handle.dispose()
      await ctx.fiber.dispose()
    },
  }
  return harness
}

/**
 * 造一条 `UserMessage`。真实 dsh 用 `createUserMessage` 铸造 —— 它会分配 `MessageId`
 * 并深冻结（"消息一旦创建即不可变"是核心不变量；`session.fork` 会校验每条 user/message
 * 都带 id，手搓字面量在 fork 时会被拒）。
 */
export function userText(text: string, source: UserMessage['source'] = { kind: 'user' }): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source })
}

/**
 * 造一条 assistant 消息。`assistant/message` 是三种"可进入模型可见面"的事件之一
 * （另两种是 `user/message` / `tool/result`），并且**必须带 model 来源**
 * （`{ kind:'model', provider, model }`）—— 压缩摘要之所以也走这个事件，正是因为
 * 那段摘要在真实实现里确实由模型生成。
 *
 * 注意 `createUserMessage` / `createAssistantMessage` 的入参**不接受** `id` 与 `role`
 * （类型上是 `never`）：身份与角色由铸造函数负责，调用方不能自己编。
 */
export function assistantText(text: string, provider = 'mock', model = 'mock-1') {
  return createAssistantMessage({ content: [{ type: 'text', text }], source: { provider, model } })
}

/**
 * 一个"占位"工具：只回一句字符串。示例里需要几个假工具来演示策略/收紧/守卫时用它，
 * 免得每处都重抄一遍 `defineTool` 的样板。真实工具三件套见 M01。
 */
export function demoTool(name: string, describe = `示例工具 ${name}`) {
  return defineTool({
    name,
    description: describe,
    parameters: {
      path: { type: 'string', description: '演示用参数' },
      cmd: { type: 'string', description: '演示用参数' },
      env: { type: 'string', description: '演示用参数' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const detail = Object.entries(args).map(([k, v]) => `${k}=${v}`).join(' ') || '(无参数)'
      return `${name} 已执行: ${detail}`
    },
  })
}

/** 从真实会话日志里读出这一轮的结果，而不是让 harness 自己记账。 */
function summarize(session: Session, events: readonly SessionEvent[]): TurnOutcome {
  let text = ''
  let steps = 0
  let steerCount = 0
  for (const event of events) {
    if (event.type === 'step/start') steps += 1
    if (event.type === 'assistant/message') {
      const message = (event.data as any).message
      for (const block of message?.content ?? []) if (block.type === 'text') text += block.text
    }
    if (event.type === 'agent/inbox/spliced' && (event.data as any).target === 'next-step') {
      const inserted = (event.data as any).inserted ?? []
      if (inserted.length > 0) steerCount += 1
    }
  }
  return { text, steps, steerRequested: steerCount > 0, steerCount, session }
}

export { LlmAdapter, MockAdapter, ToolCallingMockAdapter }
