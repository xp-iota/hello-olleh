/** storage 是 backend hub；storageDomain 把声明式 domain 路由到 JSON backend。 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'

export interface Config { root: string }
export const name = 'json-storage-domain'
export const Config: z<Config> = z.object({ root: z.string().required() })
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root: config.root })
  await ctx.plugin(storageDomain, { backend: 'json', routes: {} })
}
