/**
 * M12.2 · cordis 可处置定时器（ctx.timer / ctx.timeout / ctx.interval / ctx.throttle / ctx.debounce）。
 *
 * 对照 vendor/timer 的 TimerService：所有定时器都挂在当前 fiber 的 effect 上——
 * fiber 卸载时统一清理，挂起的 Promise 以 'Context has been disposed' 拒绝。
 * 四种形态都有"回调版"和"无回调版"：
 *   - timeout(cb, delay) → disposer；timeout(delay) → Promise<void>
 *   - interval(cb, delay) → disposer；interval(delay) → AsyncIterableIterator
 *   - throttle / debounce → 带 dispose 的包装函数
 *
 * 本插件注册一个节流监听器（遥测降噪是它的典型用途）。
 */
import type { Context } from '@deepseek-ai/cordis'

// 插件名用于 Fiber 诊断；timer 是 Cordis 的定时器服务名。
// 依赖 timer 后创建的 throttle 会绑定到当前插件 Fiber，卸载时自动清理。
export const name = 'cordis-timer'
export const inject = ['timer']

export function apply(ctx: Context) {
  // 高频事件 → 节流打印：100ms 窗口内最多打一条（带尾随）。
  const throttled = ctx.throttle((type: string) => {
    console.log(`  [throttled] session/event: ${type}`)
  }, 100)
  ctx.on('session/event', (_s: any, event: any) => throttled(event.type))
}
