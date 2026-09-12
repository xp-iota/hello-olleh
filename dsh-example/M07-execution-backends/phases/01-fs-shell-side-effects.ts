/**
 * 模块 M07 的对应阶段：消费真实 ctx.fs / ctx.subprocess seam 做真实副作用，并演示 exec.signal 取消。
 * `npm run M07`。
 *
 * 取消有**两条路径**，产出的 `error.info.code` 不同，别混为一谈：
 *   - 派发前就 abort → 注册表短路，工具主体根本不执行 → `ABORTED_BEFORE_DISPATCH`
 *   - 派发后才 abort → 主体已启动，被中止并收敛 → `ABORTED`
 * 两者都是 `isError: true`：这个标志的含义是"本次调用没产出 value"，
 * 不是"操作失败了"。取消与失败共用同一形状，靠 `error.info.code` 区分。
 */
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { createHarness } from '../../runtime/harness.ts'
import * as fsShellPlugin from '../steps/01-fs-shell-side-effects.ts'

const harness = await createHarness()
await harness.loadPlugin(fsShellPlugin)
const { ctx } = harness

console.log('① 已注册模型可见工具:', harness.visibleTools())
console.log('   seam 后端:', ctx.fs.constructor.name, '/', ctx.subprocess.constructor.name)

const target = join(tmpdir(), `dsh-example-16-${Date.now()}.txt`)
const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.map((block) => (block.type === 'text' ? block.text : '')).join('')

/**
 * 把一次调用的结局写清楚。`isError` 单独看会骗人 —— 取消也是 `true`。
 * 真正区分"取消"和"真失败"的是 `error.info.code`：
 *   ABORTED / ABORTED_BEFORE_DISPATCH = 被取消，不是出错。
 */
const outcome = (result: ToolExecutionResult) =>
  result.isError ? `isError=true, code=${result.error.info?.code ?? '(无)'}` : 'isError=false, 成功'

console.log('\n----- ② write_note：经 ctx.fs seam 真实写盘 -----')
const written = await harness.callTool('write_note', { path: target, content: 'hello from the fs seam\n第二行：中文也没问题' })
console.log('   ', outcome(written), '| render:', text(written))

console.log('\n----- ③ 用同一个 seam 读回，验证真的落盘 -----')
const resolved = await ctx.fs.resolve(target)
console.log('   读回内容:', JSON.stringify(await ctx.fs.readText(resolved)))

console.log('\n----- ④ run_cmd：经 ctx.subprocess seam 真跑一条命令 -----')
const ran = await harness.callTool('run_cmd', { argv: [process.execPath, '-e', 'console.log("stdout from child:", 1 + 1)'] })
console.log('   ', outcome(ran), '| value:', ran.isError ? ran.error.message : JSON.stringify(ran.value))

console.log('\n----- ⑤ 派发前取消：注册表短路，工具主体根本不执行 -----')
const aborted = new AbortController()
aborted.abort()
const cancelled = await ctx.tools.execute({
  callId: 'cancel-1' as any,
  name: 'write_note',
  arguments: { path: target, content: 'should never be written' },
  agent: harness.agent,
  signal: aborted.signal,
})
console.log('   ', outcome(cancelled))
console.log('    render:', text(cancelled))
// 决定性证据：文件内容没被改。取消确实拦住了副作用，而不是"执行后失败"。
console.log('    文件内容仍是:', JSON.stringify(await ctx.fs.readText(resolved)))
console.log('    注意 code = ABORTED_BEFORE_DISPATCH：index.ts 里那句 `signal.aborted` 守卫')
console.log('    在这条路径上是够不着的 —— 注册表在调用工具主体之前就已经返回了。')

console.log('\n----- ⑤b 派发后取消：主体已启动，被中止并收敛（code 不同） -----')
const midway = new AbortController()
const slowStart = Date.now()
// harness.callTool 固定用自己的 signal，所以这里直接走 ctx.tools.execute。
const midCancel = ctx.tools.execute({
  callId: 'cancel-2' as any,
  name: 'run_cmd',
  arguments: { argv: [process.execPath, '-e', 'setTimeout(() => console.log("这条永远不该打印"), 5000)'] },
  agent: harness.agent,
  signal: midway.signal,
})
// 等子进程真的起来了再取消，好落进"派发后"这条路径。
setTimeout(() => midway.abort(), 300)
const sliced = await midCancel
console.log('   ', outcome(sliced))
console.log('    耗时:', Date.now() - slowStart, 'ms（子进程本身要跑 5000ms）')
console.log('    子进程被提前掐掉了，而不是等它自然跑完。')

// 收尾：示例不该在 tmpdir 里留垃圾。
await rm(target, { force: true })
console.log('\n⑥ 清理：演示文件已删除 =', target)

await harness.dispose()
