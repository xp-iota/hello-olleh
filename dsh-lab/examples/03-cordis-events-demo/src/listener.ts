import type { Context } from 'cordis'
import { hits } from './state.ts'

export const name = 'listener-plugin'

export function apply(ctx: Context) {
  ctx.on('lab/ping', () => hits.push('普通'))
  ctx.on('lab/ping', () => hits.push('prepend'), { prepend: true })
  ctx.once('lab/ping', () => hits.push('once'))
}