/**
 * 模块 M04 的对应阶段：装上钩子插件，跑一个**真实 turn**。
 * 观察 agent/* 生命周期被逐条打印：turn-stopping 上 steer 了一次，
 * 真实主循环重读 inbox 后确实多跑了一个 step（steps=2）。`npm run M04`。
 *
 * 这里的 steps / steerCount 不是 harness 自己记的账，而是从**真实会话日志**里数出来的
 * （`step/start` 事件数、`agent/inbox/spliced` 里 target='next-step' 的插入次数）。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as hookPlugin from '../steps/02-lifecycle-steering.ts'

const harness = await createHarness({ reply: '任务基本完成了。', plugins: [[hookPlugin]] })

console.log('----- 跑一个 turn -----')
const result = await harness.runTurn({ prompt: '把这些 TODO 做完' })
console.log('\n聚合文本:', JSON.stringify(result.text))
console.log('本轮实际 step 数(应为 2):', result.steps)
console.log('本轮是否被引导(steerRequested):', result.steerRequested)
console.log('累计 steer 次数(应为 1):', result.steerCount)

await harness.dispose()
