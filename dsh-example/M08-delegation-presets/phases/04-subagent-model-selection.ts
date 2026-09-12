import { createHarness } from '../../runtime/harness.ts'
import SubagentModelSelectionConfig from '../steps/04-subagent-model-selection.ts'

const harness = await createHarness()
await harness.loadPlugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: [{ provider: 'mock', model: 'mock-1' }] })
console.log('subagentModelSelection:', harness.ctx.subagentModelSelection.current())
await harness.dispose()
