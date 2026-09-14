import { Context } from '@deepseek-ai/cordis'
import DemoPolicy from '../steps/05-intercept-config.ts'

const root = new Context()
await root.plugin(DemoPolicy, { mode: 'safe', budget: 100 })
const scoped = root.intercept('demoPolicy', { budget: 40 }).intercept('demoPolicy', { mode: 'strict' })
console.log('intercept:', {
  base: root.demoPolicy.resolve(),
  scoped: scoped.demoPolicy.resolve(),
  bothViewsAreDemoPolicy: root.demoPolicy instanceof DemoPolicy && scoped.demoPolicy instanceof DemoPolicy,
  traceProxyIdentityDiffers: root.demoPolicy !== scoped.demoPolicy,
})
await root.fiber.dispose()
