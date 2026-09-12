/** SessionQueryEngine 把精确读取留在 Definition，把全文检索留给可替换 Provider。 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type {
  SessionEventSearchPage,
  SessionEventSearchRequest,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query'

export class ExactReadSessionQuery extends SessionQueryEngine {
  constructor(ctx: Context) {
    super(ctx)
  }
  async searchSessions(_request: SessionSearchRequest, _exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>> {
    throw new Error('demo query provider intentionally implements exact reads only')
  }
  async searchEvents(_request: SessionEventSearchRequest, _exec?: SessionSearchExecContext): Promise<SessionEventSearchPage> {
    throw new Error('demo query provider intentionally implements exact reads only')
  }
}

export default ExactReadSessionQuery
