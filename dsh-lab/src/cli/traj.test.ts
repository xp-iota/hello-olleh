/**
 * traj.test.ts —— trajectory 折叠与渲染的回归测试。
 *
 * 这些断言来自一个真实教训：`traj` 最初只认 `data.message.content`，而
 * `user/message` 事件的负载在 `data` 本身。结果所有 user 行、result 行、以及
 * turn 大纲的"提示词"列都是空的——**而空会话是照不出来的**，只有真的跑过一个
 * turn 才会暴露。所以这里直接构造真实形状的事件，把折叠逻辑钉死。
 *
 * @module dsh-lab/cli/traj.test
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foldTurns } from './traj.ts'

/** 造一条最小事件：只要 type / seq / time / data，够折叠用。 */
function event(type: string, seq: number, data: unknown, time = 1000 + seq) {
  return { type, seq, time, data } as never
}

/** 一个完整的 turn：用户说话 → 工具调用 → 工具结果 → 助手回答 → turn 结束。 */
function oneTurnEvents() {
  return [
    event('turn/start', 0, { turn: 1 }),
    // 人类消息：负载在 data 本身（不是 data.message）。
    event('user/message', 1, {
      role: 'user',
      content: [{ type: 'text', text: '我们在哪个目录？' }],
      source: { kind: 'user' },
    }),
    // 运行时注入的上下文：也是 user/message，但 source.kind 不是 'user'。
    event('user/message', 2, {
      role: 'user',
      content: [{ type: 'text', text: '<system-reminder> 很长的工作区说明 </system-reminder>' }],
      source: { kind: 'runtime-context' },
    }),
    event('step/start', 3, { turn: 1, step: 1 }),
    event('assistant/message', 4, {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c1', name: 'working_directory', arguments: '{}' }],
      },
      usage: { inputTokens: 1200, outputTokens: 24 },
    }),
    event('tool/call', 5, { turn: 1, step: 1, callId: 'c1', name: 'working_directory', arguments: '{}' }),
    // 工具结果：负载在 data.message 里。
    event('tool/result', 6, {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        toolCallId: 'c1',
        content: [{ type: 'text', text: 'D:\\coding\\creative\\hello-olleh\\dsh-lab' }],
        isError: false,
      },
    }),
    event('step/end', 7, { turn: 1, step: 1 }),
    event('turn/end', 8, { turn: 1, reason: { kind: 'completed' } }),
  ]
}

test('turn 大纲拿到人类提示词，而不是被上下文块覆盖', () => {
  const turns = foldTurns(oneTurnEvents())
  assert.equal(turns.length, 1)
  assert.equal(turns[0].prompt, '我们在哪个目录？')
})

test('turn 统计到工具调用与 token', () => {
  const turns = foldTurns(oneTurnEvents())
  assert.equal(turns[0].toolCalls, 1)
  assert.equal(turns[0].inputTokens, 1200)
  assert.equal(turns[0].outputTokens, 24)
})

test('turn 的起止与 reason 都被记录', () => {
  const turns = foldTurns(oneTurnEvents())
  assert.equal(turns[0].startSeq, 0)
  assert.equal(turns[0].endSeq, 8)
  // reason 是结构化对象，要摊平成 'completed' 而不是 '[object Object]'。
  assert.equal(turns[0].reason, 'completed')
})

test('多个 turn 各自独立折叠', () => {
  const events = [
    ...oneTurnEvents(),
    event('turn/start', 9, { turn: 2 }),
    event('user/message', 10, {
      role: 'user',
      content: [{ type: 'text', text: '第二个问题' }],
      source: { kind: 'user' },
    }),
    event('turn/end', 11, { turn: 2, reason: { kind: 'cancelled' } }),
  ]
  const turns = foldTurns(events)
  assert.equal(turns.length, 2)
  assert.equal(turns[0].prompt, '我们在哪个目录？')
  assert.equal(turns[1].prompt, '第二个问题')
  assert.equal(turns[1].reason, 'cancelled')
})

test('没有 turn/end 的尾部 turn 也会被收进来', () => {
  // 崩溃或正在跑的会话就是这个形状：有 turn/start，没有 turn/end。
  const turns = foldTurns([
    event('turn/start', 0, { turn: 1 }),
    event('user/message', 1, {
      role: 'user',
      content: [{ type: 'text', text: '跑到一半' }],
      source: { kind: 'user' },
    }),
  ])
  assert.equal(turns.length, 1)
  assert.equal(turns[0].endSeq, undefined)
  assert.equal(turns[0].prompt, '跑到一半')
})

test('空事件序列不产生 turn', () => {
  assert.deepEqual(foldTurns([]), [])
})
