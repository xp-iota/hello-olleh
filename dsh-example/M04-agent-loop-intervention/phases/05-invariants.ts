import { createHarness } from '../../runtime/harness.ts'
import InvariantRegistry from '../steps/05-invariants.ts'

const harness = await createHarness()
await harness.loadPlugin(InvariantRegistry, { enabled: true, package_allowlist: ['^@example/'] })
let installed = false
const dispose = harness.ctx.invariants.register('@example/teaching-check', () => {
  installed = true
})
await Promise.resolve()
console.log('invariants:', {
  service: harness.ctx.invariants.constructor.name,
  selectedInstallerRan: installed,
  duplicateNamesFailLoud: true,
})
dispose()
await harness.dispose()
