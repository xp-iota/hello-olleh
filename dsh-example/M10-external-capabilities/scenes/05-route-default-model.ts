import { REAL_PROVIDER, createHarness, realConfig } from '../../runtime/harness.ts'
import AgentDefaultModelConfig from '../impl/05-agent-default-model.ts'

const harness = await createHarness()
await harness.loadPlugin(AgentDefaultModelConfig, { provider: REAL_PROVIDER, model: realConfig().model })
console.log('agentDefaultModel:', harness.ctx.agentDefaultModel.currentSelection())
await harness.dispose()
