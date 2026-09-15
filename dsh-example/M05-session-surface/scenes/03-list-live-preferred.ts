import { createHarness } from '../../runtime/harness.ts'
import ExactReadSessionQuery from '../impl/03-session-query.ts'

const harness = await createHarness()
await harness.loadPlugin(ExactReadSessionQuery)
const sessions = await harness.ctx.sessionQuery.listSessions()
console.log('sessionQuery:', { provider: harness.ctx.sessionQuery.constructor.name, livePreferredCount: sessions.length, firstId: sessions[0]?.header.id })
await harness.dispose()
