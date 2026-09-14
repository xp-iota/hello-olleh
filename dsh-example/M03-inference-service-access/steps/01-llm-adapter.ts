/**
 * M03.1 · 替换 LLM 能力缝（seam）的 provider：本插件提供 mock 适配器，
 * 真实推理服务 适配器由 harness 注册（见 run-real.ts）——两条路由，同一份契约。
 *
 * `ctx.llm` 是一个 seam：Definition（LlmAdapter 抽象类）+ Provider（各具体适配器）
 * + Consumer（agent-loop）。接一个新模型方 = 实现 LlmAdapter 并注册一条 provider 路由。
 *
 * `stream()` 是**唯一必需方法**，返回 StreamChunk 异步流。必须遵守协议契约：
 *   - 先 `usage` 再 `finish`；`finish` 之后不再发任何 chunk。
 *   - block 的 `index` 按首次出现顺序分配，同一 block 的所有 delta 复用同一 index。
 *   - 尊重 `options.signal`。不支持的请求字段应抛 LlmError('UNSUPPORTED')，不要静默丢弃。
 *   - 传输/协议错误：从 stream() 抛；provider 带内失败：以 finish {kind:'error'|'aborted'} 结束。
 *
 * 本例不联网，固定"回声"一句配置里的回复，方便离线测试整条链路。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

export interface Config {
  /** 注册的 provider 路由名；agent 配置里 provider 指到这里即用本适配器。 */
  routeName: string
  /** 固定回复文本。 */
  reply: string
}

class MockAdapter extends LlmAdapter {
  private readonly reply: string
  constructor(reply: string) {
    super() // 派生类必须先调 super()，再给字段赋值
    this.reply = reply
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 一个文本 block：start → delta → end，然后 usage、finish。
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.reply } }
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: this.reply.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

// `name` 是插件/Fiber 名称；`routeName` 才是模型选择 provider 时使用的路由名。
// 依赖 llm 服务后才能注册适配器，未满足依赖时 apply 不会被调用。
export const name = 'llm-adapter'
export const inject = ['llm']
// 这是配置 schema，不是类型声明：它会在插件启动时校验外部配置并填充默认值。
export const Config: z<Config> = z.object({
  routeName: z.string().default('mock'),
  reply: z.string().default('你好，我是示例 mock 模型。'),
})

export function apply(ctx: Context, config: Config) {
  // 注册是 effect-based（HMR 安全）；一条路由只能有一个适配器，重复注册会抛错。
  ctx.llm.registerAdapter([config.routeName], new MockAdapter(config.reply))
}
