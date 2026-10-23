/**
 * term.ts —— 终端渲染的最小工具集。
 *
 * 刻意不引第三方 UI 库：本工程要展示的是 DSH 的接缝，不是 TUI 框架。这里只做
 * 四件事：颜色、行编辑（readline）、流式输出（可复位的"正在生成"行）、以及
 * 一个不抢 stdin 的渲染器。
 *
 * @module dsh-lab/cli/term
 */
import { createInterface, type Interface } from 'node:readline'
import { stdin, stdout } from 'node:process'

/** 是否启用 ANSI。管道/重定向时自动关掉，便于把输出写进文件。 */
const useColor = stdout.isTTY === true && process.env.NO_COLOR === undefined

const wrap = (open: number, close: number) => (text: string): string =>
  useColor ? `\x1b[${open}m${text}\x1b[${close}m` : text

export const style = {
  dim: wrap(2, 22),
  bold: wrap(1, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
}

/** 终端宽度（非 TTY 时给一个保守值）。 */
export function width(): number {
  return stdout.columns ?? 100
}

/**
 * 流式渲染器：同一行反复重绘"正在生成"的内容，结束时定格。
 *
 * 只在 TTY 下做重绘；重定向时退化成逐段 append，避免把 `\r` 写进日志。
 */
export class StreamRenderer {
  private buffer = ''
  private readonly rendered: boolean = stdout.isTTY === true

  /** 追加一段文本。 */
  push(text: string): void {
    if (!text) return
    this.buffer += text
    if (this.rendered) this.repaint()
    else stdout.write(text)
  }

  /** 用当前缓冲区重绘（TTY 下折返到行首、清行、写内容）。 */
  private repaint(): void {
    const tail = this.buffer.length > 4000 ? this.buffer.slice(-4000) : this.buffer
    const flat = tail.replace(/\n/g, ' ⏎ ')
    stdout.write(`\r\x1b[2K${flat.slice(-Math.max(20, width() - 2))}`)
  }

  /** 结束一行。 */
  end(): string {
    const text = this.buffer
    if (this.rendered && text) stdout.write('\r\x1b[2K')
    this.buffer = ''
    return text
  }

  /** 当前已累积的文本。 */
  get text(): string {
    return this.buffer
  }
}

/** 输出一行（不带前缀）。 */
export function line(text = ''): void {
  stdout.write(text + '\n')
}

/** 一个面向前缀的输出通道（agent / tool / system ...）。 */
export function tag(name: string, color: (text: string) => string = style.gray): string {
  return color(`[${name}]`)
}

/**
 * readline 封装：一行一个 Promise，天然支持 Ctrl-C / Ctrl-D。
 *
 * 注意这里**不是**直接用 `rl.question()`。管道输入（`printf '/help\n/quit' | dsh-lab chat`）
 * 时，readline 会在构造后立刻把已缓冲的行全部读完并触发 `close`；如果我们等到
 * 调 `question()` 时才去接，那些行早就丢了，于是脚本化运行只会看到一次 EOF。
 *
 * 所以构造时就把 `line`/`close` 接进队列：谁来读就取一条，没人读就先存着。
 * 这样 TTY 交互和管道脚本走的是同一条代码路径。
 */
export class Prompter {
  private readonly rl: Interface
  private readonly queue: string[] = []
  private readonly waiters: ((value: string | undefined) => void)[] = []
  private closed = false

  constructor() {
    this.rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY === true })
    this.rl.on('line', (input: string) => {
      const waiter = this.waiters.shift()
      if (waiter !== undefined) waiter(input)
      else this.queue.push(input)
    })
    this.rl.on('close', () => {
      this.closed = true
      // 唤醒所有等待者：队列里剩下的还能被取走，之后就是真正的 EOF。
      while (this.waiters.length > 0) this.waiters.shift()!(undefined)
    })
  }

  /** 读一行；EOF 返回 undefined。 */
  async read(prompt: string): Promise<string | undefined> {
    if (stdin.isTTY === true) this.rl.setPrompt(prompt)
    if (stdin.isTTY === true) this.rl.prompt()
    if (this.queue.length > 0) return this.queue.shift()
    if (this.closed) return undefined
    return new Promise<string | undefined>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  /**
   * 一次是/否确认。空输入取默认值。
   *
   * 管道输入也照常读：脚本化测试需要能回答审批，否则"审批在终端里能用"
   * 这条路径就没法自动验证。只有真正读到 EOF 才退回默认值。
   */
  async confirm(question: string, options: { default?: boolean } = {}): Promise<boolean> {
    const suffix = options.default === true ? ' [Y/n] ' : options.default === false ? ' [y/N] ' : ' [y/n] '
    for (;;) {
      const answer = (await this.read(question + suffix))?.trim().toLowerCase()
      if (answer === undefined) return options.default ?? false
      if (answer === '') {
        if (options.default !== undefined) return options.default
        continue
      }
      if (answer === 'y' || answer === 'yes') return true
      if (answer === 'n' || answer === 'no') return false
      line(style.dim('  请输入 y 或 n'))
    }
  }

  /** 从编号菜单里选一项；返回选项下标，取消时返回 undefined。 */
  async choose(question: string, items: readonly string[]): Promise<number | undefined> {
    line(question)
    items.forEach((item, index) => line(`  ${index + 1}) ${item}`))
    for (;;) {
      const answer = (await this.read(`选择 1-${items.length}（回车取消）: `))?.trim()
      if (answer === undefined || answer === '') return undefined
      const index = Number.parseInt(answer, 10) - 1
      if (Number.isInteger(index) && index >= 0 && index < items.length) return index
      line(style.dim(`  请输入 1-${items.length} 之间的数字`))
    }
  }

  close(): void {
    if (!this.closed) this.rl.close()
  }
}
