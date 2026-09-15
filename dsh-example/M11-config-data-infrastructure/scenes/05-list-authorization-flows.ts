import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createHarness } from '../../runtime/harness.ts'
import * as credentialsStack from '../impl/05-credentials-authorization.ts'

const root = await mkdtemp(join(tmpdir(), 'dsh-example-credentials-'))
const harness = await createHarness({ plugins: [[credentialsStack, { path: join(root, 'credentials.yaml') }]] })
try {
  const info = await harness.ctx.credentials.describe(credentialRef('DSH_EXAMPLE_UNSET_CREDENTIAL'))
  console.log('credentials:', { provider: harness.ctx.credentials.constructor.name, safeDescription: info, authorizationFlows: harness.ctx.authorization.list() })
} finally {
  await harness.dispose()
  await rm(root, { recursive: true, force: true })
}
