/**
 * real.ts —— 真实运行模式（`DSH_REAL=1`）的公共设施。
 *
 * 离线模式与真实模式的分界只有一条：**真实模式下每一个阶段都必须产生至少一次
 * MiniMax 调用证据**，否则阶段失败、进程非零退出。这条纪律避免把 mock 结果
 * 当成真实推理来验收。
 *
 * 本文件提供四样东西：
 *   1. `realConfig()`  —— 读取并校验 MiniMax 配置，缺密钥时立即失败并说明配置来源；
 *   2. `CountingMinimaxAdapter` —— 包住真实适配器，加上超时、调用计数与调用证据；
 *   3. `redact()`      —— 输出前脱敏（密钥、endpoint、绝对路径一律不出现在证据里）；
 *   4. `runRealModule()` —— 按阶段清单驱动一个模块的真实运行，逐阶段打印 REAL_STAGE_OK。
 *
 * 证据里刻意**不含** URL、请求头、文件路径与密钥：它要能直接贴进课程材料。
 */
import './env.ts'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MinimaxAnthropicAdapter } from './llm-minimax.ts'

/** 真实模式开关。只有显式 `DSH_REAL=1` 才算真实验收，`npm run all` 不受影响。 */
export const REAL_MODE = process.env.DSH_REAL === '1'

/** 单次模型调用的墙钟上限；超时按失败计，不按"跳过"计。 */
export const REAL_TIMEOUT_MS = Number(process.env.DSH_REAL_TIMEOUT_MS ?? 120_000)

/** 真实模式固定的 provider 路由名。 */
export const REAL_PROVIDER = 'minimax-m3'

/** 证据里用来代替真实 endpoint 的稳定占位符。 */
const ENDPOINT_LABEL = 'minimax-anthropic-compat'

export interface RealConfig {
  apiKey: string
  baseUrl: string
  model: string
}

let cached: RealConfig | undefined

/**
 * 读取真实 provider 配置。缺密钥时**立即失败**并说明该去哪里配 ——
 * 真实模式不允许静默退回 mock。
 */
export function realConfig(): RealConfig {
  if (cached) return cached
  const apiKey = process.env.MINIMAX_API_KEY
  if (!apiKey) {
    throw new Error([
      '真实模式缺少 MINIMAX_API_KEY。',
      '配置来源：工程根 dsh-example/.env（模板见 .env.example，该文件已被 .gitignore 忽略）。',
      '需要三项：MINIMAX_API_KEY / MINIMAX_BASE_URL / MINIMAX_MODEL。',
      '也可临时注入：MINIMAX_API_KEY=<your-key> npm run real:all',
    ].join('\n  '))
  }
  cached = {
    apiKey,
    baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com/anthropic',
    model: process.env.MINIMAX_MODEL ?? 'MiniMax-M3',
  }
  return cached
}

/** 输出脱敏：密钥、endpoint、绝对路径都不进证据。 */
export function redact(value: string): string {
  let out = value
  const key = process.env.MINIMAX_API_KEY
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
 * 包住真实 MiniMax 适配器：加超时、计数、证据与失败原因。
 * 它本身仍是真实 `LlmAdapter` 子类，chunk 一条不改地透传给 agent-loop，
 * 所以真实响应会照常进入工具管线、会话日志和后续 step。
 */
export class CountingMinimaxAdapter extends LlmAdapter {
  private readonly inner: MinimaxAnthropicAdapter
  private readonly model: string
  private readonly timeoutMs: number

  constructor(config: RealConfig, timeoutMs = REAL_TIMEOUT_MS) {
    super()
    this.inner = new MinimaxAnthropicAdapter({
      apiKey: config.apiKey,
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
      throw new Error(`minimax 真实调用失败（第 ${record.seq} 次）：${reason}`, { cause: error })
    } finally {
      record.ms = Date.now() - started
      record.textChars = text.length
      record.textSample = sample(text)
    }
  }
}

/** 阶段类型：`model` 由模型驱动，`mechanism` 断言本地机制 + 入口 probe。 */
export type StageKind = 'model' | 'mechanism'

export interface StageSpec {
  /** 稳定的阶段编号，例如 `M01.1`。 */
  id: string
  title: string
  kind: StageKind
  /** 相对模块目录的阶段脚本路径。 */
  path: string
}

/**
 * 入口 probe：用**完整装配链**（runtime/harness.ts 的全部服务 + 真实 agent-loop）
 * 打一次真实 MiniMax 请求。它证明的不是"HTTP 通了"，而是"这条装配链能把真实响应
 * 送回会话日志"——纯机制阶段因此也有真实证据，而不是只拼配置。
 */
async function probeAssembly(stageId: string): Promise<string> {
  const { createHarness } = await import('./harness.ts')
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
 * 驱动一个模块的真实运行。每个阶段：
 *   - mechanism：先做一次入口 probe（真实模型 + 完整装配），再跑本地机制断言；
 *   - model    ：直接跑阶段脚本，脚本内部的 runTurn 已被路由到真实 MiniMax。
 * 阶段结束后校验"这一段确实发生过成功的 MiniMax 调用"，否则 fail loud。
 */
export async function runRealModule(
  module: string,
  title: string,
  stages: readonly StageSpec[],
  /** 调用方的 `import.meta.url`：阶段路径相对**模块目录**解析，而不是相对本文件。 */
  base: string,
): Promise<void> {
  if (!REAL_MODE) {
    throw new Error(`真实模式入口必须带 DSH_REAL=1（例如 npm run ${module}:real）`)
  }
  const config = realConfig()
  console.log(`\n████ ${module} · ${title} —— 真实 MiniMax 模式 ████`)
  console.log(`provider=${REAL_PROVIDER} model=${config.model} endpoint=<${ENDPOINT_LABEL}> timeout=${REAL_TIMEOUT_MS}ms`)

  for (const stage of stages) {
    const before = evidence.length
    console.log(`\n════════ ${stage.id} · ${stage.title}（kind=${stage.kind}）════════`)
    let probe = ''
    if (stage.kind === 'mechanism') {
      probe = await probeAssembly(stage.id)
      console.log(`  ↳ 入口 probe 真实回复: ${JSON.stringify(sample(probe, 40))}`)
    }
    await import(new URL(stage.path, base).href)

    const slice = evidence.slice(before)
    const failures = slice.filter((item) => item.failure)
    if (failures.length > 0) {
      throw new Error(`REAL_STAGE_FAIL ${stage.id} 真实调用失败：${failures.map((item) => item.failure).join(' / ')}`)
    }
    if (slice.length === 0) {
      throw new Error(`REAL_STAGE_FAIL ${stage.id} 本阶段没有产生任何 MiniMax 调用证据（禁止把 mock 结果当真实验收）`)
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
  console.log(`\nREAL_MODULE_OK ${module} stages=${stages.length} calls=${total} failed=${failed}`)
}
