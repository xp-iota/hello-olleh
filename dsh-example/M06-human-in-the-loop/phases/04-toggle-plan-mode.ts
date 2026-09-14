import { createHarness } from '../../runtime/harness.ts'
import PlanModeController, { EXIT_PLAN_MODE } from '../steps/04-plan-mode.ts'

const harness = await createHarness()
await harness.loadPlugin(PlanModeController, { section: '计划模式只允许分析和规划；完成后显式请求退出。' })
const transition = harness.ctx.planMode.set(harness.agent, true)
console.log('planMode:', { transition, state: harness.ctx.planMode.get(harness.agent), exitToolVisible: harness.visibleTools().includes(EXIT_PLAN_MODE) })
await harness.dispose()
