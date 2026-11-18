import type { Context } from 'cordis'

export const name = 'greeter-consumer'
export const inject = ['greeter']

export function apply(ctx: Context, config: { label: string }) {
  console.log(`   [${config.label}] greeter =`, ctx.greeter.greet())
}