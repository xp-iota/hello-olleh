import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    clock: { now(): string }
  }
}

export function apply(ctx: Context) {
  console.log('   [clock] provider 上线')
  ctx.provide('clock', { now: () => 'tick' })
}