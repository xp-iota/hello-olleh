/**
 * 模块 M08 的对应阶段：注册 provider + 工具 → 观测 subagent/* 事件 → 通过工具委派一次评审。
 * `npm run M08`。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as subagentPlugin from '../steps/01-subagent-delegation.ts'

const harness = await createHarness()

// 像 [06] 那样观测子代理生命周期（真实 payload：SubagentRunInfo / SubagentRunEndInfo）。
harness.ctx.on('subagent/start', (info) => console.log('[event] subagent/start → provider=%s child=%s local=%s', info.provider, info.id, info.local))
harness.ctx.on('subagent/end', (info) => console.log('[event] subagent/end   → runId=%s stopReason=%s', info.runId, info.stopReason))

await harness.loadPlugin(subagentPlugin)

console.log('① 已注册子代理 provider:', harness.ctx.subagents.list())
console.log('② 已注册模型可见工具:', harness.visibleTools())

console.log('\n----- 模型调用 review_with_subagent（触发一次委派）-----')
// callTool 在这里扮演"模型已在 turn 里决定调用该工具"那一步：真实链路是
// 模型看到工具 schema → 自己决定发起委派 → agent 循环经 ctx.tools.execute 走到本例
// 插件的 execute → ctx.subagents.start('local-reviewer', ...)。本例不跑模型 turn。
const res = await harness.callTool('review_with_subagent', { task: '检查这个支付模块 diff' })
if (res.isError) throw new Error(`不该失败: ${res.error.message}`)
console.log('③ canonical value:', res.value)
console.log('④ render 给模型看:', res.content.map((block) => (block.type === 'text' ? block.text : block.type)).join(' | '))

await harness.dispose()
