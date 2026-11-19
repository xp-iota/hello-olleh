/**
 * dsh-perf-metrics-demo —— 流式性能与 token 统计，全部站在官方标准缝上：
 *   S1 TTFT / TPOT / 时延 totals：读 sessionStats 投影（dsh-session-stats）；
 *   S2 ITL 分布与 step 明细：expandAssistantStream() 还原持久化 chunk 时间戳；
 *   S3 turn 级 E2E：turn/start → turn/end 事件实际耗时；
 *   S4 token 累计 / 上下文压力 / 组成分解：token-meter 的三个投影 + measure()；
 *   S5 逐 turn 精确用量：deriveTurnTokenUsage()（可证明才给数，否则返回空）。
 * 时间戳与用量都是 dsh 落会话日志时就记好的，本示例不自己计时。
 * 事件流靠订阅 session/event 追加流拿到（不是回头读历史快照——同步读历史的
 * 接口上游已废弃），拿到的事件与落盘时逐字一致。
 *
 * 多轮测量：TTFT / E2E 的大头在 provider 侧（网关排队、prefill、推理模型的
 * 思考时长），单次运行的数字只是当时网关状态的快照。所以默认跑 PERF_ROUNDS
 * 轮（默认 3），每轮一个全新会话（排除上下文累积对 prefill 的干扰），轮内
 * 两条 turn（短回答 + 长正文）；S1–S5 以最后一轮为例展示读法，最后给出跨轮
 * 中位数与极差——跨运行时比较请看汇总，不要比单轮数字。
 * 需要 LLM_API_KEY（本目录 .env），缺 key 明确失败（fail loud）。Node 与 Bun 双运行时。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-stats'
import type {} from '@deepseek-ai/dsh-token-meter'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { loadDotEnv } from './env.ts'
import { foldStepTimings, foldTurnTimings, tpotMs } from './metrics.ts'
import type { StepTiming, TurnTiming } from './metrics.ts'

loadDotEnv()

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const key = process.env.LLM_API_KEY
if (key === undefined || key === '') {
  throw new Error(
    '缺少 LLM_API_KEY：本示例只跑真实模型调用，指标必须来自真实的流。' +
    '复制 .env.example 为 .env 并填入 key 后重跑。',
  )
}

// 测量轮数：每轮独立会话、两条真实 turn。轮数越多汇总越稳，真实调用成本也线性增长。
const roundsRaw = process.env.PERF_ROUNDS ?? '3'
const ROUNDS = Number(roundsRaw)
if (!Number.isInteger(ROUNDS) || ROUNDS < 1) {
  throw new Error(`PERF_ROUNDS 应当是 ≥1 的整数，收到：${roundsRaw}`)
}

const ctx = await boot(
  'dsh-perf-metrics-demo', CONFIG,
  loadOverlayPatches('dsh-perf-metrics-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(`断言失败：${message}`)
}

/** 毫秒格式化：小于 1s 显示 ms，否则显示 s（保留一位）。 */
function ms(value: number): string {
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`
}

/** 中位数：偶数个样本取中间两数平均。输入不需要预排序。 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const provider = process.env.DSH_MODEL_PROVIDER ?? 'anthropic-compat'
const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
console.log(`provider = ${provider}，model = ${model}，测量轮数 = ${ROUNDS}（PERF_ROUNDS 可调）`)

const SHORT_PROMPT = '用一句中文回答：流式输出为什么能改善对话体验？'
const LONG_PROMPT = '用中文写一段约 300 字的短文，主题：首 token 延迟与逐 token 间隔分别影响什么体验。不要调用工具，直接回答。'

/** 一轮的汇总事实：跨轮比较只通过这些数，不通过单轮的原始输出。 */
interface RoundFacts {
  readonly round: number
  readonly shortTtftMs: number
  readonly longTtftMs: number
  readonly longItlP50Ms: number | null
  readonly longItlP99Ms: number | null
  readonly longItlSamples: number
  readonly tpotMs: number
  readonly shortE2eMs: number
  readonly longE2eMs: number
}

/** 一轮的完整现场：S1–S5 的展示素材（取最后一轮）。 */
interface RoundDetail {
  readonly sessionId: SessionId
  readonly session: Parameters<typeof ctx.sessionProjections.snapshot>[0]
  readonly events: SessionEvent[]
  readonly steps: StepTiming[]
  readonly turns: TurnTiming[]
  readonly stats: NonNullable<ReturnType<typeof readStats>['stats']>
  readonly snapshot: ReturnType<typeof readStats>['snapshot']
  readonly sumTokens: number
}

function readStats(session: Parameters<typeof ctx.sessionProjections.snapshot>[0]) {
  const snapshot = ctx.sessionProjections.snapshot(session, [
    'sessionStats', 'tokenUsage', 'contextPressure', 'contextBreakdown',
  ])
  return { snapshot, stats: snapshot.values.sessionStats }
}

const facts: RoundFacts[] = []
let last: RoundDetail | undefined

for (let round = 1; round <= ROUNDS; round += 1) {
  // 每轮全新会话：上下文不跨轮累积，prefill 规模一致，轮与轮才可比。
  const sessionId = SessionId(`perf-metrics-r${round}-${Date.now().toString(36)}`)

  // 事件流：订阅 `session/event` 追加流，不回头读历史快照。
  //
  // 为什么不用一次性的全量快照：Session 上的同步历史读取接口已被上游废弃
  // （上游决策 deprecate-synchronous-session-event-reads：禁止新增同步读历史的调用，
  // 因为存储演进方向是不再把完整事件序列常驻内存）。订阅是上游认可的新缝：
  // `session/event` 在 Session.append() 内**同步**派发，事件与落盘时逐字一致
  // （同样带 time 与 data.stream），所以这里拿到的序列与原来的全量快照等价。
  const events: SessionEvent[] = []
  const offEvents = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(sessionId)) return
    events.push(event)
  })

  const handle = await ctx.agents.create({
    sessionId,
    meta: { cwd: process.cwd() },
    agentOptions: { provider, model },
  })
  const agent = handle.agent

  console.log(`\n── 轮 ${round}/${ROUNDS}（会话 ${sessionId}）──`)
  console.log('turn 1：短回答')
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: SHORT_PROMPT }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()

  console.log('turn 2：约 300 字短文（ITL 样本）')
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: LONG_PROMPT }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()

  // 每轮都做口径对账：自写折叠与官方投影的 totals 逐字相等（S2 的等式）。
  const { snapshot, stats } = readStats(agent.session)
  assert(stats !== undefined, '装配了 session-stats 就应当读到 sessionStats 键')
  const steps = foldStepTimings(events)
  const turns = foldTurnTimings(events)
  assert(stats.turns === 2 && stats.ttftSteps >= 2 && stats.ttftMs > 0, '两条 turn 都应当记到首 token')
  assert(steps.length === stats.steps, 'step 明细数应当与投影一致')
  assert(turns.length === 2 && turns.every(turn => turn.e2eMs > 0), '两条 turn 都应当闭合且耗时为正')
  const sumTtft = steps.reduce((sum, step) => sum + (step.ttftMs ?? 0), 0)
  const sumDecode = steps.reduce((sum, step) => sum + (step.decodeMs ?? 0), 0)
  const sumTokens = steps.reduce((sum, step) => sum + (step.outputTokens ?? 0), 0)
  assert(sumTtft === stats.ttftMs && sumDecode === stats.decodeMs && sumTokens === stats.decodeTokens,
    `自写折叠与官方投影不一致：ttft ${sumTtft}/${stats.ttftMs}，decode ${sumDecode}/${stats.decodeMs}，tokens ${sumTokens}/${stats.decodeTokens}`)
  const tpot = tpotMs(stats.decodeMs, stats.decodeTokens)
  assert(tpot !== null && tpot > 0, '真实 turn 应当有解码时间与输出 token')

  const shortStep = steps.find(step => step.turn === 1)
  const longStep = steps.find(step => step.turn === 2)
  assert(shortStep?.ttftMs != null && longStep?.ttftMs != null, '两条 turn 都应当有 TTFT')
  // ITL 样本数不设硬门槛：模型输出长短与 chunk 合并粒度都随机，样本不足时
  // 分位数如实报 null，不拿断言去逼 provider 多吐字。
  const shortTurn = turns.find(turn => turn.turn === 1)
  const longTurn = turns.find(turn => turn.turn === 2)
  assert(shortTurn !== undefined && longTurn !== undefined, '两条 turn 的 E2E 都应当折出')

  facts.push({
    round,
    shortTtftMs: shortStep.ttftMs,
    longTtftMs: longStep.ttftMs,
    longItlP50Ms: longStep.itl?.p50Ms ?? null,
    longItlP99Ms: longStep.itl?.p99Ms ?? null,
    longItlSamples: longStep.itl?.samples ?? 0,
    tpotMs: tpot,
    shortE2eMs: shortTurn.e2eMs,
    longE2eMs: longTurn.e2eMs,
  })
  console.log(`轮 ${round} 小结：短TTFT=${ms(shortStep.ttftMs)}  长TTFT=${ms(longStep.ttftMs)}  ` +
    `长ITL P50=${longStep.itl === null ? '样本不足' : ms(longStep.itl.p50Ms)} ` +
    `P99=${longStep.itl === null ? '-' : ms(longStep.itl.p99Ms)}（${longStep.itl?.samples ?? 0} 样本）  ` +
    `TPOT=${tpot.toFixed(1)}ms/token  E2E 短=${ms(shortTurn.e2eMs)} 长=${ms(longTurn.e2eMs)}（对账通过）`)

  last = { sessionId, session: agent.session, events, steps, turns, stats, snapshot, sumTokens }
  offEvents()
  await handle.dispose()
}

assert(last !== undefined, '至少应当完成一轮测量')
const { sessionId, session, events, steps, turns, stats, snapshot, sumTokens } = last

// ── S1：官方时延投影 sessionStats（以最后一轮为例）─────────────────────────
console.log(`\n=== S1 sessionStats 投影（官方口径，最后一轮 ${sessionId}）===`)
console.log(`turns=${stats.turns}  steps=${stats.steps}  llmMs=${ms(stats.llmMs)}  toolMs=${ms(stats.toolMs)}`)
console.log(`ttftMs=${ms(stats.ttftMs)}（${stats.ttftSteps} 个 step 有首 token，均值 ${ms(stats.ttftMs / Math.max(1, stats.ttftSteps))}）`)
console.log(`decodeMs=${ms(stats.decodeMs)}  decodeTokens=${stats.decodeTokens}`)
const tpot = tpotMs(stats.decodeMs, stats.decodeTokens)
assert(tpot !== null && tpot > 0, '真实 turn 应当有解码时间与输出 token')
console.log(`TPOT = decodeMs / decodeTokens = ${tpot.toFixed(1)}ms/token（吞吐 ${(1000 / tpot).toFixed(1)} token/s）`)

// ── S2：step 明细与 ITL 分布（持久化 chunk 时间戳）────────────────────────
console.log('\n=== S2 step 明细与 ITL 分布 ===')
console.log('  turn/step  TTFT      解码      输出token  ITL均值  P50     P99     最大    样本')
for (const step of steps) {
  const itl = step.itl
  console.log(
    `  ${step.turn}/${step.step}        ` +
    `${step.ttftMs === null ? '-' : ms(step.ttftMs).padEnd(9)} ` +
    `${step.decodeMs === null ? '-' : ms(step.decodeMs).padEnd(9)} ` +
    `${String(step.outputTokens ?? '-').padEnd(10)} ` +
    (itl === null
      ? '（正文 delta 不足两个，无间隔样本）'
      : `${ms(itl.meanMs).padEnd(8)} ${ms(itl.p50Ms).padEnd(7)} ${ms(itl.p99Ms).padEnd(7)} ${ms(itl.maxMs).padEnd(7)} ${itl.samples}`),
  )
}
console.log(`交叉校验通过：ΣTTFT=${ms(stats.ttftMs)}、Σ解码=${ms(stats.decodeMs)}、Σ输出token=${sumTokens} 与投影一致（每轮都断言）`)

// ── S3：turn 级 E2E ───────────────────────────────────────────────────────
console.log('\n=== S3 turn 级 E2E ===')
for (const turn of turns) {
  console.log(`  turn ${turn.turn}：E2E=${ms(turn.e2eMs)}（${turn.steps} 步）`)
}
const e2eTotal = turns.reduce((sum, turn) => sum + turn.e2eMs, 0)
console.log(`  ΣE2E=${ms(e2eTotal)} ≥ llmMs+toolMs=${ms(stats.llmMs + stats.toolMs)}（差额是循环与落日志开销）`)
assert(e2eTotal >= stats.llmMs + stats.toolMs, 'E2E 不应小于模型与工具时间之和')

// ── S4：token-meter 投影与请求压力测量 ────────────────────────────────────
console.log('\n=== S4 token 统计（token-meter）===')
const usage = snapshot.values.tokenUsage
assert(usage !== undefined, '装配了 token-meter 就应当读到 tokenUsage 键')
console.log(`会话累计：uncachedInput=${usage.uncachedInputTokens}  output=${usage.outputTokens}  cacheRead=${usage.cacheReadTokens}  cacheWrite=${usage.cacheWriteTokens}`)
assert(usage.outputTokens === sumTokens, 'tokenUsage 的输出累计应当与逐 step 求和一致')
const pressure = snapshot.values.contextPressure
assert(pressure?.pressureTokens !== undefined, '真实调用上报过 usage 就应当有 pressureTokens 键')
console.log(`上下文压力：pressureTokens=${pressure.pressureTokens}（最近一次请求的 prompt 实测）` +
  `  projectedTokens=${pressure.projectedTokens ?? '(尚无)'}（下次请求的锚定估计）` +
  `  contextWindow=${pressure.contextWindow ?? '(适配器未声明)'}`)
if (pressure.pressureTokens === 0) {
  console.log('  注意：本网关只在 message_delta 里报 output_tokens，不报 input_tokens；')
  console.log('  prompt 侧四桶里的 input/cache 因此为 0——这是上报事实，不是折叠错误。')
}
const breakdown = snapshot.values.contextBreakdown
assert(breakdown !== undefined, '应当读到 contextBreakdown 键')
console.log(`组成分解（启发式，只看构成不看总量）：system=${breakdown.systemTokens}  tools=${breakdown.toolsTokens}  messages=${breakdown.messageTokens}`)
const measurement = ctx.tokenMeter.measure(session)
console.log(`measure()：baseline=${measurement.baseline.kind}  totalTokens=${measurement.totalTokens}  surfaceTokens=${measurement.surfaceTokens}（${measurement.nodes.length} 个表面节点）`)
assert(measurement.totalTokens > 0, '跑过真实 turn 的请求压力应当为正')
if (measurement.baseline.kind !== 'usage') {
  console.log('  baseline 不是 usage：provider 上报不足以锚定（本网关缺 input 桶），退回启发式估计。')
}

// ── S5：逐 turn 精确用量（可证明才给数）───────────────────────────────────
console.log('\n=== S5 deriveTurnTokenUsage（逐 attempt 精确口径）===')
for (const turn of turns) {
  const start = events.findIndex(event => event.type === 'turn/start' && event.data.turn === turn.turn)
  const end = events.findIndex(event => event.type === 'turn/end' && event.data.turn === turn.turn)
  const turnEvents = events.slice(start, end + 1)
  const exact = deriveTurnTokenUsage(turnEvents)
  if (exact === undefined) {
    console.log(`  turn ${turn.turn}：undefined——usage 缺 totalTokens 且 cache 桶不全，精确口径无法证明（fail-loud 返回空，不猜）`)
  } else {
    console.log(`  turn ${turn.turn}：input=${exact.uncachedInputTokens}  output=${exact.outputTokens}  total=${exact.totalTokens}` +
      `  reasoning=${exact.reasoningTokens ?? '(未上报)'}  routes=${exact.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? '(未归属)'}`)
  }
}
console.log('  说明：精确口径要求权威 totalTokens，或 input 与 cache 双桶齐全；适配器如实转发上报，')
console.log('  端点报过 cache 桶时缺失桶按协议补实测 0。不报 input/cache 的端点（如 fuyao 网关）按契约返回空；可证明路径断言见 src/metrics.test.ts。')

// ── 跨轮汇总：中位数与极差（跨运行时比较看这里，不要比单轮数字）───────────
console.log(`\n=== 跨轮汇总（${ROUNDS} 轮独立会话，中位数 [最小–最大]）===`)
const summarize = (label: string, pick: (fact: RoundFacts) => number | null, unit: 'ms' | 'ms/token') => {
  const values = facts.map(pick).filter((value): value is number => value !== null)
  if (values.length === 0) {
    console.log(`  ${label.padEnd(14)} （${ROUNDS} 轮都样本不足，无间隔可统）`)
    return
  }
  const low = Math.min(...values)
  const high = Math.max(...values)
  const mid = median(values)
  const fmt = (value: number) => unit === 'ms' ? ms(value) : `${value.toFixed(1)}ms/token`
  console.log(`  ${label.padEnd(14)} ${fmt(mid)}  [${fmt(low)} – ${fmt(high)}]（${values.length}/${ROUNDS} 轮有样本）`)
}
summarize('短TTFT', fact => fact.shortTtftMs, 'ms')
summarize('长TTFT', fact => fact.longTtftMs, 'ms')
summarize('长ITL P50', fact => fact.longItlP50Ms, 'ms')
summarize('长ITL P99', fact => fact.longItlP99Ms, 'ms')
summarize('TPOT', fact => fact.tpotMs, 'ms/token')
summarize('短E2E', fact => fact.shortE2eMs, 'ms')
summarize('长E2E', fact => fact.longE2eMs, 'ms')
console.log(`  长ITL 样本数逐轮：${facts.map(fact => fact.longItlSamples).join(' / ')}（输出长短与 chunk 合并粒度都随机）`)
console.log('  读法：TTFT / E2E 的大头在 provider 侧（排队 / prefill / 思考时长），极差大是常态；')
console.log('  跨运行时比较看中位数是否同量级——ITL P50 与 TPOT 才是运行时敏感的稳态口径。')

await ctx.fiber.dispose()
console.log('\nPERF_METRICS_OK')