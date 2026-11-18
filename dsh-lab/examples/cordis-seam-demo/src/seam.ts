import { Service } from 'cordis'
import type { Context } from 'cordis'

/** `greeter/greet` 事件携带的数据：一次问候已经发生 */
export interface GreetEvent {
  provider: string   // 是哪个 provider 说的
  name: string       // 说给谁听
  text: string       // 具体说了什么
}

export abstract class Greeter extends Service {
  constructor(ctx: Context) {
    // 第二个参数就是服务名：构造即注册，注册在 provider 插件的 fiber 上
    super(ctx, 'greeter')
  }

  /** seam 承诺的能力：provider 必须实现，consumer 只依赖它 */
  abstract greet(name: string): string
}

declare module 'cordis' {
  interface Context {
    greeter: Greeter
  }
  interface Events {
    /** 接缝上的广播：任何 provider 说出一句问候时触发 */
    'greeter/greet'(this: Context, event: GreetEvent): void
  }
}