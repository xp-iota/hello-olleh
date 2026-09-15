/** credentials 只暴露引用/状态；authorization 注册可撤销 flow，不让配置面读取 secret。 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import AuthorizationService from '@deepseek-ai/dsh-authorization'

export interface Config { path: string }
export const name = 'local-credentials-authorization'
export const Config: z<Config> = z.object({ path: z.string().required() })
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(LocalCredentialProvider, { path: config.path, watch: false, debounceMs: 0 })
  await ctx.plugin(AuthorizationService)
}
