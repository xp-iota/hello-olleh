/**
 * dsh-agent-loop-demo —— Agent 循环干预，全部离线（脚本化 LlmAdapter，不需要 key）：
 *   S1 脚本化适配器驱动真实 turn：观察 turn/step 边界与工具执行；
 *   S2 agent/turn-stopping 时 steer：turn 续跑一个 step；
 *   S3 三条 inbox 通道：followup / steer / inject 与"只入队不唤醒"；
 *   S4 取消：空闲幂等、keepInbox 语义、在途 turn 的真实中止；
 *   S5 agent/status 现场事件。
 * 关键认识：不要自己写循环——只往 inbox 塞消息，推进完全由 dsh-agent-loop 负责。
 * word-count 工具与脚本化适配器在 cordis.patch.yml 里声明，全程在位。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

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
  'dsh-agent-loop-demo', CONFIG,
  loadOverlayPatches('dsh-agent-loop-demo', PATCH),
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
    sessionId: SessionId(`agent-loop-${tag}-${suffix}`),
    meta: { cwd: process.cwd() },
    // 模型路由走 agentOptions，不在 meta 里（meta 只接受 { cwd }）。
    agentOptions: { provider: 'lab-scripted', model },
  })

// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。

// ── S1：脚本化适配器驱动真实 turn ──────────────────────────────────────────
console.log('\n=== S1 脚本化 turn：turn/step 边界 ===')
{
  const handle = await makeAgent('s1', 's1')
  const agent = handle.agent
  const boundaries: string[] = []
  let toolCalls = 0
  let assistantMessages = 0
  const off = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(agent.id)) return
    if (['turn/start', 'turn/end', 'step/start', 'step/end'].includes(event.type)) boundaries.push(event.type)
    if (event.type === 'tool/call') toolCalls += 1
    if (event.type === 'assistant/message') assistantMessages += 1
  })
  agent.followup(userMsg('统计一下这段文本的词数'))
  await agent.whenIdle()
  off()
  console.log(`边界事件：${boundaries.join(' → ')}`)
  console.log(`tool/call × ${toolCalls}，assistant/message × ${assistantMessages}`)
  assert(boundaries[0] === 'turn/start' && boundaries.at(-1) === 'turn/end', 'turn 边界不完整')
  assert(boundaries.filter(t => t === 'step/start').length === 2, '应当恰好两个 step（工具步 + 回答步）')
  assert(toolCalls === 1 && assistantMessages >= 1, '工具调用或助手消息缺失')
  await handle.dispose()
}

// ── S2：turn-stopping 时 steer 续跑 ────────────────────────────────────────
console.log('\n=== S2 turn-stopping 时 steer ===')
{
  const handle = await makeAgent('s2', 's2')
  const agent = handle.agent
  let steered = false
  let steps = 0
  const offEvent = ctx.on('session/event', (session, event) => {
    if (String(session.id) === String(agent.id) && event.type === 'step/start') steps += 1
  })
  // agent/turn-stopping：turn 即将结束（serial 事件，payload 由融合分发器注入 agent）。
  // 此刻 steer 会往 next-step 塞一条消息，循环检查 inbox 非空 → 再走一个 step。
  const offStopping = ctx.on('agent/turn-stopping', (payload) => {
    if (payload.agent !== agent || steered) return
    steered = true
    console.log(`turn ${payload.turn} 即将结束，steer 注入续跑消息`)
    agent.steer(userMsg('再补一句：这句话是 steer 注入的。'))
  })
  agent.followup(userMsg('说一句话'))
  await agent.whenIdle()
  offStopping()
  offEvent()
  console.log(`steer 触发：${steered}，本 turn 共 ${steps} 个 step（无 steer 时是 2 个）`)
  assert(steered && steps === 3, 'steer 应当让 turn 多走一个 step')
  await handle.dispose()
}

// ── S3：三条 inbox 通道 ────────────────────────────────────────────────────
console.log('\n=== S3 inbox 三通道：followup / steer / inject ===')
{
  const handle = await makeAgent('s3', 's3')
  const agent = handle.agent
  console.log(`初始：next-turn ${agent.inbox.nextTurn.length} 条，next-step ${agent.inbox.nextStep.length} 条`)
  // send(..., false)：只入队、不唤醒——inbox 是持久化待办，不是即时调用。
  agent.send(userMsg('排队但不唤醒'), 'next-turn', false)
  console.log(`send(next-turn, wakeup=false) 后：next-turn ${agent.inbox.nextTurn.length} 条，status=${agent.status}`)
  assert(agent.inbox.nextTurn.length === 1 && agent.status === 'idle', 'wakeup=false 不应唤醒 driver')
  // inject = send(next-step, false)：同样只入队；steer = send(next-step, true) 会唤醒。
  agent.inject(userMsg('下一步边界再消费'))
  console.log(`inject 后：next-step ${agent.inbox.nextStep.length} 条，status=${agent.status}`)
  assert(agent.inbox.nextStep.length === 1 && agent.status === 'idle', 'inject 不应唤醒 driver')
  agent.inbox.clear()
  console.log(`clear 后：next-turn ${agent.inbox.nextTurn.length} 条，next-step ${agent.inbox.nextStep.length} 条`)
  assert(agent.inbox.nextTurn.length === 0 && agent.inbox.nextStep.length === 0, 'clear 未清空')
  await handle.dispose()
}

// ── S4：取消（空闲幂等 + keepInbox + 在途中止）─────────────────────────────
console.log('\n=== S4 取消在途工作 ===')
{
  const handle = await makeAgent('s4', 's4')
  const agent = handle.agent
  agent.cancel({ kind: 'user' })
  agent.cancel({ kind: 'user' })
  console.log(`空闲时连续 cancel 不报错，status=${agent.status}`)
  agent.send(userMsg('会被默认取消清掉'), 'next-turn', false)
  agent.cancel({ kind: 'user' })
  console.log(`默认 cancel 清空 inbox：剩 ${agent.inbox.nextTurn.length} 条`)
  assert(agent.inbox.nextTurn.length === 0, '默认 cancel 应当清空 inbox')
  agent.send(userMsg('keepInbox 保留'), 'next-turn', false)
  agent.cancel({ kind: 'user' }, { keepInbox: true })
  console.log(`keepInbox cancel 保留排队：剩 ${agent.inbox.nextTurn.length} 条`)
  assert(agent.inbox.nextTurn.length === 1, 'keepInbox 应当保留排队工作')
  agent.inbox.clear()
  await handle.dispose()

  // 在途取消：hang 路由的 stream 挂起等待 signal，cancel 真实中止一个进行中的 turn。
  const hangHandle = await makeAgent('s4-hang', 'hang')
  const hangAgent = hangHandle.agent
  let turnEndReason = ''
  const offEvent = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(hangAgent.id) || event.type !== 'turn/end') return
    turnEndReason = (event.data as { reason?: { kind?: string } }).reason?.kind ?? '?'
  })
  const running = new Promise<void>((resolveRunning) => {
    const offStatus = ctx.on('agent/status', (payload) => {
      if (payload.agent === hangAgent && payload.status === 'running') {
        offStatus()
        resolveRunning()
      }
    })
  })
  hangAgent.followup(userMsg('这个请求会一直挂起'))
  await running
  console.log(`turn 已在途：status=${hangAgent.status}`)
  hangAgent.cancel({ kind: 'user' })
  await hangAgent.whenIdle()
  offEvent()
  console.log(`cancel 后：status=${hangAgent.status}，turn/end reason=${turnEndReason}`)
  assert(hangAgent.status === 'idle' && turnEndReason === 'aborted', '在途取消应当以 aborted 收尾')
  await hangHandle.dispose()
}

// ── S5：agent/status 现场事件 ──────────────────────────────────────────────
console.log('\n=== S5 agent/status 事件 ===')
{
  const handle = await makeAgent('s5', 's5')
  const agent = handle.agent
  const statuses: string[] = []
  const off = ctx.on('agent/status', (payload) => {
    if (payload.agent === agent) statuses.push(payload.status)
  })
  console.log(`初始 status：${agent.status}`)
  agent.followup(userMsg('跑一个完整 turn'))
  await agent.whenIdle()
  off()
  console.log(`status 变化：${statuses.join(' → ')}`)
  assert(statuses.join(' → ') === 'running → idle', '一个完整 turn 应当产生 running → idle')
  await handle.dispose()
}

await ctx.fiber.dispose()
console.log('\nAGENT_LOOP_OK')