/**
 * 12 · 单调拒绝守卫（ctx.tools.guard）。
 *
 * 与 [03] 的 `tools/pre-execute` 相比：pre-execute 是"可重排策略链"，后面的监听者
 * 可以翻案放行；而 `guard()` 注册的是 **pre-execute 之后的单调最终拒绝**——
 * 任一命中的 guard 可以拒绝，但**没有任何 guard / 监听者能强制放行**另一个 guard 已拒的调用。
 * 适合放"绝不逾越"的硬红线（危险命令、越权路径），换 provider / 换主循环都照旧生效。
 *
 * `ctx.tools.guard(fn)`：fn(exec) 返回字符串即拒绝（字符串是给用户/模型的理由），
 * 返回 undefined 表示本守卫不置可否。返回 disposer。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolGuard } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export interface Config {
  /** 命中即拒绝的危险子串（对 bash 工具的 cmd 参数做包含匹配）。 */
  denyPatterns: string[]
}

// `name` 只是插件/Fiber 标识；不可翻案的拒绝规则由 apply 中的 tools.guard 注册。
// guard 必须挂在 tools 服务上，因此把 tools 写进 inject，保证服务先完成装配。
export const name = 'tool-guard'
export const inject = ['tools']
// 配置 schema 将用户配置转换成类型安全的 denyList，并为缺省情况提供空数组。
export const Config: z<Config> = z.object({
  denyPatterns: z.array(z.string()).default([]),
})

export function apply(ctx: Context, config: Config) {
  const guard: ToolGuard = (exec) => {
    // exec.arguments 的静态类型是 unknown（守卫要对任意工具生效），自己收窄。
    const cmd = (exec.arguments as { cmd?: string } | null)?.cmd ?? ''
    for (const p of config.denyPatterns) {
      if (cmd.includes(p)) return `命令命中危险模式 "${p}"，被单调守卫拒绝`
    }
    return undefined // 本守卫不置可否，交给链上其它守卫/默认放行
  }
  // effect-based：fiber 销毁即撤销该守卫。
  ctx.tools.guard(guard)
}
