/**
 * llm-mock.ts —— 一个真实的 `LlmAdapter` 子类，固定回一句话。
 *
 * 继承的是**真实包**里的抽象类 `@deepseek-ai/dsh-llm` 的 `LlmAdapter`，
 * `stream()` 是唯一必需方法，必须遵守 StreamChunk 协议契约：
 *   - block 的 `index` 按首次出现顺序分配，同一 block 的所有 delta 复用同一 index；
 *   - 先 `usage` 再 `finish`；`finish` 之后不再发任何 chunk；
 *   - 尊重 `options.signal`。
 *
 * 有它，26 个示例才能在**不联网、不要 API key** 的前提下跑通真实 agent 主循环。
 * 想换真实模型：设 `MINIMAX_API_KEY` 并 `DSH_PROVIDER=minimax-m3`（见 llm-minimax.ts）。
 */
import { ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

export class MockAdapter extends LlmAdapter {
  private readonly reply: string

  constructor(reply: string) {
    super()
    this.reply = reply
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.signal?.aborted) throw options.signal.reason
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.reply } }
    yield { type: 'usage', usage: { inputTokens: options.messages.length, outputTokens: this.reply.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export default MockAdapter

/**
 * 一个"会调工具"的 mock 适配器：**第一步**吐一个 tool-call 块，让真实 agent-loop 去
 * 派发工具；从**第二步**起改吐纯文本收尾。用于演示只有在 turn 内才能发生的行为
 * （审批 `approval.request()`、工具结果回灌、多 step 循环…）。
 */
export class ToolCallingMockAdapter extends LlmAdapter {
  private readonly toolName: string
  private readonly toolArgs: string
  private readonly reply: string
  private calls = 0

  constructor(toolName: string, toolArgs: Record<string, unknown> = {}, reply = '工具跑完了，我来收尾。') {
    super()
    this.toolName = toolName
    this.toolArgs = JSON.stringify(toolArgs)
    this.reply = reply
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    if (this.calls === 1) {
      const id = ToolCallId(`mock-call-${this.calls}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: this.toolName, argumentsDelta: this.toolArgs }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: this.toolName, arguments: this.toolArgs } }
      yield { type: 'usage', usage: { inputTokens: options.messages.length, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.reply } }
    yield { type: 'usage', usage: { inputTokens: options.messages.length, outputTokens: this.reply.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
