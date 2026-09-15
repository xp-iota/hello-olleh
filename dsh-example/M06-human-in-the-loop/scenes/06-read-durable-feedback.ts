import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHarness } from '../../runtime/harness.ts'
import * as feedbackStack from '../impl/06-message-feedback.ts'

const root = await mkdtemp(join(tmpdir(), 'dsh-example-feedback-'))
const harness = await createHarness({ plugins: [[feedbackStack, { root, maxNoteBytes: 512 }]] })
try {
  const listed = await harness.ctx.messageFeedback.list({ sessionId: harness.agent.session.id })
  console.log('messageFeedback:', { service: harness.ctx.messageFeedback.constructor.name, persistence: harness.ctx.sessionPersistence.constructor.name, listResult: listed })
} finally {
  await harness.dispose()
  await rm(root, { recursive: true, force: true })
}
