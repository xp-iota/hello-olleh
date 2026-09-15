import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHarness } from '../../runtime/harness.ts'
import * as workspaceStack from '../impl/06-workspace-registry.ts'

const root = await mkdtemp(join(tmpdir(), 'dsh-example-workspace-'))
const harness = await createHarness({ plugins: [[workspaceStack, { root }]] })
try {
  console.log('workspaceRegistry:', { service: harness.ctx.workspaceRegistry.constructor.name, listed: harness.ctx.workspaceRegistry.list().length, persistence: harness.ctx.sessionPersistence.constructor.name })
} finally {
  await harness.dispose()
  await rm(root, { recursive: true, force: true })
}
