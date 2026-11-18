import type { Context } from 'cordis'
import { hits } from '../state.ts'

export const name = 'tick-listener'

export function apply(ctx: Context, config: { label: string }) {
  ctx.on('lab/tick', () => hits.push(config.label))
}