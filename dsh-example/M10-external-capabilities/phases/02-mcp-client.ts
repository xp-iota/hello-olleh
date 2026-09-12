import { createHarness } from '../../runtime/harness.ts'
import * as mcpClient from '../steps/02-mcp-client.ts'

const harness = await createHarness()
const fiber = harness.ctx.plugin(mcpClient, {
  transport: 'stdio',
  serverName: 'offline_missing',
  command: '/definitely/not/a/real/mcp-server',
  args: [],
  env: {},
  cwd: process.cwd(),
  toolCallTimeoutMs: 1_000,
  failOnStartupError: true,
  reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 10, maxAttempts: 1 },
})
let rejected = ''
try { await fiber } catch (error) { rejected = error instanceof Error ? error.message : String(error) }
console.log('mcp:', { transport: 'stdio', networkUsed: false, failLoud: rejected.length > 0, reason: rejected })
await fiber.dispose()
await harness.dispose()
