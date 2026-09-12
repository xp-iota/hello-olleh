/**
 * 模块 M09 的对应阶段：演示任务启动准入、JobHooks 拉模型、增量读、wait、kill 与属主栅栏。`npm run M09`。
 */
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { createHarness } from '../../runtime/harness.ts'
import * as plugin from '../steps/01-jobs-background.ts'

const harness = await createHarness()
const fiber = await harness.loadPlugin(plugin)
const { ctx, agent } = harness
const jobs = ctx.jobs

console.log('① 启动一个长跑任务（JobHooks：run() 同步返回 { cancel, done, readOutput }）:')
const id = jobs.start({
  kind: 'bash',
  label: '编译前端',
  owner: agent, // owner 是 Agent；访问按它的会话 id 栅栏
  run: () => {
    // 生产者拥有自己的执行资源与读游标；注册表只管身份与生命周期状态。
    let output = ''
    let cursor = 0
    let cancelled = false
    const done = (async (): Promise<JobOutcome> => {
      for (let i = 1; i <= 3; i++) {
        if (cancelled) return { status: 'killed', detail: 'cancelled' }
        await new Promise((resolve) => setTimeout(resolve, 30))
        output += `进度 ${i}/3\n`
      }
      return { status: 'completed', detail: 'exit code: 0' }
    })()
    return {
      cancel: () => { cancelled = true }, // 契约：同步、幂等
      done, // 契约：Promise<JobOutcome>，不 reject（运行期把拒绝转换为 failed）
      readOutput: () => {
        const delta = output.slice(cursor)
        cursor = output.length
        return delta
      },
    }
  },
})
console.log('   颁发 id =', id, '（<kind>-N 形）')

console.log('\n② read 是增量读（连续读不重复；游标归生产者）:')
await new Promise((resolve) => setTimeout(resolve, 40))
console.log('   第一次读:', JSON.stringify(jobs.read(id, agent).text))
console.log('   第二次读:', JSON.stringify(jobs.read(id, agent).text), '（只剩增量）')

console.log('\n③ wait：等结算或超时（不取消任务）:')
const final = await jobs.wait(id, 5_000, agent)
console.log('   结算状态 =', final.status, '| detail =', final.detail, '| reported =', jobs.read(id, agent).snapshot.reported)

console.log('\n④ 属主栅栏：非属主读取被拒:')
const other = await ctx.agents.create({ sessionId: 'other-agent' as any, agentOptions: { provider: 'mock', model: 'mock-1' } })
try {
  jobs.get(id, other.agent)
  console.log('   竟然读到了?!')
} catch (error) {
  console.log('  ', (error as Error).message)
}
await other.dispose()

console.log('\n⑤ kill：live → stopping → killed（reason 原样转发给 hooks.cancel）:')
const id2 = jobs.start({
  kind: 'bash',
  label: '监视文件变更',
  run: () => {
    const controller = new AbortController()
    const done = new Promise<JobOutcome>((resolve) => {
      const timer = setTimeout(() => resolve({ status: 'completed' }), 5_000)
      // 生产者尊重取消：cancel → abort → 提前以 killed 收工。
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve({ status: 'killed', detail: '演示取消' })
      }, { once: true })
    })
    return { cancel: (reason?: string) => controller.abort(reason), done }
  },
})
console.log('   kill →', jobs.kill(id2, undefined, '演示取消'))
console.log('   结算 =', (await jobs.wait(id2, 5_000)).status)

console.log('\n⑥ 准入：没有 controller 时 start 被拒（先卸掉插件的 controller）:')
await fiber.dispose()
try {
  jobs.start({ kind: 'bash', label: '不该启动', run: () => ({ cancel: () => {}, done: Promise.resolve({ status: 'completed' }) }) })
  console.log('   竟然启动了?!')
} catch (error) {
  console.log('  ', (error as Error).message)
}

await harness.dispose()
