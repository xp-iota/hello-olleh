/**
 * 模块 M06 的对应阶段：三种应答局面。deploy 工具在 pre-execute 里被 ask：
 *   A) 无应答器        → fail closed（unavailable，拒绝）
 *   B) 应答器放行白名单 → allowed-once（真正执行）
 *   C) 应答器拒绝      → rejected
 * `npm run M06`。
 *
 * 真实 `ApprovalService` 有一条**不变量**：`approval.request()` 必须发生在**打开的 turn 内**
 * ——`approval/asked` + `approval/decided` 这对审计事件要被 turn 包住，否则重放时是崩溃尾巴。
 * 所以这里不能在 turn 外裸调工具，而是用一个"会调工具"的 mock 适配器让**真实 agent-loop**
 * 在 turn 里派发 deploy，审批自然发生在轮内。
 */
import { createHarness, demoTool, ToolCallingMockAdapter } from '../../runtime/harness.ts'
import * as answererPlugin from '../steps/02-approval-answerer.ts'

/** 一个内联插件：注册 deploy 工具，并对它一律先"请示人类"。 */
const deployGate = {
  name: 'deploy-gate',
  inject: ['tools'],
  apply(ctx: any) {
    ctx.tools.register(demoTool('deploy', '部署到指定环境'))
    ctx.on('tools/pre-execute', async (exec: any, next: () => any) =>
      exec.name === 'deploy' ? { kind: 'ask', reason: '部署需人工确认' } : next())
  },
}

async function scenario(label: string, plugins: Array<[unknown, unknown?]>): Promise<void> {
  console.log(label)
  const harness = await createHarness({
    adapter: new ToolCallingMockAdapter('deploy', { env: 'prod' }),
    plugins: [[deployGate], ...plugins],
  })
  const { session } = await harness.runTurn({ prompt: '把服务部署到 prod' })
  // 真实事件序列：tool/call → approval/asked → approval/decided → tool/result
  for (const event of session.snapshotEvents()) {
    const data = event.data as any
    if (event.type === 'approval/decided') console.log('  approval/decided → outcome:', data.outcome)
    if (event.type === 'tool/result') {
      const block = data.message?.content?.[0]
      const text = block?.content?.[0]
      console.log('  tool/result      → isError:', block?.isError ?? false, '|', text?.type === 'text' ? text.text : JSON.stringify(text))
    }
  }
  await harness.dispose()
}

await scenario('== 场景：无应答器 → fail closed ==', [])
await scenario('\n== 场景：应答器把 deploy 列入白名单 → allowed-once ==', [[answererPlugin, { autoApprove: ['deploy'] }]])
await scenario('\n== 场景：应答器不在白名单 → rejected ==', [[answererPlugin, { autoApprove: [] }]])
