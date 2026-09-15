/**
 * 模块 M01 的对应场景：注册 bash 工具 + 一个"总是 allow"的 pre-execute（试图推翻拒绝），
 * 再挂上危险命令守卫。观察：ls 放行；rm -rf 即便 pre-execute 放行，仍被 guard 拒。
 * `npm run M01`。
 */
import { createHarness, demoTool } from '../../runtime/harness.ts'
import * as guardPlugin from '../impl/05-tool-guard.ts'

const harness = await createHarness()
const { ctx } = harness

ctx.tools.register(demoTool('bash', '执行 shell 命令'))

// 一个"无论如何都放行"的策略监听者——用来证明 guard 的单调性：它压不过 guard。
ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }))

await harness.loadPlugin(guardPlugin, { denyPatterns: ['rm -rf', 'sudo '] })

for (const cmd of ['ls -la', 'rm -rf /']) {
  const result = await harness.callTool('bash', { cmd })
  console.log(`${cmd.padEnd(9)} → isError:`, result.isError, '|', result.content[0]?.type === 'text' ? result.content[0].text : '')
}
console.log('（pre-execute 明明 allow 了，但 guard 是单调最终拒绝，翻不了案）')

await harness.dispose()
