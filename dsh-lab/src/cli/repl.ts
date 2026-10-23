/**
 * repl.ts —— 交互式终端会话（`dsh-lab chat`）。
 *
 * 这是本工程"完整人机交互"的主体：一个 agent 一次对话，全部走官方接缝——
 *
 *   人输入  → agent.followup(createUserMessage(...))   （M04 的 inbox 接缝）
 *   模型流  → 'agent/assistant-stream' 事件            （实时渲染，不轮询）
 *   要审批  → 'approval/request' waterfall             （M06）
 *   要提问  → 'user-questions/request' waterfall       （M06）
 *   斜杠命令 → ctx.commands（注册在 dsh-commands 上的 /plan /goal /compact /feedback）
 *   会话日志 → session-persistence-jsonl 落盘          （M05 / trajectory）
 *
 * 关键设计：**没有第二套循环**。REPL 只负责"把人的输入塞进 inbox"和"把事件流
 * 画出来"，turn/step 的推进、工具调度、压缩、重试全部由 dsh-agent-loop 完成。
 *
 * @module dsh-lab/cli/repl
 */
import '../lab/services.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-tools'
import '@deepseek-ai/dsh-commands'
import '@deepseek-ai/dsh-session-query'
import '@deepseek-ai/dsh-user-approval/types'
import '@deepseek-ai/dsh-user-questions'
import { SessionId } from '@deepseek-ai/dsh-session'
import { parseCommand } from '@deepseek-ai/dsh-commands'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'
import { line, Prompter, style, StreamRenderer, tag, width } from './term.ts'
import { renderTrajectory } from './traj.ts'

/** 一次 REPL 会话的可选参数。 */
export interface ChatOptions {
  /** 恢复已有会话 id。 */
  resume?: string
  /** 覆盖模型路由。 */
  provider?: string
  model?: string
}

/**
 * 交互式会话。
 *
 * 生命周期：创建 agent → 循环读输入 → 释放 agent。用户 `/quit` 或 EOF 时退出。
 */
export class Repl {
  private readonly ctx: Context
  private readonly prompter: Prompter
  private readonly disposers: (() => void)[] = []
  private handle: AgentHandle | undefined
  private agent: Agent | undefined
  private streaming: StreamRenderer | undefined
  private reasoning = false
  private inToolCall = false

  constructor(ctx: Context) {
    this.ctx = ctx
    this.prompter = new Prompter()
  }

  /**
   * 创建或恢复 agent，然后进入读-求值循环。
   */
  async run(options: ChatOptions = {}): Promise<void> {
    await this.startAgent(options)
    this.renderBanner(options)

    // 事件订阅在 agent 创建之前装好，避免漏掉第一批帧。
    for (;;) {
      const input = await this.prompter.read(this.promptText())
      if (input === undefined) {
        line(style.dim('\n(EOF，退出)'))
        break
      }
      const text = input.trim()
      if (text === '') continue
      if (text === '/quit' || text === '/exit' || text === '/q') break

      try {
        await this.handleInput(text)
      } catch (error) {
        line(style.red(`✗ ${error instanceof Error ? error.message : String(error)}`))
      }
    }

    this.prompter.close()
    await this.teardown()
  }

  /** 当前 session id（用于提示符和 trajectory 提示）。 */
  private get sessionId(): string {
    return this.agent === undefined ? '(none)' : String(this.agent.id)
  }

  private promptText(): string {
    return `${style.cyan('›')} `
  }

  private renderBanner(options: ChatOptions): void {
    const agent = this.agent
    if (agent === undefined) return
    const provider = agent.options.provider ?? '(default)'
    const model = agent.options.model ?? '(default)'
    line()
    line(`${style.bold('dsh-lab')} ${style.dim('· 交互式会话')}`)
    line(`  ${style.dim('session')}  ${this.sessionId}`)
    line(`  ${style.dim('route')}    ${provider} / ${model}`)
    line(`  ${style.dim('tools')}    ${this.ctx.tools.schemas().length ?? 0} 个`)
    line()
    line(style.dim('  直接输入问题；/help 看命令；Ctrl-D 退出。'))
    if (options.resume !== undefined) line(style.dim(`  （已恢复会话 ${options.resume}）`))
    line()
  }

  /**
   * 建 agent，并装好三类交互监听。
   *
   * `setup` 回调里的注册是 agent 作用域的：agent 释放时它们自动解绑，
   * 因此不用手工记 disposer。
   */
  private async startAgent(options: ChatOptions): Promise<void> {
    const agentOptions: { provider?: string; model?: string } = {}
    if (options.provider !== undefined) agentOptions.provider = options.provider
    if (options.model !== undefined) agentOptions.model = options.model

    if (options.resume !== undefined) {
      this.handle = await this.ctx.agents.resume({
        resumeSessionId: SessionId(options.resume),
        agentOptions,
        setup: (agentCtx) => {
          this.composeAgentScope(agentCtx)
        },
      })
    } else {
      this.handle = await this.ctx.agents.create({
        sessionId: SessionId(crypto.randomUUID()),
        meta: { cwd: process.cwd() },
        agentOptions,
        setup: (agentCtx) => {
          this.composeAgentScope(agentCtx)
        },
      })
    }
    this.agent = this.handle.agent
    this.installGlobalListeners()
  }

  /**
   * agent 作用域内的接缝装配：审批回答器 + 提问回答器。
   *
   * 两者都是 **waterfall**：返回结果就"认领"这次请求，调用 `next()` 则交给下一个
   * 回答器。终端是最后一道，所以这里直接返回结果。
   */
  private composeAgentScope(agentCtx: Context): void {
    // 审批：把请求翻成终端里的 y/n。
    agentCtx.on('approval/request', async (request: { toolName: string; reason?: string }): Promise<ApprovalOutcome> => {
      line()
      line(style.yellow(`⚠ 需要确认：${request.toolName}`))
      if (request.reason !== undefined) line(style.dim(`  ${request.reason}`))
      const allowed = await this.prompter.confirm('  允许这次调用？')
      return allowed ? 'allowed-once' : 'rejected'
    })

    // 提问：把结构化选择题翻成终端菜单，支持自由回答。
    agentCtx.on('user-questions/request', async (request: AskUserQuestionRequestEvent) => {
      const answers: { id: string; selected: string[]; custom?: string }[] = []
      line()
      for (const question of request.questions) {
        if (question.header !== undefined) line(style.bold(`▸ ${question.header}`))
        if (question.detail !== undefined) line(style.dim(question.detail))
        const labels = question.options?.map((option: { label: string }) => option.label) ?? []
        if (labels.length > 0) {
          const index = await this.prompter.choose(`  ${question.question}`, labels)
          if (index === undefined) {
            const custom = await this.prompter.read('  自填答案: ')
            answers.push({ id: question.id, selected: [], custom: custom ?? '' })
          } else {
            answers.push({ id: question.id, selected: [labels[index]!] })
          }
        } else {
          const answer = await this.prompter.read(`  ${question.question}: `)
          answers.push({ id: question.id, selected: [], custom: answer ?? '' })
        }
      }
      return { answers }
    })
  }

  /** 进程级监听：流式帧、工具调用结果、turn 边界、错误。 */
  private installGlobalListeners(): void {
    const ctx = this.ctx
    const agent = this.agent!

    // 流式渲染：文本增量/推理增量/工具调用增量分别着色。
    const onStream = ctx.on('agent/assistant-stream', ((payload: { agent: Agent; frame: any }) => {
      if (payload.agent !== agent) return
      const frame = payload.frame
      if (frame.type === 'start') {
        this.streaming = new StreamRenderer()
        this.reasoning = false
        this.inToolCall = false
        return
      }
      if (frame.type !== 'chunk' || this.streaming === undefined) return
      this.renderChunk(frame.chunk)
    }) as never)
    this.disposers.push(onStream as () => void)

    // turn 结束：收尾当前流，打印用量。
    //
    // 注意签名：`'session/event'(session, event)` 是**两个位置参数**，不像
    // `agent/*` 那样收一个 payload 对象。早期版本按 payload 解构，于是这两个
    // 监听永远拿不到事件——工具行和 turn 收尾行从来没打印过，而且不报错。
    const onTurnEnd = ctx.on('session/event', ((session: { id: string }, event: any) => {
      if (String(session.id) !== String(agent.id)) return
      if (event.type === 'turn/end') {
        if (this.streaming !== undefined) {
          const text = this.streaming.end()
          if (text.length > 0) line()
          this.streaming = undefined
        }
        // 负载在 event.data 里；reason 是结构化对象，直接插值会印出 [object Object]。
        line(style.dim(`— turn ${String(event.data?.turn ?? '?')} ${reasonText(event.data?.reason)}`))
      }
    }) as never)
    this.disposers.push(onTurnEnd as () => void)

    // 工具调用与结果：一行摘要，便于看清 agent 在做什么。
    const onTool = ctx.on('session/event', ((session: { id: string }, event: any) => {
      if (String(session.id) !== String(agent.id)) return
      const data = event.data ?? {}
      if (event.type === 'tool/call') {
        const args = typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {})
        line(`${tag('tool')} ${style.bold(String(data.name))} ${style.dim(shorten(args, 100))}`)
      } else if (event.type === 'tool/result') {
        // tool/result 的消息体在 data.message 里（不是摊在 data 上）。
        const message = data.message ?? {}
        const failed = message.isError === true
        const marker = failed ? style.red('✗') : style.green('✓')
        line(`       ${marker} ${style.dim(shorten(renderResultPreview(message), width() - 12))}`)
      }
    }) as never)
    this.disposers.push(onTool as () => void)

    // 运行期错误（provider 空响应、工具抛错等）必须可见。
    const onError = ctx.on('agent/error', ((payload: { agent: Agent; error: unknown }) => {
      if (payload.agent !== agent) return
      const message = payload.error instanceof Error ? payload.error.message : String(payload.error)
      line(style.red(`✗ ${message}`))
    }) as never)
    this.disposers.push(onError as () => void)

    // 状态变化：running 时把光标提示换掉（只在 TTY 下）。
    ctx.on('agent/status', ((payload: { agent: Agent; status: string }) => {
      if (payload.agent !== agent) return
      if (payload.status === 'running') line(style.dim('… thinking'))
    }) as never)
  }

  /** 渲染一个流式 chunk。 */
  private renderChunk(chunk: StreamChunk): void {
    const stream = this.streaming
    if (stream === undefined) return
    switch (chunk.type) {
      case 'block-start':
        if (chunk.blockType === 'reasoning') {
          this.reasoning = true
          line(style.dim('  ┌ thinking'))
        } else if (chunk.blockType === 'tool-call') {
          this.inToolCall = true
        }
        break
      case 'text-delta':
        if (this.reasoning) {
          this.reasoning = false
          line(style.dim('  └'))
        }
        stream.push(chunk.text)
        break
      case 'reasoning-delta':
        // 推理内容只在 TTY 下逐段刷新，避免淹没正文。
        if (process.stdout.isTTY === true) this.prompterPut(chunk.text)
        break
      case 'tool-call-delta':
        break
      case 'block-end':
        if (chunk.block.type === 'text') {
          const text = stream.end()
          if (text.length > 0) line()
        } else if (chunk.block.type === 'tool-call') {
          this.inToolCall = false
        }
        break
      default:
        break
    }
  }

  /** 推理文本的轻量输出（灰字，直接写终端）。 */
  private prompterPut(text: string): void {
    if (!text) return
    process.stdout.write(style.gray(text))
  }

  /** 处理一行输入：斜杠命令走 commands 服务，其余进 agent inbox。 */
  private async handleInput(text: string): Promise<void> {
    const agent = this.agent!
    if (text.startsWith('/')) {
      const parsed = parseCommand(text)
      if (parsed !== undefined && this.isCommand(parsed.name)) {
        const execution = await this.ctx.commands.execute(agent, text, [], new AbortController().signal)
        if (execution !== undefined) {
          const result = execution.result
          if (result.kind === 'error') line(style.red(result.text))
          else if (result.text !== undefined && result.text !== '') line(result.text)
        }
        return
      }
      // 本工程自己的几个命令（不落会话日志，纯本地视图）。
      if (await this.handleLocalCommand(text)) return
      line(style.dim(`未知命令 ${text}；/help 看可用命令`))
      return
    }

    // 普通输入：进 next-turn inbox 并唤醒 driver。
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }

  /** 命令是否由 ctx.commands 注册（官方行注册的那些）。 */
  private isCommand(name: string): boolean {
    const list = this.ctx.commands.list(this.agent!) ?? []
    return list.some((command: { name: string }) => command.name === name)
  }

  /**
   * 本工程私有的本地命令：`/traj` `/sessions` `/help` `/new` `/model`。
   *
   * 它们不进会话日志——因为这些是"看会话"的动作，不是会话内容。
   */
  private async handleLocalCommand(text: string): Promise<boolean> {
    const [name, ...rest] = text.slice(1).split(/\s+/)
    const argument = rest.join(' ').trim()
    switch (name) {
      case 'help': {
        line()
        line(style.bold('会话内命令'))
        line(`  ${style.cyan('/help')}              这张表`)
        line(`  ${style.cyan('/traj')} ${style.dim('[id]')}        查看 trajectory（默认当前会话）`)
        line(`  ${style.cyan('/sessions')}          列出已落盘的会话`)
        line(`  ${style.cyan('/new')}               开新会话`)
        line(`  ${style.cyan('/model')} ${style.dim('[route]')}   查看/切换模型路由`)
        line(`  ${style.cyan('/quit')}              退出`)
        line()
        line(style.bold('官方斜杠命令（落进会话日志）'))
        for (const command of this.ctx.commands.list(this.agent!) ?? []) {
          line(`  ${style.cyan('/' + command.name)}  ${style.dim(command.description)}`)
        }
        line()
        return true
      }
      case 'traj': {
        const id = argument === '' ? String(this.agent!.id) : argument
        await renderTrajectory(this.ctx, id)
        return true
      }
      case 'sessions': {
        const { renderSessionList } = await import('./traj.ts')
        await renderSessionList(this.ctx)
        return true
      }
      case 'new': {
        await this.teardown()
        line(style.dim('(新会话)'))
        await this.startAgent({})
        this.renderBanner({})
        return true
      }
      case 'model': {
        if (argument === '') {
          // 和 banner 保持同一套回退：未显式指定时显示 `(default)`，
          // 而不是把 undefined 直接印给用户。
          const provider = this.agent!.options.provider ?? '(default)'
          const model = this.agent!.options.model ?? '(default)'
          line(style.dim(`当前：${provider} / ${model}`))
          line(style.dim('切换：/model <route> <model>'))
          return true
        }
        const [provider, model] = argument.split(/\s+/)
        await this.teardown()
        await this.startAgent({ provider, model })
        line(style.dim(`已切到 ${provider ?? '(default)'} / ${model ?? '(default)'}`))
        return true
      }
      default:
        return false
    }
  }

  /** 释放 agent 与监听。 */
  private async teardown(): Promise<void> {
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // 已经随 agent 解绑的监听再 dispose 一次是安全的，忽略。
      }
    }
    if (this.handle !== undefined) {
      const handle = this.handle
      this.handle = undefined
      this.agent = undefined
      await handle.dispose()
    }
  }
}

/** 截断长文本，保留尾部（参数与结果通常尾部更有信息）。 */
function shorten(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat
  return '…' + flat.slice(-(limit - 1))
}

/** 从一条 tool 消息里取一段可读预览。 */
function renderResultPreview(message: any): string {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block: any) => (block?.type === 'text' ? block.text : `[${block?.type ?? '?'}]`))
      .join(' ')
  }
  return ''
}

/** `turn/end` 的 reason 是 `{kind:'completed'}` 这样的对象；摊平成短字符串。 */
function reasonText(reason: unknown): string {
  if (typeof reason === 'string') return reason
  if (reason !== null && typeof reason === 'object' && 'kind' in reason) {
    return String((reason as { kind: unknown }).kind)
  }
  return String(reason ?? '')
}
