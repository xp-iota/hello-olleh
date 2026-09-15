import { createHarness, userText } from '../../runtime/harness.ts'
import TokenMeter from '../impl/04-token-meter.ts'

const harness = await createHarness()
await harness.loadPlugin(TokenMeter)
harness.agent.session.append('user/message', userText('一段进入模型可见面的文本'), { surfaceOp: 'append' })
const measurement = harness.ctx.tokenMeter.measure(harness.agent.session)
console.log('tokenMeter:', {
  baseline: measurement.baseline.kind,
  surfaceTokens: measurement.surfaceTokens,
  totalTokens: measurement.totalTokens,
  nodes: measurement.nodes.length,
})
await harness.dispose()
