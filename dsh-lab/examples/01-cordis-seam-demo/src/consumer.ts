import type { Context } from 'cordis'

export const name = 'consumer'
export const inject = ['greeter']

export function apply(ctx: Context) {
  console.log('[consumer] 激活，调用 ctx.greeter.greet() →', ctx.greeter.greet('cordis'))
  // 服务型 consumer 的卸载日志：provider 消失时 cordis 先卸载本插件，再注销服务
  ctx.effect(() => () => console.log('[consumer] 卸载'))
}