/** 把超长纯文本工具结果写入本地 spillStore，并只把有界预览交给模型。 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import LocalSpillStore from '@deepseek-ai/dsh-spill-local'
import * as spillPolicy from '@deepseek-ai/dsh-spill-policy'

export interface Config {
  root: string
  maxInlineBytes: number
}

export const name = 'offline-spill-stack'
export const inject = ['tools']
export const Config: z<Config> = z.object({
  root: z.string().required(),
  maxInlineBytes: z.number().step(1).min(1).required(),
})

export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(LocalSpillStore, { root: config.root, cleanupPeriodDays: 0 })
  await ctx.plugin(spillPolicy, { maxInlineBytes: config.maxInlineBytes })
}
