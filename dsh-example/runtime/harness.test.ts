/**
 * harness.test.ts —— 对**真实 dsh SDK**的冒烟测试（`npm test`，离线）。
 *
 * 它守的不是 mini 运行时的契约（那套东西已经删掉了），而是三件事：
 *   1. 真实 core 服务能按依赖顺序全部装配起来；
 *   2. 真实 agent-loop 能跑完一个 turn，并按 dsh 的顺序把事件写进会话日志；
 *   3. 会话日志的核心不变量成立（seq 连续、深冻结、surface 只投影三类消息事件）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness, demoTool } from './harness.ts'

test('真实 core 服务全部装配', async () => {
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

test('真实 agent-loop 跑完一个 turn 并按序落日志', async () => {
  const harness = await createHarness({ reply: 'pong' })
  try {
    const { text, steps, session } = await harness.runTurn({ prompt: 'ping' })
    assert.equal(text, 'pong')
    assert.equal(steps, 1)

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

test('会话日志不变量：seq 连续 + 深冻结 + surface 只投影消息事件', async () => {
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

test('工具管线：注册 → 执行 → effect 反注册', async () => {
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
