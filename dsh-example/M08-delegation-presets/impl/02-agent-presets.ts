/** 在 Loader 提供的 baseUrl 下装配空 roster，演示 agentPresets 服务而不扫描用户目录。 */
import type { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'

export const name = 'offline-agent-presets'
export const inject = ['sessionProjections']
export async function apply(ctx: Context): Promise<void> {
  const composition = ctx.extend({ baseUrl: import.meta.url })
  await composition.plugin(Loader, { baseUrl: import.meta.url })
  await composition.plugin(AgentPresets, {
    default: 'none',
    roots: [],
    includeShippedRoot: false,
    includeUserRoot: false,
  })
}
