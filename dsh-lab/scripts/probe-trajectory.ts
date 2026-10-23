/**
 * probe-trajectory.ts —— 用一条**真实 turn** 验证 trajectory 渲染。
 *
 * 为什么需要这个探针：`dsh-lab traj` 最有价值的部分是 turn 大纲、工具行、
 * token 用量这几块，而它们只有在会话里真的跑过一个 turn 之后才有内容。没有
 * `LLM_API_KEY` 时，所有会话都只有播种事件，上述代码路径等于从未被执行过。
 *
 * 做法：在进程内注册一个脚本化的 `LlmAdapter`，让 agent 走完
 * turn/start → step → tool/call → tool/result → assistant/message → turn/end，
 * 然后用同一套 `renderTrajectory()` 把它打印出来。这不替代真实 provider 验证
 * （那是 M03.3 的事），但能把渲染与折叠逻辑钉在真实事件序列上。
 *
 * 用法：node scripts/probe-trajectory.ts
 */
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootLab } from '../src/boot.ts'
import { renderTrajectory } from '../src/cli/traj.ts'
import { line, style } from '../src/cli/term.ts'

/**
 * 一轮脚本化对话：先调一个工具，再给最终回答。
 *
 * 按 step 数决定行为，这样同一个 adapter 能驱动完整的多步循环。
 */
class ScriptedAdapter extends LlmAdapter {
  private readonly steps = new Map<string, number>()

  providerInfo(provider: string) {
    return { id: provider, name: '脚本化（探针用）' }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const key = String(options.model)
    const step = (this.steps.get(key) ?? 0) + 1
    this.steps.set(key, step)

    if (step === 1) {
      // 第一个 step：产出一个 tool-call，让循环进入工具执行。
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index: 0,
        id: 'probe-call-1' as never,
        name: 'working_directory',
        argumentsDelta: '{}',
      }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: 'probe-call-1', name: 'working_directory', arguments: '{}' } as never,
      }
      yield { type: 'usage', usage: { inputTokens: 1200, outputTokens: 24 } }
      yield { type: 'finish', reason: 'tool-calls' as never }
      return
    }

    // 第二个 step：给最终文本回答。
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '当前工作目录已经查到了。' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '当前工作目录已经查到了。' } as never }
    yield { type: 'usage', usage: { inputTokens: 1500, outputTokens: 18 } }
    yield { type: 'finish', reason: 'stop' as never }
  }
}

const lab = await bootLab()
try {
  // 注册成一个独立路由，不碰 anthropic-compat。
  lab.ctx.llm.registerAdapter(['lab-probe'], new ScriptedAdapter())

  const sessionId = SessionId(`probe-${Date.now().toString(36)}`)
  const handle = await lab.ctx.agents.create({
    sessionId,
    // root 会话的 header 只接受 `{ cwd }`：`origin` 是子 agent 专用的，
    // 填别的值会被 validateSessionHeader 当场拒掉。
    meta: { cwd: process.cwd() },
    // 模型路由走 agentOptions，不在 meta 里。
    agentOptions: { provider: 'lab-probe', model: 'scripted' },
  })

  await handle.agent.send(createUserMessage({ content: [{ type: 'text', text: '我们在哪个目录？' }], source: { kind: 'user' } }), 'next-turn', true)
  await handle.agent.whenIdle()

  line()
  await renderTrajectory(lab.ctx, sessionId)

  // 断言：渲染必须看到 turn、工具调用和 token，否则"能渲染"只是没崩。
  const { events } = await lab.ctx.sessionQuery.readSession(sessionId)
  const turnStarts = events.filter((event) => event.type === 'turn/start').length
  const toolCalls = events.filter((event) => event.type === 'tool/call').length
  const assistantMessages = events.filter((event) => event.type === 'assistant/message').length

  line()
  line(`事件 ${events.length} 条 / turn ${turnStarts} / 工具调用 ${toolCalls} / 助手消息 ${assistantMessages}`)

  if (turnStarts < 1) throw new Error('探针失败：没有产生 turn/start')
  if (toolCalls < 1) throw new Error('探针失败：没有产生 tool/call')
  if (assistantMessages < 1) throw new Error('探针失败：没有产生 assistant/message')

  line(style.green('PROBE_TRAJECTORY_OK'))
} finally {
  await lab.dispose()
}
