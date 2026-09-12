/**
 * 18 · 追加式会话日志（ctx.sessions）：一切模型可见内容的唯一本体。
 *
 * 对照 packages/core/session 的不变量：
 *   - append 分配 seq = log.length（连续性契约），事件接受即深冻结；
 *   - surfaceOp 标记控制事件是否进入模型可见 surface：'append' 入列，
 *     { op:'replace', start, end } 先遮蔽区间再入列（压缩就靠它折叠历史）；
 *   - deriveMessages() 只投影 surface 事件 → "模型可见 ⇒ 已落日志"；
 *   - fork(source, boundary) 从稳定前缀分叉子会话；flush() 是 parallel 持久化检查点。
 *
 * 本插件把 session/event 打成流水账；run.ts 跑一个真实 turn 后检查日志。
 */
import type { Context } from '@deepseek-ai/cordis'

// 插件名用于日志/卸载诊断；sessions 才是会话日志服务的名字。
// Cordis 等 sessions 服务可用后再安装 session/event 监听器。
export const name = 'session-log'
export const inject = ['sessions']

export function apply(ctx: Context) {
  ctx.on('session/event', (session: any, event: any) => {
    console.log(`  [log] seq=${event.seq} ${event.type}${event.surfaceOp ? ` surfaceOp=${JSON.stringify(event.surfaceOp)}` : ''}`)
  })
  ctx.on('session/created', (session: any) => {
    console.log(`  [store] session/created → ${session.id}`)
  })
}
