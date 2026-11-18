import type { Context } from 'cordis'
import { Greeter } from './seam.ts'

export const name = 'provider-pirate'
export const provide = ['greeter']

class PirateGreeter extends Greeter {
  greet(name: string) {
    const text = `Ahoy, ${name}!`
    this.ctx.emit('greeter/greet', { provider: 'provider-pirate', name, text })
    return text
  }
}

export function apply(ctx: Context) {
  console.log('[provider-pirate] 注册 ctx.greeter')
  new PirateGreeter(ctx)
  ctx.effect(() => () => console.log('[provider-pirate] 卸载，ctx.greeter 随即消失'))
}