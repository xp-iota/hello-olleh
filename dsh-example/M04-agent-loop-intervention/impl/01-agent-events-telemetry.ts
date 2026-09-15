/**
 * M04.1 · 观测 agent 生命周期 / 会话事件做遥测。
 *
 * dsh 的一切都能通过"监听事件"来观测，而不必改主循环——这就是它的可观测性扩展点。
 * 两类事件域：
 *   - session/event：持久事件流（turn/start、step/start、assistant/chunk、step/end、turn/end ...）
 *   - agent/*：携带"活 Agent"的策略事件（pre-step、request、turn-stopping ...）
 *
 * 本例纯"看"：把每次 turn/step 的边界和 token 流出打印成一行行日志。
 * 遥测后端、审计、回放、进度 UI 都可以照这个模子写。
 *
 * 关键点：
 *   - 观察者要**隔离自身失败**：一个监听器抛错不应打断主流程——用 try/catch 包住副作用。
 *   - 只监听、不 import 主循环、不 import provider → 换 provider/换循环时本插件照旧生效。
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'agent-events-telemetry'
// 本插件只当观察者，不注入任何服务；仍能收到全局 session/event。
// 空数组明确表示“没有服务依赖”，不是遗漏配置；因此可在任意基础服务之后加载。
export const inject = []

export function apply(ctx: Context) {
  ctx.on('session/event', (_session, event) => {
    try {
      switch (event.type) {
        case 'turn/start':
          console.log('[telemetry] ▶ turn 开始')
          break
        case 'step/start':
          console.log('[telemetry]  · step 开始')
          break
        // 0.1.5 起没有 'assistant/chunk' 事件：token 增量内嵌在 assistant/message
        // 携带的 provider 流里，不再单独落日志。要观测流式请看 M03 的
        // llm/stream waterfall —— 会话日志是"已接受的事实"，不是传输过程。
        case 'assistant/attempt':
          console.log('[telemetry]  · provider attempt')
          break
        case 'step/end':
          console.log('\n[telemetry]  · step 结束')
          break
        case 'turn/end':
          console.log('[telemetry] ■ turn 结束\n')
          break
        default:
          break // 其它事件类型这里不关心
      }
    } catch (err) {
      // 观测失败绝不能影响 agent 主循环——吞掉并记录即可。
      console.error('[telemetry] 观测器内部错误（已忽略）:', err)
    }
  })
}
