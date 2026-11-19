/**
 * metrics.ts —— 官方 sessionStats 投影没有覆盖的三个指标，纯函数折叠：
 *   ITL（逐 token 间隔）：expandAssistantStream() 把持久化的压缩 chunk 记录
 *     无损展开成带时间戳的 delta，取相邻 text-delta 的间隔做分布；
 *   step 级明细：每个 step 的 TTFT / 解码时间 / 输出 token / ITL，
 *     边界口径与官方投影逐字对齐（step/start → 首个非空 delta → assistant/message）；
 *   turn 级 E2E：turn/start → turn/end 的事件实际耗时。
 * 全部输入都是会话事件流本身——不打时间戳，时间戳是 dsh 落日志时就记好的
 * （TimedStreamChunk），这里只做还原与统计。纯函数，可单独断言。
 */
import { assistantStreamFirstTokenTime, expandAssistantStream } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** ITL 分布：相邻 text-delta 间隔的样本数与分位。 */
export interface ItlStats {
  readonly samples: number
  readonly meanMs: number
  readonly p50Ms: number
  readonly p99Ms: number
  readonly maxMs: number
}

/** 一个 step 的时延明细；null 表示该 step 没有对应事实（如无首 token）。 */
export interface StepTiming {
  readonly turn: number
  readonly step: number
  readonly ttftMs: number | null
  readonly decodeMs: number | null
  readonly outputTokens: number | null
  readonly itl: ItlStats | null
}

/** 一个 turn 的端到端实际耗时与步数。 */
export interface TurnTiming {
  readonly turn: number
  readonly e2eMs: number
  readonly steps: number
}

/** 最近秩法分位数：输入必须已升序排列。 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile：空样本')
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index]!
}

/**
 * 一条 assistant 流的 ITL 分布。
 *
 * 只取 text-delta（可见正文的解码间隔）：reasoning-delta 是思考块，
 * tool-call-delta 是参数 JSON，都不属于"逐 token 出正文"的体验口径。
 * 不足两个 delta 就没有间隔可言，返回 null。
 */
export function itlOfStream(stream: readonly AssistantStreamRecord[]): ItlStats | null {
  const times: number[] = []
  for (const timed of expandAssistantStream(stream)) {
    if (timed.chunk.type === 'text-delta') times.push(timed.time)
  }
  if (times.length < 2) return null
  const gaps: number[] = []
  for (let index = 1; index < times.length; index += 1) {
    gaps.push(Math.max(0, times[index]! - times[index - 1]!))
  }
  gaps.sort((a, b) => a - b)
  const meanMs = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
  return {
    samples: gaps.length,
    meanMs,
    p50Ms: percentile(gaps, 50),
    p99Ms: percentile(gaps, 99),
    maxMs: gaps[gaps.length - 1]!,
  }
}

/** usage 里的输出 token 数；缺席或非法返回 null（与官方投影同一守卫）。 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * 逐 step 时延明细。边界口径与 sessionStats 投影一致：
 * TTFT = step/start → 首个非空 delta（assistant/attempt 先到先记，跨重试保留）；
 * 解码 = 首 token → assistant/message；输出 token 取该消息的 usage。
 * ITL 用 assistant/message 携带的完整流（attempt 可能只是重试前的一段）。
 */
export function foldStepTimings(events: readonly SessionEvent[]): StepTiming[] {
  const out: StepTiming[] = []
  const open = new Map<string, { turn: number; step: number; startTime: number; firstTokenTime: number | null }>()
  const keyOf = (turn: number, step: number) => `${turn}:${step}`
  for (const event of events) {
    const data = (event as { data?: Record<string, unknown> }).data ?? {}
    const turn = Number(data.turn)
    const step = Number(data.step)
    switch (event.type) {
      case 'step/start':
        open.set(keyOf(turn, step), { turn, step, startTime: event.time, firstTokenTime: null })
        break
      case 'assistant/attempt': {
        const current = open.get(keyOf(turn, step))
        if (current === undefined || current.firstTokenTime !== null) break
        const stream = data.stream as readonly AssistantStreamRecord[] | undefined
        const first = stream === undefined ? undefined : assistantStreamFirstTokenTime(stream)
        if (first !== undefined) current.firstTokenTime = first
        break
      }
      case 'assistant/message': {
        const current = open.get(keyOf(turn, step))
        if (current === undefined) break
        open.delete(keyOf(turn, step))
        const stream = data.stream as readonly AssistantStreamRecord[] | undefined
        const firstToken = current.firstTokenTime
          ?? (stream === undefined ? undefined : assistantStreamFirstTokenTime(stream))
          ?? null
        const outputTokens = usageOutputTokens(data.usage)
        out.push({
          turn,
          step,
          ttftMs: firstToken === null ? null : Math.max(0, firstToken - current.startTime),
          decodeMs: firstToken === null ? null : Math.max(0, event.time - firstToken),
          outputTokens,
          itl: stream === undefined ? null : itlOfStream(stream),
        })
        break
      }
      default:
        break
    }
  }
  return out
}

/** turn 级 E2E：turn/start → turn/end 的实际耗时；未闭合的 turn 不计。 */
export function foldTurnTimings(events: readonly SessionEvent[]): TurnTiming[] {
  const out: TurnTiming[] = []
  const open = new Map<number, { startTime: number; steps: number }>()
  for (const event of events) {
    const data = (event as { data?: Record<string, unknown> }).data ?? {}
    const turn = Number(data.turn)
    switch (event.type) {
      case 'turn/start':
        open.set(turn, { startTime: event.time, steps: 0 })
        break
      case 'step/start': {
        const current = open.get(turn)
        if (current !== undefined) current.steps += 1
        break
      }
      case 'turn/end': {
        const current = open.get(turn)
        if (current === undefined) break
        open.delete(turn)
        out.push({ turn, e2eMs: Math.max(0, event.time - current.startTime), steps: current.steps })
        break
      }
      default:
        break
    }
  }
  return out
}

/**
 * TPOT（每输出 token 平均耗时）= 解码实际耗时 ÷ provider 报告的输出 token。
 * 注意口径：outputTokens 含 thinking token，而解码实际耗时覆盖整段生成，
 * 所以这是"混合口径"的 averages；纯正文的逐 token 体验看 ITL。
 */
export function tpotMs(decodeMs: number, decodeTokens: number): number | null {
  return decodeTokens > 0 ? decodeMs / decodeTokens : null
}