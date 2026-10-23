/**
 * traj.ts —— trajectory（会话轨迹）的读取与展示。
 *
 * 数据来源是官方 `ctx.sessionQuery`（`dsh-session-query` 的精确读面），不是
 * 自建日志解析：`readSession()` 会做一次完整的 replay 校验，读出来的事件序列就是
 * 真正被信任的那一份。
 *
 * 展示四类信息：
 *   1. 概览 —— 会话 id、标题、cwd、事件数、turn 数、token 用量；
 *   2. turn 大纲 —— 每个 turn 的编号、起止、耗时、该 turn 的提示词摘要；
 *   3. 明细 —— 按 seq 列出 step / 消息 / 工具调用 / 工具结果，附时间戳；
 *   4. 模型表面 —— `readSurface()` 折叠后的模型实际看到的上下文（`--surface`）。
 *
 * 之所以把"记录"和"查看"分成两层：记录是持久化接缝（M05）的产物，查看是本工程
 * 新加的价值——官方 CLI 没有终端 trajectory 视图。
 *
 * @module dsh-lab/cli/traj
 */
// 类型增强：sessionQuery / tools / commands 等服务的 Context 声明来自这些包。
// 运行时由装配树提供，编译期必须显式 import 才能看到 ctx 上的成员。
import '@deepseek-ai/dsh-session-query'
import '@deepseek-ai/dsh-tools'
import '@deepseek-ai/dsh-commands'

import '../lab/services.ts'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { line, style } from './term.ts'

/** 一条事件的数据体（0.2.1 把负载统一放在 `data` 里）。 */
type EventData<T extends SessionEvent> = T['data']

/** 一个 turn 的折叠结果（导出供回归测试构造断言）。 */
interface Turn {
  readonly number: number
  readonly startSeq: number
  readonly endSeq: number | undefined
  readonly startTime: number
  readonly endTime: number | undefined
  readonly reason: string | undefined
  readonly prompt: string
  readonly steps: number
  readonly toolCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/** 把事件序列折叠成 turn 列表。 */
export function foldTurns(events: readonly SessionEvent[]): Turn[] {
  const turns: Turn[] = []
  let current:
    | {
        number: number
        startSeq: number
        startTime: number
        prompt: string
        steps: number
        toolCalls: number
        inputTokens: number
        outputTokens: number
      }
    | undefined
  let endSeq: number | undefined
  let endTime: number | undefined
  let reason: string | undefined

  const close = () => {
    if (current === undefined) return
    turns.push({ ...current, endSeq, endTime, reason })
    current = undefined
    endSeq = undefined
    endTime = undefined
    reason = undefined
  }

  for (const event of events) {
    const time = event.time ?? 0
    switch (event.type) {
      case 'turn/start': {
        close()
        const data = (event as { data: EventData<Extract<SessionEvent, { type: 'turn/start' }>> }).data
        current = {
          number: data.turn,
          startSeq: event.seq,
          startTime: time,
          prompt: '',
          steps: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
        }
        break
      }
      case 'user/message': {
        // 只认人类说的话：runtime-context、skills 提示、workspace 指令这些
        // 也是 user/message，但把它们当"提示词"印进大纲毫无意义。
        // 同时只取 turn 里的**第一条**人类消息，否则后续插话会盖掉开头那句。
        if (current !== undefined && current.prompt === '') {
          const data = (event as unknown as { data: Record<string, unknown> }).data
          if (isHumanMessage(data)) current.prompt = textOf(messageOf(data)?.content)
        }
        break
      }
      case 'step/start':
        if (current !== undefined) current.steps += 1
        break
      case 'tool/call':
        if (current !== undefined) current.toolCalls += 1
        break
      case 'assistant/message': {
        const data = (event as { data: { usage?: { inputTokens?: number; outputTokens?: number } } }).data
        if (current !== undefined && data.usage !== undefined) {
          current.inputTokens += data.usage.inputTokens ?? 0
          current.outputTokens += data.usage.outputTokens ?? 0
        }
        break
      }
      case 'turn/end': {
        const data = (event as { data: { turn: number; reason: unknown } }).data
        endSeq = event.seq
        endTime = time
        reason = reasonOf(data.reason)
        close()
        break
      }
      default:
        break
    }
  }
  close()
  return turns
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

/**
 * 把一条 assistant 的内容渲染成可读摘要。
 *
 * 只取 text 会漏掉"这一步其实是在调工具"——纯 tool-call 的 assistant 消息
 * 会渲染成空行，看上去像是模型什么都没说。这里把 tool-call 也标出来。
 */
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

/**
 * 从一条事件的 `data` 里取消息体。
 *
 * 0.2.1 的两种形状必须都认，否则渲染出来是空行：
 *   * `user/message` / `assistant/message` 事件（消息被直接记录）—— 负载在 `data` 本身；
 *   * `tool/result` 事件 —— 负载在 `data.message` 里，因为它记录的是"一条 tool 消息"。
 *
 * 早期版本只用 `data.message`，于是所有 user 行和 result 行都是空的；
 * 这个 bug 只有在真的跑过一个 turn 之后才看得见，播种空会话是照不出来的。
 */
function messageOf(data: Record<string, unknown>): { content?: unknown; isError?: boolean } | undefined {
  const direct = data as { content?: unknown; role?: string; isError?: boolean }
  if (direct.role !== undefined && direct.content !== undefined) return direct
  const wrapped = data.message as { content?: unknown; isError?: boolean } | undefined
  return wrapped
}

/** 只保留人真正说的话，过滤掉运行时注入的上下文块。 */
function isHumanMessage(data: Record<string, unknown>): boolean {
  const source = data.source as { kind?: string } | undefined
  // source 缺席时按人类消息处理：不是每个写入方都会标 source。
  return source?.kind === undefined || source.kind === 'user'
}

/** `turn/end` 的 reason 是结构化对象（`{kind:'completed'}`），不是字符串。 */
function reasonOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && 'kind' in value) {
    return String((value as { kind: unknown }).kind)
  }
  return String(value)
}

/** 毫秒 → 人类可读的短时长。 */
function duration(ms: number): string {
  if (ms <= 0) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${seconds}s`
}

/** 时间戳 → HH:MM:SS.mmm */
function clock(time: number): string {
  if (time <= 0) return '--:--:--'
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(
    date.getSeconds(),
  ).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

/** 截断到一行。 */
function oneLine(text: string, limit = 100): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + '…'
}

/**
 * 打印一条会话的 trajectory。
 *
 * @param ctx - 已启动的服务树。
 * @param sessionId - 目标会话 id。
 * @param options.surface - 同时打印模型表面折叠结果。
 * @param options.events - 打印逐事件明细（默认开）。
 */
export async function renderTrajectory(
  ctx: Context,
  sessionId: string,
  options: { surface?: boolean; events?: boolean } = {},
): Promise<void> {
  const id = SessionId(sessionId)
  let snapshot
  try {
    snapshot = await ctx.sessionQuery.readSession(id)
  } catch (error) {
    line(style.red(`✗ 读不到会话 ${sessionId}: ${error instanceof Error ? error.message : String(error)}`))
    line(style.dim('  用 /sessions 或 `dsh-lab sessions` 看已有会话。'))
    return
  }

  const events = snapshot.events
  const header = snapshot.session
  const turns = foldTurns(events)
  const title = await ctx.sessionQuery.readTitle(id).catch(() => undefined)

  const inputTokens = turns.reduce((sum, turn) => sum + turn.inputTokens, 0)
  const outputTokens = turns.reduce((sum, turn) => sum + turn.outputTokens, 0)
  const toolCalls = turns.reduce((sum, turn) => sum + turn.toolCalls, 0)
  const span = (events[events.length - 1]?.time ?? 0) - (events[0]?.time ?? 0)

  // ── 概览 ──
  line()
  line(style.bold(`trajectory ${header.id}`))
  if (title?.title !== undefined && title.title !== '') line(`  标题      ${title.title}`)
  line(`  cwd       ${header.cwd ?? '-'}`)
  line(`  事件      ${events.length} 条`)
  line(`  turn      ${turns.length} 个`)
  line(`  工具调用  ${toolCalls} 次`)
  line(`  耗时      ${duration(span)}`)
  line(`  token     ${inputTokens} in / ${outputTokens} out`)
  if (snapshot.inheritedEventCount > 0) {
    line(style.dim(`  继承前缀  ${snapshot.inheritedEventCount} 条（fork 自父会话）`))
  }

  // ── turn 大纲 ──
  if (turns.length > 0) {
    line()
    line(style.bold('turn 大纲'))
    line(style.dim('  #   seq          时间           耗时    步  工具  提示词'))
    for (const turn of turns) {
      const used = (turn.endTime ?? turn.startTime) - turn.startTime
      line(
        `  ${String(turn.number).padStart(2)}  ` +
          `${String(turn.startSeq).padStart(4)}→${String(turn.endSeq ?? '-').padEnd(4)}  ` +
          `${clock(turn.startTime)}  ${duration(used).padStart(6)}  ` +
          `${String(turn.steps).padStart(2)}  ${String(turn.toolCalls).padStart(4)}  ` +
          style.dim(oneLine(turn.prompt, 60)),
      )
    }
  }

  // ── 逐事件明细 ──
  if (options.events !== false) {
    line()
    line(style.bold('事件明细'))
    for (const event of events) {
      const detail = describeEvent(event)
      if (detail === undefined) continue
      line(`  ${style.dim(String(event.seq).padStart(4))} ${style.dim(clock(event.time ?? 0))}  ${detail}`)
    }
  }

  // ── 模型表面 ──
  if (options.surface === true) {
    line()
    line(style.bold('模型表面（readSurface）'))
    const surface = await ctx.sessionQuery.readSurface(id)
    for (const event of surface.events) {
      const kind = String(event.type)
      const data = ((event as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>
      const text = oneLine(describeAssistantContent(messageOf(data)?.content), 100)
      line(`  ${style.dim(kind.padEnd(18))} ${text}`)
    }
  }
  line()
}

/** 把一个事件渲染成一行摘要；返回 undefined 表示不展示。 */
function describeEvent(event: SessionEvent): string | undefined {
  const data = (event as { data?: Record<string, unknown> }).data ?? {}
  // `permission/preset` / `sandbox/mode` / `approval/policy` 等事件来自
  // permission-presets、sandbox-policy 这些扩展包，不在核心 SessionEvent 联合里，
  // 所以先按字符串比一次，再进穷尽 switch —— 否则 TS 会把它们当成不可达分支。
  const type = String(event.type)
  if (type === 'permission/preset') return style.dim(`权限预设 ${String(data.preset ?? '')}`)
  if (type === 'sandbox/mode') return style.dim(`沙箱模式 ${String(data.mode ?? '')}`)
  if (type === 'approval/policy') return style.dim(`审批策略 ${String(data.policy ?? '')}`)
  if (type === 'session/end-seed') return style.dim('session 播种结束')

  switch (event.type) {
    case 'turn/start':
      return style.magenta(`turn ${String(data.turn)} 开始`)
    case 'turn/end':
      return style.magenta(`turn ${String(data.turn)} 结束 (${reasonOf(data.reason)})`)
    case 'step/start':
      return style.blue(`step ${String(data.step)} 开始`)
    case 'step/end':
      return style.blue(`step ${String(data.step)} 结束`)
    case 'user/message': {
      const text = textOf(messageOf(data)?.content)
      // 运行时注入的上下文块不逐条展开：它们很长，而且不是"对话"。
      if (!isHumanMessage(data)) return style.dim(`context  ${oneLine(text, 70)}`)
      return `${style.cyan('user')}     ${style.dim(oneLine(text, 90))}`
    }
    case 'assistant/message': {
      return `${style.green('assistant')} ${style.dim(oneLine(describeAssistantContent(messageOf(data)?.content), 90))}`
    }
    case 'tool/call':
      return `${style.yellow('tool')}      ${String(data.name)} ${style.dim(oneLine(String(data.arguments ?? ''), 70))}`
    case 'tool/result': {
      const message = messageOf(data)
      const failed = message?.isError === true
      return `${failed ? style.red('result✗') : style.yellow('result')}   ${style.dim(
        oneLine(textOf(message?.content), 80),
      )}`
    }
    case 'approval/asked':
      return style.yellow(`approval  询问 ${String(data.toolName ?? '')}`)
    case 'approval/decided':
      return style.yellow(`approval  结果 ${String(data.outcome ?? '')}`)
    case 'command/run':
      return style.cyan(`command   /${String(data.name ?? '')}`)
    case 'command/done':
      return style.cyan(`command   完成 ${String(data.kind ?? '')}`)
    default:
      // 其余事件（request/header、assistant/attempt、投影记录等）默认不展开，
      // 需要时用 --surface 或直接读 JSONL。
      return undefined
  }
}

/** 列出会话（最新在前）。 */
export async function renderSessionList(ctx: Context): Promise<void> {
  const records = await ctx.sessionQuery.listSessions()
  if (records.length === 0) {
    line(style.dim('还没有任何会话。先 `dsh-lab chat` 聊一句。'))
    return
  }
  line()
  line(style.bold(`会话（${records.length}）`))
  line(style.dim('  id                                    live  persisted  标题'))
  for (const record of records) {
    const title = await ctx.sessionQuery.readTitle(record.header.id).catch(() => undefined)
    line(
      `  ${String(record.header.id).padEnd(36)}  ` +
        `${record.live ? style.green('yes ') : style.dim('no  ')}  ` +
        `${record.persisted ? style.green('yes      ') : style.dim('no       ')}  ` +
        `${title?.title ?? style.dim('(无标题)')}`,
    )
  }
  line()
}
