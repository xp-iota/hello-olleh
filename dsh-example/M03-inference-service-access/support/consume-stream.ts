/**
 * consume.ts —— 05 两个入口共享的 StreamChunk 消费循环。
 *
 * 「换 provider 不换 Consumer」不能只停留在口头：mock（run.ts）与真实推理服务
 * （real/llm-adapter-minimax.ts）走的是**这一个**函数，差异只有传给 llm.stream() 的 provider。
 *
 * 除聚合文本外，这里逐条核对 LlmAdapter 的协议硬约束（见 index.ts 头注释）：
 *   - 先 `usage` 再 `finish`；`finish` 之后不再发任何 chunk；
 *   - 同一 block 的所有 delta 复用同一 index（delta 的 index 必须先有 block-start）。
 */
import type { FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'

export interface ConsumeOptions {
  /** 逐条打印 chunk。mock 流只有 5 个 chunk 适合全打印；真实流太长，改看计数。 */
  verbose?: boolean
  /** 逐条打印时的行前缀，默认两个空格。 */
  indent?: string
}

export interface ConsumeResult {
  /** chunk 类型按流出顺序（含重复）。 */
  order: string[]
  /** 各类型 chunk 的出现次数。 */
  counts: Record<string, number>
  /** 聚合的全部 text-delta。 */
  text: string
  /** reasoning-delta 的字符总数（真实推理模型的"思考量"，mock 恒为 0）。 */
  reasoningChars: number
  /** block-start 的 blockType 序列。 */
  blockTypes: string[]
  /** usage chunk 的载荷；协议要求它必须出现在 finish 之前。 */
  usage: TokenUsage | undefined
  /** finish chunk 的载荷；协议要求它是最后一个 chunk。 */
  finish: FinishReason | undefined
  /** 协议违规计数：delta 的 index 没有先出现同 index 的 block-start。 */
  orphanDeltas: number
}

export async function consumeStream(
  stream: AsyncIterable<StreamChunk>,
  { verbose = false, indent = '  ' }: ConsumeOptions = {},
): Promise<ConsumeResult> {
  const result: ConsumeResult = {
    order: [],
    counts: {},
    text: '',
    reasoningChars: 0,
    blockTypes: [],
    usage: undefined,
    finish: undefined,
    orphanDeltas: 0,
  }
  // 已由 block-start 开启、尚未 block-end 的 index 集合。
  const open = new Set<number>()

  if (verbose) console.log('逐 chunk 流出：')
  for await (const chunk of stream) {
    result.order.push(chunk.type)
    result.counts[chunk.type] = (result.counts[chunk.type] ?? 0) + 1
    switch (chunk.type) {
      case 'block-start':
        result.blockTypes.push(chunk.blockType)
        open.add(chunk.index)
        break
      case 'text-delta':
        if (!open.has(chunk.index)) result.orphanDeltas += 1
        result.text += chunk.text
        break
      case 'reasoning-delta':
        if (!open.has(chunk.index)) result.orphanDeltas += 1
        result.reasoningChars += chunk.text.length
        break
      case 'tool-call-delta':
        if (!open.has(chunk.index)) result.orphanDeltas += 1
        break
      case 'block-end':
        open.delete(chunk.index)
        break
      case 'usage':
        result.usage = chunk.usage
        break
      case 'finish':
        result.finish = chunk.reason
        break
    }
    if (verbose) {
      const detail = chunk.type === 'text-delta'
        ? JSON.stringify(chunk.text)
        : chunk.type === 'finish' ? JSON.stringify(chunk.reason) : ''
      // 拼好再打，避免空 detail 时行尾出现无意义的尾随空格。
      console.log(indent + '-', [chunk.type, detail].filter((part) => part !== '').join(' '))
    }
  }
  return result
}

/**
 * 打印协议检查结果（两个入口共用同一组断言措辞）。返回值全为 true 才算守住契约；
 * mock 与真实 provider 应给出完全一致的结论 —— 这正是"同一份契约"的可观测证据。
 */
export function printProtocolChecks(result: ConsumeResult): void {
  const usageBeforeFinish = result.order.indexOf('usage') < result.order.indexOf('finish')
  const finishIsLast = result.order.length > 0 && result.order[result.order.length - 1] === 'finish'
  console.log('协议检查: usage 在 finish 之前 =', usageBeforeFinish)
  console.log('协议检查: finish 是最后一个 =', finishIsLast)
  console.log('协议检查: delta 的 index 都有 block-start =', result.orphanDeltas === 0)
  console.log('协议检查: 有 usage 载荷 =', result.usage !== undefined)
}
