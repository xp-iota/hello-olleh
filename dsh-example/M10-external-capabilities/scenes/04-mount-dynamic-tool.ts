import { createHarness } from '../../runtime/harness.ts'
import * as extensions from '../impl/04-cordis-extensions.ts'

const harness = await createHarness({ plugins: [[extensions]] })
console.log('extensions:', {
  dynamicRunner: harness.ctx.dynamicCordisRunner.constructor.name,
  inspectRegistry: harness.ctx.cordisInspect.constructor.name,
  tools: harness.visibleTools().filter(name => name.startsWith('cordis_')),
})
await harness.dispose()
