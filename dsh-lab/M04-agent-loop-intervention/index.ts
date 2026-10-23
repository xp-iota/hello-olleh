/**
 * M04 · Agent 循环干预。
 *
 * 这一章看的是"一个 turn 内部"：turn/step 边界、inbox 的三条通道
 * （followup / steer / inject）、取消、以及循环暴露的现场事件。
 *
 * 关键认识：**不要自己写循环**。REPL（`dsh-lab chat`）就是这一章的最佳示例——
 * 它只往 inbox 里塞消息，推进完全由 dsh-agent-loop 负责。
 *
 * @module dsh-lab/M04
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** 建一个 agent 并跑一个 turn 的公共骨架。 */
async function withAgent(
  stage: StageContext,
  body: (agent: import('@deepseek-ai/dsh-agent').Agent) => Promise<void>,
): Promise<void> {
  const handle = await stage.ctx.agents.create({
    sessionId: stage.sessionId as never,
    meta: { cwd: process.cwd() },
  })
  try {
    await body(handle.agent)
  } finally {
    await handle.dispose()
  }
}

/** M04.1 —— 观察 turn / step 事件。 */
async function observeTurnEvents(stage: StageContext) {
  const { ctx } = stage
  if (process.env.LLM_API_KEY === undefined || process.env.LLM_API_KEY === '') {
    // 没有 key 时退化成"只验证事件订阅在位"，并明确说明为什么跳过。
    let subscribed = false
    const off = ctx.on('session/event', () => {
      subscribed = true
    })
    off()
    stage.log('缺少 LLM_API_KEY，本阶段只验证事件订阅通道（真实 turn 需要模型）')
    stage.log(`session/event 监听可挂载：${typeof ctx.on === 'function'}`)
    return
  }

  const seen: string[] = []
  await withAgent(stage, async (agent) => {
    const off = ctx.on('session/event', (session, event) => {
      if (String(session.id) !== String(agent.id)) return
      const type = event.type
      if (type === 'turn/start' || type === 'turn/end' || type === 'step/start' || type === 'step/end') {
        seen.push(type)
      }
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '只回复两个字：收到' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    off()
  })
  stage.log(`观察到边界事件：${seen.join(' → ')}`)
  stage.assert(seen.includes('turn/start') && seen.includes('turn/end'), '没有观察到完整的 turn 边界')
}

/** M04.2 —— 在 turn 结束前 steer（续跑）。 */
async function steerAtBoundary(stage: StageContext) {
  const { ctx } = stage
  let steered = false
  await withAgent(stage, async (agent) => {
    // agent/turn-stopping：turn 即将结束，此时 steer 会让它再走一步。
    const off = ctx.on('agent/turn-stopping', ((payload: { agent: unknown }) => {
      if (payload.agent !== agent || steered) return
      steered = true
      agent.steer(
        createUserMessage({
          content: [{ type: 'text', text: '再补一句：这句话是 steer 注入的。' }],
          source: { kind: 'user' },
        }),
      )
    }) as never)
    if (process.env.LLM_API_KEY !== undefined) {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: '说一句话。' }], source: { kind: 'user' } }))
      await agent.whenIdle()
    }
    off()
  })
  stage.log(`steer 在本轮被触发：${steered}${process.env.LLM_API_KEY === undefined ? '（缺 key，未真正跑 turn）' : ''}`)
}

/** M04.3 —— 三条 inbox 通道的区别。 */
async function compareInboxChannels(stage: StageContext) {
  await withAgent(stage, async (agent) => {
    const inbox = agent.inbox
    stage.log(`next-turn 初始：${inbox.nextTurn.length} 条；next-step 初始：${inbox.nextStep.length} 条`)
    // 只入队、不唤醒：证明 inbox 是"持久化的待办"，不是即时调用。
    agent.send(
      createUserMessage({ content: [{ type: 'text', text: '排队但不唤醒' }], source: { kind: 'user' } }),
      'next-turn',
      false,
    )
    stage.log(`send 之后 next-turn：${agent.inbox.nextTurn.length} 条`)
    stage.assert(agent.inbox.nextTurn.length >= 1, 'send 未进入 next-turn')
    stage.assert(agent.status === 'idle', 'wakeup=false 不应唤醒 driver')
    agent.inbox.clear()
    stage.log(`clear 之后：${agent.inbox.nextTurn.length} 条`)
    stage.assert(agent.inbox.nextTurn.length === 0, 'clear 未清空')
  })
}

/** M04.4 —— 取消在途工作。 */
async function cancelInFlight(stage: StageContext) {
  await withAgent(stage, async (agent) => {
    // 没有 key 时不发请求，直接验证 cancel 的语义是幂等且不报错。
    agent.cancel({ kind: 'user' })
    stage.log(`空闲时 cancel 不报错，status=${agent.status}`)
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    stage.log('keepInbox 形态也可用（保留排队工作）')
  })
}

/** M04.5 —— 订阅现场事件（status / error）。 */
async function observeLiveEvents(stage: StageContext) {
  const { ctx } = stage
  const statuses: string[] = []
  await withAgent(stage, async (agent) => {
    const off = ctx.on('agent/status', ((payload: { agent: unknown; status: string }) => {
      if (payload.agent !== agent) return
      statuses.push(payload.status)
    }) as never)
    stage.log(`初始 status：${agent.status}`)
    off()
  })
  stage.log(`观察到的 status 变化：${statuses.join(' → ') || '(无：本轮没有驱动)'}`)
}

export default defineModule({
  id: 'M04',
  title: 'Agent 循环干预',
  stages: [
    { id: 'M04.1', title: '观察 turn / step 边界', kind: 'model', run: observeTurnEvents },
    { id: 'M04.2', title: '在 turn 结束前 steer', kind: 'model', run: steerAtBoundary },
    { id: 'M04.3', title: '三条 inbox 通道', kind: 'mechanism', run: compareInboxChannels },
    { id: 'M04.4', title: '取消在途工作', kind: 'mechanism', run: cancelInFlight },
    { id: 'M04.5', title: '订阅现场状态事件', kind: 'mechanism', run: observeLiveEvents },
  ],
})
