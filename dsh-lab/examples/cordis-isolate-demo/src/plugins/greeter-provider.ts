import type { Context } from 'cordis'

export const name = 'greeter-provider'

export function apply(ctx: Context, config: { text: string }) {
  ctx.provide('greeter', { greet: () => config.text })
}