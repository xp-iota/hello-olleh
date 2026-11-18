import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

let applies = 0

export function apply(ctx: Context, config: { tag: string }) {
  applies++
  console.log(`   [greeter ${config.tag}] apply #${applies}`)
  ctx.provide('greeter', { tag: config.tag })
}