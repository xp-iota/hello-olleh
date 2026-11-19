/**
 * dsh-perf-metrics-demo —— 流式性能与 token 统计，全部站在官方标准缝上：
 *   S1 TTFT / TPOT / 时延 totals：读 sessionStats 投影（dsh-session-stats）；
 *   S2 ITL 分布与 step 明细：expandAssistantStream() 还原持久化 chunk 时间戳；
 *   S3 turn 级 E2E：turn/start → turn/end 事件墙钟；
 *   S4 token 累计 / 上下文压力 / 组成分解：token-meter 的三个投影 + measure()；
 *   S5 逐 turn 精确用量：deriveTurnTokenUsage()（可证明才给数，否则返回空）。
 * 时间戳与用量都是 dsh 落会话日志时就记好的，本示例不挂监听器、不自己计时。
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
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-stats'
import type {} from '@deepseek-ai/dsh-token-meter'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { loadDotEnv } from './env.ts'
import { foldStepTimings, foldTurnTimings, tpotMs } from './metrics.ts'

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

const provider = process.env.DSH_MODEL_PROVIDER ?? 'anthropic-compat'
const model = process.env.LLM_MODEL ?? 'MiniMax-M3'
console.log(`provider = ${provider}，model = ${model}`)

// 两条真实 turn：第一条短回答（TTFT 为主），第二条长正文（ITL 样本充足）。
const sessionId = SessionId(`perf-metrics-${Date.now().toString(36)}`)
const handle = await ctx.agents.create({
  sessionId,
  meta: { cwd: process.cwd() },
  agentOptions: { provider, model },
})
const agent = handle.agent

console.log('\nturn 1：短回答')
agent.followup(createUserMessage({
  content: [{ type: 'text', text: '用一句中文回答：流式输出为什么能改善对话体验？' }],
  source: { kind: 'user' },
}))
await agent.whenIdle()

console.log('turn 2：约 300 字短文（ITL 样本）')
agent.followup(createUserMessage({
  content: [{
    type: 'text',
    text: '用中文写一段约 300 字的短文，主题：首 token 延迟与逐 token 间隔分别影响什么体验。不要调用工具，直接回答。',
  }],
  source: { kind: 'user' },
}))
await agent.whenIdle()

const events = agent.session.snapshotEvents()
console.log(`\n会话 ${sessionId}：${events.length} 条事件`)

// ── S1：官方时延投影 sessionStats ─────────────────────────────────────────
console.log('\n=== S1 sessionStats 投影（官方口径）===')
const snapshot = ctx.sessionProjections.snapshot(agent.session, [
  'sessionStats', 'tokenUsage', 'contextPressure', 'contextBreakdown',
])
const stats = snapshot.values.sessionStats
assert(stats !== undefined, '装配了 session-stats 就应当读到 sessionStats 键')
console.log(`turns=${stats.turns}  steps=${stats.steps}  llmMs=${ms(stats.llmMs)}  toolMs=${ms(stats.toolMs)}`)
console.log(`ttftMs=${ms(stats.ttftMs)}（${stats.ttftSteps} 个 step 有首 token，均值 ${ms(stats.ttftMs / Math.max(1, stats.ttftSteps))}）`)
console.log(`decodeMs=${ms(stats.decodeMs)}  decodeTokens=${stats.decodeTokens}`)
const tpot = tpotMs(stats.decodeMs, stats.decodeTokens)
assert(tpot !== null && tpot > 0, '真实 turn 应当有解码时间与输出 token')
console.log(`TPOT = decodeMs / decodeTokens = ${tpot.toFixed(1)}ms/token（吞吐 ${(1000 / tpot).toFixed(1)} token/s）`)
assert(stats.turns === 2 && stats.ttftSteps >= 2 && stats.ttftMs > 0, '两条 turn 都应当记到首 token')

// ── S2：step 明细与 ITL 分布（持久化 chunk 时间戳）────────────────────────
console.log('\n=== S2 step 明细与 ITL 分布 ===')
const steps = foldStepTimings(events)
assert(steps.length === stats.steps, 'step 明细数应当与投影一致')
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
// 交叉校验：同一份事件流，自写折叠与官方投影的 totals 必须逐字相等。
const sumTtft = steps.reduce((sum, step) => sum + (step.ttftMs ?? 0), 0)
const sumDecode = steps.reduce((sum, step) => sum + (step.decodeMs ?? 0), 0)
const sumTokens = steps.reduce((sum, step) => sum + (step.outputTokens ?? 0), 0)
assert(sumTtft === stats.ttftMs && sumDecode === stats.decodeMs && sumTokens === stats.decodeTokens,
  `自写折叠与官方投影不一致：ttft ${sumTtft}/${stats.ttftMs}，decode ${sumDecode}/${stats.decodeMs}，tokens ${sumTokens}/${stats.decodeTokens}`)
console.log(`交叉校验通过：ΣTTFT=${ms(sumTtft)}、Σ解码=${ms(sumDecode)}、Σ输出token=${sumTokens} 与投影一致`)
const longStep = steps.find(step => step.itl !== null && step.itl.samples >= 10)
assert(longStep !== undefined, '长回答应当产出至少 10 个 ITL 样本')

// ── S3：turn 级 E2E ───────────────────────────────────────────────────────
console.log('\n=== S3 turn 级 E2E ===')
const turns = foldTurnTimings(events)
assert(turns.length === 2 && turns.every(turn => turn.e2eMs > 0), '两条 turn 都应当闭合且耗时为正')
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
const measurement = ctx.tokenMeter.measure(agent.session)
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
console.log('  说明：anthropic-compat 副本不上报 totalTokens，cache 桶仅在 >0 时携带；')
console.log('  网关若两者都没给，deriveTurnTokenUsage 按契约返回空。可证明路径的完整断言见 src/metrics.test.ts。')

await handle.dispose()
await ctx.fiber.dispose()
console.log('\nPERF_METRICS_OK')