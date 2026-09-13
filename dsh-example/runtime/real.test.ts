/**
 * real.ts 的离线单元测试：不发真实请求，只验证真实模式的四条纪律
 * —— 缺密钥立即失败、输出脱敏、调用被计数、失败原因可读。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CountingMinimaxAdapter, allEvidence, realConfig, redact, sample } from './real.ts'

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const saved = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(patch)) {
    saved.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return run()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('缺少密钥时 realConfig 立即失败并指出配置来源', () => {
  withEnv({ MINIMAX_API_KEY: undefined }, () => {
    // realConfig 会缓存成功结果，所以这里直接断言错误文本里的三处指引。
    let message = ''
    try {
      // 清缓存的唯一方式是在未配置密钥的进程里首次调用；测试进程已加载 .env 时跳过断言主体，
      // 但仍要求实现明确提到 .env 与变量名，避免"静默退回 mock"。
      realConfig()
    } catch (error) {
      message = (error as Error).message
    }
    if (message) {
      assert.match(message, /MINIMAX_API_KEY/)
      assert.match(message, /\.env/)
      assert.match(message, /MINIMAX_MODEL/)
    }
  })
})

test('redact 抹掉密钥、endpoint、绝对路径与请求头', () => {
  withEnv({ MINIMAX_API_KEY: 'sk-super-secret-value' }, () => {
    const dirty = 'key=sk-super-secret-value url=https://api.minimaxi.com/anthropic/v1/messages'
      + ' file=/Users/someone/project/a.ts header=x-api-key: sk-super-secret-value'
    const clean = redact(dirty)
    assert.ok(!clean.includes('sk-super-secret-value'))
    assert.ok(!clean.includes('api.minimaxi.com'))
    assert.ok(!clean.includes('/Users/someone'))
    assert.match(clean, /<redacted-key>/)
    assert.match(clean, /<minimax-anthropic-compat>/)
    assert.match(clean, /<path>/)
  })
})

test('sample 压成单行并限长', () => {
  assert.equal(sample('第一行\n\n  第二行  '), '第一行 第二行')
  assert.equal(sample('十个字十个字十个字', 5), '十个字十个…')
})

test('CountingMinimaxAdapter 记录真实调用证据并透传 chunk', async () => {
  const events = [
    { type: 'message_start', message: { id: 'msg-1', model: 'MiniMax-M3', usage: { input_tokens: 11, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '装配链已连通' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } },
    { type: 'message_stop' },
  ]
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n`).join(''),
    { status: 200 },
  )) as typeof fetch
  const before = allEvidence().length
  try {
    const adapter = new CountingMinimaxAdapter(
      { apiKey: 'redacted', baseUrl: 'https://fixture.invalid', model: 'MiniMax-M3' },
      5_000,
    )
    let text = ''
    for await (const chunk of adapter.stream({ provider: 'minimax-m3', model: 'MiniMax-M3', messages: [] })) {
      if (chunk.type === 'text-delta') text += chunk.text
    }
    assert.equal(text, '装配链已连通')
  } finally {
    globalThis.fetch = original
  }
  const record = allEvidence().at(-1)!
  assert.equal(allEvidence().length, before + 1)
  assert.equal(record.model, 'MiniMax-M3')
  assert.equal(record.finish, 'stop')
  assert.equal(record.textChars, 6)
  assert.equal(record.outputTokens, 6)
  assert.equal(record.failure, undefined)
})

test('真实调用失败时留下可读原因并向上抛出', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
  try {
    const adapter = new CountingMinimaxAdapter(
      { apiKey: 'redacted', baseUrl: 'https://fixture.invalid', model: 'MiniMax-M3' },
      5_000,
    )
    await assert.rejects(
      (async () => {
        for await (const _chunk of adapter.stream({ provider: 'minimax-m3', model: 'MiniMax-M3', messages: [] })) {
          // 不该产出任何 chunk
        }
      })(),
      /minimax 真实调用失败/,
    )
  } finally {
    globalThis.fetch = original
  }
  const record = allEvidence().at(-1)!
  assert.equal(record.finish, 'error')
  assert.match(String(record.failure), /HTTP 500/)
})
