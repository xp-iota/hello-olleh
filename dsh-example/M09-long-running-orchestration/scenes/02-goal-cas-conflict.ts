/**
 * 模块 M09 的对应场景：create → pause → resume → block → complete → clear，外加一次 CAS 冲突。`npm run M09`。
 *
 * 目标服务没有自己的存储：`goals.get(agent)` 的返回值完全折叠自该 agent 会话日志里的
 * `goal/change` 事件，所以最后一节直接回放日志就能重建全程。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as plugin from '../impl/02-goal-lifecycle.ts'

const harness = await createHarness({ plugins: [[plugin]] })
const { ctx, agent } = harness
const goals = ctx.goals

console.log('① create：创建并 arm（rev=1, phase=active, activation=armed）')
let view = goals.create(agent, { objective: '重构支付模块', maxGoalRounds: 5 })
console.log('   →', view.phase, view.activation, `rev=${view.revision}`)
const staleRef = { id: view.id, revision: view.revision }

console.log('\n② pause：active → paused（撤 arm）')
view = goals.pause(agent, staleRef)
console.log('   →', view.phase, view.activation, `rev=${view.revision}`)

console.log('\n③ CAS 冲突：用旧 ref 操作被拒')
try {
  goals.resume(agent, staleRef) // staleRef.revision 已过期
  console.log('   竟然通过了?!')
} catch (error) {
  console.log('  ', (error as Error).message)
}

console.log('\n④ resume：paused → active（重新 arm）')
view = goals.resume(agent, { id: view.id, revision: view.revision })
console.log('   →', view.phase, view.activation, `rev=${view.revision}`)

console.log('\n⑤ block：→ blocked（携带人机可读 reason）')
view = goals.block(agent, { id: view.id, revision: view.revision }, { code: 'needs-human', message: '需要人类确认数据库迁移窗口' })
console.log('   →', view.phase, `(code=${view.blockedReason?.code})`, `rev=${view.revision}`)

console.log('\n⑥ complete：→ complete 并撤 arm')
view = goals.complete(agent, { id: view.id, revision: view.revision })
console.log('   →', view.phase, view.activation, `rev=${view.revision}`)

console.log('\n⑦ clear：追加 null 墓碑，折叠结果回到 undefined')
goals.clear(agent, { id: view.id, revision: view.revision })
console.log('   goals.get(agent) =', goals.get(agent))

const changes = agent.session.snapshotEvents().filter((event) => event.type === 'goal/change')
console.log('\n⑧ 日志即状态：回放', changes.length, '条 goal/change 事件即可重建全程')

await harness.dispose()
