/**
 * trajectory.ts —— 把会话事件流渲染成可读的 trajectory（纯文本版）。
 *
 * 数据来源是官方 ctx.sessionQuery 的精确读面：readSession() 做一次完整 replay
 * 校验，读出来的事件序列就是真正被信任的那一份。渲染分三层：
 *   1. 概览 —— id、标题、事件数、turn 数、工具调用、token 用量；
 *   2. turn 大纲 —— foldTurns() 把事件流折叠成每个 turn 的编号/起止/步数/提示词；
 *   3. 逐事件明细与模型表面（可选）。
 *
 * 折叠逻辑里有三个只有跑过真实 turn 才看得见的坑（旧教材实测踩过）：
 *   - 消息体有两种形状：user/assistant 事件负载在 data 本身，tool/result 在 data.message；
 *   - user/message 不全是人说的话：runtime-context 等注入块要按 source.kind 过滤；
 *   - turn/end 的 reason 是结构化对象 { kind }，不是字符串。
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query-sqlite'

/** 一个 turn 的折叠结果。 */
export interface Turn {
  readonly number: number
  readonly startSeq: number
  readonly endSeq: number | undefined
  readonly reason: string | undefined
  readonly prompt: string
  readonly steps: number
  readonly toolCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/** 取 content（block 数组或字符串）里的纯文本。 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: { type?: string; text?: string }) => (block?.type === 'text' ? (block.text ?? '') : ''))
    .filter(Boolean)
    .join(' ')
}

/** 两种消息形状都认：data 本身（user/assistant）或 data.message（tool/result）。 */
function messageOf(data: Record<string, unknown>): { content?: unknown; isError?: boolean } | undefined {
  const direct = data as { content?: unknown; role?: string; isError?: boolean }
  if (direct.role !== undefined && direct.content !== undefined) return direct
  return data.message as { content?: unknown; isError?: boolean } | undefined
}

/** 只保留人真正说的话：source.kind 缺席或为 'user' 才算人类消息。 */
function isHumanMessage(data: Record<string, unknown>): boolean {
  const source = data.source as { kind?: string } | undefined
  return source?.kind === undefined || source.kind === 'user'
}

/** turn/end 的 reason 是 { kind: 'completed' } 这样的对象。 */
function reasonOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && 'kind' in value) {
    return String((value as { kind: unknown }).kind)
  }
  return String(value)
}

/** assistant 内容摘要：纯 tool-call 的消息不能渲染成空行，要标出调了什么。 */
function describeAssistantContent(content: unknown): string {
  const text = textOf(content)
  if (!Array.isArray(content)) return text
  const calls = content
    .filter((block: { type?: string }) => block?.type === 'tool-call')
    .map((block: { name?: string }) => block.name ?? '?')
  if (calls.length === 0) return text
  const callText = `→ ${calls.join(', ')}`
  return text === '' ? callText : `${text} ${callText}`
}

/** 截断到一行。 */
function oneLine(text: string, limit = 100): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + '…'
}

/** 把事件序列折叠成 turn 列表。 */
export function foldTurns(events: readonly SessionEvent[]): Turn[] {
  const turns: Turn[] = []
  let current: { number: number; startSeq: number; prompt: string; steps: number; toolCalls: number; inputTokens: number; outputTokens: number } | undefined
  let endSeq: number | undefined
  let reason: string | undefined
  const close = () => {
    if (current === undefined) return
    turns.push({ ...current, endSeq, reason })
    current = undefined
    endSeq = undefined
    reason = undefined
  }
  for (const event of events) {
    const data = (event as { data?: Record<string, unknown> }).data ?? {}
    switch (event.type) {
      case 'turn/start':
        close()
        current = { number: Number(data.turn), startSeq: event.seq, prompt: '', steps: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 }
        break
      case 'user/message':
        // 只取 turn 里第一条人类消息，否则后续插话会盖掉开头那句。
        if (current !== undefined && current.prompt === '' && isHumanMessage(data)) {
          current.prompt = textOf(messageOf(data)?.content)
        }
        break
      case 'step/start':
        if (current !== undefined) current.steps += 1
        break
      case 'tool/call':
        if (current !== undefined) current.toolCalls += 1
        break
      case 'assistant/message': {
        const usage = (data as { usage?: { inputTokens?: number; outputTokens?: number } }).usage
        if (current !== undefined && usage !== undefined) {
          current.inputTokens += usage.inputTokens ?? 0
          current.outputTokens += usage.outputTokens ?? 0
        }
        break
      }
      case 'turn/end':
        endSeq = event.seq
        reason = reasonOf(data.reason)
        close()
        break
      default:
        break
    }
  }
  close()
  return turns
}

/** 把一个事件渲染成一行摘要；返回 undefined 表示不展示。 */
function describeEvent(event: SessionEvent): string | undefined {
  const data = (event as { data?: Record<string, unknown> }).data ?? {}
  switch (event.type) {
    case 'turn/start':
      return `turn ${String(data.turn)} 开始`
    case 'turn/end':
      return `turn ${String(data.turn)} 结束 (${reasonOf(data.reason)})`
    case 'step/start':
      return `step ${String(data.step)} 开始`
    case 'step/end':
      return `step ${String(data.step)} 结束`
    case 'user/message': {
      const text = textOf(messageOf(data)?.content)
      if (!isHumanMessage(data)) return `context  ${oneLine(text, 70)}`
      return `user      ${oneLine(text, 90)}`
    }
    case 'assistant/message':
      return `assistant ${oneLine(describeAssistantContent(messageOf(data)?.content), 90)}`
    case 'tool/call':
      return `tool      ${String(data.name)} ${oneLine(String(data.arguments ?? ''), 70)}`
    case 'tool/result': {
      const message = messageOf(data)
      return `${message?.isError === true ? 'result✗' : 'result'}   ${oneLine(textOf(message?.content), 80)}`
    }
    default:
      // request/header、assistant/attempt、投影记录等默认不展开。
      return undefined
  }
}

/** 打印一条会话的 trajectory（概览 + turn 大纲 + 明细 + 可选表面）。 */
export async function renderTrajectory(
  ctx: Context,
  sessionId: string,
  options: { surface?: boolean; events?: boolean } = {},
): Promise<void> {
  const id = SessionId(sessionId)
  const snapshot = await ctx.sessionQuery.readSession(id)
  const events = snapshot.events
  const turns = foldTurns(events)
  const title = await ctx.sessionQuery.readTitle(id).catch(() => undefined)
  const inputTokens = turns.reduce((sum, turn) => sum + turn.inputTokens, 0)
  const outputTokens = turns.reduce((sum, turn) => sum + turn.outputTokens, 0)
  const toolCalls = turns.reduce((sum, turn) => sum + turn.toolCalls, 0)

  console.log(`\ntrajectory ${snapshot.session.id}`)
  if (title?.title !== undefined && title.title !== '') console.log(`  标题      ${title.title}`)
  console.log(`  事件      ${events.length} 条`)
  console.log(`  turn      ${turns.length} 个`)
  console.log(`  工具调用  ${toolCalls} 次`)
  console.log(`  token     ${inputTokens} in / ${outputTokens} out`)

  if (turns.length > 0) {
    console.log('\nturn 大纲')
    console.log('  #   seq        步  工具  结局        提示词')
    for (const turn of turns) {
      console.log(
        `  ${String(turn.number).padStart(2)}  ` +
        `${String(turn.startSeq).padStart(4)}→${String(turn.endSeq ?? '-').padEnd(4)}  ` +
        `${String(turn.steps).padStart(2)}  ${String(turn.toolCalls).padStart(4)}  ` +
        `${String(turn.reason ?? '-').padEnd(10)}  ${oneLine(turn.prompt, 60)}`,
      )
    }
  }

  if (options.events !== false) {
    console.log('\n事件明细')
    for (const event of events) {
      const detail = describeEvent(event)
      if (detail !== undefined) console.log(`  ${String(event.seq).padStart(4)}  ${detail}`)
    }
  }

  if (options.surface === true) {
    console.log('\n模型表面（readSurface）')
    const surface = await ctx.sessionQuery.readSurface(id)
    for (const event of surface.events) {
      const data = ((event as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>
      console.log(`  ${String(event.type).padEnd(18)} ${oneLine(describeAssistantContent(messageOf(data)?.content), 100)}`)
    }
  }
}