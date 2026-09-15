/**
 * 模块 M04 的对应场景：装上遥测插件，跑一个**真实 turn**（真实 agent-loop 驱动），
 * 观察遥测插件把 session/event 生命周期逐条打印出来。`npm run M04`。
 *
 * 该 turn 由真实推理服务驱动；没有 LLM_API_KEY 就跑不起来。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as telemetryPlugin from '../impl/01-agent-events-telemetry.ts'

const harness = await createHarness()
await harness.loadPlugin(telemetryPlugin)

console.log('----- 开始 turn（下面应由遥测插件打印生命周期）-----')
const { text: finalText, steps } = await harness.runTurn({ prompt: 'ping' })
console.log('----- 结束 turn；聚合文本 =', JSON.stringify(finalText), '| step 数 =', steps, '-----')

await harness.dispose()
