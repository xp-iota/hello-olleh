/** intercept 在不重建服务的前提下，把调用域配置叠加到 Service 的追踪上下文。 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export interface Config {
  mode?: string
  budget?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    demoPolicy: DemoPolicy
  }
}

export class DemoPolicy extends Service {
  static Config: z<Config> = z.object({ mode: z.string(), budget: z.number() })
  private readonly base: Config
  constructor(ctx: Context, base: Config = {}) {
    super(ctx, 'demoPolicy')
    this.base = base
  }

  resolve(): Config {
    const layers: Config[] = []
    let cursor: object | null = this.ctx[Context.intercept]
    while (cursor !== null) {
      const own = Object.getOwnPropertyDescriptor(cursor, 'demoPolicy')?.value as Config | undefined
      if (own !== undefined) layers.unshift(own)
      cursor = Object.getPrototypeOf(cursor) as object | null
    }
    return Object.assign({}, this.base, ...layers)
  }
}

export default DemoPolicy
