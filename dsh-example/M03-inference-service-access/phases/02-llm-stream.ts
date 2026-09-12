/**
 * 模块 M03 的对应阶段：harness 自带的真实 mock 适配器 → 经 llm/stream waterfall 消费 →
 * 验证外层改写（大写）与内层统计（chunk 数/usage）都生效。`npm run M03`。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as plugin from '../steps/02-llm-stream.ts'
import { stats } from '../steps/02-llm-stream.ts'

const harness = await createHarness({ reply: 'hello harness' })
await harness.loadPlugin(plugin)

console.log('① 消费经 llm/stream waterfall 包装后的 chunk 流:')
let text = ''
for await (const chunk of harness.ctx.llm.stream({ provider: 'mock', model: 'mock-1', messages: [] })) {
  console.log('  -', chunk.type, chunk.type === 'text-delta' ? JSON.stringify(chunk.text) : '')
  if (chunk.type === 'text-delta') text += chunk.text
}

console.log('\n② 外层改写生效（应为全大写）:', JSON.stringify(text))
console.log('③ 内层统计生效:', `chunks=${stats.chunks}（应为 5）, outputTokens=${stats.outputTokens}（应为 13）`)

await harness.dispose()
