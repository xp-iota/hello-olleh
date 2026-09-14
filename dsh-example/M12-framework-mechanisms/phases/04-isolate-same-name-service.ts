import { Context } from '@deepseek-ai/cordis'
import * as realmValue from '../steps/04-isolate-realm.ts'

const root = new Context()
await root.plugin(realmValue, { source: 'root' })
const isolated = root.isolate('realmValue')
await isolated.plugin(realmValue, { source: 'isolated' })
console.log('isolate:', { root: root.realmValue.source, isolated: isolated.realmValue.source, separated: root.realmValue !== isolated.realmValue })
await root.fiber.dispose()
