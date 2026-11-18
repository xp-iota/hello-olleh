/**
 * dsh-guardrail-demo —— 自写安全护栏插件的完整策略面，全部离线：
 *   S1 观察与脱敏：allow 的调用打印一行脱敏预览，日志先于工具函数体；
 *   S2 deny：工具名单与危险命令模式，先留痕再拦截，函数体绝不执行；
 *   S3 ask：管线自动走 approval 缝——批准/拒绝/无回答器/无 agent 四条路；
 *   S4 cancel：规范取消结果，不呈现策略拒绝；
 *   S5 guard 对照：官方单调守卫在 pre-execute 之后求值，只能拒绝不能放行。
 * 关键认识：护栏是装配清单里的一行本地插件，策略全部来自 config——
 * 改规则不改代码，摘插件不改管线。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-approval'
import { blocksToText, executeTool } from './tools.ts'
import { bodyOrder, bodySawGuardrail, guardrailLines } from './plugins/probe-tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

// 护栏日志收集器：包装 stdout.write，护栏行（sink: stdout）进数组后照常透传。
// 工具函数体靠这个数组证明「日志先于我」；被拦截的调用靠它证明「谁拦的我」。
const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = ((chunk: Uint8Array | string, ...rest: unknown[]) => {
  const text = String(chunk)
  if (text.includes('[safety-guardrail]')) guardrailLines.push(text.trimEnd())
  return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest)
}) as typeof process.stdout.write

const ctx = await boot(
  'dsh-guardrail-demo', CONFIG,
  loadOverlayPatches('dsh-guardrail-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

/** 取失败结果的结构化错误码（ApprovalError / AbortError 等）。 */
function errorCode(result: { isError?: boolean; error?: { info?: { code?: string } } }): string | undefined {
  return result.isError === true ? result.error?.info?.code : undefined
}

// ── S1：观察与脱敏——日志先于工具函数体 ────────────────────────────────────
console.log('\n=== S1 观察与脱敏 ===')
{
  const result = await executeTool(ctx, 'demo_echo', {
    text: 'hello guardrail',
    apiKey: 'sk-live-123',
    authorization: 'Bearer abc',
    maxTokens: 4096,
  })
  console.log(`echo 结果：${blocksToText(result.content)}`)
  assert(result.isError !== true, 'allow 的调用应当执行')

  const line = guardrailLines.find(l => l.includes('tool=demo_echo')) ?? ''
  console.log(`日志先于函数体：${bodySawGuardrail['demo_echo'] === true}`)
  assert(bodySawGuardrail['demo_echo'] === true, '护栏日志必须先于工具函数体')
  const redacted = line.includes('[REDACTED]')
  const noLeak = !line.includes('sk-live-123') && !line.includes('Bearer abc')
  const budgetIntact = line.includes('"maxTokens":4096')
  console.log(`脱敏：[REDACTED] 在场=${redacted}，明文密钥缺席=${noLeak}，maxTokens 未误伤=${budgetIntact}`)
  assert(redacted && noLeak && budgetIntact, '脱敏预览不符')
}

// ── S2：deny——名单与命令模式，先留痕再拦截 ────────────────────────────────
console.log('\n=== S2 deny：名单与命令模式 ===')
{
  const byList = await executeTool(ctx, 'demo_danger', {})
  const listLine = guardrailLines.find(l => l.includes('deny tool=demo_danger')) ?? ''
  console.log(`名单 deny：isError=${byList.isError === true}，留痕=${listLine.includes('reason=')}`)
  assert(byList.isError === true && listLine.includes('deny list'), '名单拒绝应当留痕并拦截')

  // 模式 deny 用不在名单上的 demo_shell：优先级 cancel > 名单 > 模式，
  // 名单工具永远先被名单拦下，模式规则要用干净工具才能单独看见。
  const byPattern = await executeTool(ctx, 'demo_shell', { command: 'rm -rf /tmp/x' })
  console.log(`模式 deny：isError=${byPattern.isError === true}，reason=${blocksToText(byPattern.content)}`)
  assert(byPattern.isError === true && blocksToText(byPattern.content).includes('forbidden pattern'), '命令模式应当拒绝')
  console.log(`函数体从未执行：${!bodyOrder.includes('demo_danger') && !bodyOrder.includes('demo_shell')}`)
  assert(!bodyOrder.includes('demo_danger') && !bodyOrder.includes('demo_shell'), '被拒绝的工具函数体不应执行')
}

// ── S3：ask——管线自动走 approval 缝 ───────────────────────────────────────
console.log('\n=== S3 ask：审批缝 ===')
const askHandle = await ctx.agents.create({
  sessionId: SessionId('guardrail-demo-ask'),
  meta: { cwd: process.cwd() },
})
{
  const agent = askHandle.agent
  // approval.request() 必须在 open turn 内：审计对（approval/asked + decided）
  // 要被 turn 包住，否则重载时是崩溃尾巴垃圾。真实部署里 turn 由 agent-loop
  // 打开；这里直接驱动管线，所以手动 append turn/start 把门打开。
  agent.session.append('turn/start', { turn: 1 })

  // 回答器批准：ask → allowed-once → 照常执行。
  const offAllow = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
  const allowed = await executeTool(ctx, 'demo_ask', {}, agent)
  offAllow()
  console.log(`回答器批准：isError=${allowed.isError === true}（allowed-once → 执行）`)
  assert(allowed.isError !== true && bodyOrder.includes('demo_ask'), '批准后应当执行')

  // 回答器拒绝：deny 带 ApprovalError/APPROVAL_REJECTED。
  const offReject = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'rejected')
  const rejected = await executeTool(ctx, 'demo_ask', {}, agent)
  offReject()
  console.log(`回答器拒绝：code=${errorCode(rejected)}`)
  assert(errorCode(rejected) === 'APPROVAL_REJECTED', '拒绝应当带 APPROVAL_REJECTED')

  // 无回答器：fail-closed（unavailable），不是默许。
  const unanswered = await executeTool(ctx, 'demo_ask', {}, agent)
  console.log(`无回答器：code=${errorCode(unanswered)}`)
  assert(errorCode(unanswered) === 'APPROVAL_UNAVAILABLE', '无回答器应当 fail-closed')

  // 无 agent：审批请求没有路由对象，同样降级 unavailable。
  const standalone = await executeTool(ctx, 'demo_ask', {})
  console.log(`无 agent：code=${errorCode(standalone)}`)
  assert(errorCode(standalone) === 'APPROVAL_UNAVAILABLE', '无 agent 应当降级 unavailable')
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

// ── S4：cancel——规范取消结果 ──────────────────────────────────────────────
console.log('\n=== S4 cancel：规范取消 ===')
{
  const cancelled = await executeTool(ctx, 'demo_cancel', {})
  console.log(`cancel 结果：${blocksToText(cancelled.content)}`)
  assert(cancelled.isError === true && errorCode(cancelled) === 'ABORTED_BEFORE_DISPATCH', 'cancel 应当走规范取消结果')
  console.log(`函数体未执行：${!bodyOrder.includes('demo_cancel')}`)
  assert(!bodyOrder.includes('demo_cancel'), '被取消的工具函数体不应执行')
}

// ── S5：guard 对照——单调拒绝，pre-execute 之后求值 ────────────────────────
console.log('\n=== S5 guard 对照：单调拒绝 ===')
{
  // 护栏对 demo_guarded 是 allow（日志照打），但官方 guard 在其后仍然拒绝。
  const release = ctx.tools.guard(exec => (exec.name === 'demo_guarded' ? 'monotonic guard denial' : undefined))
  const guarded = await executeTool(ctx, 'demo_guarded', {})
  const allowLine = guardrailLines.filter(l => l.includes('pre-execute tool=demo_guarded')).length
  console.log(`guard 在场：isError=${guarded.isError === true}（pre-execute 仍 allow，日志 × ${allowLine}）`)
  assert(guarded.isError === true && blocksToText(guarded.content).includes('monotonic guard denial'), 'guard 应当单调拒绝')

  // 摘掉 guard 后同一调用放行——guard 没有 allow 结果，摘除即恢复。
  release()
  const freed = await executeTool(ctx, 'demo_guarded', {})
  console.log(`guard 摘除：isError=${freed.isError === true}`)
  assert(freed.isError !== true, '摘除 guard 后应当放行')
}

await askHandle.dispose()
await ctx.fiber.dispose()
process.stdout.write = originalWrite
console.log('\nGUARDRAIL_DEMO_OK')