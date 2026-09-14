import { createHarness } from '../../runtime/harness.ts'
import * as agentPresets from '../steps/02-agent-presets.ts'

const harness = await createHarness({ plugins: [[agentPresets]] })
console.log('agentPresets:', { service: harness.ctx.agentPresets.constructor.name, configuredRoots: harness.ctx.agentPresets.roots.length, discovered: (await harness.ctx.agentPresets.list()).length })
await harness.dispose()
