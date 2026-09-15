import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ToolCallId,
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmAdapter, ReplayEnvelope, StreamChunk } from '@deepseek-ai/dsh-llm'
import { AnthropicCompatAdapter, resolveAnthropicCompatVendor } from './llm.ts'

async function collect(adapter: LlmAdapter, options: GenerateOptions): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  return chunks
}

async function withFetch<T>(implementation: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

function terminalSse(): Response {
  return new Response([
    'data: {"type":"message_start","message":{"id":"msg-1","model":"MiniMax-M3","usage":{"input_tokens":3,"output_tokens":0}}}\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n',
    'data: {"type":"message_stop"}\n',
  ].join(''), { status: 200 })
}

test('MiniMax 请求映射 tools、停止序列、温度和工具消息历史', async () => {
  const callId = ToolCallId('call-1')
  const messages = [
    createUserMessage({ content: [{ type: 'text', text: '查天气' }], source: { kind: 'user' } }),
    createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name: 'weather', arguments: '{"city":"上海"}' }],
      source: { provider: 'anthropic-compat', model: 'MiniMax-M3' },
    }),
    createToolResultMessage({
      callId,
      content: [{ type: 'text', text: '晴，26℃' }],
      isError: false,
    }),
  ]
  let requestBody: any
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body))
    return terminalSse()
  }) as typeof fetch

  await withFetch(fakeFetch, async () => {
    const adapter = new AnthropicCompatAdapter({ apiKey: 'redacted', baseUrl: 'https://fixture.invalid' })
    await collect(adapter, {
      provider: 'anthropic-compat',
      model: 'MiniMax-M3',
      messages,
      system: 'system text',
      tools: [{ name: 'weather', description: '查天气', parameters: { type: 'object' } }],
      temperature: 0.25,
      maxTokens: 123,
      stop: ['<END>'],
    })
  })

  assert.equal(requestBody.max_tokens, 123)
  assert.equal(requestBody.temperature, 0.25)
  assert.deepEqual(requestBody.stop_sequences, ['<END>'])
  assert.deepEqual(requestBody.tools, [{
    name: 'weather',
    description: '查天气',
    input_schema: { type: 'object' },
  }])
  assert.deepEqual(requestBody.messages[1].content[0], {
    type: 'tool_use',
    id: 'call-1',
    name: 'weather',
    input: { city: '上海' },
  })
  assert.deepEqual(requestBody.messages[2].content[0], {
    type: 'tool_result',
    tool_use_id: 'call-1',
    content: [{ type: 'text', text: '晴，26℃' }],
    is_error: false,
  })
})

test('MiniMax tool_use/thinking SSE 映射为完整 dsh block 并保留 replay signature', async () => {
  const events = [
    { type: 'message_start', message: { id: 'msg-tool', model: 'MiniMax-M3', usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 2 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '需要查天气' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed-thinking' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'weather', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"上海"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
    { type: 'message_stop' },
  ]
  const fakeFetch = (async () => new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n`).join(''),
    { status: 200 },
  )) as typeof fetch

  const chunks = await withFetch(fakeFetch, async () => {
    const adapter = new AnthropicCompatAdapter({ apiKey: 'redacted', baseUrl: 'https://fixture.invalid' })
    return collect(adapter, { provider: 'anthropic-compat', model: 'MiniMax-M3', messages: [] })
  })

  assert.ok(chunks.some((chunk) => chunk.type === 'reasoning-delta' && chunk.text === '需要查天气'))
  assert.ok(chunks.some((chunk) => chunk.type === 'block-end'
    && chunk.block.type === 'tool-call'
    && chunk.block.name === 'weather'
    && chunk.block.arguments === '{"city":"上海"}'))
  assert.deepEqual(chunks.find((chunk) => chunk.type === 'usage'), {
    type: 'usage',
    usage: { inputTokens: 8, outputTokens: 7, cacheReadTokens: 2 },
  })
  const finish = chunks.at(-1)
  assert.equal(finish?.type, 'finish')
  if (finish?.type === 'finish') {
    assert.deepEqual(finish.reason, { kind: 'tool-calls' })
    assert.deepEqual(finish.replayState?.blocks, [
      { type: 'thinking', signature: 'signed-thinking' },
      { type: 'tool_use' },
    ])
  }
})

test('MiniMax 对没有官方映射的 reasoningEffort fail loud', async () => {
  const adapter = new AnthropicCompatAdapter({ apiKey: 'redacted', baseUrl: 'https://fixture.invalid' })
  await assert.rejects(
    collect(adapter, {
      provider: 'anthropic-compat',
      model: 'MiniMax-M3',
      messages: [],
      reasoningEffort: 'high' as GenerateOptions['reasoningEffort'],
    }),
    /不支持 reasoningEffort/,
  )
})

test('MiniMax 把 agent-loop 放在 messages 里的 system 消息提升到顶层 system 字段', async () => {
  // 真实 agent-loop 把 System Prompt 当成一条 role=system 消息随 messages 一起送来。
  // 若适配器直接拒绝，真实链路会在第一个 step 就 finish 成 error，会话里只留一条空 assistant。
  const messages = [
    createSystemMessage(
      'You are an AI agent powered by DeepSeek Harness.',
      '@deepseek-ai/dsh-system-prompt',
    ),
    createUserMessage({ content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }),
  ]
  let requestBody: any
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body))
    return terminalSse()
  }) as typeof fetch

  await withFetch(fakeFetch, async () => {
    const adapter = new AnthropicCompatAdapter({ apiKey: 'redacted', baseUrl: 'https://fixture.invalid' })
    await collect(adapter, { provider: 'anthropic-compat', model: 'MiniMax-M3', messages, system: '调用方显式 system' })
  })

  assert.deepEqual(requestBody.system, [
    { type: 'text', text: '调用方显式 system' },
    { type: 'text', text: 'You are an AI agent powered by DeepSeek Harness.' },
  ])
  assert.equal(requestBody.messages.length, 1)
  assert.equal(requestBody.messages[0].role, 'user')
})

test('供应商可显式选择，也可从网关和模型兼容识别', () => {
  assert.equal(resolveAnthropicCompatVendor('minimax'), 'minimax')
  assert.equal(resolveAnthropicCompatVendor('FUYAO'), 'fuyao')
  assert.equal(resolveAnthropicCompatVendor(undefined, { model: 'fuyao-coding' }), 'fuyao')
  assert.equal(resolveAnthropicCompatVendor(undefined, { baseUrl: 'http://fuyao-ai-gateway.xiaopeng.link' }), 'fuyao')
  assert.equal(resolveAnthropicCompatVendor(undefined, { model: 'MiniMax-M3' }), 'minimax')
  assert.throws(() => resolveAnthropicCompatVendor('unknown'), /只支持 minimax \/ fuyao/)
})

function toolReplayMessages(signature?: string) {
  const callId = ToolCallId('call-fuyao')
  const replayState: ReplayEnvelope = {
    response: { id: 'msg-fuyao', model: 'fuyao-coding', stopReason: 'tool_use' },
    blocks: [
      { type: 'thinking', ...(signature ? { signature } : {}) },
      { type: 'tool_use' },
    ],
  }
  return [
    createAssistantMessage({
      content: [
        { type: 'reasoning', text: '需要调用工具' },
        { type: 'tool-call', id: callId, name: 'weather', arguments: '{"city":"上海"}' },
      ],
      source: { provider: 'anthropic-compat', model: 'fuyao-coding', replayState },
    }),
    createToolResultMessage({
      callId,
      content: [{ type: 'text', text: '晴，26℃' }],
      isError: false,
    }),
  ]
}

test('Fuyao 回放时省略 unsigned reasoning，但保留 tool_use 与 tool_result', async () => {
  let requestBody: any
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body))
    return terminalSse()
  }) as typeof fetch

  await withFetch(fakeFetch, async () => {
    const adapter = new AnthropicCompatAdapter({
      apiKey: 'redacted',
      vendor: 'fuyao',
      baseUrl: 'https://fixture.invalid',
      defaultModel: 'fuyao-coding',
    })
    await collect(adapter, {
      provider: 'anthropic-compat',
      model: 'fuyao-coding',
      messages: toolReplayMessages(),
    })
  })

  assert.deepEqual(requestBody.messages[0].content, [{
    type: 'tool_use',
    id: 'call-fuyao',
    name: 'weather',
    input: { city: '上海' },
  }])
  assert.deepEqual(requestBody.messages[1].content[0], {
    type: 'tool_result',
    tool_use_id: 'call-fuyao',
    content: [{ type: 'text', text: '晴，26℃' }],
    is_error: false,
  })
})

test('MiniMax 对 unsigned reasoning 继续 fail loud', async () => {
  let fetchCalled = false
  const fakeFetch = (async () => {
    fetchCalled = true
    return terminalSse()
  }) as typeof fetch

  await withFetch(fakeFetch, async () => {
    const adapter = new AnthropicCompatAdapter({
      apiKey: 'redacted',
      vendor: 'minimax',
      baseUrl: 'https://fixture.invalid',
    })
    await assert.rejects(
      collect(adapter, {
        provider: 'anthropic-compat',
        model: 'MiniMax-M3',
        messages: toolReplayMessages(),
      }),
      /minimax: 无法回放缺少 Anthropic signature/,
    )
  })
  assert.equal(fetchCalled, false)
})

test('Fuyao 仍回放带签名 reasoning', async () => {
  let requestBody: any
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body))
    return terminalSse()
  }) as typeof fetch

  await withFetch(fakeFetch, async () => {
    const adapter = new AnthropicCompatAdapter({
      apiKey: 'redacted',
      vendor: 'fuyao',
      baseUrl: 'https://fixture.invalid',
    })
    await collect(adapter, {
      provider: 'anthropic-compat',
      model: 'fuyao-coding',
      messages: toolReplayMessages('signed-thinking'),
    })
  })

  assert.deepEqual(requestBody.messages[0].content[0], {
    type: 'thinking',
    thinking: '需要调用工具',
    signature: 'signed-thinking',
  })
})

test('Fuyao 不会把 reasoning-only 消息省略成空 content', async () => {
  const replayState: ReplayEnvelope = {
    response: { id: 'msg-reasoning', model: 'fuyao-coding', stopReason: 'end_turn' },
    blocks: [{ type: 'thinking' }],
  }
  const message = createAssistantMessage({
    content: [{ type: 'reasoning', text: '只有思考，没有可回放结果' }],
    source: { provider: 'anthropic-compat', model: 'fuyao-coding', replayState },
  })
  const adapter = new AnthropicCompatAdapter({
    apiKey: 'redacted',
    vendor: 'fuyao',
    baseUrl: 'https://fixture.invalid',
  })
  await assert.rejects(
    collect(adapter, { provider: 'anthropic-compat', model: 'fuyao-coding', messages: [message] }),
    /fuyao: 无法回放缺少 Anthropic signature/,
  )
})
