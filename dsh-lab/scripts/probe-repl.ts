/**
 * probe-repl.ts —— 用脚本化适配器驱动一次 **REPL 实时渲染**，验证流式与工具行。
 *
 * 为什么值得单独探一次：`dsh-lab chat` 的实时渲染有三处独立的字段读取
 * （assistant-stream 帧、turn/end 的 reason、tool/result 的 data.message），
 * 每一处都曾经因为"负载在 event.data 里"这条 0.2.1 约定而读空。没有 key 时
 * 这条路径永远跑不到，所以这里用脚本化适配器把它跑到。
 *
 * 用法：node scripts/probe-repl.ts
 */
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootLab } from '../src/boot.ts'
import { line, style } from '../src/cli/term.ts'

/** 两步对话：先调工具，再收尾。 */
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
      yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 12 } }
      yield { type: 'finish', reason: 'tool-calls' as never }
      return
    }

    const text = '目录查到了，就在这里。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for (const piece of [text.slice(0, 4), text.slice(4)]) {
      yield { type: 'text-delta', index: 0, text: piece }
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } as never }
    yield { type: 'usage', usage: { inputTokens: 1100, outputTokens: 9 } }
    yield { type: 'finish', reason: 'stop' as never }
  }
}

const lab = await bootLab()
try {
  lab.ctx.llm.registerAdapter(['lab-probe'], new ScriptedAdapter())

  const sessionId = SessionId(`repl-probe-${Date.now().toString(36)}`)
  const handle = await lab.ctx.agents.create({
    sessionId,
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'lab-probe', model: 'scripted' },
  })

  // 复刻 REPL 的三个监听，逐一验证渲染不空、不出现 [object Object]。
  const seen = { stream: 0, turnEnd: '', toolCall: '', toolResult: '' }

  lab.ctx.on('agent/assistant-stream' as never, ((payload: { agent: unknown; frame: any }) => {
    if (payload.agent !== handle.agent) return
    if (payload.frame?.type === 'chunk') seen.stream += 1
  }) as never)

  lab.ctx.on('session/event' as never, ((session: { id: string }, event: any) => {
    if (String(session.id) !== String(handle.agent.id)) return
    const data = event.data ?? {}
    if (event.type === 'turn/end') {
      const reason = data.reason
      seen.turnEnd =
        typeof reason === 'object' && reason !== null && 'kind' in reason
          ? String((reason as { kind: unknown }).kind)
          : String(reason)
    }
    if (event.type === 'tool/call') seen.toolCall = String(data.name ?? '')
    if (event.type === 'tool/result') {
      const message = data.message ?? {}
      const content = message.content
      seen.toolResult = Array.isArray(content)
        ? content.map((block: any) => (block?.type === 'text' ? block.text : `[${block?.type}]`)).join(' ')
        : String(content ?? '')
    }
  }) as never)

  await handle.agent.send(
    createUserMessage({ content: [{ type: 'text', text: '我们在哪个目录？' }], source: { kind: 'user' } }),
    'next-turn',
    true,
  )
  await handle.agent.whenIdle()

  line()
  line(`流式帧   ${seen.stream} 个`)
  line(`turn 收尾 ${seen.turnEnd}`)
  line(`工具调用 ${seen.toolCall}`)
  line(`工具结果 ${seen.toolResult}`)

  if (seen.stream < 1) throw new Error('探针失败：没有收到 assistant-stream 帧')
  if (seen.turnEnd !== 'completed') throw new Error(`探针失败：turn 收尾渲染成了 "${seen.turnEnd}"`)
  if (seen.turnEnd.includes('[object')) throw new Error('探针失败：reason 仍然渲染成 [object Object]')
  if (seen.toolCall !== 'working_directory') throw new Error(`探针失败：工具名读成了 "${seen.toolCall}"`)
  if (seen.toolResult === '') throw new Error('探针失败：工具结果预览为空')

  line(style.green('PROBE_REPL_OK'))
} finally {
  await lab.dispose()
}
