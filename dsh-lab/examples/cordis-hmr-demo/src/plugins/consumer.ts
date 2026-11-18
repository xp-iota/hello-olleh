import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { tag: string }
  }
}

/** inject 以导出常量声明：模块 namespace 整体作为组件时携带依赖清单。 */
export const inject = ['greeter']

let applies = 0

export function apply(ctx: Context) {
  applies++
  console.log(`   [consumer] apply #${applies} sees greeter = ${ctx.greeter.tag}`)
}