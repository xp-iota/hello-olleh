/**
 * 模块 M02 的对应阶段：加载提示段插件 → 打印真实 `ctx.systemPrompt` 组装出的 System Prompt。
 * `npm run M02`。config.signature 覆盖默认署名。
 *
 * 注意 `assemble()` 返回的是结构化 `PromptAssembly`，把它渲染成字符串是请求组装层的活——
 * 真实包直接导出了那个渲染函数 `renderPrompt`。
 */
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createHarness } from '../../runtime/harness.ts'
import * as promptPlugin from '../steps/01-prompt-section.ts'

const harness = await createHarness()

// 演示 order 顺序：先放一个低 order 的段落，再加载本插件的 order=300 段。
harness.ctx.systemPrompt.section({ name: 'persona', order: 0, text: '你是一个乐于助人的编码助手。' })

await harness.loadPlugin(promptPlugin, { signature: '—— 来自扩展示例工程' })

console.log('===== 组装后的 System Prompt =====')
console.log(renderPrompt(await harness.ctx.systemPrompt.assemble(harness.assembleContext())))

await harness.dispose()
