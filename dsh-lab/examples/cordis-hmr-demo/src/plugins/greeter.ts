import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

export const tag = 'v1'

export function apply(ctx: Context) {
  console.log(`   [greeter] apply tag=${tag}`)
  ctx.provide('greeter', { tag })
}