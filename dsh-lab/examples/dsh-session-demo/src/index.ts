/**
 * dsh-session-demo —— 会话日志六景，全部离线（脚本化适配器播种真实 turn）：
 *   S1 append-only 事件流的结构与 seq 不变量；
 *   S2 JSONL 落盘（flush 后文件真实出现，肉眼可读）；
 *   S3 live-preferred 会话列表；
 *   S4 标题投影（首条人类消息的规则回退）；
 *   S5 模型表面（历史折叠后的模型可见事件）；
 *   S6 从日志恢复（dispose → resume，身份与事件守恒）。
 * 会话日志是 dsh 的唯一事实来源：turn/step、消息、工具调用与结果全在同一条事件流里。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query-sqlite'
import * as wordCount from './plugins/word-count.ts'
import { ScriptedAdapter } from './plugins/scripted-adapter.ts'

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
  'dsh-session-demo', CONFIG,
  loadOverlayPatches('dsh-session-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const toolFiber = await ctx.plugin(wordCount)
const releaseAdapter = ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())

// 播种一条真实 turn：脚本第 1 步调 word_count，第 2 步给最终回答。
const sessionId = SessionId(`session-demo-${Date.now().toString(36)}`)
const handle = await ctx.agents.create({
  sessionId,
  meta: { cwd: process.cwd() },
  agentOptions: { provider: 'lab-scripted', model: 'seed' },
})
const agent = handle.agent
agent.followup(createUserMessage({
  content: [{ type: 'text', text: '统计一下这段文本的词数' }],
  source: { kind: 'user' },
}))
await agent.whenIdle()

// ── S1：日志结构与 seq 不变量 ──────────────────────────────────────────────
console.log('\n=== S1 日志结构与 seq 不变量 ===')
const snapshot = await ctx.sessionQuery.readSession(sessionId)
console.log(`事件数：${snapshot.events.length}`)
const types = new Map<string, number>()
for (const event of snapshot.events) types.set(event.type, (types.get(event.type) ?? 0) + 1)
console.log(`类型分布：${[...types].map(([type, count]) => `${type}×${count}`).join(', ')}`)
assert(snapshot.events.every((event, index) => event.seq === index), 'seq 必须从 0 开始连续递增')
console.log('seq 连续性校验通过（从 0 开始逐条 +1）')
assert(types.has('turn/start') && types.has('tool/call') && types.has('assistant/message'), '播种 turn 的事件不完整')

// ── S2：JSONL 落盘 ─────────────────────────────────────────────────────────
console.log('\n=== S2 JSONL 落盘 ===')
const flushed = await ctx.sessions.flush(agent.session)
console.log(`sessions.flush 返回：${flushed}`)
// 落盘文件在 .dsh-home/sessions 下按项目目录组织；递归找出本会话的 JSONL。
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.jsonl')) out.push(full)
  }
  return out
}
const files = walk(resolve(HOME, 'sessions'))
const mine = files.find(file => readFileSync(file, 'utf8').includes(String(sessionId)))
if (mine === undefined) throw new Error('断言失败：flush 之后应当找到本会话的 JSONL 文件')
const lines = readFileSync(mine, 'utf8').trim().split('\n')
console.log(`落盘文件：${relative(ROOT, mine)}（${lines.length} 行）`)
const firstRecord = JSON.parse(lines[0]!) as { type?: string; event?: { type?: string } }
console.log(`首行记录类型：${firstRecord.type ?? firstRecord.event?.type ?? '(见文件)'}`)
assert(lines.length >= snapshot.events.length, '落盘行数不应少于事件数')

// ── S3：live-preferred 会话列表 ────────────────────────────────────────────
console.log('\n=== S3 live-preferred 会话列表 ===')
const records = await ctx.sessionQuery.listSessions()
const record = records.find(row => String(row.header.id) === String(sessionId))
if (record === undefined) throw new Error('断言失败：会话应当出现在列表里')
console.log(`语料会话数：${records.length}（live ${records.filter(row => row.live).length} 条）`)
console.log(`本会话：live=${record.live} persisted=${record.persisted}`)
assert(record.live && record.persisted, '在位且已 flush 的会话应当 live 且 persisted')

// ── S4：标题投影（规则回退）────────────────────────────────────────────────
console.log('\n=== S4 标题投影 ===')
// 不挂 session-title-llm：标题来自首条人类消息的规则回退（fallbackMaxWords/Bytes）。
const title = await ctx.sessionQuery.readTitle(sessionId)
console.log(`当前标题：${title?.title ?? '(尚无)'}`)
assert(title !== undefined && title.title.length > 0, '规则回退应当产生标题')

// ── S5：模型表面 ───────────────────────────────────────────────────────────
console.log('\n=== S5 模型表面 ===')
const surface = await ctx.sessionQuery.readSurface(sessionId)
const surfaceTypes = new Map<string, number>()
for (const event of surface.events) surfaceTypes.set(event.type, (surfaceTypes.get(event.type) ?? 0) + 1)
console.log(`表面事件：${surface.events.length} 条（${[...surfaceTypes].map(([type, count]) => `${type}×${count}`).join(', ')}）`)
assert(surface.events.length > 0, '跑过真实 turn 的会话表面不应为空')
assert(!surfaceTypes.has('turn/start') && !surfaceTypes.has('tool/call'), '边界与调用事件不进模型表面')

// ── S6：从日志恢复 ─────────────────────────────────────────────────────────
console.log('\n=== S6 从日志恢复 ===')
const before = snapshot.events.length
await handle.dispose()
const resumed = await ctx.agents.resume({ resumeSessionId: sessionId })
try {
  const after = await ctx.sessionQuery.readSession(sessionId)
  console.log(`恢复后 agent 身份：${resumed.agent.id}（原 ${sessionId}）`)
  console.log(`事件数：恢复前 ${before} → 恢复后 ${after.events.length}`)
  assert(String(resumed.agent.id) === String(sessionId), '恢复出的 agent 身份应当与原会话一致')
  assert(after.events.length >= before, '恢复不应丢事件')
} finally {
  await resumed.dispose()
}

releaseAdapter()
await toolFiber.dispose()
await ctx.fiber.dispose()
console.log('\nSESSION_DEMO_OK')