import type { Context } from 'cordis'

export const name = 'clock-provider'

export function apply(ctx: Context) {
  ctx.provide('clock', { now: () => 'root-clock' })
}