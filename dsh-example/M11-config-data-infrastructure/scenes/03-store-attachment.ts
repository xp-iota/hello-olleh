import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHarness } from '../../runtime/harness.ts'
import LocalAttachmentStore from '../impl/03-local-attachments.ts'

const dshHome = await mkdtemp(join(tmpdir(), 'dsh-example-attachments-'))
const harness = await createHarness()
try {
  await harness.loadPlugin(LocalAttachmentStore, { dshHome })
  const ref = await harness.ctx.attachments.saveFile({ data: Uint8Array.from([79, 75]), name: 'sample.bin' })
  console.log('attachments:', { backend: harness.ctx.attachments.constructor.name, attachmentId: String(ref.attachmentId), name: ref.name })
} finally {
  await harness.dispose()
  await rm(dshHome, { recursive: true, force: true })
}
