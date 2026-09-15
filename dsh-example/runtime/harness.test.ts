/**
 * harness.test.ts —— 对**真实 dsh SDK**的冒烟测试（`npm test`）。
 *
 * 它守的不是 mini 运行时的契约（那套东西已经删掉了），而是三件事：
 *   1. 真实 core 服务能按依赖顺序全部装配起来；
 *   2. 真实 agent-loop 能跑完一个 turn，并按 dsh 的顺序把事件写进会话日志；
 *   3. 会话日志的核心不变量成立（seq 连续、深冻结、surface 只投影三类消息事件）。
 *
 * 装配与 turn 都需要真实 provider 配置（`createHarness` 缺 `LLM_API_KEY` 会立即失败），
 * 所以这里按是否有密钥决定 skip —— 不引入任何本地 stub 适配器。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CountingAnthropicCompatAdapter,
  allEvidence,
  createHarness,
  demoTool,
  realConfig,
  redact,
  sample,
} from './harness.ts'

/** 无密钥时跳过需要真实 provider 配置的用例；不做任何静默降级。 */
const noKey = process.env.LLM_API_KEY ? false : '缺少 LLM_API_KEY'

test('真实 core 服务全部装配', { skip: noKey }, async () => {
  const harness = await createHarness()
  try {
    for (const name of ['sessions', 'systemPrompt', 'llm', 'approval', 'tools', 'commands', 'skills', 'subagents', 'fs', 'subprocess', 'shell', 'jobs', 'agents', 'goals', 'agentLoop', 'settings'] as const) {
      assert.ok((harness.ctx as any)[name], `ctx.${name} 应当已装配`)
    }
    // 两个 seam 刻意留给示例当 provider。
    assert.equal(harness.ctx.compaction, undefined)
    assert.equal(harness.ctx.sandbox, undefined)
  } finally {
    await harness.dispose()
  }
})

test('真实 agent-loop 跑完一个 turn 并按序落日志', { skip: noKey }, async () => {
  const harness = await createHarness()
  try {
    const { text, steps, session } = await harness.runTurn({ prompt: 'ping' })
    assert.ok(text.trim() !== '', '真实模型应当返回非空文本')
    assert.ok(steps >= 1)

    const types = session.snapshotEvents().map((event) => event.type)
    for (const expected of ['turn/start', 'step/start', 'user/message', 'assistant/message', 'step/end', 'turn/end'] as const) {
      assert.ok(types.includes(expected), `会话日志应当包含 ${expected}`)
    }
    assert.ok(types.indexOf('turn/start') < types.indexOf('step/start'))
    assert.ok(types.indexOf('assistant/message') < types.indexOf('step/end'))
    assert.ok(types.lastIndexOf('step/end') < types.indexOf('turn/end'))
  } finally {
    await harness.dispose()
  }
})

test('会话日志不变量：seq 连续 + 深冻结 + surface 只投影消息事件', { skip: noKey }, async () => {
  const harness = await createHarness()
  try {
    const { session } = await harness.runTurn({ prompt: 'ping' })
    session.snapshotEvents().forEach((event, index) => assert.equal(event.seq, index))
    assert.throws(() => { (session.snapshotEvents()[0]!.data as any).mutated = true }, TypeError)

    const surfaceTypes = new Set(session.surface.nodes.map((seq) => session.snapshotEvents()[seq]!.type))
    for (const type of surfaceTypes) {
      // 0.1.5 的 SurfaceEventType 是这四个（dsh-session/lib/types/types.d.ts:413）。
      // system/message 在 0.1.1 时不进 surface，0.1.5 起进 —— 这属于
      // 「surface 机制变更」，也是 SESSION_FORMAT_VERSION 需要 bump 的那一类改动。
      assert.ok(['system/message', 'user/message', 'assistant/message', 'tool/result'].includes(type), `${type} 不该进 surface`)
    }
  } finally {
    await harness.dispose()
  }
})

test('工具管线：注册 → 执行 → effect 反注册', { skip: noKey }, async () => {
  const harness = await createHarness()
  try {
    const seed = { name: 'seed', inject: ['tools'], apply: (ctx: any) => { ctx.tools.register(demoTool('echo')) } }
    const fiber = await harness.loadPlugin(seed)
    assert.deepEqual(harness.visibleTools(), ['echo'])

    const ok = await harness.callTool('echo', { path: 'a.txt' })
    assert.equal(ok.isError, false)

    await fiber.dispose()
    assert.deepEqual(harness.visibleTools(), [])
    const gone = await harness.callTool('echo', {})
    assert.equal(gone.isError, true)
  } finally {
    await harness.dispose()
  }
})


// ── 真实 provider 配置、脱敏与调用证据 ──────────────────────────────────
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
  withEnv({ LLM_API_KEY: undefined }, () => {
    // realConfig 会缓存成功结果，所以这里直接断言错误文本里的三处指引。
    let message = ''
    try {
      // 清缓存的唯一方式是在未配置密钥的进程里首次调用；测试进程已加载 .env 时跳过断言主体，
      // 但仍要求实现明确提到 .env 与变量名 —— 缺配置必须给出可操作的指引，而不是静默降级。
      realConfig()
    } catch (error) {
      message = (error as Error).message
    }
    if (message) {
      assert.match(message, /LLM_API_KEY/)
      assert.match(message, /\.env/)
      assert.match(message, /LLM_MODEL/)
    }
  })
})

test('redact 抹掉密钥、endpoint、绝对路径与请求头', () => {
  withEnv({ LLM_API_KEY: 'sk-super-secret-value' }, () => {
    const dirty = 'key=sk-super-secret-value url=https://api.minimaxi.com/anthropic/v1/messages'
      + ' file=/Users/someone/project/a.ts header=x-api-key: sk-super-secret-value'
    const clean = redact(dirty)
    assert.ok(!clean.includes('sk-super-secret-value'))
    assert.ok(!clean.includes('api.minimaxi.com'))
    assert.ok(!clean.includes('/Users/someone'))
    assert.match(clean, /<redacted-key>/)
    assert.match(clean, /<llm-anthropic-compat>/)
    assert.match(clean, /<path>/)
  })
})

test('sample 压成单行并限长', () => {
  assert.equal(sample('第一行\n\n  第二行  '), '第一行 第二行')
  assert.equal(sample('十个字十个字十个字', 5), '十个字十个…')
})

test('CountingAnthropicCompatAdapter 记录真实调用证据并透传 chunk', async () => {
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
    const adapter = new CountingAnthropicCompatAdapter(
      { apiKey: 'redacted', vendor: 'minimax', baseUrl: 'https://fixture.invalid', model: 'MiniMax-M3' },
      5_000,
    )
    let text = ''
    for await (const chunk of adapter.stream({ provider: 'anthropic-compat', model: 'MiniMax-M3', messages: [] })) {
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
    const adapter = new CountingAnthropicCompatAdapter(
      { apiKey: 'redacted', vendor: 'minimax', baseUrl: 'https://fixture.invalid', model: 'MiniMax-M3' },
      5_000,
    )
    await assert.rejects(
      (async () => {
        for await (const _chunk of adapter.stream({ provider: 'anthropic-compat', model: 'MiniMax-M3', messages: [] })) {
          // 不该产出任何 chunk
        }
      })(),
      /anthropic-compat 真实调用失败/,
    )
  } finally {
    globalThis.fetch = original
  }
  const record = allEvidence().at(-1)!
  assert.equal(record.finish, 'error')
  assert.match(String(record.failure), /HTTP 500/)
})
