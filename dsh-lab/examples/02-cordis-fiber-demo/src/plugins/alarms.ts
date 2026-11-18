import type { Context } from 'cordis'
import type {} from '@cordisjs/timer'
import { fired } from '../state.ts'

export const name = 'alarms'
export const inject = ['timer']

export function apply(ctx: Context) {
  ctx.timeout(() => fired.push('早闹钟(30ms)'), 30)
  ctx.timeout(() => fired.push('晚闹钟(200ms)'), 200)
}