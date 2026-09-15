/**
 * 模块 M12 的对应场景：timeout 两种形态 → interval async iterator → debounce →
 * fiber dispose 时挂起的定时器被拒。`npm run M12`。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as plugin from '../impl/02-cordis-timer.ts'

const harness = await createHarness()
const fiber = await harness.loadPlugin(plugin)
const { ctx } = harness

console.log('① timeout(delay) → Promise（可 await 的延时）')
await ctx.timeout(50)
console.log('   50ms 到了')

console.log('\n② timeout(cb, delay) → disposer（回调版）')
await new Promise<void>((resolve) => {
  ctx.timeout(() => {
    console.log('   回调版 timeout 触发')
    resolve()
  }, 30)
})

console.log('\n③ interval(delay) → AsyncIterableIterator（消费 3 个 tick 后停）')
let count = 0
for await (const _tick of ctx.interval(30)) {
  console.log(`   tick ${++count}`)
  if (count === 3) break // break 会调用 iterator.return() → 定时器被清理
}

console.log('\n④ debounce：连续调用只触发最后一次')
const debounced = ctx.debounce((value: string) => console.log(`   [debounced] ${value}`), 40)
debounced('第一次')
debounced('第二次')
debounced('第三次（只有我会触发）')
await ctx.timeout(80)

console.log('\n⑤ 插件里的 throttle 监听器：跑一个真实 turn，高频 session/event 被节流')
await harness.runTurn({ prompt: '滴' })

console.log('\n⑥ dispose：fiber 卸载时挂起的 timeout Promise 被拒')
const pending = ctx.timeout(10_000).then(
  () => '居然 resolve 了?!',
  (error: Error) => `被拒: ${error.message}`,
)
await fiber.dispose()
await harness.dispose()
console.log('  ', await pending)
