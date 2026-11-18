import { Service } from 'cordis'
import type { Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    greeter: { greet(): string }
    clock: { now(): string }
    ticker: Ticker
  }
  interface Events {
    'lab/tick'(): void
  }
}

/** 以服务实例为 thisArg 派发事件：Service 的 filter 按 isolate 键筛监听器。 */
export class Ticker extends Service {
  constructor(ctx: Context) {
    super(ctx, 'ticker')
  }
  tick() {
    this.ctx.emit(this, 'lab/tick')
  }
}