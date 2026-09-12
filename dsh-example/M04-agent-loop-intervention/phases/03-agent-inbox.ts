/**
 * 模块 M04 的对应阶段：演示 inbox 四通道的路由与唤醒差异（真实 `agent.inbox`）。`npm run M04`。
 *
 * 四个入口的对照是本例的重点，所以每个都**显式调用一次**，并打印它带来的路由效果：
 *   - inject   → nextStep + 不唤醒（睡着的 driver 不会被它叫醒）
 *   - followup → nextTurn + 唤醒（独占一个新 turn）
 *   - steer    → nextStep + 唤醒（running driver 在**同一 turn 的下一个 step** 边界消费）
 *   - send     → target / wakeup 全显式（底层入口）
 *
 * `steer` 与 `followup` 的分界是最容易搞混的一处：同样都在 running 时入队，
 * steer 落在**本轮**的下一步，followup 落在**下一轮**。
 *
 * 真实 `Inbox` 暴露只读的 `nextTurn` / `nextStep` 两个队列视图；每次入队/认领都会往
 * 会话日志写一条 `agent/inbox/spliced`（所以"谁在什么时候塞了什么"是可回放的）。
 */
import { createHarness, userText } from '../../runtime/harness.ts'
import * as plugin from '../steps/03-agent-inbox.ts'

const harness = await createHarness({ reply: '收到。', plugins: [[plugin]] })
const { ctx, agent } = harness
const state = () => `nextStep = ${agent.inbox.nextStep.length} | nextTurn = ${agent.inbox.nextTurn.length}`

console.log('① inject：排入 nextStep 但不唤醒（turn 开始前注入的上下文）')
agent.inject(userText('背景：这是个演示。', { kind: 'plugin', plugin: 'agent-inbox', form: 'instructions' }))
console.log('   inbox 状态:', state())
console.log('   ↑ 排进去了，但 driver 没被叫醒 —— inject 不唤醒')

console.log('\n② 跑一个 turn：真实主循环在 step1 的认领边界把两个队列都取空')
console.log('   （inject 的上下文与 followup 的用户输入一起进了第一步，见下面 pre-step 的 source 列表）')
const result = await harness.runTurn({ prompt: '开始吧' })
console.log('   实际 step 数 =', result.steps)

console.log('\n③ send：全显式入口（target + wakeup 自己定）—— wakeup=false 不唤醒 driver')
agent.send(userText('下一轮再处理我'), 'next-turn', false)
console.log('   inbox 状态:', state())
console.log('   ↑ 与 ① 的 inject 同为"不唤醒"，但目标队列是 nextTurn')

console.log('\n④ 会话日志里的 inbox 流水（agent/inbox/spliced 可回放）:')
for (const event of agent.session.snapshotEvents()) {
  if (event.type !== 'agent/inbox/spliced') continue
  const data = event.data as any
  const first = data.inserted?.[0]?.content?.[0]
  console.log(`   seq=${event.seq} target=${data.target} 入队 ${data.inserted.length} 条 / 移除 ${data.removedCount ?? 0} 条`, first?.text ? `→ ${JSON.stringify(first.text.slice(0, 16))}` : '')
}

console.log('\n⑤ followup：nextTurn + 唤醒 —— 该消息独占它自己的一个 turn')
agent.followup(userText('我是独立的一轮'))
console.log('   inbox 状态:', state())
console.log('   ↑ 入队即返回（此时 driver 刚被唤醒，还没到认领边界），所以 nextTurn 仍是 1')
await agent.whenIdle()
const stepsSoFar = agent.session.snapshotEvents().filter((e) => e.type === 'step/start').length
console.log('   到目前的累计 step 数 =', stepsSoFar, '（followup 唤醒了 driver，所以又多跑了一轮）')

console.log('\n⑥ steer：nextStep + 唤醒 —— running driver 在【同一 turn 的下一步】消费')
console.log('   下面在 turn-stopping 上 steer 一条：不 steer 的话本轮就该关轮了')
let steered = false
const steerPlugin = {
  name: 'steer-demo',
  apply(c: any) {
    c.on('agent/turn-stopping', ({ agent: a, turn }: any) => {
      if (steered) {
        console.log(`  [turn-stopping] turn=${turn} 不再 steer → 本轮正常关闭`)
        return
      }
      steered = true
      console.log(`  [turn-stopping] turn=${turn} 反对停止 → steer 一条，强制再走一步`)
      a.steer(userText('继续：还有事没做完', { kind: 'plugin', plugin: 'steer-demo', form: 'instructions' }))
    })
  },
}
await harness.loadPlugin(steerPlugin)
const steerRun = await harness.runTurn({ prompt: '做点事' })
console.log('   steer 那一轮的 step 数 =', steerRun.steps, '| 被引导 =', steerRun.steerRequested, '| 引导次数 =', steerRun.steerCount)
console.log('   ↑ 对比 ⑤ 的 followup：steer 没有新开 turn，而是在同一个 turn 里多走了一步')

console.log('\n⑦ 两条引导的 spliced 对照（target 决定落在哪条队列）:')
for (const event of agent.session.snapshotEvents()) {
  if (event.type !== 'agent/inbox/spliced') continue
  const data = event.data as any
  const first = data.inserted?.[0]
  // 只看"入队"那几条（认领是移除，没有 inserted）；跳过后面的 clear 之类的空事件。
  if (!first) continue
  const text = first.content?.[0]?.text ?? ''
  // 只挑两条最有对照价值的：用户输入进 next-turn，steer 的 plugin 消息进 next-step。
  if (data.target === 'next-step' && first.source?.kind !== 'plugin') continue
  console.log(`   target=${data.target.padEnd(9)} source=${String(first.source?.kind ?? 'unknown').padEnd(6)} → ${JSON.stringify(text.slice(0, 16))}`)
}

console.log('\n⑧ clear：丢弃全部待认领消息')
agent.inbox.clear()
console.log('   inbox 状态:', state())

await harness.dispose()
