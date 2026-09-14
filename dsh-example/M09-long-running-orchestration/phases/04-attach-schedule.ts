import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createHarness } from '../../runtime/harness.ts'
import * as schedule from '../steps/04-schedule.ts'

const root = await mkdtemp(join(tmpdir(), 'dsh-example-schedule-'))
const harness = await createHarness({ plugins: [[JsonlSessionPersistence, { root, compression: 'none' }], [schedule]] })
try {
  const tools = harness.visibleTools().filter(name => name.includes('schedule'))
  console.log('schedule:', { persistence: harness.ctx.sessionPersistence.constructor.name, tools })
} finally {
  await harness.dispose()
  await rm(root, { recursive: true, force: true })
}
