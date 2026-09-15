/**
 * 模块 M10 的对应场景：跨进程工具协议的**两种结果都要跑出来**。`npm run M10`。
 *
 *   A) 实际成功：拉起本仓库里的真实 MCP stdio server（assets/mcp-word-count-server.mjs，
 *      官方 SDK 实现）→ tools/list 同步进 ctx.tools → 走完整工具管线 tools/call 一次，
 *      结果由**另一个进程**算出来再回灌。
 *   B) 明确拒绝：把命令换成一个不存在的可执行文件 → 启动失败并 fail loud，
 *      带上 server 名字与原因，而不是静默留下一个空工具集。
 *
 * 全程本机 stdio，不联网、不需要密钥。
 */
import { join } from 'node:path'
import { createHarness } from '../../runtime/harness.ts'
import * as mcpClient from '../impl/02-mcp-client.ts'

const SERVER = join(import.meta.dirname, '..', 'assets', 'mcp-word-count-server.mjs')

const harness = await createHarness()

console.log('① 实际成功：拉起真实 MCP stdio server，并同步它的工具')
const connected = harness.ctx.plugin(mcpClient, {
  transport: 'stdio',
  serverName: 'local_word_count',
  command: process.execPath,
  args: [SERVER],
  env: {},
  cwd: process.cwd(),
  toolCallTimeoutMs: 15_000,
  failOnStartupError: true,
  reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 10, maxAttempts: 1 },
})
await connected
const visible = harness.visibleTools()
const toolName = visible.find((name) => name.includes('word_count'))
console.log('   模型可见的 MCP 工具:', visible.filter((name) => name.includes('word_count')))
if (!toolName) throw new Error('MCP server 已连接，但它的工具没有同步进 ctx.tools')

const result = await harness.callTool(toolName, { text: 'MCP tools cross process boundaries' })
if (result.isError) throw new Error(`跨进程工具调用失败: ${result.error.message}`)
console.log('   tools/call 真实往返:', result.content.map((block) => (block.type === 'text' ? block.text : block.type)).join(' | '))

await connected.dispose()
console.log('   dispose 之后工具被回收:', harness.visibleTools().filter((name) => name.includes('word_count')).length === 0)

console.log('\n② 明确拒绝：换成不存在的可执行文件 → 启动失败并 fail loud')
const missing = harness.ctx.plugin(mcpClient, {
  transport: 'stdio',
  serverName: 'offline_missing',
  command: '/definitely/not/a/real/mcp-server',
  args: [],
  env: {},
  cwd: process.cwd(),
  toolCallTimeoutMs: 1_000,
  failOnStartupError: true,
  reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 10, maxAttempts: 1 },
})
let rejected = ''
try {
  await missing
} catch (error) {
  rejected = error instanceof Error ? error.message : String(error)
}
console.log('   mcp:', { transport: 'stdio', networkUsed: false, failLoud: rejected.length > 0, reason: rejected })
if (!rejected) throw new Error('启动失败没有 fail loud —— 静默留下空工具集是最危险的结果')
await missing.dispose()

await harness.dispose()
