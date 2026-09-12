import { createHarness } from '../../runtime/harness.ts'
import AgentDefaultModelConfig from '../steps/05-agent-default-model.ts'

const harness = await createHarness()
await harness.loadPlugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock-1' })
console.log('agentDefaultModel:', harness.ctx.agentDefaultModel.currentSelection())
await harness.dispose()
