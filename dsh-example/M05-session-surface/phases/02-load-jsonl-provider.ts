import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHarness } from '../../runtime/harness.ts'
import JsonlSessionPersistence from '../steps/02-session-persistence.ts'

const root = await mkdtemp(join(tmpdir(), 'dsh-example-session-jsonl-'))
const harness = await createHarness()
try {
  await harness.loadPlugin(JsonlSessionPersistence, { root, compression: 'none' })
  console.log('sessionPersistence:', { backend: harness.ctx.sessionPersistence.constructor.name, storedSessions: (await harness.ctx.sessionPersistence.list()).length })
} finally {
  await harness.dispose()
  await rm(root, { recursive: true, force: true })
}
