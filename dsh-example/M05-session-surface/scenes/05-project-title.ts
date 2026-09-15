import { createHarness } from '../../runtime/harness.ts'
import SessionTitleService from '../impl/05-session-title.ts'

const harness = await createHarness()
await harness.loadPlugin(SessionTitleService, { fallbackMaxWords: 8, fallbackMaxBytes: 64, maxTitleBytes: 96 })
const renamed = harness.ctx.sessionTitle.rename(harness.agent.session, '  会话服务链  ')
console.log('sessionTitle:', { title: renamed.title, source: renamed.source.kind, foldedAgain: harness.ctx.sessionTitle.get(harness.agent.session)?.title })
await harness.dispose()
