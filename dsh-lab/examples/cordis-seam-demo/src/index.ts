/**
 * 装配：seam 的 provider、服务型 consumer、事件型 consumer 如何互相找到对方
 *
 * 运行：node src/index.ts   （Node 22+ 可直接运行 TS，无需构建）
 *       bun src/index.ts    （Bun 1.4+ 同样直接运行）
 */
import { Context } from 'cordis'
import * as audit from './audit.ts'
import * as consumer from './consumer.ts'
import * as providerEn from './provider-en.ts'
import * as providerPirate from './provider-pirate.ts'

const sleep = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
const ctx = new Context()

console.log('\n① 先挂事件监听者 audit 和 consumer，此时没有任何 provider')
ctx.use(audit)
const consumerFiber = ctx.use(consumer)
await sleep()
console.log('   结果：consumer 保持 pending —— inject 未满足，apply() 一次也没执行\n')

console.log('② 再挂 provider-en')
const enFiber = ctx.use(providerEn)
await enFiber
await consumerFiber
console.log('   结果：服务就绪后 consumer 自动激活；它的 greet() 调用内部由 provider 广播事件\n')

console.log('③ 没声明 inject 的插件直接读 ctx.greeter')
ctx.use((inner) => {
  try {
    (inner as any).greeter
  } catch (error) {
    console.log('   结果：' + (error as Error).message + '\n')
  }
})
await sleep()

console.log('④ 换一个调用方（root 侧直接调用服务）：事件照样广播')
ctx.get('greeter')!.greet('root')
console.log('')

console.log('⑤ 卸载 provider-en')
await enFiber.dispose()
await sleep()
console.log('   结果：provider 卸载时先卸载依赖它的 consumer，再注销服务；audit 不受影响')
console.log('   ctx.get("greeter") =', ctx.get('greeter'), '\n')

console.log('⑥ 换成另一个 provider（consumer 的代码一行没改）')
const pirateFiber = ctx.use(providerPirate)
await pirateFiber
await consumerFiber
console.log('   结果：同一条 seam 换了实现，服务型与事件型 consumer 都被重新触发\n')

await pirateFiber.dispose()
console.log('演示结束')