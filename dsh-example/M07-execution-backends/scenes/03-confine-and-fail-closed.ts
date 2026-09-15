/**
 * 模块 M07 的对应场景：装载后端 → confine 包装 → 换后端后 fail-closed 拒绝 → dispose 逐层还原。`npm run M07`。
 */
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { createHarness } from '../../runtime/harness.ts'
import * as plugin from '../impl/03-sandbox-seam.ts'

const harness = await createHarness()
// 类式插件：构造即把 WrapSandbox 挂到 ctx.sandbox。
const wrapFiber = await harness.loadPlugin(plugin)
const { ctx } = harness

// 策略由调用方给（mode 只能是可约束的两档；danger-full-access 不走 confine）。
const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: canonicalPath(process.cwd()) }
console.log('① 调用方给出的策略:', JSON.stringify(policy))

console.log('\n② confine：把调用者 argv 包装成受约束的 argv（argv 是程序+参数，不是 shell 字符串）')
const confined = ctx.sandbox.confine(['bash', '-c', 'echo hi'], policy)
console.log('   包装后 argv :', JSON.stringify(confined.argv))
console.log('   强制力      :', confined.enforcement)
console.log('   拒绝签名    :', JSON.stringify(confined.denialSignatures))

console.log('\n③ 一个 context 只能有一个实现：重复装载同一 seam 直接抛错')
try {
  await harness.loadPlugin(plugin.RefuseSandbox)
  console.log('   竟然装上了?!')
} catch (error) {
  console.log('  ', (error as Error).message)
}

console.log('\n④ 换后端要先卸掉旧的（effect-based：dispose 即还原）')
await wrapFiber.dispose()
console.log('   卸掉 WrapSandbox → ctx.sandbox =', ctx.sandbox)
const refuseFiber = await harness.loadPlugin(plugin.RefuseSandbox)
console.log('   装上 RefuseSandbox → ctx.sandbox =', ctx.sandbox.constructor.name)

console.log('\n⑤ fail-closed：强制不了的模式抛 SandboxUnavailableError，绝不静默放行')
try {
  ctx.sandbox.confine(['bash', '-c', 'echo hi'], policy)
  console.log('   竟然放行了?!')
} catch (error) {
  console.log('   workspace-write →', (error as Error).message)
}
console.log('   read-only 仍给出可执行的包装:', JSON.stringify(ctx.sandbox.confine(['ls'], { mode: 'read-only', workspaceRoot: policy.workspaceRoot }).argv))

console.log('\n⑥ 最后卸掉 RefuseSandbox → seam 回到未装')
await refuseFiber.dispose()
console.log('   ctx.sandbox =', ctx.sandbox)

await harness.dispose()
