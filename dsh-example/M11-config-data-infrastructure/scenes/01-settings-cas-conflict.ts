/**
 * 模块 M11 的对应场景：默认值 → update 合并 → expectedRevision 冲突 → mutate 路径编辑 → replace 重置。`npm run M11`。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as plugin from '../impl/01-settings-namespaces.ts'
import { DEMO_NS, DemoSchema } from '../impl/01-settings-namespaces.ts'

const harness = await createHarness()
await harness.loadPlugin(plugin)
const settings = harness.ctx.settings

const revision = () => settings.describe().find((descriptor) => descriptor.ns === DEMO_NS)?.revision

console.log('① 未写任何东西：解析值 = schema 默认值')
console.log('  ', settings.get(DEMO_NS), '| revision =', revision())

console.log('\n② update：合并补丁进 user 层')
await settings.update(DEMO_NS, { fontSize: 16 })
console.log('   revision =', revision())

console.log('\n③ 乐观并发：过期 expectedRevision 被拒')
try {
  await settings.update(DEMO_NS, { fontSize: 20 }, 0)
  console.log('   竟然通过了?!')
} catch (error) {
  console.log('  ', (error as Error).message)
}

console.log('\n④ 带对的 expectedRevision 则放行')
await settings.update(DEMO_NS, { theme: 'light' }, revision())
console.log('   revision =', revision())

console.log('\n⑤ mutate：路径级编辑（op 是 set / unset）')
await settings.mutate(DEMO_NS, [{ op: 'set', path: ['fontSize'], value: 18 }])
console.log('   当前值:', settings.get(DEMO_NS))

console.log('\n⑥ replace({})：整段清空 user 层 → 全部回落默认值（merge 表达不了的"重置"）')
await settings.replace(DEMO_NS, {})
console.log('   重置后:', settings.get(DEMO_NS))

console.log('\n⑦ 重复注册同一命名空间抛错')
try {
  settings.register(DEMO_NS, DemoSchema)
  console.log('   竟然通过了?!')
} catch (error) {
  console.log('  ', (error as Error).message)
}

await harness.dispose()
