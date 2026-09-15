/**
 * 模块 M03 的对应场景：真实推理服务 → 经 llm/stream waterfall 消费 →
 * 验证外层改写（大写）与内层统计（chunk 数/usage）都生效。`npm run M03`。
 *
 * 注：`stats` 是 `impl/02-llm-stream.ts` 的模块级共享对象，M03.2 与 M03.d 顺序执行时会累加，
 * 所以这里只断言"统计确实被写入"，不硬编码某一阶段的 chunk 数。
 */
import { REAL_PROVIDER, createHarness, realConfig, userText } from '../../runtime/harness.ts'
import * as plugin from '../impl/02-llm-stream.ts'
import { stats } from '../impl/02-llm-stream.ts'

const harness = await createHarness()
await harness.loadPlugin(plugin)

const { model } = realConfig()
console.log('① 消费经 llm/stream waterfall 包装后的 chunk 流:')
let text = ''
const stream = harness.ctx.llm.stream({
  provider: REAL_PROVIDER,
  model,
  system: '你是一个演示助手，回答保持一句话。',
  messages: [userText('用一句话介绍 DeepSeek Harness 的 LLM 能力缝。')],
})
for await (const chunk of stream) {
  console.log('  -', chunk.type, chunk.type === 'text-delta' ? JSON.stringify(chunk.text) : '')
  if (chunk.type === 'text-delta') text += chunk.text
}

console.log('\n② 外层改写生效（应为全大写且非空）:', JSON.stringify(text))
console.log('③ 内层统计生效:', `chunks=${stats.chunks}, outputTokens=${stats.outputTokens}`)

await harness.dispose()

// fail loud：外层改写与内层统计都必须真的作用在真实流上。
if (text === '' || text !== text.toUpperCase()) {
  throw new Error('llm/stream 外层改写未生效 —— waterfall 包装未被验证')
}
if (stats.chunks === 0) {
  throw new Error('llm/stream 内层统计未生效 —— waterfall 观察者未被验证')
}
