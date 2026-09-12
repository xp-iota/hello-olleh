import { createHarness } from '../../runtime/harness.ts'
import * as localReviewer from '../../M08-delegation-presets/steps/01-subagent-delegation.ts'
import WorkerThreadWorkflowEngine from '../steps/03-workflow-engine.ts'

const harness = await createHarness({ plugins: [[localReviewer]] })
await harness.loadPlugin(WorkerThreadWorkflowEngine, {
  provider: 'local-reviewer',
  maxConcurrentAgents: 2,
  maxTotalAgents: 4,
  maxItemsPerCall: 16,
  syncTimeoutMs: 1_000,
  disposeGraceMs: 1_000,
})
const run = harness.ctx.workflowEngine.start({
  parent: harness.agent,
  meta: { name: 'offline-flow', description: '不发网络的 worker-thread 教学工作流' },
  script: "phase('Compute'); log('worker is alive'); return { ok: true, value: 6 * 7 }",
})
const result = await run.result
console.log('workflowEngine:', { provider: harness.ctx.workflowEngine.constructor.name, stopReason: result.stopReason, value: result.value, agentsStarted: result.agentsStarted })
await run.dispose()
await harness.dispose()
