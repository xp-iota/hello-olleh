/**
 * 模块 M10 的对应阶段（离线）：把 `SKILL.md` 注册进**真实 `ctx.skills`** → 目录发现 → 取定义 →
 * `renderSkillContent` 渲染 → `agent.inject()` → 跑一个**真实 turn**，证明清单正文
 * 确实被主循环认领、进了这一步的模型可见上下文。`npm run M10`。
 *
 * 本脚本推理走 harness 自带的 mock 适配器（固定回复），所以它只证明\"清单送到了\"；
 * \"模型照清单答\"这件事需要真实推理服务 —— 见 `npm run M10`（M10.d 阶段）。
 */
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { createHarness } from '../../runtime/harness.ts'
import { PROMPT, invokeSkill, registerSkill } from '../steps/01-skill-code-review.ts'

const harness = await createHarness({ reply: '（mock 适配器固定回复：真实按清单评审见 npm run M10）' })
const skill = await registerSkill(harness)

console.log('① 模型在目录里发现的 skill:')
for (const summary of await harness.ctx.skills.list()) {
  console.log('   name    =', summary.name, '| source =', summary.source, '| provider =', summary.provider)
  console.log('   何时该用 =', summary.description)
}

console.log('\n② 调用 skill：渲染正文并 inject 到下一步的模型可见上下文')
invokeSkill(harness, skill)
console.log('   inbox.nextStep 待认领 =', harness.agent.inbox.nextStep.length)

console.log('\n③ 跑一个真实 turn：主循环在 step 边界认领，清单随请求进入模型可见上下文')
const outcome = await harness.runTurn({ prompt: PROMPT })
const injected = outcome.session.deriveMessages()
  .filter((message): message is UserMessage => message.role === 'user')
  .find((message) => message.source.kind === 'skill-invocation')
const injectedText = injected?.content.map((block) => (block.type === 'text' ? block.text : '')).join('') ?? ''

console.log('   已被认领（nextStep 清空）  =', harness.agent.inbox.nextStep.length === 0)
console.log('   模型可见投影里有 skill 消息 =', Boolean(injected), injected ? `(source=${injected.source.kind})` : '')
console.log('   其正文带清单的输出格式要求 =', injectedText.includes('结论：可合'))
console.log('   本轮 step 数 =', outcome.steps, '| mock 回复 =', JSON.stringify(outcome.text))

await harness.dispose()

// fail loud：本例的意义就是\"数据写的能力真的进了模型可见上下文\"。
if (!injected || !injectedText.includes('<skill_content')) {
  throw new Error('skill 正文没有进入模型可见上下文 —— 数据扩展链路未被验证')
}
