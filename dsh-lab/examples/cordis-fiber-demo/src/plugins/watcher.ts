import type { Context } from 'cordis'
import { counters } from '../state.ts'

export const name = 'watcher'
export const inject = ['tick']

export function apply(ctx: Context) {
  counters.applies++
  console.log(`   [watcher] 第 ${counters.applies} 次激活，tick.n =`, ctx.tick.n)
}