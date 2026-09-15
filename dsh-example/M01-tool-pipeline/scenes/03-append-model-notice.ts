/**
 * 模块 M01 的对应场景：复用注册阶段的 word_count 工具 + 本阶段的结果转换插件。
 * 观察：post-execute 在结果后追加了一条模型可见提示；result 打了审计行。`npm run M01`。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as wordcountPlugin from '../impl/01-word-count.ts'
import * as transformPlugin from '../impl/03-result-transform.ts'

const harness = await createHarness()
await harness.loadPlugin(wordcountPlugin) // 提供 word_count 工具
await harness.loadPlugin(transformPlugin) // 挂上 post-execute / result 监听

const result = await harness.callTool('word_count', { text: 'one two three four five' })
if (result.isError) throw new Error(`不该失败: ${result.error.message}`)

console.log('规范值 value（未变）:', result.value)
console.log('模型可见 content（已被转换追加）:')
for (const block of result.content) console.log('  •', JSON.stringify(block.type === 'text' ? block.text : block))

await harness.dispose()
