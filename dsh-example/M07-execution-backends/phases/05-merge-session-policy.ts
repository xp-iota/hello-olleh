import { createHarness } from '../../runtime/harness.ts'
import SandboxPolicyService, { setSandboxMode } from '../steps/05-sandbox-policy.ts'

const harness = await createHarness()
await harness.loadPlugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: process.cwd() })
const before = harness.ctx.sandboxPolicy.resolve({ session: harness.agent.session })
setSandboxMode(harness.agent.session, 'workspace-write')
const after = harness.ctx.sandboxPolicy.resolve({ session: harness.agent.session })
console.log('sandboxPolicy:', { default: before.mode, sessionOverride: after.mode, workspaceRoot: after.workspaceRoot })
await harness.dispose()
