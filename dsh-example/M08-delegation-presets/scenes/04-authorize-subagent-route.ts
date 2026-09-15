import { REAL_PROVIDER, createHarness, realConfig } from '../../runtime/harness.ts'
import SubagentModelSelectionConfig from '../impl/04-subagent-model-selection.ts'

const harness = await createHarness()
await harness.loadPlugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: [{ provider: REAL_PROVIDER, model: realConfig().model }] })
console.log('subagentModelSelection:', harness.ctx.subagentModelSelection.current())
await harness.dispose()
