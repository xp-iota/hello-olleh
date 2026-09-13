/**
 * M04.3 · Agent inbox：四通道输入模型（对照 core/agent runtime-types.ts 的 Agent 接口）。
 *
 * Agent 对外的所有输入都路由进 inbox 的两个边界：
 *   - nextStep：下一个 step 边界认领（当前轮内继续）
 *   - nextTurn：下一个 turn 认领（后续轮次）
 *
 * 四个入口只是"路由 + 是否唤醒"的组合：
 *   - send(message, target, wakeup)  全显式的底层入口
 *   - followup(message)  → nextTurn + 唤醒（该消息独占自己的 turn）
 *   - steer(message)     → nextStep + 唤醒（running driver 在下一 step 边界消费）
 *   - inject(message)    → nextStep + 不唤醒（排队模型可见上下文，等下一次唤醒）
 *
 * 本插件在 pre-step 打印每次认领的 inbox 内容；run.ts 演示各入口的路由效果。
 */
import type { Context } from '@deepseek-ai/cordis'

// 插件名用于识别 Fiber；agents 依赖确保 agent/pre-step 事件来源已安装。
export const name = 'agent-inbox'
export const inject = ['agents']

export function apply(ctx: Context) {
  ctx.on('agent/pre-step', (payload: any, next: () => any) => {
    const kinds = payload.messages.map((m: any) => (m.source && m.source.kind) ?? 'unknown')
    console.log(`  [inbox] pre-step turn=${payload.turn} step=${payload.step} 认领 ${payload.messages.length} 条 (source: ${kinds.join(', ') || '无'})`)
    return next()
  })
}
