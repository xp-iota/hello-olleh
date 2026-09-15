/**
 * 模块 M02 的对应场景：装载 provider 类插件（构造即挂到 ctx.compaction）→ 逐条构建初始上下文 →
 * compactIfNeeded 触发折叠（插件内部判定逐步可见）→ 对照折叠前后的模型可见面 →
 * 再跑三个边界分支（不压 / 无可折 / 已 abort）→ dispose 卸载 seam。`npm run M02`。
 *
 * `CompactionResult` 的载体是 `CompactionAgentContext`（`{ session, options }`），
 * 所以这里可以直接拿真实 `ctx.sessions.create(...)` 造的会话喂进去，不必先有 agent。
 */
import type { CompactionAgentContext, ManualCompactAgentContext } from '@deepseek-ai/dsh-compaction'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { REAL_PROVIDER, createHarness, realConfig, userText } from '../../runtime/harness.ts'
import * as compactionPlugin from '../impl/03-compaction-provider.ts'

const harness = await createHarness()
// 类式插件：loadPlugin 会 `new DemoCompactionEngine(ctx, config)`，
// 构造里的 super(ctx) 就把它挂到了 ctx.compaction —— 没有任何手工 provide 调用。
const fiber = await harness.loadPlugin(compactionPlugin, { threshold: 8 })
console.log('① 已装载 compaction 实现:', harness.ctx.compaction?.constructor.name, '（构造里 super(ctx) 即挂载，无手工 provide）')

const signal = new AbortController().signal
/** 造一个压缩作用的载体（{ session, options, runMaintenance }），会话里预置 messageCount 条
 *  user 消息；log 时逐条打出追加过程（seq 由日志分配）。 */
const createAgentContext = (id: string, messageCount: number, log = false): ManualCompactAgentContext => {
  const session = harness.ctx.sessions.create(id as SessionId)
  for (let i = 0; i < messageCount; i++) {
    const appendEvent = session.append('user/message', userText(`m${i}`), { surfaceOp: 'append' })
    if (log) console.log(`     + seq ${String(appendEvent.seq).padStart(2)}  "m${i}"`)
  }
  return {
    session,
    options: { provider: REAL_PROVIDER, model: realConfig().model },
    async runMaintenance(task) { return task(signal) },
  }
}
const compaction = harness.ctx.compaction

/** 把模型可见面逐条打印（seq + 角色 + 文本）。 */
const printSurface = (session: Session, label: string): void => {
  console.log(`   ${label}（${session.surface.nodes.length} 条）:`)
  for (const seq of session.surface.nodes) {
    const event = session.snapshotEvents().find((e) => e.seq === seq)!
    const role = event.type === 'user/message' ? 'user     ' : 'assistant'
    // user/message 的消息字段直接摊在 data 上；assistant/message 则包在 data.message 里。
    const content = (event.data as any).message?.content ?? (event.data as any).content ?? []
    const text = (content as any[])
      .map((block) => (block.type === 'text' ? block.text : `<${block.type}>`))
      .join('')
    console.log(`     seq ${String(seq).padStart(2)}  ${role}  ${JSON.stringify(text)}`)
  }
}

console.log('\n② 构建初始上下文：向 longCtx 的会话逐条追加 12 条 user 消息（surfaceOp: append）:')
const longCtx = createAgentContext('long', 12, true)
console.log('   → longCtx 的 surface 现有', longCtx.session.surface.nodes.length, '条')
const shortCtx = createAgentContext('short', 2)
console.log('   另造 shortCtx（2 条消息），用于对照“未到阈值不压”的分支')

console.log('\n③ 压缩过程：compactIfNeeded(longCtx, \'pressure\') —— 插件内部的判定与动作逐步可见:')
const result = await compaction.compactIfNeeded(longCtx, 'pressure', signal)
console.log('   返回 CompactionResult（一笔可核对的账）:')
console.log(`     shadowedRange      = ${`[${result?.shadowedRange.start}..${result?.shadowedRange.end}]`.padEnd(8)}← 被遮蔽的 ${result?.shadowedSeqs.length} 条`)
console.log(`     summarySeq         = ${String(result?.summarySeq).padEnd(8)}← 摘要事件自己的 seq`)
console.log(`     shadowedTokenCount = ${String(result?.shadowedTokenCount).padEnd(8)}← 省下的 token（示例用常数估算）`)

console.log('\n④ 最终结果：模型可见面从 12 条折叠成 4 条，日志一条没删:')
printSurface(longCtx.session, '折叠后 surface')
console.log(`   session 日志仍 ${longCtx.session.snapshotEvents().length} 条（append-only），seq 0–8 只是被摘要从可见面遮蔽`)

console.log('\n⑤ 对照：compactIfNeeded(shortCtx, \'pressure\') —— 2 条 < 阈值 8，不压:')
console.log('   返回值 =', await compaction.compactIfNeeded(shortCtx, 'pressure', signal))

console.log('\n⑥ 手动 compactNow(shortCtx) —— 不受阈值约束，但 2 条都在“保留最近 3 条”之内:')
console.log('   返回值 =', await compaction.compactNow(shortCtx, signal))

console.log('\n⑦ 尊重 signal：已 abort 的压力检查:')
const aborted = new AbortController()
aborted.abort()
console.log('   返回值 =', await compaction.compactIfNeeded(longCtx as CompactionAgentContext, 'pressure', aborted.signal))

console.log('\n⑧ 插件 fiber.dispose() 后 seam 自动卸载（回到未装）:')
await fiber.dispose()
console.log('   ctx.compaction =', harness.ctx.compaction)

await harness.dispose()
