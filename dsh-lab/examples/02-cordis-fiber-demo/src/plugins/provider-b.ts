import type { Context } from 'cordis'

export const name = 'provider-b'

export function apply(ctx: Context) {
  ctx.provide('tick', { n: 2 })
}