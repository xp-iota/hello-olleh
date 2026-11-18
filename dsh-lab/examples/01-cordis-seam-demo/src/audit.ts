import type { Context } from 'cordis'

export const name = 'audit'

export function apply(ctx: Context) {
  console.log('[audit] 开始监听 greeter/greet（此刻还没有任何 provider）')
  ctx.on('greeter/greet', (event) => {
    console.log(`[audit] 记录：${event.provider} 对 ${event.name} 说了「${event.text}」`)
  })
}