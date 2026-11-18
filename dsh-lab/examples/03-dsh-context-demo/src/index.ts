/**
 * dsh-context-demo —— 上下文装配与经济学，六个场景全部离线：
 *   S1 system prompt 的 section 装配与可逆注册；
 *   S2 变量插值与未定义变量的严格失败；
 *   S3 token 估算（estimateContent）；
 *   S4 超长工具结果裁剪（tool-result-pruner 真实触发）；
 *   S5 大输出溢写（spill-policy 真实触发，第二棵树禁用 pruner）；
 *   S6 会话历史折叠为模型表面（sessionQuery.readSurface）。
 * big-text 工具在 cordis.patch.yml 里声明，两棵树都带上，S5 在第二棵树上调用。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolResultMessage } from '@deepseek-ai/dsh-session'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import type {} from '@deepseek-ai/dsh-session-query-sqlite'
import { makeText } from './plugins/big-text.ts'
import { callTool, preview } from './tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')
const NOPRUNE = resolve(ROOT, 'cordis.noprune.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const patches = () => loadOverlayPatches('dsh-context-demo', PATCH)
const ctx = await boot('dsh-context-demo', CONFIG, patches(), undefined, BASE_URL)

// ── S1：section 装配 ───────────────────────────────────────────────────────
console.log('\n=== S1 system prompt：section 装配与可逆注册 ===')
const removeSection = ctx.systemPrompt.section({
  name: 'demo:context',
  order: 1500,
  text: '本节由运行时注册：dsh 把 System Prompt 的每一段都当作可寻址的贡献。',
})
const assembly = await ctx.systemPrompt.assemble()
console.log(`section 数：${assembly.sections.length}`)
for (const section of assembly.sections.slice(0, 8)) {
  console.log(`  [${section.name}] order=${(section as { order?: number }).order ?? '?'}`)
}
assert(assembly.sections.some(s => s.name === 'demo:context'), '运行时注册的 section 未出现在装配结果里')
console.log(`工具 schema 数：${assembly.tools.length}`)
removeSection()
const after = await ctx.systemPrompt.assemble()
assert(!after.sections.some(s => s.name === 'demo:context'), '移除 section 后仍在')
console.log('移除后 section 已消失（注册是可逆 effect）')

// ── S2：变量插值与严格校验 ─────────────────────────────────────────────────
console.log('\n=== S2 变量插值：装配期求值，未定义变量直接抛错 ===')
const removeVariable = ctx.systemPrompt.variable('demo_stage', () => 'S2')
const removeVarSection = ctx.systemPrompt.section({
  name: 'demo:variable',
  order: 1501,
  text: '当前场景：{{demo_stage}}。这句话里的变量在装配期插值。',
})
const rendered = renderPrompt(await ctx.systemPrompt.assemble())
assert(rendered.includes('当前场景：S2'), '变量没有插值进 System Prompt')
console.log(`插值成功：${rendered.includes('当前场景：S2')}`)
const removeBroken = ctx.systemPrompt.section({
  name: 'demo:broken',
  order: 1502,
  text: '未定义变量：{{demo_missing}}',
})
let threw = false
try {
  renderPrompt(await ctx.systemPrompt.assemble())
} catch (error) {
  threw = true
  console.log(`未定义变量按预期报错：${error instanceof Error ? error.message.slice(0, 80) : ''}`)
}
assert(threw, '未定义变量应当让渲染失败')
removeBroken()
removeVarSection()
removeVariable()

// ── S3：token 估算 ─────────────────────────────────────────────────────────
console.log('\n=== S3 token 估算：estimateContent ===')
const shortText = makeText(50)
const longText = makeText(3000)
const shortTokens = estimateContent([{ type: 'text', text: shortText }])
const longTokens = estimateContent([{ type: 'text', text: longText }])
console.log(`50 词（${shortText.length} 字符）≈ ${shortTokens} token`)
console.log(`3000 词（${longText.length} 字符）≈ ${longTokens} token`)
assert(longTokens > shortTokens, '更长的文本应当估算出更多 token')

// ── S4：裁剪超长工具结果（pruner 是会话表面服务，不是 post-execute 监听）─────
console.log('\n=== S4 tool-result-pruner：真实触发会话表面裁剪 ===')
const handle4 = await ctx.agents.create({
  sessionId: SessionId(`context-prune-${Date.now().toString(36)}`),
  meta: { cwd: process.cwd() },
})
const session4 = handle4.agent.session
const callId = ToolCallId(`demo-prune-${Date.now().toString(36)}`)
const bigMessage: ToolResultMessage = {
  id: MessageId(`demo-prune-msg-${Date.now().toString(36)}`),
  role: 'tool',
  toolCallId: callId,
  isError: false,
  source: { kind: 'tool', callId },
  content: [{ type: 'text', text: longText }],
}
session4.append('tool/result', { turn: 0, step: 0, message: bigMessage }, { surfaceOp: 'append' })
const pruneResult = ctx.toolResultPruner.pruneSession(session4)
console.log(`pruned 条数：${pruneResult.pruned.length}，charsRemoved = ${pruneResult.charsRemoved}`)
for (const p of pruneResult.pruned) {
  console.log(`  seq ${p.originalSeq} → ${p.replacementSeq}：${p.charsBefore} → ${p.charsAfter} 字符`)
}
assert(pruneResult.pruned.length === 1 && pruneResult.charsRemoved > 0, '裁剪没有发生')
await handle4.dispose()

// ── S6：会话模型表面（在 ctx 上，先于第二棵树）─────────────────────────────
console.log('\n=== S6 会话历史折叠为模型表面 ===')
const handle = await ctx.agents.create({
  sessionId: SessionId(`context-surface-${Date.now().toString(36)}`),
  meta: { cwd: process.cwd() },
})
const surface = await ctx.sessionQuery.readSurface(handle.agent.session.id)
console.log(`会话 ${handle.agent.session.id} 的模型表面事件：${surface.events.length} 条`)
await handle.dispose()
await ctx.fiber.dispose()

// ── S5：大输出溢写（第二棵树：禁用 pruner）─────────────────────────────────
console.log('\n=== S5 spill-policy：真实触发溢写（第二棵树禁用 pruner）===')
const ctxB = await boot(
  'dsh-context-demo', CONFIG,
  [...patches(), ...loadOverlayPatches('dsh-context-demo', NOPRUNE)],
  undefined, BASE_URL,
)
// big_text 工具由 patch 清单声明，boot 后已在位。
// spill 需要会话 owner（exec.agent.session.header.id）：不传 agent 会 warn 并保留内联内容。
const handleB = await ctxB.agents.create({
  sessionId: SessionId(`context-spill-${Date.now().toString(36)}`),
  meta: { cwd: process.cwd() },
})
const huge = await callTool(ctxB, 'big_text', { size: 'huge' }, handleB.agent)
assert(!huge.isError, `huge 调用失败：${huge.content}`)
const hugeOriginal = makeText(16000)
console.log(`原始文本 ${hugeOriginal.length} 字符 → 模型可见 ${huge.content.length} 字符`)
console.log(`模型可见头部：${preview(huge.content, 80)}`)
console.log(`模型可见尾部：${preview(huge.content.slice(-260), 260)}`)
// spill 的保留策略是"头尾 + 溢写通知"，内联预算 maxInlineTokens 内的内容仍保留，
// 所以压缩比不是数量级而是"超出预算的部分落盘"。
assert(huge.content.length < hugeOriginal.length, '溢写没有发生')
const pathMatch = huge.content.match(/[A-Za-z]:[\\/][^\s'"]+|\/[^\s'"]+spill[^\s'"]*/)
assert(pathMatch !== null, '溢写通知里没有文件路径')
const spilled = pathMatch![0].replace(/[.'")\]]+$/, '')
console.log(`溢写文件存在 = ${existsSync(spilled)}（${spilled}）`)
assert(existsSync(spilled), '溢写文件应当落盘')
await handleB.dispose()
await ctxB.fiber.dispose()

console.log('\nCONTEXT_DEMO_OK')