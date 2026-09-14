/**
 * 模块 M05 的对应阶段：跑一个真实 turn（事件全部落日志）→ 检查 seq 连续性 / 深冻结 /
 * deriveMessages 投影 → 用 replace surfaceOp 模拟压缩遮蔽 → fork 前缀 → flush。`npm run M05`。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { assistantText, createHarness } from '../../runtime/harness.ts'
import * as plugin from '../steps/01-session-log.ts'

const harness = await createHarness({ reply: '收到。' })
await harness.loadPlugin(plugin)

console.log('① 跑一个 turn（事件先落日志，append 即广播）:')
const { session } = await harness.runTurn({ prompt: '你好' })

console.log('\n② 不变量：seq 连续性（seq === 数组下标）')
const contiguous = session.snapshotEvents().every((event, index) => event.seq === index)
console.log('   连续 =', contiguous, '| 事件数 =', session.snapshotEvents().length)

console.log('\n③ 不变量：事件深冻结（改写被拒）')
try {
  ;(session.snapshotEvents()[0]!.data as any).turn = 999
  console.log('   居然改成功了?!')
} catch {
  console.log('   改写冻结事件 → TypeError（符合预期）')
}

console.log('\n④ deriveMessages：只投影 surface 事件（chunk 不在其中）')
const describe = (message: { role: string; content: Array<{ type: string; text?: string }> }) =>
  `${message.role}:${message.content.map((block) => (block.type === 'text' ? block.text?.slice(0, 12) : block.type)).join(',')}`
console.log('   投影消息:', session.deriveMessages().map(describe).join(' | '))

console.log('\n⑤ surfaceOp replace：位置性替换——摘要占据被遮蔽区间的原位置')
const surfaceBefore = [...session.surface.nodes]
// start/end 必须是**当前 surface 上真实存在的节点 seq**，不是日志下标；写错会抛错而不是静默无效。
// 0.1.5：surface 节点 0 holds the system prompt —— 运行期只允许 system/message 在
// 恰好那一个节点上改写它。所以遮蔽区间从节点 1 起，跳过系统提示。
const shadowed = surfaceBefore.slice(1, 3)
// 0.1.5：只有能引用来源事件的节点才能替换 surface。assistant/message 的
// sourceEventSeqs 是 never，所以检查点用 user/message（与上游 compaction 一致）。
session.append(
  'user/message',
  createUserMessage({ content: [{ type: 'text', text: '（摘要）前文已折叠' }], source: { kind: 'user' } }) as any,
  { surfaceOp: { op: 'replace', startSeq: shadowed[0]!, endSeq: shadowed[shadowed.length - 1]! }, sourceEventSeqs: shadowed },
)
console.log(`   surface 节点 ${surfaceBefore.length} → ${session.surface.nodes.length}，投影现在以摘要开头:`)
console.log('   ', session.deriveMessages().map(describe).join(' | '))

console.log('\n⑤b 两条 fail-closed 校验（真实实现的抛错原文）:')
const bogus = createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } }) as any
try {
  session.append('user/message', bogus, { surfaceOp: { op: 'replace', startSeq: SessionSeq(999), endSeq: SessionSeq(999) }, sourceEventSeqs: [SessionSeq(999)] })
} catch (error) {
  console.log('   区间不在 surface 上:', (error as Error).message)
}
try {
  const first = session.surface.nodes[0]!
  session.append('user/message', bogus, { surfaceOp: { op: 'replace', startSeq: first, endSeq: first }, sourceEventSeqs: [] })
} catch (error) {
  console.log('   引用不完整      :', (error as Error).message)
}

console.log('\n⑥ fork：只能从**稳定前缀**分叉——边界落在未闭合的 turn 里会被拒')
try {
  harness.ctx.sessions.fork(session, SessionSeq(2), 'demo-fork-bad' as SessionId)
} catch (error) {
  console.log('   边界在 open turn 内:', (error as Error).message)
}
// turn/end 之后才是稳定前缀：boundary 取"要继承的事件条数"。
const stable = session.snapshotEvents().findIndex((event) => event.type === 'turn/end') + 1
const child = harness.ctx.sessions.fork(session, SessionSeq(stable), 'demo-fork' as SessionId)
console.log(`   从 boundary=${stable} 分叉 → 子会话 ${child.id} 继承了 ${child.snapshotEvents().length} 条事件`)

console.log('\n⑦ flush：parallel 持久化检查点（无监听者也正常返回）')
console.log('   flush →', await harness.ctx.sessions.flush(session))

await harness.dispose()
