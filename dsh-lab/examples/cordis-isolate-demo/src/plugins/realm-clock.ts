import type { Context } from 'cordis'

export const name = 'realm-clock'
export const inject = ['clock']

export function apply(ctx: Context) {
  console.log('   [realm-clock] clock.now() =', ctx.clock.now())
}