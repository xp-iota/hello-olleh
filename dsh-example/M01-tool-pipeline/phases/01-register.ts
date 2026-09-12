/**
 * 模块 M01 的对应阶段：`node M01-tool-pipeline/run.ts`（或用根目录 `npm run M01`）。
 * 演示：把插件装进**真实 dsh**（`@deepseek-ai/*` 发布包）→ 走完整工具管线调用
 * word_count → 打印规范值与渲染内容。
 * 额外演示 cordis 的"可逆 effect"：插件 fiber.dispose() 后工具消失（热卸载）。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as wordcountPlugin from '../steps/01-word-count.ts'

const harness = await createHarness()
const fiber = await harness.loadPlugin(wordcountPlugin)

console.log('① 已注册模型可见工具:', harness.visibleTools())

const result = await harness.callTool('word_count', { text: 'DeepSeek Harness 扩展示例 真能跑起来' })
if (result.isError) throw new Error(`不该失败: ${result.error.message}`)
console.log('② canonical value:', result.value)
console.log('③ render 给模型看:', result.content.map((block) => (block.type === 'text' ? block.text : block.type)).join(' | '))

// 可逆 effect：销毁插件 fiber → 注册自动回收
await fiber.dispose()
console.log('④ dispose 之后工具集合:', harness.visibleTools(), '（应为空）')

await harness.dispose()
