import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHarness, userText } from '../../runtime/harness.ts'
import * as projectionCache from '../steps/04-session-projection-cache.ts'

const root = await mkdtemp(join(tmpdir(), 'dsh-example-projection-cache-'))
const harness = await createHarness({ plugins: [[projectionCache, { root }]] })
try {
  harness.agent.session.append('user/message', userText('需要进入 checkpoint 的事实'), { surfaceOp: 'append' })
  await harness.ctx.sessionProjectionCache.write(harness.agent.session)
  const cached = harness.ctx.sessionProjectionCache.cachedSnapshot(
    harness.agent.session.header,
    harness.agent.session.inheritedEventCount,
  )
  console.log('sessionProjectionCache:', { backend: harness.ctx.storage.backend.get('json').constructor.name, cached: cached !== undefined, keys: Object.keys(cached?.values ?? {}) })
} finally {
  await harness.dispose()
  await rm(root, { recursive: true, force: true })
}
