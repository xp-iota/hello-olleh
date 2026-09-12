/**
 * 03 · 权限门（hook 插件）。
 *
 * dsh 的"原生 hook"就是一个监听拦截点的普通 cordis 插件，不需要外部协议。
 * `tools/pre-execute` 是可重排的策略 waterfall：每个监听者返回一个类型化决定
 * PreToolDecision：
 *   { kind: 'allow' }            放行
 *   { kind: 'deny'; reason }     拒绝（模型会收到 reason）
 *   { kind: 'ask'; reason? }     交给 ctx.approval 询问人类
 * 不调用 next() 就等于"截断"，通常配合 return 一个终态决定。
 *
 * 模式视角：本例是"以责任链（CoR）方式使用 waterfall"——命中黑名单 = 接盘并截链，
 * 未命中 = return next() 转发。但底层毕竟是 waterfall：下游决定在返回途中仍可被
 * 外层再加工——这正是下面"翻案"提醒的根源。
 * waterfall 与责任链的分界只在一处展开：docs/hello-cordis/06 篇 § 6.3.6。
 *
 * 关键点：
 *   - 策略别写死进工具本身，放到这个扩展点上——换 provider / 换主循环都照旧生效。
 *   - 需要"后续监听者无法翻案的最终拒绝"时，用 ctx.tools.guard()，而非这里。
 *   - exec.name 是被调用的工具名；这里演示"命中黑名单就拒绝"。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export interface Config {
  /** 未经确认即拒绝的工具名列表。 */
  denyList: string[]
}

// `name` 只用于识别这个插件；真正的权限规则在 apply 中监听 tools/pre-execute。
// `inject` 让 Cordis 先准备好 ctx.tools，再执行 apply，否则工具拦截点还不存在。
export const name = 'permission-gate'
export const inject = ['tools']
// 调用方可以在 cordis.yml 或 run.ts 传 denyList；schema 负责校验并提供空数组默认值。
export const Config: z<Config> = z.object({
  denyList: z.array(z.string()).default([]),
})

export function apply(ctx: Context, config: Config) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (config.denyList.includes(exec.name)) {
      // 简单起见直接拒绝；真实产品更可能 return { kind: 'ask', reason }
      // 让 ctx.approval 弹一个人类审批。
      // 责任链视角：这是"接盘并截链"——不调 next()，下游监听者与内建默认都不执行。
      return { kind: 'deny', reason: `工具 "${exec.name}" 被示例权限门拒绝。` }
    }
    // 不在黑名单 → 转发：交给链上下一个监听者，最后由内建默认放行。
    return next()
  })
}
