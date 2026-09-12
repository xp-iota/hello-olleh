/**
 * 模块 M01 的对应阶段：注册 4 个工具 → 插件在 `agent/session-start` 时只放行 echo/read →
 * 观察该 agent 的可见集 / schemas / 被收紧工具调用变 UNKNOWN_TOOL → disposer 精确撤销
 * 单条收紧 → 插件 fiber.dispose() 整树回收。另外演示三条 fail-closed 的抛错。`npm run M01`。
 *
 * 工具必须先注册，插件才能引用它们的名字（restrict 对未知名字抛错），
 * 所以这里用 `setup` 在造 agent 之前把工具装好、再把插件装上。
 */
import { createHarness, demoTool } from '../../runtime/harness.ts'
import * as restrictPlugin from '../steps/04-tool-restrict.ts'

// 先起一个空 harness 只为拿到 ctx？不行——restrict 依赖 agent/session-start。
// 正确顺序：把"注册 4 个工具"做成一个内联插件，和 11 一起在 agent 之前装载。
const seedTools = {
  name: 'seed-tools',
  inject: ['tools'],
  apply(ctx: any) {
    for (const n of ['echo', 'read', 'write', 'bash']) ctx.tools.register(demoTool(n))
  },
}

const harness = await createHarness({
  plugins: [[seedTools], [restrictPlugin, { allow: ['echo', 'read'] }]],
})
const { ctx, agent } = harness
const restrictFiber = harness.plugins[1]

console.log('① 全部已注册（全局视角）:', ctx.tools.schemas().map((schema) => schema.name))
console.log('② 该 agent 可见（已被收紧）:', harness.visibleTools())

const denied = await harness.callTool('write', { path: 'a.txt' })
console.log('③ 调用被收紧的 write → isError:', denied.isError, '|', denied.content[0]?.type === 'text' ? denied.content[0].text : '')

console.log('\n④ fail-closed 三连（真实实现的抛错原文）:')
for (const [label, run] of [
  ['plain context', () => ctx.tools.restrict({ allow: ['echo'] })],
  ['空 filter    ', () => agent.ctx.tools.restrict({})],
  ['未知工具名   ', () => agent.ctx.tools.restrict({ deny: ['nope'] })],
] as const) {
  try {
    run()
    console.log(`   ${label}: 竟然没抛错`)
  } catch (error) {
    console.log(`   ${label}:`, (error as Error).message)
  }
}

console.log('\n⑤ restrict 返回的 disposer 精确撤销这一条收紧（同 scope 多条取交集）:')
const lift = agent.ctx.tools.restrict({ deny: ['echo'] })
console.log('   再叠一条 deny echo →', harness.visibleTools())
lift()
console.log('   lift() 撤销这一条  →', harness.visibleTools(), '（插件那条收紧仍在）')

await restrictFiber.dispose()
console.log('\n⑥ 插件 fiber.dispose() 之后：')
console.log('   老 agent 仍被收紧 →', harness.visibleTools())
console.log('   —— 因为这条 restrict 是在 `agent.ctx` 上调的，effect 归**那个 agent 的 fiber**，')
console.log('      随 agent 一起回收；插件 fiber 只拥有它自己注册的那个 session-start 监听器。')

const second = await ctx.agents.create({ sessionId: 'agent-2' as any, agentOptions: { provider: 'mock', model: 'mock-1' } })
console.log('   新建的 agent 不再被收紧 →', harness.visibleTools(second.agent), '（监听器已随插件撤销）')
await second.dispose()

await harness.dispose()
