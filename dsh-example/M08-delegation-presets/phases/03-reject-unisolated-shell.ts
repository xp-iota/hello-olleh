import { createHarness } from '../../runtime/harness.ts'
import PermissionPresetService from '../steps/03-permission-presets.ts'

const harness = await createHarness()
const fiber = harness.ctx.plugin(PermissionPresetService, {})
let rejected = ''
try {
  await fiber
} catch (error) {
  rejected = error instanceof Error ? error.message : String(error)
}
console.log('permissionPresets:', { failLoud: rejected.includes('does not confine'), reason: rejected })
await fiber.dispose()
await harness.dispose()
