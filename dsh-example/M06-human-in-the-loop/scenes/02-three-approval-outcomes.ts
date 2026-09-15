/**
 * 模块 M06 的对应场景：三种应答局面。deploy 工具在 pre-execute 里被 ask：
 *   A) 无应答器        → fail closed（unavailable，拒绝）
 *   B) 应答器放行白名单 → allowed-once（真正执行）
 *   C) 应答器拒绝      → rejected
 * `npm run M06`。
 *
 * 真实 `ApprovalService` 有一条**不变量**：`approval.request()` 必须发生在**打开的 turn 内**
 * ——`approval/asked` + `approval/decided` 这对审计事件要被 turn 包住，否则重放时是崩溃尾巴。
 * 所以这里不能在 turn 外裸调工具，而是用明确的指令让**真实模型**在 turn 里派发 deploy，
 * 审批自然发生在轮内。
 *
 * 三个场景各需要一次真实调用；每个场景都从会话日志核验 `approval/decided` 确实发生，
 * 否则 fail loud（这正是本阶段要演示的机制）。
 */
import { createHarness, demoTool } from '../../runtime/harness.ts'
import * as answererPlugin from '../impl/02-approval-answerer.ts'

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

/** 必须动用 deploy 才能满足的指令：明确点名工具并要求调用其参数。 */
const PROMPT = '请调用 deploy 工具把服务部署到 prod 环境。必须调用该工具，不要只给出建议。'

async function scenario(label: string, plugins: Array<[unknown, unknown?]>): Promise<void> {
  console.log(label)
  const harness = await createHarness({
    plugins: [[deployGate], ...plugins],
  })
  const { session } = await harness.runTurn({ prompt: PROMPT })

  let sawToolCall = false
  let outcome: unknown
  // 真实事件序列：tool/call → approval/asked → approval/decided → tool/result
  for (const event of session.snapshotEvents()) {
    const data = event.data as any
    if (event.type === 'tool/call' && data.name === 'deploy') sawToolCall = true
    if (event.type === 'approval/decided') {
      outcome = data.outcome
      console.log('  approval/decided → outcome:', data.outcome)
    }
    if (event.type === 'tool/result') {
      const block = data.message?.content?.[0]
      const text = block?.content?.[0]
      console.log('  tool/result      → isError:', block?.isError ?? false, '|', text?.type === 'text' ? text.text : JSON.stringify(text))
    }
  }
  await harness.dispose()

  if (!sawToolCall) {
    throw new Error(`${label.trim()}：模型本轮没有调用 deploy —— 审批链路未被验证`)
  }
  if (outcome === undefined) {
    throw new Error(`${label.trim()}：deploy 被调用但没有发生 approval/decided —— 审批不变量未被验证`)
  }
}

await scenario('== 场景：无应答器 → fail closed ==', [])
await scenario('\n== 场景：应答器把 deploy 列入白名单 → allowed-once ==', [[answererPlugin, { autoApprove: ['deploy'] }]])
await scenario('\n== 场景：应答器不在白名单 → rejected ==', [[answererPlugin, { autoApprove: [] }]])
