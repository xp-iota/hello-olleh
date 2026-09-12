import { createHarness } from '../../runtime/harness.ts'
import TerminalSessionService, { TerminalError } from '../steps/04-terminal-sessions.ts'

const harness = await createHarness()
await harness.loadPlugin(TerminalSessionService)
let rejection: { name: string; code?: string } | undefined
try {
  await harness.ctx.terminals.spawn(harness.agent, { type: 'bash' })
} catch (error) {
  rejection = error instanceof TerminalError ? { name: error.name, code: error.code } : { name: String(error) }
}
console.log('terminals:', { backends: harness.ctx.terminals.listBackends(), rejection, nativeBackendSkipped: 'npm install scripts were not approved' })
await harness.dispose()
