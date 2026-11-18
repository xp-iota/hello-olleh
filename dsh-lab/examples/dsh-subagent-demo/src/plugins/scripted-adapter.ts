/**
 * scripted-adapter —— 脚本化 LlmAdapter：离线驱动真实 agent 循环。
 *
 * LlmAdapter 是 dsh 的 provider 缝：唯一必须实现的方法是 stream()，
 * 产出原始 StreamChunk 协议（block-start → delta → block-end → usage → finish）。
 * 注册进 ctx.llm.registerAdapter() 后，agent-loop 对它的驱动与真实 provider
 * 完全一致——turn/step 边界、工具执行、inbox 消费全都真实发生，只是"模型回答"
 * 由脚本决定。这让循环干预的每个观察点都不需要 API key。
 *
 * 两条路由：
 *   - scripted：第 1 个 step 产出 word_count 工具调用，之后的 step 给最终文本；
 *   - hang：产出 block-start 后挂起，直到 options.signal 中止才抛错——
 *     用于演示在途取消（LlmRuntime 会把抛出规范化为 aborted 终局）。
 */
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

export class ScriptedAdapter extends LlmAdapter {
  /** 每个 model 路由独立的 step 计数：不同场景用不同 model id，互不串步。 */
  private readonly steps = new Map<string, number>()

  override providerInfo(provider: string) {
    return { id: provider, name: '脚本化（离线演示用）' }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const step = (this.steps.get(options.model) ?? 0) + 1
    this.steps.set(options.model, step)

    if (options.model === 'hang') {
      // 挂起路由：只开一个文本块，然后等取消信号。适配器契约要求尊重 signal。
      yield { type: 'block-start', index: 0, blockType: 'text' }
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) return resolve()
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      options.signal?.throwIfAborted()
      return
    }

    if (step === 1) {
      // 第一个 step：产出一个 tool-call，让循环进入工具执行。
      const callId = ToolCallId(`scripted-call-${options.model}`)
      const args = JSON.stringify({ text: 'deepseek harness scripted turn' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: callId, name: 'word_count', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'word_count', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 1200, outputTokens: 24 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    // 后续 step：给最终文本回答（steer 续跑时也走这里）。
    const text = step === 2 ? '工具结果已经拿到了。' : '这是续跑后的补充回答。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1500, outputTokens: 18 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}