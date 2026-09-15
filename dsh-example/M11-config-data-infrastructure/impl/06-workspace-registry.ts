/** workspaceRegistry 在 storageDomain 中保存 workspace 视图，并用 persistence 校验 Session。 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import * as jsonStorage from './02-json-storage-domain.ts'

export interface Config { root: string }
export const name = 'offline-workspace-registry'
export const Config: z<Config> = z.object({ root: z.string().required() })
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(jsonStorage, { root: join(config.root, 'storage') })
  await ctx.plugin(JsonlSessionPersistence, { root: join(config.root, 'sessions'), compression: 'none' })
  await ctx.plugin(WorkspaceRegistry)
}
