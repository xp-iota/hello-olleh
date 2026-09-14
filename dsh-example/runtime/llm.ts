/**
 * llm.ts —— 示例工程统一的 LLM 适配器集合。
 *
 * - MockAdapter / ToolCallingMockAdapter：离线确定性运行。
 * - AnthropicCompatAdapter：MiniMax 与 Fuyao 共用的 Anthropic Messages + SSE 适配器。
 *
 * 两个真实供应商的关键差异是 reasoning 回放：MiniMax 返回并要求原样回放 signature；
 * Fuyao 可能返回无 signature 的 thinking。后者只在同一 assistant 消息仍有 text/tool-call
 * 可回放时省略 unsigned reasoning，绝不把模型思维伪装成普通文本。
 */
import { ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  Message,
  ReplayEnvelope,
  StreamChunk,
  TokenUsage,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'

/** Anthropic stop_reason → dsh finish.reason.kind（只映射不带 failure 的那几档）。 */
const FINISH_REASON: Record<string, 'stop' | 'max-tokens' | 'tool-calls'> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'max-tokens',
  tool_use: 'tool-calls',
}

/**
 * 逐行解析 SSE 的 data 字段。EOF 时也消费最后一个无换行事件；畸形 JSON
 * 是协议错误，不能静默丢弃后继续把部分回答标成成功。
 */
async function* parseSseData(body: AsyncIterable<Uint8Array>): AsyncGenerator<any> {
  const decoder = new TextDecoder()
  let buffer = ''

  const parseLine = (raw: string): any => {
    const line = raw.trimEnd()
    if (!line.startsWith('data:')) return undefined
    const data = line.slice(5).trim()
    if (!data) return undefined
    if (data === '[DONE]') return { type: '__done' }
    try {
      return JSON.parse(data)
    } catch (error) {
      throw new Error('anthropic-compat: SSE data 不是合法 JSON', { cause: error })
    }
  }

  const drain = function* (final: boolean) {
    let eol: number
    while ((eol = buffer.indexOf('\n')) >= 0) {
      const event = parseLine(buffer.slice(0, eol))
      buffer = buffer.slice(eol + 1)
      if (event !== undefined) yield event
    }
    if (final && buffer.length > 0) {
      const event = parseLine(buffer)
      buffer = ''
      if (event !== undefined) yield event
    }
  }

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    yield* drain(false)
  }
  buffer += decoder.decode()
  yield* drain(true)
}

export type AnthropicCompatVendor = 'minimax' | 'fuyao'

export interface AnthropicCompatOptions {
  apiKey: string
  /** 显式供应商；缺省时根据 baseUrl/defaultModel 自动识别。 */
  vendor?: AnthropicCompatVendor | undefined
  /** MiniMax 默认官方 Anthropic 端点；Fuyao 必须配置自己的网关地址。 */
  baseUrl?: string | undefined
  /** MiniMax 默认 MiniMax-M3；Fuyao 默认 fuyao-coding。 */
  defaultModel?: string | undefined
}

/** 显式配置优先；兼容旧配置时根据 Fuyao 网关/模型名自动识别。 */
export function resolveAnthropicCompatVendor(
  vendor: string | undefined,
  hints: { baseUrl?: string | undefined; model?: string | undefined } = {},
): AnthropicCompatVendor {
  if (vendor !== undefined) {
    const normalized = vendor.trim().toLowerCase()
    if (normalized === 'minimax' || normalized === 'fuyao') return normalized
    throw new Error(`anthropic-compat: 不支持 LLM_VENDOR=${JSON.stringify(vendor)}（只支持 minimax / fuyao）`)
  }
  const hint = `${hints.baseUrl ?? ''} ${hints.model ?? ''}`.toLowerCase()
  return hint.includes('fuyao') || hint.includes('xiaopeng') ? 'fuyao' : 'minimax'
}

interface ReplayBlock {
  type: 'text' | 'thinking' | 'tool_use'
  signature?: string
}

interface ActiveText {
  kind: 'text'
  text: string
}

interface ActiveReasoning {
  kind: 'reasoning'
  text: string
  signature: string
}

interface ActiveToolCall {
  kind: 'tool-call'
  id: ReturnType<typeof ToolCallId>
  name: string
  arguments: string
}

type ActiveBlock = ActiveText | ActiveReasoning | ActiveToolCall

function parseToolArguments(raw: string, toolName: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('工具参数必须是 JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`anthropic-compat: 工具 "${toolName}" 的 arguments 不是合法 JSON object`, { cause: error })
  }
}

function replayBlocks(message: Message): readonly ReplayBlock[] {
  const replay = message.source.kind === 'model' ? message.source.replayState : undefined
  if (!replay || typeof replay !== 'object') return []
  const blocks = (replay as { blocks?: unknown }).blocks
  return Array.isArray(blocks) ? blocks as ReplayBlock[] : []
}

function toAnthropicNestedBlock(block: ContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'image':
      throw new Error('anthropic-compat: 当前适配器未装配附件读取能力，不能发送 image block')
    default:
      throw new Error(`anthropic-compat: tool_result 内不支持 ${JSON.stringify(block.type)} block`)
  }
}

/**
 * 真实 agent-loop 把 System Prompt 当成一条 `role: 'system'` 的消息放进
 * `options.messages`，而 Anthropic Messages API 只接受顶层 `system`。这里把两个来源
 * 按出现顺序合并成 text block 数组：
 *   1. `GenerateOptions.system`（调用方显式传入的那一段）
 *   2. `messages` 里所有 role=system 消息的 text block
 *
 * 不做这一步，真实链路会在第一个 step 就 finish 成 `{kind:'error'}`，会话日志里只剩
 * 一条空 assistant —— 看起来"跑通了"，其实模型从未回答。
 */
function splitSystem(options: GenerateOptions): {
  system: Array<{ type: 'text'; text: string }>
  messages: readonly Message[]
} {
  const system: Array<{ type: 'text'; text: string }> = []
  if (options.system) system.push({ type: 'text', text: options.system })
  const messages: Message[] = []
  for (const message of options.messages) {
    if (message.role !== 'system') {
      messages.push(message)
      continue
    }
    for (const block of message.content) {
      if (block.type !== 'text') {
        throw new Error(`anthropic-compat: system 消息只支持 text block，收到 ${JSON.stringify(block.type)}`)
      }
      if (block.text) system.push({ type: 'text', text: block.text })
    }
  }
  return { system, messages }
}

/** dsh provider-neutral message → Anthropic Messages API message。 */
function toAnthropicMessage(message: Message, vendor: AnthropicCompatVendor): Record<string, unknown> {
  if (message.role === 'system') {
    // splitSystem 已把 system 消息摘走；走到这里说明调用方绕过了它。
    throw new Error('anthropic-compat: system 消息必须通过 GenerateOptions.system 传入')
  }
  const replay = replayBlocks(message)
  const hasReplayableSibling = message.content.some((block) => block.type !== 'reasoning')
  const content: Array<Record<string, unknown>> = []
  message.content.forEach((block, index) => {
    switch (block.type) {
      case 'text':
        content.push({ type: 'text', text: block.text })
        break
      case 'reasoning': {
        const metadata = replay[index]
        if (metadata?.type === 'thinking' && metadata.signature) {
          content.push({ type: 'thinking', thinking: block.text, signature: metadata.signature })
          break
        }
        // Fuyao 的工具调用响应可能带 unsigned thinking；保留同消息里的 tool_use/text 即可续跑。
        if (vendor === 'fuyao' && hasReplayableSibling) break
        throw new Error(`${vendor}: 无法回放缺少 Anthropic signature 的 reasoning block`)
      }
      case 'tool-call':
        content.push({
          type: 'tool_use',
          id: String(block.id),
          name: block.name,
          input: parseToolArguments(block.arguments, block.name),
        })
        break
      case 'tool-result':
        content.push({
          type: 'tool_result',
          tool_use_id: String(block.toolCallId),
          content: block.content.map(toAnthropicNestedBlock),
          ...(block.isError === undefined ? {} : { is_error: block.isError }),
        })
        break
      case 'image':
        throw new Error('anthropic-compat: 当前适配器未装配附件读取能力，不能发送 image block')
      default:
        throw new Error(`anthropic-compat: 不支持的消息块 ${(block as ContentBlock).type}`)
    }
  })
  return { role: message.role, content }
}

function toAnthropicTool(tool: ToolSchema): Record<string, unknown> {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters }
}

function tokenUsage(inputTotal: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number): TokenUsage {
  return {
    inputTokens: Math.max(0, inputTotal - cacheReadTokens - cacheWriteTokens),
    outputTokens,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
  }
}

export class AnthropicCompatAdapter extends LlmAdapter {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly defaultModel: string
  private readonly vendor: AnthropicCompatVendor

  constructor({ apiKey, baseUrl, defaultModel, vendor }: AnthropicCompatOptions) {
    super()
    if (!apiKey) throw new Error('anthropic-compat: 缺少 apiKey（请设环境变量 LLM_API_KEY）')
    this.vendor = resolveAnthropicCompatVendor(vendor, { baseUrl, model: defaultModel })
    const resolvedBaseUrl = baseUrl ?? (this.vendor === 'minimax' ? 'https://api.minimaxi.com/anthropic' : undefined)
    if (!resolvedBaseUrl) throw new Error('fuyao: 必须配置 LLM_BASE_URL')
    this.apiKey = apiKey
    this.baseUrl = resolvedBaseUrl.replace(/\/$/, '')
    this.defaultModel = defaultModel ?? (this.vendor === 'minimax' ? 'MiniMax-M3' : 'fuyao-coding')
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.reasoningEffort !== undefined) {
      // 当前支持的 Anthropic 兼容接口没有与 dsh opaque reasoning effort 对应的档位；
      // fail loud，避免调用方以为该选项已经生效。
      throw new Error(`anthropic-compat: 不支持 reasoningEffort=${JSON.stringify(options.reasoningEffort)}`)
    }

    const model = options.model ?? this.defaultModel
    const { system, messages } = splitSystem(options)
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 2048,
        stream: true,
        ...(system.length ? { system } : {}),
        ...(options.tools?.length ? { tools: options.tools.map(toAnthropicTool) } : {}),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.stop?.length ? { stop_sequences: options.stop } : {}),
        messages: messages.map((message) => toAnthropicMessage(message, this.vendor)),
      }),
      signal: options.signal ?? null,
    })
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      throw new Error(`anthropic-compat: HTTP ${response.status} ${detail.slice(0, 200)}`)
    }

    let inputTotal = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let stopReason = 'end_turn'
    let terminal = false
    let responseId: string | undefined
    let responseModel: string | undefined
    const active = new Map<number, ActiveBlock>()
    const replay: ReplayBlock[] = []

    for await (const evt of parseSseData(response.body as unknown as AsyncIterable<Uint8Array>)) {
      if (evt.type === '__done') {
        terminal = true
        break
      }
      switch (evt.type) {
        case 'message_start': {
          responseId = evt.message?.id
          responseModel = evt.message?.model
          const usage = evt.message?.usage ?? {}
          inputTotal = usage.input_tokens ?? inputTotal
          outputTokens = usage.output_tokens ?? outputTokens
          cacheReadTokens = usage.cache_read_input_tokens ?? cacheReadTokens
          cacheWriteTokens = usage.cache_creation_input_tokens ?? cacheWriteTokens
          break
        }
        case 'content_block_start': {
          const index = evt.index
          const block = evt.content_block ?? {}
          if (block.type === 'text') {
            const text = block.text ?? ''
            active.set(index, { kind: 'text', text })
            yield { type: 'block-start', index, blockType: 'text' }
            if (text) yield { type: 'text-delta', index, text }
          } else if (block.type === 'thinking') {
            const text = block.thinking ?? ''
            active.set(index, { kind: 'reasoning', text, signature: block.signature ?? '' })
            yield { type: 'block-start', index, blockType: 'reasoning' }
            if (text) yield { type: 'reasoning-delta', index, text }
          } else if (block.type === 'tool_use') {
            const id = ToolCallId(String(block.id))
            const initial = block.input && Object.keys(block.input).length > 0 ? JSON.stringify(block.input) : ''
            active.set(index, { kind: 'tool-call', id, name: String(block.name), arguments: initial })
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index, id, name: String(block.name), argumentsDelta: initial }
          } else {
            throw new Error(`anthropic-compat: 不支持 Anthropic content block ${JSON.stringify(block.type)}`)
          }
          break
        }
        case 'content_block_delta': {
          const current = active.get(evt.index)
          if (!current) throw new Error(`anthropic-compat: 收到未知 block ${evt.index} 的 delta`)
          const delta = evt.delta ?? {}
          if (current.kind === 'text' && delta.type === 'text_delta') {
            const text = delta.text ?? ''
            current.text += text
            if (text) yield { type: 'text-delta', index: evt.index, text }
          } else if (current.kind === 'reasoning' && delta.type === 'thinking_delta') {
            const text = delta.thinking ?? ''
            current.text += text
            if (text) yield { type: 'reasoning-delta', index: evt.index, text }
          } else if (current.kind === 'reasoning' && delta.type === 'signature_delta') {
            current.signature += delta.signature ?? ''
          } else if (current.kind === 'tool-call' && delta.type === 'input_json_delta') {
            const fragment = delta.partial_json ?? ''
            current.arguments += fragment
            if (fragment) {
              yield { type: 'tool-call-delta', index: evt.index, id: current.id, argumentsDelta: fragment }
            }
          } else {
            throw new Error(`anthropic-compat: ${current.kind} block 收到不兼容 delta ${JSON.stringify(delta.type)}`)
          }
          break
        }
        case 'content_block_stop': {
          const current = active.get(evt.index)
          if (!current) throw new Error(`anthropic-compat: 收到未知 block ${evt.index} 的 stop`)
          active.delete(evt.index)
          if (current.kind === 'text') {
            yield { type: 'block-end', index: evt.index, block: { type: 'text', text: current.text } }
            replay.push({ type: 'text' })
          } else if (current.kind === 'reasoning') {
            yield { type: 'block-end', index: evt.index, block: { type: 'reasoning', text: current.text } }
            replay.push({ type: 'thinking', ...(current.signature ? { signature: current.signature } : {}) })
          } else {
            const argumentsRaw = current.arguments || '{}'
            parseToolArguments(argumentsRaw, current.name)
            yield {
              type: 'block-end',
              index: evt.index,
              block: { type: 'tool-call', id: current.id, name: current.name, arguments: argumentsRaw },
            }
            replay.push({ type: 'tool_use' })
          }
          break
        }
        case 'message_delta': {
          stopReason = evt.delta?.stop_reason ?? stopReason
          const usage = evt.usage ?? {}
          outputTokens = usage.output_tokens ?? outputTokens
          break
        }
        case 'message_stop':
          terminal = true
          break
        case 'error':
          throw new Error(`anthropic-compat: 带内错误 ${JSON.stringify(evt.error ?? evt)}`)
      }
      if (terminal) break
    }
    if (!terminal) throw new Error('anthropic-compat: Anthropic stream ended before message_stop')
    if (active.size > 0) throw new Error('anthropic-compat: Anthropic stream ended before content_block_stop')

    yield { type: 'usage', usage: tokenUsage(inputTotal, outputTokens, cacheReadTokens, cacheWriteTokens) }
    const kind = FINISH_REASON[stopReason] ?? 'stop'
    const replayState: ReplayEnvelope = {
      response: { id: responseId, model: responseModel, stopReason },
      blocks: replay,
    }
    yield {
      type: 'finish',
      reason: kind === 'max-tokens' ? { kind: 'max-tokens' } : kind === 'tool-calls' ? { kind: 'tool-calls' } : { kind: 'stop' },
      replayState,
    }
  }
}

export default AnthropicCompatAdapter

/** 固定文本与工具调用两种离线适配器。 */
export class MockAdapter extends LlmAdapter {
  private readonly reply: string

  constructor(reply: string) {
    super()
    this.reply = reply
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.signal?.aborted) throw options.signal.reason
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.reply } }
    yield { type: 'usage', usage: { inputTokens: options.messages.length, outputTokens: this.reply.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}


/**
 * 一个"会调工具"的 mock 适配器：**第一步**吐一个 tool-call 块，让真实 agent-loop 去
 * 派发工具；从**第二步**起改吐纯文本收尾。用于演示只有在 turn 内才能发生的行为
 * （审批 `approval.request()`、工具结果回灌、多 step 循环…）。
 */
export class ToolCallingMockAdapter extends LlmAdapter {
  private readonly toolName: string
  private readonly toolArgs: string
  private readonly reply: string
  private calls = 0

  constructor(toolName: string, toolArgs: Record<string, unknown> = {}, reply = '工具跑完了，我来收尾。') {
    super()
    this.toolName = toolName
    this.toolArgs = JSON.stringify(toolArgs)
    this.reply = reply
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    if (this.calls === 1) {
      const id = ToolCallId(`mock-call-${this.calls}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: this.toolName, argumentsDelta: this.toolArgs }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: this.toolName, arguments: this.toolArgs } }
      yield { type: 'usage', usage: { inputTokens: options.messages.length, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.reply } }
    yield { type: 'usage', usage: { inputTokens: options.messages.length, outputTokens: this.reply.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
