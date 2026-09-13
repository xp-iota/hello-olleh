/**
 * M04.2 · 钩子生命周期与中途引导（agent/* 策略事件）。
 *
 * 与 06（纯观测 session/event）不同：`agent/*` 是**携带活 Agent 的策略事件**，
 * 监听者既能观察、又能改变主循环走向。dsh 的用户级/项目级 hook 系统就是这组
 * 拦截点上的监听器（事件模式对照 core/agent/src/runtime-types.ts）：
 *   - agent/session-start   会话开始（emit，一次；payload 是 { agent, source }）
 *   - agent/pre-step        每个 step 之前（waterfall：可否决本步或改写进入本步的消息；
 *                           自动压缩压力检查就挂这里——见 M02 与 compaction-basic 源码）
 *   - agent/request         一次模型请求发出前（waterfall：可替换冻结的调用配置）
 *   - agent/turn-stopping   回合即将停止时（serial：没有 next）
 *
 * 关键点（对照 core/agent-loop/src/agent.ts 的 turn()）：
 *   - waterfall 监听者纯观察也必须 `return next()`——不调 next() 就是否决整条链。
 *   - turn-stopping 不靠返回值表态：反对停止的监听者调 `agent.steer(...)` 把消息塞进
 *     inbox；主循环派发后重读 inbox.nextStep——非空就再跑一个 step，空才关轮。
 *     "data decides"：监听者顺序不能改变结果。
 *   - 引导用 `agent.steer(...)`（插进当前轮的下一步）而非 `agent.followup(...)`（排到下一轮）。
 *   - 本例演示"检测到助手想收尾但还有 TODO 未做完 → 强制再走一步"，最多引导一次。
 */
import type { Context } from '@deepseek-ai/cordis'

// 这是 Cordis 的插件标识；hook 的实际事件名在 apply 的 ctx.on(...) 中声明。
// 依赖 agents 是为了保证 agent 生命周期事件已经由 agent 服务提供。
export const name = 'hooks-lifecycle-steering'
export const inject = ['agents']

export function apply(ctx: Context) {
  // 只做一次引导，避免死循环。
  let hasSteered = false

  ctx.on('agent/session-start', ({ agent, source }: any) => {
    console.log(`[hooks] session-start：agent=${agent.id} source=${source}`)
  })

  ctx.on('agent/pre-step', (payload: any, next: () => any) => {
    console.log(`[hooks] pre-step：turn=${payload.turn} step=${payload.step}，认领消息 ${payload.messages.length} 条`)
    return next() // 纯观察也必须交回 next()，否则等于否决本步
  })

  ctx.on('agent/request', (payload: any, next: () => any) => {
    console.log(`[hooks] request：turn=${payload.turn} step=${payload.step} 即将发出模型请求`)
    return next() // 想换 provider/model 时返回替换后的 config；这里只观察
  })

  // turn-stopping 是 serial：没有 next；反对停止就 agent.steer()，然后返回 void。
  ctx.on('agent/turn-stopping', ({ agent, turn }: any) => {
    if (hasSteered) return // 已引导过一次 → 放行，回合正常关闭
    hasSteered = true
    console.log(`[hooks] turn-stopping：turn=${turn} 发现还有未清 TODO → steer 一条引导，强制再走一步`)
    agent.steer({
      role: 'user',
      content: [{ type: 'text', text: '请继续：还有 TODO 未处理完。' }],
      source: { kind: 'hook', hook: name },
    })
  })
}
