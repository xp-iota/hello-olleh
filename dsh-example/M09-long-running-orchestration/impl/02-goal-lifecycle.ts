/**
 * M09.2 · 目标生命周期（ctx.goals）：状态只由所属会话日志折叠而来。
 *
 * 对照 packages/goal/goal：
 *   - 每次变更 append 一条携带完整变更后状态的 `goal/change` 事件（whole-value rule）——
 *     目标服务没有自己的存储，会话日志就是唯一本体；
 *   - 变更走乐观并发：带当前 GoalRef（{ id, revision }），不匹配抛 GoalError；
 *   - activation（armed/disarmed）是进程内状态，永不落日志；
 *   - phase 词表：active | paused | blocked | complete；clear 追加 null 墓碑。
 *
 * 本插件把 goal/change 事件打出来；run.ts 走完整生命周期。
 */
import type { Context } from '@deepseek-ai/cordis'

// 插件名用于诊断；目标状态的写入仍由 ctx.goals 服务负责。
// 本例还监听 session/event，但声明 goals 表示插件与目标服务的装配关系。
export const name = 'goal-lifecycle'
export const inject = ['goals']

export function apply(ctx: Context) {
  ctx.on('session/event', (_session: any, event: any) => {
    if (event.type !== 'goal/change') return
    const goal = event.data.goal
    console.log(`  [goal/change] seq=${event.seq} →`, goal === null ? '（墓碑：已清除）' : `rev=${goal.revision} phase=${goal.phase} "${goal.objective}"`)
  })
}
