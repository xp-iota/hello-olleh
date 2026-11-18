/**
 * dsh-hitl-demo —— 人在回路（Human-in-the-loop），全部离线（脚本化 LlmAdapter，不需要 key）：
 *   S1 审批 waterfall 的四个结果词汇 + fail-closed + 取消竞态，审计对落会话日志；
 *   S2 approval.request 的 turn 约束 + setApprovalPolicy 会话级覆盖（never 先于回答器判决）；
 *   S3 真实工具审批：pre-execute 返回 ask → 管线自动走 approval 缝（批准/拒绝/无 agent 降级）；
 *   S4 userQuestions.ask 结构化提问与回答器 waterfall；
 *   S5 commands.register 自定义斜杠命令 + execute 生命周期事件；
 *   S6 todo_write 工具：有 agent 才能写，counts 汇总。
 * 关键认识：审批不是"弹个框"——它是 turn 内的审计事件对 + 封闭结果词汇 + fail-closed 判决链。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as wordCount from './plugins/word-count.ts'
import { ScriptedAdapter } from './plugins/scripted-adapter.ts'
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
  'dsh-hitl-demo', CONFIG,
  loadOverlayPatches('dsh-hitl-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const userMsg = (text: string) =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

const suffix = Date.now().toString(36)
const makeAgent = (tag: string, model: string) =>
  ctx.agents.create({
    sessionId: SessionId(`hitl-${tag}-${suffix}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'lab-scripted', model },
  })

const toolFiber = await ctx.plugin(wordCount)
const releaseAdapter = ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())

/**
 * 在一个真实 turn 内部执行 fn。挂点选 agent/turn-stopping：此刻 turn 尚未 end
 * （approvalState 投影的 turnOpen 仍为 true），serial 事件会等异步监听完成。
 * 审批必须 turn 内发起——这是 S2 要演示的硬约束。
 */
async function insideTurn<T>(agent: Agent, fn: () => Promise<T>): Promise<T> {
  let result: T | undefined
  let failure: unknown
  const off = ctx.on('agent/turn-stopping', async (payload) => {
    if (payload.agent !== agent) return
    off()
    try {
      result = await fn()
    } catch (error) {
      failure = error
    }
  })
  agent.followup(userMsg('跑一个 turn，供人在回路演示'))
  await agent.whenIdle()
  if (failure !== undefined) throw failure
  if (result === undefined) throw new Error('turn-stopping 未触发，fn 没有执行')
  return result
}

/** 收集一个 agent 会话上的审批审计对（approval/asked + approval/decided）。 */
function collectAudit(agent: Agent) {
  const asked: { id: string; toolName: string; callId?: string }[] = []
  const decided: { id: string; outcome: string }[] = []
  const off = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(agent.id)) return
    if (event.type === 'approval/asked') asked.push(event.data as { id: string; toolName: string; callId?: string })
    if (event.type === 'approval/decided') decided.push(event.data as { id: string; outcome: string })
  })
  return { asked, decided, off }
}

// ── S1：审批词汇表与 fail-closed ───────────────────────────────────────────
console.log('\n=== S1 审批 waterfall：四个结果 + fail-closed ===')
{
  const handle = await makeAgent('s1', 's1')
  const agent = handle.agent
  const audit = collectAudit(agent)
  const outcomes = await insideTurn(agent, async () => {
    const seen: ApprovalOutcome[] = []
    // a) 回答器认领并批准
    const offAllow = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
    seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '演示批准' }))
    offAllow()
    // b) 回答器认领并拒绝
    const offReject = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'rejected')
    seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '演示拒绝' }))
    offReject()
    // c) 没有回答器 → 兜底 unavailable（fail-closed，不是抛错）
    seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '无回答器' }))
    // d) 回答器抛错 → 问题被关闭为 unavailable，而不是把异常漏给调用方
    const offThrow = ctx.on('approval/request', () => { throw new Error('回答器崩溃') })
    seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '回答器抛错' }))
    offThrow()
    // e) 撤回：回答器挂起不答，signal abort 赢得竞态 → cancelled，迟到的回答被丢弃
    const controller = new AbortController()
    const offHang = ctx.on('approval/request', () => new Promise<ApprovalOutcome>(() => {}))
    const timer = setTimeout(() => controller.abort(), 20)
    seen.push(await ctx.approval.request({ agent, toolName: 'demo-tool', reason: '演示撤回', signal: controller.signal }))
    clearTimeout(timer)
    offHang()
    return seen
  })
  audit.off()
  console.log(`五次请求的结果：${outcomes.join(' → ')}`)
  console.log(`审计对：approval/asked × ${audit.asked.length}，approval/decided × ${audit.decided.length}`)
  assert(outcomes.join(',') === 'allowed-once,rejected,unavailable,unavailable,cancelled', '审批词汇表结果不符')
  assert(audit.asked.length === 5 && audit.decided.length === 5, '审计对数量不符')
  assert(audit.asked.every((a, i) => a.id === audit.decided[i]?.id), '审计对 id 未按序配对')
  assert(audit.decided.map(d => d.outcome).join(',') === outcomes.join(','), '审计结果与返回值不一致')
  await handle.dispose()
}

// ── S2：turn 约束与会话级策略覆盖 ──────────────────────────────────────────
console.log('\n=== S2 turn 约束 + never 策略覆盖 ===')
{
  const handle = await makeAgent('s2', 's2')
  const agent = handle.agent
  let outsideError = ''
  try {
    await ctx.approval.request({ agent, toolName: 'demo-tool' })
  } catch (error) {
    outsideError = (error as Error).message
  }
  console.log(`turn 外裸调：${preview(outsideError, 80)}`)
  assert(outsideError.includes('outside an open turn'), 'turn 外调用应当被拒绝')

  // 会话级覆盖落 approval/policy 事件；never 在服务自己的请求路径上先于任何
  // 回答器判决——注册顺序再靠前也拦不住它（prepend 监听器也不行）。
  let policyEvents = 0
  const offPolicy = ctx.on('session/event', (session, event) => {
    if (String(session.id) === String(agent.id) && event.type === 'approval/policy') policyEvents += 1
  })
  setApprovalPolicy(agent.session, 'never')
  const offAllow = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
  const outcome = await insideTurn(agent, () =>
    ctx.approval.request({ agent, toolName: 'demo-tool', reason: '回答器想批准' }))
  offAllow()
  offPolicy()
  console.log(`setApprovalPolicy('never') 后：结果=${outcome}（回答器在场也被拒），approval/policy 事件 × ${policyEvents}`)
  assert(outcome === 'rejected' && policyEvents === 1, 'never 策略应当先于回答器判决')
  await handle.dispose()
}

// ── S3：真实工具审批（pre-execute ask → 管线走 approval 缝）────────────────
console.log('\n=== S3 真实 turn 内的工具审批 ===')
{
  // pre-execute 返回 { kind: 'ask' }：管线自己调 approval.request（带 callId），
  // 把四个结果一一映射为 allow / 三种带 ApprovalError 的 deny。这就是权限门的正路。
  const offPre = ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'word_count') return { kind: 'ask', reason: 'word_count 需要人工批准' }
    return next()
  })

  // a) 批准：脚本化 turn 的第一步工具调用被放行，审计对带 callId。
  const allowHandle = await makeAgent('s3-allow', 's3a')
  const allowAudit = collectAudit(allowHandle.agent)
  const offAllow = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
  allowHandle.agent.followup(userMsg('统计一下这段文本的词数'))
  await allowHandle.agent.whenIdle()
  offAllow()
  allowAudit.off()
  console.log(`批准路径：decided=${allowAudit.decided[0]?.outcome}，callId 在审计里=${allowAudit.asked[0]?.callId !== undefined}`)
  assert(allowAudit.decided[0]?.outcome === 'allowed-once', '批准路径结果不符')
  assert(allowAudit.asked[0]?.callId !== undefined, '管线应当把真实 callId 带进审批')
  await allowHandle.dispose()

  // b) 拒绝：工具结果变成模型可见的拒绝原因，turn 照常收尾。
  const denyHandle = await makeAgent('s3-deny', 's3b')
  const denyAudit = collectAudit(denyHandle.agent)
  let denialText = ''
  const offResult = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(denyHandle.agent.id) || event.type !== 'tool/result') return
    const message = (event.data as { message?: { content?: unknown } }).message
    denialText = blocksToText(message?.content)
  })
  const offReject = ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'rejected')
  denyHandle.agent.followup(userMsg('统计一下这段文本的词数'))
  await denyHandle.agent.whenIdle()
  offReject()
  offResult()
  denyAudit.off()
  console.log(`拒绝路径：decided=${denyAudit.decided[0]?.outcome}，模型看到：${preview(denialText, 80)}`)
  assert(denyAudit.decided[0]?.outcome === 'rejected', '拒绝路径结果不符')
  assert(denialText.includes('rejected'), '拒绝原因应当传给模型')
  await denyHandle.dispose()

  // c) 无 agent 的调用也要求审批 → 没有会话可审计、没有 UI 可路由 → 降级 deny。
  const orphan = await callTool(ctx, 'word_count', { text: 'no agent here' })
  console.log(`无 agent 降级：isError=${orphan.isError}，${preview(orphan.content, 80)}`)
  assert(orphan.isError && orphan.content.includes('no agent'), '无 agent 的 ask 应当降级拒绝')
  offPre()
}

// ── S4：结构化提问 ─────────────────────────────────────────────────────────
console.log('\n=== S4 userQuestions.ask ===')
{
  const handle = await makeAgent('s4', 's4')
  const agent = handle.agent
  // 回答器监听 user-questions/request：返回答案即认领，next() 交给下一个。
  const offAnswer = ctx.on('user-questions/request', async (request) => ({
    answers: request.questions.map(q => ({ id: q.id, selected: [q.options?.[0]?.label ?? ''] })),
  }))
  const answer = await ctx.userQuestions.ask({
    agent,
    questions: [{
      id: 'scope',
      question: '本次演示允许哪种访问？',
      header: '访问范围',
      options: [{ label: '只读' }, { label: '读写' }],
    }],
  })
  offAnswer()
  console.log(`回答：${JSON.stringify(answer.answers)}`)
  assert(answer.answers[0]?.id === 'scope' && answer.answers[0]?.selected[0] === '只读', '回答未按问题 id 回声')

  let emptyCode = ''
  try {
    await ctx.userQuestions.ask({ agent, questions: [] })
  } catch (error) {
    emptyCode = (error as { code?: string }).code ?? ''
  }
  console.log(`空问题批：UserQuestionError code=${emptyCode}`)
  assert(emptyCode === 'EMPTY_QUESTIONS', '空问题批应当报 EMPTY_QUESTIONS')
  await handle.dispose()
}

// ── S5：自定义斜杠命令 ─────────────────────────────────────────────────────
console.log('\n=== S5 commands.register + execute ===')
{
  const handle = await makeAgent('s5', 's5')
  const agent = handle.agent
  const offCommand = ctx.commands.register({
    name: 'lab-note',
    description: '把一句话记进演示日志',
    handler: invocation => ({ kind: 'success', text: `已记录：${invocation.rawInput.trim()}` }),
  })
  const names = ctx.commands.list(agent).map(command => command.name)
  console.log(`lab-note 可见：${names.includes('lab-note')}`)
  assert(names.includes('lab-note'), '自定义命令未出现在 list 里')

  const lifecycle: string[] = []
  const offEvent = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(agent.id)) return
    if (event.type === 'command/run' || event.type === 'command/done') lifecycle.push(event.type)
  })
  const execution = await ctx.commands.execute(agent, '/lab-note 双运行时一致', [], new AbortController().signal)
  const unknown = await ctx.commands.execute(agent, '/nope', [], new AbortController().signal)
  offEvent()
  offCommand()
  console.log(`execute 结果：kind=${execution?.result.kind}，text=${execution?.result.kind === 'success' ? execution.result.text : '?'}`)
  console.log(`生命周期事件：${lifecycle.join(' → ')}；未注册命令返回 ${unknown === undefined ? 'undefined' : '意外值'}`)
  assert(execution?.result.kind === 'success', '命令执行应当成功')
  assert(lifecycle.join(',') === 'command/run,command/done', '命令生命周期事件不完整')
  assert(unknown === undefined, '未注册命令应当返回 undefined')
  await handle.dispose()
}

// ── S6：todo_write 工具 ────────────────────────────────────────────────────
console.log('\n=== S6 todo_write ===')
{
  const handle = await makeAgent('s6', 's6')
  const agent = handle.agent
  const todos = [
    { content: '读源码', status: 'completed' },
    { content: '写示例', status: 'in_progress' },
    { content: '双运行时验证', status: 'pending' },
  ]
  const written = await callTool(ctx, 'todo_write', { todos }, agent)
  const counts = (written.value as { counts?: { pending: number; inProgress: number; completed: number } })?.counts
  console.log(`有 agent：isError=${written.isError}，${written.content}`)
  assert(!written.isError && counts?.pending === 1 && counts?.inProgress === 1 && counts?.completed === 1, 'todo counts 不符')

  // 清单是"每 agent 会话"的状态：没有归属会话的调用被拒绝，而不是静默 no-op。
  const orphan = await callTool(ctx, 'todo_write', { todos })
  console.log(`无 agent：isError=${orphan.isError}，${preview(orphan.content, 80)}`)
  assert(orphan.isError && orphan.content.includes('owning agent session'), '无 agent 的 todo_write 应当被拒绝')
  await handle.dispose()
}

releaseAdapter()
await toolFiber.dispose()
await ctx.fiber.dispose()
console.log('\nHITL_OK')