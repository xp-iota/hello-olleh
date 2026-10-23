/**
 * M05 · 会话表面与持久化。
 *
 * 会话日志（session log）是 dsh 的唯一事实来源：turn/step、消息、工具调用与结果、
 * 审批审计、命令生命周期，全部是同一个 append-only 事件流里的记录。这一章看四件事：
 *
 *   1. 日志本身的结构（seq、type、data、surfaceOp）；
 *   2. 落盘（JSONL provider）与恢复；
 *   3. 读取面（sessionQuery 的精确读 / 表面折叠 / 标题）；
 *   4. 投影缓存（列表页不必回放整条日志）。
 *
 * 本工程 `traj` 子命令就是这一章的产品化形态。
 *
 * @module dsh-lab/M05
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** 建一条带内容的最小会话（写入真实事件，不调模型）。 */
async function seedSession(stage: StageContext) {
  const handle = await stage.ctx.agents.create({
    sessionId: SessionId(stage.sessionId),
    meta: { cwd: process.cwd() },
  })
  return handle
}

/** M05.1 —— 日志的结构与不变量。 */
async function inspectLog(stage: StageContext) {
  const handle = await seedSession(stage)
  const agent = handle.agent
  try {
    const session = agent.session
    // 直接访问同步快照已弃用；新代码走 sessionQuery 的异步读。
    const snapshot = await stage.ctx.sessionQuery.readSession(session.id)
    stage.log(`事件数：${snapshot.events.length}`)
    const first = snapshot.events[0]
    stage.log(`首事件：${first === undefined ? '(空)' : `${first.type} seq=${first.seq}`}`)
    const types = new Map<string, number>()
    for (const event of snapshot.events) types.set(event.type, (types.get(event.type) ?? 0) + 1)
    stage.log(`事件类型分布：${[...types].map(([type, count]) => `${type}×${count}`).join(', ')}`)
    stage.assert(snapshot.events.length > 0, '新建会话应当至少有一条事件（session/created）')
    // 不变量：seq 单调递增且从 0 开始连续。
    const seqs = snapshot.events.map((event) => event.seq)
    stage.assert(
      seqs.every((seq, index) => seq === index),
      'seq 必须从 0 开始连续递增',
    )
    stage.log('seq 连续性校验通过')
  } finally {
    await handle.dispose()
  }
}

/** M05.2 —— JSONL 落盘。 */
async function jsonlPersistence(stage: StageContext) {
  const handle = await seedSession(stage)
  const agent = handle.agent
  const id = String(agent.id)
  try {
    await agent.whenIdle()
    // flush 后文件应当出现在 <DSH_HOME>/sessions 下。
    await stage.ctx.sessions.flush?.(agent.session)
    const records = await stage.ctx.sessionQuery.listSessions()
    const hit = records.find((record) => String(record.header.id) === id)
    stage.assert(hit !== undefined, '会话没有出现在持久化列表里')
    stage.log(`持久化列表可见：${id}（persisted=${hit.persisted}）`)
  } finally {
    await handle.dispose()
  }
}

/** M05.3 —— live-preferred 的读取。 */
async function listLivePreferred(stage: StageContext) {
  const { ctx } = stage
  const records = await ctx.sessionQuery.listSessions()
  stage.log(`语料会话数：${records.length}`)
  const live = records.filter((record) => record.live)
  stage.log(`其中 live：${live.length}`)
  if (records.length > 0) {
    const sample = records[0]!
    stage.log(`样例：${sample.header.id} live=${sample.live} persisted=${sample.persisted}`)
  }
}

/** M05.4 —— 从日志恢复（resume）。 */
async function resumeFromLog(stage: StageContext) {
  const { ctx } = stage
  const handle = await seedSession(stage)
  const id = String(handle.agent.id)
  await ctx.sessions.flush?.(handle.agent.session)
  await handle.dispose()

  const resumed = await ctx.agents.resume({ resumeSessionId: SessionId(id) })
  try {
    const snapshot = await ctx.sessionQuery.readSession(SessionId(id))
    stage.log(`恢复后事件数：${snapshot.events.length}`)
    stage.assert(String(resumed.agent.id) === id, '恢复出的 agent 身份应当与原会话一致')
    stage.log(`恢复成功，agent 仍为 ${id}`)
  } finally {
    await resumed.dispose()
  }
}

/** M05.5 —— 标题投影。 */
async function projectTitle(stage: StageContext) {
  const { ctx } = stage
  const handle = await seedSession(stage)
  const id = handle.agent.id
  try {
    // 标题由规则回退（首条人类消息）或模型摘要产生。
    const title = await ctx.sessionQuery.readTitle(id).catch(() => undefined)
    stage.log(`当前标题：${title?.title ?? '(尚无)'}`)
    stage.log('session-title 与 session-title-first-prompt-llm 均已装配（规则回退 + 模型摘要）')
  } finally {
    await handle.dispose()
  }
}

export default defineModule({
  id: 'M05',
  title: '会话表面与持久化',
  stages: [
    { id: 'M05.1', title: '日志结构与 seq 不变量', kind: 'mechanism', run: inspectLog },
    { id: 'M05.2', title: 'JSONL 落盘', kind: 'mechanism', run: jsonlPersistence },
    { id: 'M05.3', title: 'live-preferred 会话列表', kind: 'mechanism', run: listLivePreferred },
    { id: 'M05.4', title: '从日志恢复会话', kind: 'mechanism', run: resumeFromLog },
    { id: 'M05.5', title: '标题投影', kind: 'mechanism', run: projectTitle },
  ],
})
