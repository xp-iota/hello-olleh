/** 用 storage → json backend → domain → cache 的真实 Provider 链保存 projection checkpoint。 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import SessionProjectionCache from '@deepseek-ai/dsh-session-projection-cache'

export interface Config { root: string }
export const name = 'json-session-projection-cache'
export const Config: z<Config> = z.object({ root: z.string().required() })

export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root: config.root })
  await ctx.plugin(storageDomain, { backend: 'json', routes: {} })
  await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 10, writeIntervalMs: 60_000 })
}
