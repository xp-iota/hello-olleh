/**
 * 模块 M07 的对应场景：resolve 默认值/夹紧 → run 成功与非零退出 → 超时杀 → 后台 start + 增量读。`npm run M07`。
 * ShellRunResult：{ exitCode, signal, timedOut, aborted, timeoutMs, stdout, stderr }；
 * ShellProcess：{ status, exitCode, signal, done: Promise<void>, readOutput(): { delta, lossy }, kill() }。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as plugin from '../impl/02-shell-service.ts'

const harness = await createHarness()
await harness.loadPlugin(plugin)
const shell = harness.ctx.shell

console.log('\n① resolve：补默认值并夹紧上限（请求 999_999ms）')
const spec = shell.resolve({ command: 'echo hello-shell', timeoutMs: 999_999 })
console.log('   spec =', JSON.stringify({ command: spec.command, workdir: spec.workdir, timeoutMs: spec.timeoutMs, stdoutMaxBytes: spec.stdoutMaxBytes }))

console.log('\n② run：正常退出（resolve 出结果，非 reject）')
const ok = await shell.run(shell.resolve({ command: 'echo hello-shell' }))
console.log('   exitCode =', ok.exitCode, '| stdout =', JSON.stringify(ok.stdout.text.trim()), '| truncated =', ok.stdout.truncated)

console.log('\n③ run：非零退出同样 resolve（不 reject）')
const bad = await shell.run(shell.resolve({ command: 'echo oops >&2; exit 42' }))
console.log('   exitCode =', bad.exitCode, '| stderr =', JSON.stringify(bad.stderr.text.trim()))

console.log('\n④ run：超时杀 → timedOut: true（依然 resolve，不 reject）')
const slow = await shell.run(shell.resolve({ command: 'sleep 5', timeoutMs: 100 }))
console.log('   exitCode =', slow.exitCode, '| timedOut =', slow.timedOut, '| aborted =', slow.aborted, '| signal =', slow.signal)

console.log('\n⑤ start：后台句柄立即返回；readOutput 增量读 { delta, lossy }；done 是 Promise<void> 且永不 reject')
const proc = shell.start(shell.resolve({ command: 'echo line1; sleep 0.2; echo line2' }))
console.log('   status =', proc.status, '（立即返回，进程还在跑）')
await harness.ctx.timeout(100)
console.log('   第一次读:', JSON.stringify(proc.readOutput().delta))
await proc.done // done 只等关闭；退出事实落在句柄字段上
console.log('   done settle 后: status =', proc.status, '| exitCode =', proc.exitCode)
console.log('   第二次读（只剩增量）:', JSON.stringify(proc.readOutput().delta))

console.log('\n⑥ kill 幂等：对已结束的进程再 kill')
console.log('   kill() →', proc.kill(), '| 再 kill() →', proc.kill())

await harness.dispose()
