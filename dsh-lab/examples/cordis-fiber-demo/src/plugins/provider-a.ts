import type { Context } from 'cordis'

export const name = 'provider-a'

export function apply(ctx: Context) {
  ctx.provide('tick', { n: 1 })
}