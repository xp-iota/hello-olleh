import type { Context } from 'cordis'
import { Ticker } from '../seam.ts'

export const name = 'ticker'

export function apply(ctx: Context) {
  new Ticker(ctx)   // 构造即注册：root 行与 realm 行各有一份 ticker
}