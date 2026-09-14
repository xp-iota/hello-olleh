/**
 * 模块 M04 的对应阶段：装上遥测插件，跑一个**真实 turn**（真实 agent-loop 驱动），
 * 观察遥测插件把 session/event 生命周期逐条打印出来。`npm run M04`。
 *
 * harness 自带一个真实 `LlmAdapter`（runtime/llm.ts），所以这里不联网也能跑完整循环。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as telemetryPlugin from '../steps/01-agent-events-telemetry.ts'

const harness = await createHarness({ reply: '观测到了这一次对话' })
await harness.loadPlugin(telemetryPlugin)

console.log('----- 开始 turn（下面应由遥测插件打印生命周期）-----')
const { text: finalText, steps } = await harness.runTurn({ prompt: 'ping' })
console.log('----- 结束 turn；聚合文本 =', JSON.stringify(finalText), '| step 数 =', steps, '-----')

await harness.dispose()
