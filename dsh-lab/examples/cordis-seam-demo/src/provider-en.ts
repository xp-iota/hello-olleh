import type { Context } from 'cordis'
import { Greeter } from './seam.ts'

export const name = 'provider-en'
export const provide = ['greeter']   // 可选元数据，供 loader / 静态分析使用

class EnglishGreeter extends Greeter {
  greet(name: string) {
    const text = `Hello, ${name}!`
    // provider 的动作：说出问候，同时把这件事作为事实广播出去
    this.ctx.emit('greeter/greet', { provider: 'provider-en', name, text })
    return text
  }
}

export function apply(ctx: Context) {
  console.log('[provider-en] 注册 ctx.greeter')
  new EnglishGreeter(ctx)   // 构造 Service 就是注册
  // 卸载日志也是 effect：fiber 销毁时按注册逆序执行清理
  ctx.effect(() => () => console.log('[provider-en] 卸载，ctx.greeter 随即消失'))
}