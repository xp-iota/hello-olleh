/**
 * metrics.test.ts —— 纯函数折叠的离线断言 + deriveTurnTokenUsage 的契约两态。
 *
 * 合成事件序列不依赖网络：时间戳与 usage 都是构造好的事实，
 * 用来钉住口径（TTFT/解码/ITL/E2E 的边界）与官方精确用量的可证明条件。
 * 真实模型下的端到端验证在 src/index.ts（npm start）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { foldStepTimings, foldTurnTimings, itlOfStream, percentile, tpotMs } from './metrics.ts'

/** 合成一条会话事件：seq/time/type/data 四件齐全。 */
function event(seq: number, time: number, type: string, data: unknown): SessionEvent {
  return { seq, time, type, data } as unknown as SessionEvent
}

/** 合成一段打包的 text-delta 流：time0 首 chunk 时间，dt 相邻间隔。 */
function textRun(time0: number, dt: readonly number[], texts: readonly string[]): AssistantStreamRecord {
  return { type: 'text-chunks', time0, index: 0, dt, texts } as AssistantStreamRecord
}

test('percentile 最近秩法：P50/P99 落在真实样本上', () => {
  assert.equal(percentile([10, 20, 30], 50), 20)
  assert.equal(percentile([10, 20, 30], 99), 30)
  assert.equal(percentile([7], 50), 7)
  assert.throws(() => percentile([], 50))
})

test('itlOfStream 从打包记录还原间隔分布', () => {
  // time0=1000，间隔 [10,20,30] → 四个 delta 在 1000/1010/1030/1060。
  const stats = itlOfStream([textRun(1000, [10, 20, 30], ['a', 'b', 'c', 'd'])])
  assert.deepEqual(stats, { samples: 3, meanMs: 20, p50Ms: 20, p99Ms: 30, maxMs: 30 })
})

test('itlOfStream 不足两个正文 delta 返回 null，reasoning 不算正文', () => {
  assert.equal(itlOfStream([textRun(1000, [], ['a'])]), null)
  const reasoning: AssistantStreamRecord = { type: 'reasoning-chunks', time0: 0, index: 0, dt: [5, 5], texts: ['想', '了', '想'] } as AssistantStreamRecord
  assert.equal(itlOfStream([reasoning]), null)
})

test('foldStepTimings 的边界口径：step/start → 首 token → assistant/message', () => {
  const events = [
    event(0, 500, 'turn/start', { turn: 1 }),
    event(1, 1000, 'step/start', { turn: 1, step: 1 }),
    // attempt 先到：首 token 1200 先记下来（跨重试保留的语义）。
    event(2, 1100, 'assistant/attempt', { turn: 1, step: 1, stream: [textRun(1200, [], ['x'])] }),
    event(3, 2000, 'assistant/message', {
      turn: 1, step: 1,
      usage: { inputTokens: 50, outputTokens: 40 },
      stream: [textRun(1200, [10, 10], ['x', 'y', 'z'])],
    }),
    event(4, 2100, 'step/end', { turn: 1, step: 1 }),
    event(5, 3000, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const steps = foldStepTimings(events)
  assert.equal(steps.length, 1)
  assert.equal(steps[0]!.ttftMs, 200)
  assert.equal(steps[0]!.decodeMs, 800)
  assert.equal(steps[0]!.outputTokens, 40)
  assert.deepEqual(steps[0]!.itl, { samples: 2, meanMs: 10, p50Ms: 10, p99Ms: 10, maxMs: 10 })
})

test('foldTurnTimings 只计闭合 turn，E2E 是事件实际耗时', () => {
  const events = [
    event(0, 1000, 'turn/start', { turn: 1 }),
    event(1, 1010, 'step/start', { turn: 1, step: 1 }),
    event(2, 1900, 'step/end', { turn: 1, step: 1 }),
    event(3, 3000, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(4, 4000, 'turn/start', { turn: 2 }),
  ]
  const turns = foldTurnTimings(events)
  assert.deepEqual(turns, [{ turn: 1, e2eMs: 2000, steps: 1 }])
})

test('tpotMs 是解码实际耗时除以输出 token，零 token 返回 null', () => {
  assert.equal(tpotMs(800, 40), 20)
  assert.equal(tpotMs(800, 0), null)
})

/** 一条可证明的完整 turn：usage 带权威 totalTokens 与全部可选桶。 */
function provableTurn(): SessionEvent[] {
  const usage = {
    inputTokens: 100, outputTokens: 20, totalTokens: 170,
    cacheReadTokens: 50, cacheWriteTokens: 0, reasoningTokens: 8,
  }
  return [
    event(1, 1000, 'turn/start', { turn: 1 }),
    event(2, 1010, 'step/start', { turn: 1, step: 1 }),
    event(3, 2000, 'assistant/message', {
      turn: 1, step: 1, usage,
      stream: [{ type: 'chunk', time: 2000, chunk: { type: 'usage', usage } }],
      message: { id: 'm-3', role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: 'anthropic-compat', model: 'MiniMax-M3' } },
    }),
    event(90, 2100, 'step/end', { turn: 1, step: 1 }),
    event(91, 3000, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

test('deriveTurnTokenUsage 可证明时给精确数：含 reasoning 与路由归属', () => {
  assert.deepEqual(deriveTurnTokenUsage(provableTurn()), {
    uncachedInputTokens: 100,
    outputTokens: 20,
    totalTokens: 170,
    cacheReadTokens: 50,
    cacheWriteTokens: 0,
    reasoningTokens: 8,
    routes: [{ provider: 'anthropic-compat', model: 'MiniMax-M3' }],
  })
})

test('deriveTurnTokenUsage 缺 totalTokens 又缺 cache 桶时返回空（不猜）', () => {
  const events = provableTurn()
  const message = events[2] as unknown as { data: { usage: Record<string, number>; stream: { chunk: { usage: Record<string, number> } }[] } }
  for (const usage of [message.data.usage, message.data.stream[0]!.chunk.usage]) {
    delete usage.totalTokens
    delete usage.cacheWriteTokens
  }
  assert.equal(deriveTurnTokenUsage(events), undefined)
})

test('deriveTurnTokenUsage 未闭合的 turn 返回空', () => {
  assert.equal(deriveTurnTokenUsage(provableTurn().slice(0, -1)), undefined)
})