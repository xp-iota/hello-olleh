import { createHarness } from '../../runtime/harness.ts'
import WebhookRuntime from '../steps/03-webhook-runtime.ts'

const harness = await createHarness()
const required = [...WebhookRuntime.inject]
const missing = required.filter(key => harness.ctx.get(key) === undefined)
console.log('webhookRuntime boundary:', { required, missing, loaded: false, reason: 'Host-plane dependencies stay explicit in an offline teaching profile' })
await harness.dispose()
