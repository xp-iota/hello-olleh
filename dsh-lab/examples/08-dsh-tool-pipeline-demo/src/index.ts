/**
 * dsh-tool-pipeline-demo —— 工具管线五段，全部离线、不经过模型：
 *   S1 注册与 effect 回收；
 *   S2 pre-execute 权限门（waterfall deny）；
 *   S3 post-execute 结果变换（waterfall accept）；
 *   S4 按 agent 收紧可见工具（scoped restrict 不外溢）；
 *   S5 单调守卫：只能拒绝，不能放行。
 * word-count 插件在 cordis.patch.yml 里声明（初始禁用），
 * 五个场景全部通过行句柄的 disabled 开关驱动，不编程式挂插件。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { SessionId } from '@deepseek-ai/dsh-session'
import { blocksToText, callTool, preview } from './tools.ts'

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
  'dsh-tool-pipeline-demo', CONFIG,
  loadOverlayPatches('dsh-tool-pipeline-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

// patch 清单里声明的 word-count 行：按 options.id 找行句柄，
// 场景只做开关，挂载与回收都交给 loader。
function wordCountRow(ctx: Context) {
  const entry = [...ctx.loader.entries()].find(row => row.options.id === 'word-count')
  if (!entry) throw new Error('cordis.patch.yml 里没有 id=word-count 的行')
  return entry
}

async function setWordCount(ctx: Context, enabled: boolean): Promise<void> {
  await wordCountRow(ctx).update({ disabled: !enabled })
  await ctx.loader.await()
}

// ── S1：注册与回收 ─────────────────────────────────────────────────────────
console.log('\n=== S1 注册工具与 effect 回收 ===')
const before = ctx.tools.schemas().map(schema => schema.name)
console.log(`启用前工具数：${before.length}（word-count 行初始禁用）`)
await setWordCount(ctx, true)
const after = ctx.tools.schemas().map(schema => schema.name)
assert(after.includes('word_count'), 'word_count 未出现在可见工具里')
console.log(`启用后新增：${after.filter(n => !before.includes(n)).join(', ')}`)
const first = await callTool(ctx, 'word_count', { text: 'DeepSeek Harness 里每一次工具调用都是可观察的' })
assert(!first.isError, `工具调用失败：${first.content}`)
console.log(`调用结果：${first.content}`)
await setWordCount(ctx, false)
const recycled = ctx.tools.schemas().map(schema => schema.name)
assert(!recycled.includes('word_count'), '禁用之后工具仍在')
console.log(`禁用后工具集合已回收（${recycled.length} 个）`)

// ── S2：pre-execute 拒绝 ───────────────────────────────────────────────────
console.log('\n=== S2 pre-execute 权限门 ===')
await setWordCount(ctx, true)
// pre-execute 是 waterfall：返回决定就"认领"，调用 next() 交给下一个监听。
// 注意：监听器挂在根 ctx 上，不随插件 fiber 销毁——必须拿 off 句柄手动解除，
// 否则 S2 的 deny 会泄漏到后续场景。
const offPre = ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name === 'word_count') {
    console.log(`pre-execute 拦截 ${exec.name}`)
    return { kind: 'deny', reason: '本场景规定：word_count 一律拒绝' }
  }
  return next()
})
const denied = await callTool(ctx, 'word_count', { text: 'should be denied' })
assert(denied.isError, 'deny 之后调用不应成功')
console.log(`模型看到的拒绝原因：${denied.content}`)
offPre()
await setWordCount(ctx, false)

// ── S3：post-execute 追加说明 ──────────────────────────────────────────────
console.log('\n=== S3 post-execute 结果变换 ===')
await setWordCount(ctx, true)
const offPost = ctx.on('tools/post-execute', async (exec, result, next) => {
  if (exec.name !== 'word_count') return next()
  // accept 的 content 字段整段替换模型可见内容。
  return {
    kind: 'accept',
    content: [...result.content, { type: 'text', text: '（本次结果由 post-execute 监听补充说明）' }],
  }
})
const appended = await callTool(ctx, 'word_count', { text: 'one two three' })
assert(appended.content.includes('post-execute'), 'post-execute 的补充没有出现在结果里')
console.log(`返回内容：${appended.content}`)
offPost()
await setWordCount(ctx, false)

// ── S4：按 agent 收紧可见工具 ──────────────────────────────────────────────
console.log('\n=== S4 按 agent 收紧可见工具 ===')
await setWordCount(ctx, true)
const all = ctx.tools.schemas().map(schema => schema.name)
console.log(`全局可见工具数：${all.length}`)
const handle = await ctx.agents.create({
  sessionId: SessionId(`pipeline-restrict-${Date.now().toString(36)}`),
  meta: { cwd: process.cwd() },
  setup: agentCtx => {
    // scoped 收紧只影响这个 agent 的下一轮装配。
    agentCtx.tools.restrict({ allow: ['word_count'] })
  },
})
const scoped = ctx.tools.schemas(handle.agent).map(schema => schema.name)
console.log(`该 agent 可见：${scoped.join(', ')}（${scoped.length} 个）`)
assert(scoped.length === 1 && scoped[0] === 'word_count', '收紧后的工具集合不符预期')
const stillAll = ctx.tools.schemas().map(schema => schema.name)
assert(stillAll.length === all.length, '全局工具集合被 scoped 收紧影响了')
console.log(`全局仍为 ${stillAll.length} 个（scoped 收紧不外溢）`)
await handle.dispose()
await setWordCount(ctx, false)

// ── S5：单调守卫 ───────────────────────────────────────────────────────────
console.log('\n=== S5 单调守卫：只能拒绝，不能放行 ===')
await setWordCount(ctx, true)
// 先让 pre-execute 放行，再由 guard 拒绝：证明 guard 不能被 allow 覆盖。
const offAllow = ctx.on('tools/pre-execute', async (_exec, next) => next())
const removeGuard = ctx.tools.guard(exec =>
  exec.name === 'word_count' ? '守卫禁止：word_count 在本场景不可用' : undefined,
)
const blocked = await callTool(ctx, 'word_count', { text: 'blocked by guard' })
assert(blocked.isError, 'guard 拒绝之后调用不应成功')
console.log(`guard 的拒绝原因：${preview(blocksToText(blocked.content))}`)
removeGuard()
const allowed = await callTool(ctx, 'word_count', { text: 'allowed again' })
assert(!allowed.isError, '移除 guard 后应当恢复')
console.log(`移除 guard 后恢复：${allowed.content}`)
offAllow()
await setWordCount(ctx, false)

await ctx.fiber.dispose()
console.log('\nTOOL_PIPELINE_OK')