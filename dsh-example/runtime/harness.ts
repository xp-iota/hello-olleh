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
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
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
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { AnthropicCompatAdapter, MockAdapter, ToolCallingMockAdapter, resolveAnthropicCompatVendor } from './llm.ts'
import type { AnthropicCompatVendor } from './llm.ts'

/** 唯一运行模式状态：默认真实，`--mock` / `DSH_MOCK=1` 才离线。 */
let mock = process.env.DSH_MOCK === '1'
export let REAL_MODE = !mock

export function isMockMode(): boolean {
  return mock
}

export function setMockMode(): void {
  mock = true
  REAL_MODE = false
  process.env.DSH_MOCK = '1'
}

export function applyMockFlag(argv: readonly string[] = process.argv.slice(2)): string[] {
  const rest = argv.filter((arg) => arg !== '--mock')
  if (rest.length !== argv.length) setMockMode()
  return rest
}

let envLoaded = false

export function loadProjectEnv(): void {
  if (envLoaded) return
  envLoaded = true
  try {
    process.loadEnvFile(new URL('../.env', import.meta.url))
  } catch {
    /* 没有 .env：继续读进程环境变量 */
  }
}

loadProjectEnv()

export function requireRealCredentials(module: string): void {
  loadProjectEnv()
  if (isMockMode() || process.env.LLM_API_KEY) return
  console.error('✗ 缺少 LLM_API_KEY。')
  console.error('  复制 .env.example 为 .env 并填入推理服务密钥，或在命令前临时注入：')
  console.error(`  LLM_API_KEY=<your-key> npm run ${module}`)
  process.exit(1)
}

/** 示例工程使用的进程内 settings provider。 */
export class MemorySettingsProvider extends SettingsProvider {
  private readonly doc: Record<string, unknown> = {}
  readonly writable = true

  protected async load(): Promise<Record<string, unknown>> {
    return this.doc
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns as unknown as string] = section
  }
}

/** 每个示例默认拿到的 agent 会话 id。 */
export const DEMO_SESSION = 'demo-session' as SessionId

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
    ctx.llm.registerAdapter([REAL_PROVIDER], new CountingAnthropicCompatAdapter(real))
  } else if (process.env.LLM_API_KEY) {
    // 离线模式下也注册这条路由，方便 `DSH_PROVIDER=anthropic-compat` 单点试跑。
    ctx.llm.registerAdapter([REAL_PROVIDER], new AnthropicCompatAdapter({
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


// ── 真实/离线模块编排与调用证据 ──────────────────────────────────────────
/** 单次模型调用的墙钟上限；超时按失败计，不按"跳过"计。 */
export const REAL_TIMEOUT_MS = Number(process.env.DSH_REAL_TIMEOUT_MS ?? 120_000)

/** 真实模式固定的 provider 路由名。 */
export const REAL_PROVIDER = 'anthropic-compat'

/** 证据里用来代替真实 endpoint 的稳定占位符。 */
const ENDPOINT_LABEL = 'llm-anthropic-compat'

export interface RealConfig {
  apiKey: string
  baseUrl: string
  model: string
  vendor: AnthropicCompatVendor
}

let cached: RealConfig | undefined

/**
 * 读取真实 provider 配置。缺密钥时**立即失败**并说明该去哪里配 ——
 * 真实模式不允许静默退回 mock。
 */
export function realConfig(): RealConfig {
  if (cached) return cached
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) {
    throw new Error([
      '真实模式缺少 LLM_API_KEY。',
      '配置来源：工程根 dsh-example/.env（模板见 .env.example，该文件已被 .gitignore 忽略）。',
      '需要三项：LLM_API_KEY / LLM_BASE_URL / LLM_MODEL（可选 LLM_VENDOR=minimax|fuyao）。',
      '也可临时注入：LLM_API_KEY=<your-key> npm run real:all',
    ].join('\n  '))
  }
  const baseUrl = process.env.LLM_BASE_URL ?? 'https://api.minimaxi.com/anthropic'
  const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
  cached = {
    apiKey,
    baseUrl,
    model,
    vendor: resolveAnthropicCompatVendor(process.env.LLM_VENDOR, { baseUrl, model }),
  }
  return cached
}

/** 输出脱敏：密钥、endpoint、绝对路径都不进证据。 */
export function redact(value: string): string {
  let out = value
  const key = process.env.LLM_API_KEY
  if (key && key.length > 6) out = out.split(key).join('<redacted-key>')
  out = out.replace(/https?:\/\/[^\s"')]+/g, `<${ENDPOINT_LABEL}>`)
  out = out.replace(/\/(?:Users|home)\/[^\s"')]+/g, '<path>')
  out = out.replace(/x-api-key[^\s,}]*/gi, '<redacted-header>')
  return out
}

/** 一段真实文本的可展示样本（单行、限长、已脱敏）。 */
export function sample(text: string, limit = 72): string {
  const flat = redact(text).replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`
}

export interface CallEvidence {
  seq: number
  provider: string
  model: string
  ms: number
  textChars: number
  textSample: string
  toolCalls: string[]
  finish: string
  inputTokens: number
  outputTokens: number
  failure?: string
}

const evidence: CallEvidence[] = []

/** 至今为止全部真实调用证据（同一进程内共享）。 */
export function allEvidence(): readonly CallEvidence[] {
  return evidence
}

/**
 * 包住真实推理服务 适配器：加超时、计数、证据与失败原因。
 * 它本身仍是真实 `LlmAdapter` 子类，chunk 一条不改地透传给 agent-loop，
 * 所以真实响应会照常进入工具管线、会话日志和后续 step。
 */
export class CountingAnthropicCompatAdapter extends LlmAdapter {
  private readonly inner: AnthropicCompatAdapter
  private readonly model: string
  private readonly timeoutMs: number

  constructor(config: RealConfig, timeoutMs = REAL_TIMEOUT_MS) {
    super()
    this.inner = new AnthropicCompatAdapter({
      apiKey: config.apiKey,
      vendor: config.vendor,
      baseUrl: config.baseUrl,
      defaultModel: config.model,
    })
    this.model = config.model
    this.timeoutMs = timeoutMs
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const started = Date.now()
    const record: CallEvidence = {
      seq: evidence.length + 1,
      provider: options.provider ?? REAL_PROVIDER,
      model: options.model ?? this.model,
      ms: 0,
      textChars: 0,
      textSample: '',
      toolCalls: [],
      finish: 'incomplete',
      inputTokens: 0,
      outputTokens: 0,
    }
    evidence.push(record)

    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let text = ''
    try {
      for await (const chunk of this.inner.stream({ ...options, signal })) {
        if (chunk.type === 'text-delta') text += chunk.text
        if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') record.toolCalls.push(chunk.block.name)
        if (chunk.type === 'usage') {
          record.inputTokens = chunk.usage.inputTokens
          record.outputTokens = chunk.usage.outputTokens
        }
        if (chunk.type === 'finish') record.finish = chunk.reason.kind
        yield chunk
      }
    } catch (error) {
      const reason = timeout.aborted
        ? `超时 ${this.timeoutMs}ms`
        : redact(error instanceof Error ? error.message : String(error))
      record.failure = reason
      record.finish = 'error'
      throw new Error(`anthropic-compat 真实调用失败（第 ${record.seq} 次）：${reason}`, { cause: error })
    } finally {
      record.ms = Date.now() - started
      record.textChars = text.length
      record.textSample = sample(text)
    }
  }
}

/** 阶段类型：`model` 由模型驱动，`mechanism` 断言本地机制 + 入口 probe。 */
export type StageKind = 'model' | 'mechanism'

interface StageBase {
  /** 稳定的阶段编号，例如 `M01.1`。 */
  id: string
  title: string
  kind: StageKind
  /**
   * 只对真实模式有意义的阶段（各模块 `run.ts` 内联的专项演示自带真实 turn / 真实路由消费，
   * 没有密钥就跑不起来）。mock 模式下打印一行 skip 而**不是**执行 —— 这样 `run.ts`
   * 的阶段清单在两个模式下是同一份，不需要各自维护。
   */
  realOnly?: boolean
}

/** 路径阶段保持独立场景文件；专项阶段可直接内联在对应模块的 run.ts。 */
export type StageSpec = StageBase & (
  | { path: string; run?: never }
  | { path?: never; run: () => void | Promise<void> }
)

/** 执行路径阶段或 run.ts 内联阶段。 */
async function executeStage(stage: StageSpec, base: string): Promise<void> {
  if (stage.path !== undefined) {
    await import(new URL(stage.path, base).href)
    return
  }
  await stage.run()
}

/**
 * 入口 probe：用本文件的完整装配链（全部服务 + 真实 agent-loop）
 * 打一次真实推理服务 请求。它证明的不是"HTTP 通了"，而是"这条装配链能把真实响应
 * 送回会话日志"——纯机制阶段因此也有真实证据，而不是只拼配置。
 */
async function probeAssembly(stageId: string): Promise<string> {
  const harness = await createHarness()
  try {
    const outcome = await harness.runTurn({
      // 复述型指令：模型没有拒答的理由，probe 因此只在链路真的断了时才失败。
      prompt: `请把下面这句话原样复述一遍，不要加任何别的内容：装配链已连通 ${stageId}`,
    })
    if (!outcome.text.trim()) {
      throw new Error(`阶段 ${stageId} 的入口 probe 没有拿到非空真实文本`)
    }
    return outcome.text
  } finally {
    await harness.dispose()
  }
}

/**
 * 驱动一个模块。**这是 12 个模块 `run.ts` 唯一的编排入口**，两个模式共用一份阶段清单：
 *
 *   - 默认（real）：每个阶段都必须留下真实调用证据，否则 fail loud。
 *     mechanism 阶段先做一次入口 probe（真实模型 + 完整装配），再跑本地机制断言；
 *     model 阶段直接跑脚本，脚本内部的 runTurn 已被路由到真实推理服务。
 *   - `--mock`：只跑不带 `realOnly` 的阶段 —— 正是原先 `run.ts` 逐个 `import()` 的那批。
 *     `realOnly` 阶段打印一行 skip，不执行、不联网、不需要密钥。
 *
 * 两个模式都按同一份清单打印阶段 banner，所以输出可以逐行对照。
 */
export async function runModule(
  module: string,
  title: string,
  stages: readonly StageSpec[],
  /** 调用方的 `import.meta.url`：阶段路径相对**模块目录**解析，而不是相对本文件。 */
  base: string,
): Promise<void> {
  if (!REAL_MODE) return runMockModule(module, title, stages, base)

  const config = realConfig()
  console.log(`\n████ ${module} · ${title} —— 真实推理服务 模式 ████`)
  console.log(`provider=${REAL_PROVIDER} model=${config.model} endpoint=<${ENDPOINT_LABEL}> timeout=${REAL_TIMEOUT_MS}ms`)
  console.log('（离线请用 --mock，例如 `npm run M01 -- --mock`）')

  let realStages = 0
  for (const stage of stages) {
    const before = evidence.length
    console.log(`\n════════ ${stage.id} · ${stage.title}（kind=${stage.kind}）════════`)
    if (stage.kind === 'mechanism') {
      const probe = await probeAssembly(stage.id)
      console.log(`  ↳ 入口 probe 真实回复: ${JSON.stringify(sample(probe, 40))}`)
    }
    await executeStage(stage, base)
    realStages += 1

    const slice = evidence.slice(before)
    const failures = slice.filter((item) => item.failure)
    if (failures.length > 0) {
      throw new Error(`REAL_STAGE_FAIL ${stage.id} 真实调用失败：${failures.map((item) => item.failure).join(' / ')}`)
    }
    if (slice.length === 0) {
      throw new Error(`REAL_STAGE_FAIL ${stage.id} 本阶段没有产生任何 推理服务调用证据（禁止把 mock 结果当真实验收）`)
    }
    const answered = slice.filter((item) => item.textChars > 0 || item.toolCalls.length > 0)
    if (answered.length === 0) {
      throw new Error(`REAL_STAGE_FAIL ${stage.id} 真实调用返回空文本且无工具调用`)
    }
    const best = answered[answered.length - 1]!
    const tools = slice.flatMap((item) => item.toolCalls)
    console.log(
      `REAL_STAGE_OK ${stage.id} kind=${stage.kind} provider=${REAL_PROVIDER} model=${config.model}`
      + ` calls=${slice.length} ms=${slice.reduce((sum, item) => sum + item.ms, 0)}`
      + ` in=${slice.reduce((sum, item) => sum + item.inputTokens, 0)}`
      + ` out=${slice.reduce((sum, item) => sum + item.outputTokens, 0)}`
      + ` finish=${best.finish} tools=${tools.length === 0 ? '-' : tools.join(',')}`
      + ` text="${sample(best.textSample, 48)}"`,
    )
  }

  const total = evidence.length
  const failed = evidence.filter((item) => item.failure).length
  console.log(`\nREAL_MODULE_OK ${module} stages=${realStages} calls=${total} failed=${failed}`)
}

/** mock 分支：只跑离线可跑的阶段，`realOnly` 阶段显式跳过。 */
async function runMockModule(
  module: string,
  title: string,
  stages: readonly StageSpec[],
  base: string,
): Promise<void> {
  console.log(`\n████ ${module} · ${title} —— 离线 mock 模式 ████`)
  console.log('provider=mock（不联网、不需要密钥；真实模式去掉 --mock）')

  let ran = 0
  let skipped = 0
  for (const stage of stages) {
    console.log(`\n════════ ${stage.id} · ${stage.title}（kind=${stage.kind}）════════`)
    if (stage.realOnly) {
      console.log('  ↳ 跳过：本阶段需要真实推理服务，离线 mock 模式不跑（去掉 --mock 即可执行）')
      skipped += 1
      continue
    }
    await executeStage(stage, base)
    ran += 1
  }

  console.log(`\nMOCK_MODULE_OK ${module} stages=${ran} skipped=${skipped}`)
}
