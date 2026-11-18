/**
 * scripted-adapter —— 脚本化 LlmAdapter：离线播种一条真实 turn。
 *
 * 与 dsh-session-demo 的同名插件同一契约（stream() 产出原始 StreamChunk 协议），
 * 这里只保留文本路由：每个 step 直接给最终回答，不调工具——存储示例只需要
 * 会话日志里有一条真实的人类消息与助手回答，供跨会话引用读取。
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

export class ScriptedAdapter extends LlmAdapter {
  override providerInfo(provider: string) {
    return { id: provider, name: '脚本化（离线演示用）' }
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = '已记录。这条回答由脚本化适配器产出，用于跨会话引用演示。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 32, outputTokens: 24 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}