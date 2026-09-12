import { createHarness, userText } from '../../runtime/harness.ts'
import MemorySessionTelemetry from '../steps/04-session-telemetry.ts'

const harness = await createHarness({ plugins: [[MemorySessionTelemetry]] })
harness.agent.session.append('user/message', userText('只进入内存遥测，不发送网络'), { surfaceOp: 'append' })
const telemetry = harness.ctx.sessionTelemetry
if (!(telemetry instanceof MemorySessionTelemetry)) throw new Error('unexpected telemetry backend')
const records = telemetry.records
console.log('sessionTelemetry:', {
  backend: harness.ctx.sessionTelemetry.constructor.name,
  records: records.length,
  channels: [...new Set(records.map(record => record.channel))],
  eventTypes: records.map(record => record.attributes['event.type']).filter(Boolean),
})
await harness.dispose()
