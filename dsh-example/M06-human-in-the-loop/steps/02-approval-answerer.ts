/**
 * 13 · 人工审批应答器（ctx.approval / approval/request）。
 *
 * 03 演示从 `tools/pre-execute` 返回 `{ kind:'ask' }`；被 ask 的调用会流向 **审批 seam**：
 * `ctx.approval.request(req)` 把请求交给监听 `approval/request` 的应答器（answerer）裁决。
 * 应答器返回封闭四值 ApprovalOutcome：
 *   'allowed-once'  唯一放行授权（仅本次）
 *   'rejected'      人类明确拒绝
 *   'cancelled'     取消（signal）
 *   'unavailable'   没有应答器 / 抛错 —— **fail closed**
 * CLI 弹交互、Web 弹审批卡、CI 里的"自动放行白名单"、YOLO 全放行，都是不同的应答器实现。
 *
 * 关键点：
 *   - 本插件只做"应答器"这一件事，不碰工具、不碰 pre-execute → 换工具/换策略照旧生效。
 *   - 应答器是 waterfall：可用 next() 把决定权交给链上更专门的应答器。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import z from '@deepseek-ai/schemastery'

export interface Config {
  /** 免确认即放行的工具名（其余一律 rejected）。 */
  autoApprove: string[]
}

// 插件名供 Cordis 诊断使用；它不是 approval 请求里的 answer 值。
export const name = 'approval-answerer'
// 只监听事件，不注入任何服务。
// 该示例只监听全局 approval 事件，不直接消费 ctx 服务，所以依赖列表为空。
export const inject = []
// answer/schema 等外部选项在加载时由此 schema 校验并补默认值。
export const Config: z<Config> = z.object({
  autoApprove: z.array(z.string()).default([]),
})

export function apply(ctx: Context, config: Config) {
  ctx.on('approval/request', async (req: ApprovalRequest): Promise<ApprovalOutcome> => {
    if (config.autoApprove.includes(req.toolName)) {
      console.log(`[approval] 自动放行(allowed-once)：${req.toolName}`)
      return 'allowed-once'
    }
    console.log(`[approval] 拒绝(rejected)：${req.toolName} —— ${req.reason ?? '无因'}`)
    return 'rejected'
  })
}
