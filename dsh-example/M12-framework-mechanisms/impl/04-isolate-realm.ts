/** isolate 为同名服务创建互不泄漏的解析 realm。 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    realmValue: { source: string }
  }
}

export interface Config { source: string }
export const name = 'isolate-realm-value'
export const Config: z<Config> = z.object({ source: z.string().required() })
export function apply(ctx: Context, config: Config): void {
  ctx.provide('realmValue', { source: config.source })
}
