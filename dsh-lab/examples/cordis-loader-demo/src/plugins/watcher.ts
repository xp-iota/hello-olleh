import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

/** 插件本身不声明 inject：依赖由配置行追加（outer/inner 两层 Fiber）。 */
const applies = new Map<string, number>()

export function apply(ctx: Context, config: { tag?: string } = {}) {
  const key = config.tag ?? 'default'
  const n = (applies.get(key) ?? 0) + 1
  applies.set(key, n)
  const label = config.tag ? `watcher ${config.tag}` : 'watcher'
  console.log(`   [${label}] sees greeter = ${ctx.greeter.tag}，apply #${n}`)
}