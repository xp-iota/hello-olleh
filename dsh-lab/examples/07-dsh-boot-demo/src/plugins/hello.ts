/**
 * hello —— 本示例的本地插件：inject labMark，打印 overlay 后的 config，
 * 并挂两个可逆 effect 演示 dispose 的逆序回收。
 */
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 宿主在 prepare 阶段（或运行时）提供的标记服务。 */
    labMark?: string
  }
}

export const name = 'hello'
export const inject = ['labMark']

export function apply(ctx: Context, config: { tag?: string } = {}): void {
  console.log(`[hello] ACTIVE tag=${config.tag ?? '(unset)'} labMark=${ctx.labMark}`)
  ctx.effect(() => {
    console.log('[hello] effect#1 mount')
    return () => console.log('[hello] effect#1 dispose')
  })
  ctx.effect(() => {
    console.log('[hello] effect#2 mount')
    return () => console.log('[hello] effect#2 dispose')
  })
}