/**
 * dsh-trajectory-probe-demo —— Trajectory 探针，全部离线：
 *   S1 脚本化适配器播种两个 turn（工具步 + 回答步 / 纯回答步）；
 *   S2 foldTurns 折叠断言：turn 数、步数、工具数、token 用量全部对账；
 *   S3 渲染 trajectory：概览 + turn 大纲 + 逐事件明细；
 *   S4 模型表面视图：readSurface 折叠后模型实际看到什么；
 *   S5 dispose 之后从盘上渲染：flush 过的会话不依赖 live agent。
 * 探针的价值：turn 大纲、工具行、token 用量这些渲染路径，只有会话里真的跑过
 * turn 之后才有内容——播种空会话照不出折叠逻辑的 bug。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as wordCount from './plugins/word-count.ts'
import { ScriptedAdapter } from './plugins/scripted-adapter.ts'
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

const toolFiber = await ctx.plugin(wordCount)
const releaseAdapter = ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())

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

releaseAdapter()
await toolFiber.dispose()
await ctx.fiber.dispose()
console.log('\nTRAJ_PROBE_OK')