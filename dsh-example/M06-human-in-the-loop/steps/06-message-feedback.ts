/** command feedback 与 message feedback 共用 Session 日志；后者经 persistence 保证耐久。 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as commandFeedback from '@deepseek-ai/dsh-command-feedback'
import MessageFeedbackService from '@deepseek-ai/dsh-message-feedback'

export interface Config { root: string; maxNoteBytes: number }
export const name = 'offline-feedback-stack'
export const Config: z<Config> = z.object({
  root: z.string().required(),
  maxNoteBytes: z.number().step(1).min(1).required(),
})
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(JsonlSessionPersistence, { root: config.root, compression: 'none' })
  await ctx.plugin(commandFeedback)
  await ctx.plugin(MessageFeedbackService, { maxNoteBytes: config.maxNoteBytes })
}
