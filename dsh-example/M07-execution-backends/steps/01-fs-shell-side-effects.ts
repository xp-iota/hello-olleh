/**
 * M07.1 · 真实副作用工具：写文件（ctx.fs）+ 跑子进程（ctx.subprocess），尊重 exec.signal 取消。
 *
 * 01 的 word_count 是纯计算工具；本例演示"会改外部世界"的工具——它们不自己碰 node:fs /
 * node:child_process，而是**消费 seam**：`ctx.fs`（`FileSystem`）、`ctx.subprocess`
 * （`SubprocessRuntime`）。这样同一份工具代码，换个后端就自动落进沙箱 / 远程执行世界，
 * 且天然获得取消、审计。
 *
 * 关键点：
 *   - 一切 I/O 都把 `exec.signal` 透传下去；开工前先看一眼 `exec.signal.aborted` 尽早退出。
 *     注意这只是**兜底**：signal 若在派发前就已 abort，工具注册表会直接短路，
 *     `execute` 根本不会被调用（产出 code `ABORTED_BEFORE_DISPATCH`）。这句守卫真正
 *     兜住的是派发之后、I/O 开始之前那一小段窗口。
 *   - I/O 失败 / 抛异常 = isError（会被工具管线归一为错误结果，喂回模型）。
 *     取消也是 isError（code `ABORTED`），别把两者混为一谈。
 *   - seam 的"实现"从哪来？由别的插件提供 —— 一个继承对应抽象服务（`FileSystem` /
 *     `SubprocessRuntime`）的类，构造里 `super(ctx)` 就把自己挂上了 ctx（形状见 M02 / M07）。
 *     官方后端是 `@deepseek-ai/dsh-fs-local` 与 `@deepseek-ai/dsh-subprocess-local`，
 *     本示例工程的 harness 默认装的就是这两个真实包（见 runtime/harness.ts）。
 *   - `ctx.subprocess.spawn` 的 spec 是**完整**的（argv / cwd / stdio / graceMs）：
 *     seam 不替调用方猜默认值，输出收集策略也要显式写（这里用 collect + maxBytes）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

// `name` 是插件/Fiber 名称；它和下方注册的工具名没有关系。
// apply 同时消费工具注册表、文件系统和子进程 seam，因此三项都必须先注入。
export const name = 'fs-shell-side-effects'
export const inject = ['tools', 'fs', 'subprocess']

/** 工具没有自己的 cwd 概念：取发起 agent 的会话 cwd，退化到进程 cwd。 */
function cwdOf(exec: { agent?: { session: { header: { cwd?: string } } } | undefined }): string {
  return exec.agent?.session.header.cwd ?? process.cwd()
}

export function apply(ctx: Context) {
  // 工具一：经 ctx.fs seam 原子写文本。
  ctx.tools.register(defineTool({
    name: 'write_note',
    description: '把一段文本写入指定路径的文件（经文件系统 seam）。',
    parameters: {
      path: { type: 'string', required: true, description: '目标文件路径（相对路径按 cwd 解析）' },
      content: { type: 'string', required: true, description: '要写入的完整文本' },
    },
    output: {
      // output.schema 必填：它是工具的规范返回值形状。
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', required: true },
          bytes: { type: 'number', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: `已写入 ${value.path}（${value.bytes} 字节）` }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('aborted before dispatch')
      const target = await ctx.fs.resolve(args.path, { cwd: cwdOf(exec), signal: exec.signal })
      await ctx.fs.writeText(target, args.content, undefined, exec.signal)
      const bytes = new TextEncoder().encode(args.content).length
      return { path: ctx.fs.processPath(target), bytes }
    },
  }))

  // 工具二：经 ctx.subprocess seam 跑一条命令并捕获 stdout。
  ctx.tools.register(defineTool({
    name: 'run_cmd',
    description: '运行一条命令并返回 stdout（经子进程 seam，尊重取消）。',
    parameters: {
      argv: { type: 'array', items: { type: 'string' }, required: true, description: '可执行文件 + 参数数组，如 ["node","-e","..."]' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          exitCode: { type: 'number', required: true },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.stdout.trim() || `(exit ${value.exitCode})` }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('aborted before dispatch')
      const handle = ctx.subprocess.spawn({
        argv: args.argv,
        cwd: cwdOf(exec),
        // 显式的输出收集策略：seam 不替调用方猜上限。
        stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
        graceMs: 2000,
        signal: exec.signal,
      })
      const outcome = await handle.done
      return {
        exitCode: outcome.exitCode ?? -1,
        stdout: handle.collected.stdout?.readFrom(0).text ?? '',
        stderr: handle.collected.stderr?.readFrom(0).text ?? '',
      }
    },
  }))
}
