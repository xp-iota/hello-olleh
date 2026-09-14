/**
 * llm-minimax.ts —— MiniMax（稀宇科技）Anthropic 兼容端点的真实 `LlmAdapter`。
 *
 * 继承的是真实包 `@deepseek-ai/dsh-llm` 的抽象类，与 05 的 MockAdapter 走同一份契约，
 * 把 provider-neutral 消息 / 工具 schema 翻译成 Anthropic Messages wire format，再把
 * SSE 的 text / thinking / tool_use 块翻译回 dsh 的 StreamChunk 协议。
 *
 * 认证走 `x-api-key` 头；密钥只从环境变量 LLM_API_KEY 读，永不入库。
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
      throw new Error('minimax: SSE data 不是合法 JSON', { cause: error })
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

export interface MinimaxOptions {
  apiKey: string
  /** 默认 https://api.minimaxi.com/anthropic（Anthropic 兼容端点）。 */
  baseUrl?: string | undefined
  /** 默认 MiniMax-M3。 */
  defaultModel?: string | undefined
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
    throw new Error(`minimax: 工具 "${toolName}" 的 arguments 不是合法 JSON object`, { cause: error })
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
      throw new Error('minimax: 当前适配器未装配附件读取能力，不能发送 image block')
    default:
      throw new Error(`minimax: tool_result 内不支持 ${JSON.stringify(block.type)} block`)
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
        throw new Error(`minimax: system 消息只支持 text block，收到 ${JSON.stringify(block.type)}`)
      }
      if (block.text) system.push({ type: 'text', text: block.text })
    }
  }
  return { system, messages }
}

/** dsh provider-neutral message → Anthropic Messages API message。 */
function toAnthropicMessage(message: Message): Record<string, unknown> {
  if (message.role === 'system') {
    // splitSystem 已把 system 消息摘走；走到这里说明调用方绕过了它。
    throw new Error('minimax: system 消息必须通过 GenerateOptions.system 传入')
  }
  const replay = replayBlocks(message)
  const content = message.content.map((block, index) => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text }
      case 'reasoning': {
        const metadata = replay[index]
        if (metadata?.type !== 'thinking' || !metadata.signature) {
          throw new Error('minimax: 无法回放缺少 Anthropic signature 的 reasoning block')
        }
        return { type: 'thinking', thinking: block.text, signature: metadata.signature }
      }
      case 'tool-call':
        return {
          type: 'tool_use',
          id: String(block.id),
          name: block.name,
          input: parseToolArguments(block.arguments, block.name),
        }
      case 'tool-result':
        return {
          type: 'tool_result',
          tool_use_id: String(block.toolCallId),
          content: block.content.map(toAnthropicNestedBlock),
          ...(block.isError === undefined ? {} : { is_error: block.isError }),
        }
      case 'image':
        throw new Error('minimax: 当前适配器未装配附件读取能力，不能发送 image block')
      default:
        throw new Error(`minimax: 不支持的消息块 ${(block as ContentBlock).type}`)
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

export class MinimaxAnthropicAdapter extends LlmAdapter {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly defaultModel: string

  constructor({ apiKey, baseUrl, defaultModel }: MinimaxOptions) {
    super()
    if (!apiKey) throw new Error('minimax: 缺少 apiKey（请设环境变量 LLM_API_KEY）')
    this.apiKey = apiKey
    this.baseUrl = (baseUrl ?? 'https://api.minimaxi.com/anthropic').replace(/\/$/, '')
    this.defaultModel = defaultModel ?? 'MiniMax-M3'
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.reasoningEffort !== undefined) {
      // MiniMax 的 Anthropic 兼容接口没有与 dsh opaque reasoning effort 对应的档位；
      // fail loud，避免调用方以为该选项已经生效。
      throw new Error(`minimax: 不支持 reasoningEffort=${JSON.stringify(options.reasoningEffort)}`)
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
        messages: messages.map(toAnthropicMessage),
      }),
      signal: options.signal ?? null,
    })
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      throw new Error(`minimax: HTTP ${response.status} ${detail.slice(0, 200)}`)
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
            throw new Error(`minimax: 不支持 Anthropic content block ${JSON.stringify(block.type)}`)
          }
          break
        }
        case 'content_block_delta': {
          const current = active.get(evt.index)
          if (!current) throw new Error(`minimax: 收到未知 block ${evt.index} 的 delta`)
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
            throw new Error(`minimax: ${current.kind} block 收到不兼容 delta ${JSON.stringify(delta.type)}`)
          }
          break
        }
        case 'content_block_stop': {
          const current = active.get(evt.index)
          if (!current) throw new Error(`minimax: 收到未知 block ${evt.index} 的 stop`)
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
          throw new Error(`minimax: 带内错误 ${JSON.stringify(evt.error ?? evt)}`)
      }
      if (terminal) break
    }
    if (!terminal) throw new Error('minimax: Anthropic stream ended before message_stop')
    if (active.size > 0) throw new Error('minimax: Anthropic stream ended before content_block_stop')

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

export default MinimaxAnthropicAdapter
