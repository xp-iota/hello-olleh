import type { Context } from 'cordis'

/** 与 greeter 无任何依赖边：HMR 换代时 epoch 不变，apply 计数应保持 #1。 */
let applies = 0

export function apply(ctx: Context) {
  applies++
  console.log(`   [clock] apply #${applies}（与 greeter 无关）`)
}