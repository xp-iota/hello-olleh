/**
 * 模块 M02 的对应场景：加载插件 → 异步整体装配 → 打印装配体与渲染出的最终提示词。
 * 观察：`assemble()` 返回结构化 PromptAssembly；assemble 钩子往 sections 里插了前言；
 * `{{today}}` 在渲染阶段被 variables 插值成当天日期。`npm run M02`。
 */
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createHarness } from '../../runtime/harness.ts'
import * as promptPlugin from '../impl/02-prompt-variable-assemble.ts'

const harness = await createHarness()

// 先放一个低 order 的 persona 段，观察拼接顺序。
harness.ctx.systemPrompt.section({ name: 'persona', order: 0, text: '你是一个乐于助人的编码助手。' })

await harness.loadPlugin(promptPlugin)

console.log('===== ① assemble() 的返回值是结构化 PromptAssembly，不是字符串 =====')
const assembly = await harness.ctx.systemPrompt.assemble(harness.assembleContext())
console.log('   sections :', assembly.sections.map((section) => section.name).join(' → '))
console.log('   variables:', JSON.stringify(assembly.variables))
console.log('   contexts :', assembly.contexts.length, '| tools:', assembly.tools.length)

console.log('\n===== ② 渲染成最终提示词（拼 section + 插值 {{today}}）=====')
// renderPrompt
console.log(renderPrompt(assembly))

console.log('\n===== ③ 未注册的变量是**硬错误**：渲染阶段直接抛，不静默清空也不原样保留 =====')
try {
  // renderPrompt
  renderPrompt({
    sections: [{ name: 'x', text: '未知变量 {{nope}}' }],
    contexts: [],
    tools: [],
    variables: {},
  })
} catch (error) {
  console.log('   renderPrompt 抛错:', (error as Error).message)
}

console.log('\n===== ④ 已注册但求值为 undefined 的变量：同样 fail loud =====')
harness.ctx.systemPrompt.variable('maybe', () => undefined)
harness.ctx.systemPrompt.section({ name: 'maybe-user', order: 400, text: '可选变量：<{{maybe}}>' })
const withMaybe = await harness.ctx.systemPrompt.assemble(harness.assembleContext())
console.log('   variables.maybe =', JSON.stringify(withMaybe.variables.maybe))
try {
  // renderPrompt
  renderPrompt(withMaybe)
} catch (error) {
  console.log('   renderPrompt 抛错:', (error as Error).message)
}

await harness.dispose()
