import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHarness } from '../../runtime/harness.ts'
import * as jsonStorage from '../impl/02-json-storage-domain.ts'

const root = await mkdtemp(join(tmpdir(), 'dsh-example-storage-'))
const harness = await createHarness({ plugins: [[jsonStorage, { root }]] })
try {
  console.log('storage:', { hub: harness.ctx.storage.constructor.name, backend: harness.ctx.storage.backend.get('json').constructor.name, domainFacility: harness.ctx.storageDomain.constructor.name })
} finally {
  await harness.dispose()
  await rm(root, { recursive: true, force: true })
}
