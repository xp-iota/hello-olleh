import type { Context } from 'cordis'
import { order } from '../state.ts'

export const name = 'noisy'

export function apply(ctx: Context) {
  ctx.effect(() => {
    order.push('装 A')
    return () => order.push('卸 A')
  })
  ctx.effect(() => {
    order.push('装 B')
    return () => order.push('卸 B')
  })
  ctx.on('lab/ping', () => order.push('听到 ping'))
}