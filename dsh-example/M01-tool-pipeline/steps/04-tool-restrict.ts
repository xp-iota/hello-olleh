/**
 * M01.4 · 收紧模型可见工具集（ctx.tools.restrict / 渐进式披露）。
 *
 * 注册表保持"展示 / 查找 / 执行"三者对齐：被 restrict 收紧掉的全局工具，模型看不见、
 * 也调不动（读作 absent / UNKNOWN_TOOL）。ToolSearch、按阶段放权、精简上下文窗口都用它。
 *
 * `restrict(filter)`：filter = { allow } 只保留、{ deny } 移除；同一 scope 上多次收紧**取交集**。
 * 返回 disposer → 撤销这条收紧。
 *
 * 关键点（这三条都是真实实现里会**抛错**的，不是风格建议）：
 *   - **必须经某个 agent 的 scoped context 调用**：`agent.ctx.tools.restrict(...)`。
 *     在 plain context（插件自己的 ctx）上调用会抛错 —— 一条 context-global 的收紧会遮蔽
 *     每一个 agent，那不是收紧而是误伤；要拒某个 agent 的工具就用它自己的 agent.ctx。
 *   - 空 filter（既没 allow 也没 deny）抛错：它几乎总是 config 物化成空导致的 bug。
 *   - 名字必须是**已注册的全局工具**；写错名字抛错，而不是静默无效。
 *   - 与 M01.5 的 `guard()` 不同：restrict 改的是"可见集"，guard 改的是"放行判定"；
 *     且 guard 在 plain context 上注册是合法的（全局生效）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export interface Config {
  /** 允许模型看到的工具名（空数组 = 不做收紧）。 */
  allow: string[]
}

// 插件名用于 Fiber/日志识别；这里同时依赖 tools（改工具可见性）和 agents（按 agent 配置）。
export const name = 'tool-restrict'
export const inject = ['tools', 'agents']
// 该 schema 是外部配置的入口，run.ts 和 cordis.yml 传入的值都会在启动时校验。
export const Config: z<Config> = z.object({
  allow: z.array(z.string()).default([]),
})

export function apply(ctx: Context, config: Config) {
  if (config.allow.length === 0) return // 空 filter 会抛错，所以这里直接不收紧
  const filter: ToolRestriction = { allow: config.allow }
  // 每个 agent 一进会话就按阶段放权（渐进式披露的真实落点）。
  // 用 WeakSet 去重：同一个 agent 多次开会话不应叠加同样的收紧。
  const armed = new WeakSet<object>()
  ctx.on('agent/session-start', ({ agent }: any) => {
    if (armed.has(agent)) return
    armed.add(agent)
    // 经 agent.ctx 收紧：只影响这个 agent。effect-based —— 但注意 effect 的**归属**是
    // 被调用的那个 context（`agent.ctx`），所以它随该 agent 一起回收，
    // 而不是随本插件的 fiber 回收（见 run.ts ⑥）。
    agent.ctx.tools.restrict(filter)
  })
}
