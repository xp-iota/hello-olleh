/** 动态 runner 提供 extensions 执行面，tool-cordis 把 inspect/define 生命周期暴露成工具。 */
import type { Context } from '@deepseek-ai/cordis'
import DynamicCordisRunnerService from '@deepseek-ai/dsh-cordis-host-runner'
import * as toolCordis from '@deepseek-ai/dsh-tool-cordis'

export const name = 'offline-cordis-extensions'
export const inject = ['tools', 'systemPrompt']
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(DynamicCordisRunnerService, { vmTimeoutMs: 1_000 })
  await ctx.plugin(toolCordis)
}
