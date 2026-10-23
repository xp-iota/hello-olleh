/**
 * anthropic-compat.test.ts —— 适配器的纯函数测试。
 *
 * 只测不依赖网络的转换逻辑：SSE 解析、消息折叠、工具 schema 映射、usage 归一。
 * 这些最容易在协议细节上出错，而一旦错了，症状会出现在"模型行为怪"这种很难
 * 定位的地方——所以值得单独钉住。
 *
 * @module dsh-lab/llm/anthropic-compat.test
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseSseData,
  splitSystem,
  toAnthropicMessages,
  toAnthropicTool,
  tokenUsage,
} from './anthropic-compat/index.ts'

/** 把若干文本块包成一个 SSE 字节流。 */
async function* sse(lines: readonly string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder()
  for (const line of lines) yield encoder.encode(line + '\n')
}

/** 收集生成器产出。 */
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of source) out.push(item)
  return out
}

test('parseSseData 只取 data 行，忽略 event / 心跳', async () => {
  const events = await collect(
    parseSseData(
      sse([
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
        '',
        ': keep-alive',
        'event: ping',
        '',
      ]),
    ),
  )
  assert.equal(events.length, 1)
  assert.equal((events[0] as { type: string }).type, 'content_block_delta')
})

test('parseSseData 把 [DONE] 归一成 __done', async () => {
  const events = await collect(parseSseData(sse(['data: [DONE]'])))
  assert.deepEqual(events, [{ type: '__done' }])
})

test('parseSseData 跨 chunk 拼接半行', async () => {
  // 网络分片会在一行中间切开。这个用例保证不会因此丢事件或炸掉。
  const encoder = new TextEncoder()
  async function* split(): AsyncIterable<Uint8Array> {
    yield encoder.encode('data: {"type":"x",')
    yield encoder.encode('"n":1}\n')
  }
  const events = await collect(parseSseData(split()))
  assert.equal(events.length, 1)
  assert.equal((events[0] as { n: number }).n, 1)
})

test('parseSseData 对非法 JSON 抛 PROTOCOL', async () => {
  await assert.rejects(() => collect(parseSseData(sse(['data: {not json']))), /SSE data 不是合法 JSON/)
})

test('splitSystem 把 system 消息折进顶层 system', () => {
  const { system, messages } = splitSystem({
    provider: 'anthropic-compat',
    model: 'm',
    messages: [
      { role: 'system', content: [{ type: 'text', text: '你是助手。' }] },
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
    ],
  } as never)
  assert.equal(system.length, 1)
  assert.equal(system[0].text, '你是助手。')
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, 'user')
})

test('splitSystem 同时保留 GenerateOptions.system', () => {
  const { system } = splitSystem({
    provider: 'anthropic-compat',
    model: 'm',
    system: '来自调用方的 system',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  } as never)
  // 两段 system 都要在（调用方传入的 + 消息里的）。
  assert.ok(system.some((block: { text: string }) => block.text === '来自调用方的 system'))
})

test('toAnthropicMessages 折叠连续的 tool 消息', () => {
  // 0.2.1 把工具结果做成独立的 role:'tool' 消息；Anthropic 要求它们落在
  // user 消息的 tool_result block 里，且必须紧邻对应的 tool_use。
  const messages = toAnthropicMessages(
    [
      { role: 'user', content: [{ type: 'text', text: '算一下' }] },
      {
        role: 'assistant',
        // assistant 消息必须带 source（含 replayState）：适配器据此决定怎么回放
        // reasoning 块。缺了它，replayBlocks 会去读 undefined.replayState。
        source: { kind: 'model', replayState: { blocks: [] } },
        content: [{ type: 'tool-call', id: 'c1', name: 'word_count', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '3 词' }] },
      { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: '另一条' }] },
    ] as never,
    'minimax',
  )
  const merged = messages.at(-1) as { role: string; content: { type: string; tool_use_id: string }[] }
  assert.equal(merged.role, 'user')
  // 两条 tool 结果合并进同一条 user 消息。
  assert.equal(merged.content.length, 2)
  assert.equal(merged.content[0].type, 'tool_result')
  assert.equal(merged.content[0].tool_use_id, 'c1')
  assert.equal(merged.content[1].tool_use_id, 'c2')
})

test('toAnthropicMessages 给失败结果带 is_error', () => {
  const messages = toAnthropicMessages(
    [{ role: 'tool', toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'boom' }] }] as never,
    'minimax',
  )
  const block = (messages[0] as { content: { is_error?: boolean }[] }).content[0]
  assert.equal(block.is_error, true)
})

test('toAnthropicTool 只留 name/description/input_schema', () => {
  const tool = toAnthropicTool({
    name: 'word_count',
    description: '统计词数',
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    // timeoutMs 是 dsh 的执行预算，绝不发给模型。
    timeoutMs: 5000,
  } as never)
  assert.deepEqual(Object.keys(tool).sort(), ['description', 'input_schema', 'name'])
  assert.equal(tool.name, 'word_count')
  assert.equal(tool.description, '统计词数')
})

test('tokenUsage 从总量里扣掉缓存读写', () => {
  const usage = tokenUsage(100, 20, 30, 10)
  // inputTokens 是"本次真正新算的输入"，缓存命中的部分单列。
  assert.equal(usage.outputTokens, 20)
  assert.equal(usage.inputTokens, 60)
  assert.equal(usage.cacheReadTokens, 30)
  assert.equal(usage.cacheWriteTokens, 10)
})

test('tokenUsage 无缓存时不带多余字段', () => {
  const usage = tokenUsage(50, 5, 0, 0)
  assert.equal(usage.inputTokens, 50)
  assert.equal(usage.cacheReadTokens, undefined)
  assert.equal(usage.cacheWriteTokens, undefined)
})

test('tokenUsage 不会算出负数', () => {
  // 异常但可能发生：缓存计数大于总量时，宁可给 0 也不给负 token。
  assert.equal(tokenUsage(10, 5, 30, 0).inputTokens, 0)
})
