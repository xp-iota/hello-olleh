/**
 * 模块 M03 的对应场景：真实推理服务 → 经 llm/stream waterfall 消费 →
 * 验证外侧改写（大写）与内侧统计（chunk 数/usage）都生效。`npm run M03`。
 *
 * `stats` 是插件的模块级对象；本场景加载插件后写入，M03.d 的新 harness 不加载此插件。
 */
import { REAL_PROVIDER, createHarness, realConfig, userText } from '../../runtime/harness.ts'
import * as plugin from '../impl/llm-stream.ts'
import { stats } from '../impl/llm-stream.ts'

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

console.log('\n② 外侧改写生效（应为全大写且非空）:', JSON.stringify(text))
console.log('③ 内侧统计生效:', `chunks=${stats.chunks}, outputTokens=${stats.outputTokens}`)

await harness.dispose()

// fail loud：外侧改写与内侧统计都必须真的作用在真实流上。
if (text === '' || text !== text.toUpperCase()) {
  throw new Error('llm/stream 外侧改写未生效 —— waterfall 包装未被验证')
}
if (stats.chunks === 0) {
  throw new Error('llm/stream 内侧统计未生效 —— waterfall 观察者未被验证')
}
