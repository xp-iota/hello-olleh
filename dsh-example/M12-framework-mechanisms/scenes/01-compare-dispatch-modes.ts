/**
 * 模块 M12 的对应场景：在**真实 cordis**上逐一派发五种模式，观察各自语义。`npm run M12`。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as plugin from '../impl/01-dispatch-modes.ts'

const harness = await createHarness()
await harness.loadPlugin(plugin)
const { ctx } = harness

console.log('① emit：同步广播，立即返回，不等任何 Promise')
ctx.emit('demo/observe', 'hello')
console.log('  → emit 已返回（异步观察者 C 此时还没打印）')
// 给异步监听者一点时间，好让它的话在 emit 返回之后才出现——这就是"即发即忘"。
await new Promise((resolve) => setTimeout(resolve, 40))

console.log('\n② parallel：并发等齐，完成顺序由耗时决定（A 注册在前但更慢）')
await ctx.parallel('demo/flush', 'batch-1')
console.log('  → 全部 settle 后才走到这里')

console.log('\n③ parallel：有监听者拒绝 → AggregateError')
try {
  await ctx.parallel('demo/flush', 'fail')
} catch (error) {
  const aggregate = error as AggregateError
  console.log(`  → 捕获 ${aggregate.name}，内含 ${aggregate.errors.length} 个失败:`, (aggregate.errors[0] as Error).message)
}

console.log('\n④ serial：按序 await，首个 bail 值截链（监听者全同步）')
console.log('  → 返回值 =', await ctx.serial('demo/pick', 1))

console.log('\n⑤ bail：同一批监听者走同步版本，结果与 ④ 完全一样')
console.log('  → 返回值 =', ctx.bail('demo/pick', 2))

console.log('\n⑥ waterfall：最后一个实参是内建默认（base），外层监听者包装内层结果')
console.log('  → 返回值 =', await ctx.waterfall('demo/wrap', '原始文本', () => Promise.resolve('【内建默认】原始文本')))

console.log('\n⑦a isBailed 边界：return 0 会「意外」截链（0 既非 null 也非 false/undefined）')
console.log('  → 返回值 =', ctx.bail('demo/boundary'))

console.log('\n⑦b 换成异步监听者：serial 与 bail 的唯一差别在这里暴露')
console.log('  serial → 返回值 =', await ctx.serial('demo/pick-async', 3))
const leaky = ctx.bail('demo/pick-async', 4)
console.log('  bail   → 返回值 =', leaky)
console.log('  bail 没 await，直接把未决 Promise 当成了截链值 —— 这是用 bail 接异步监听者的坑。')
// 收尾：那个被漏出来的 Promise 还在跑，等它落地免得和后面的输出交错。
await leaky

await harness.dispose()
