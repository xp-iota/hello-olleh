/**
 * 24 · shell seam（ctx.shell）：resolve → run / start。
 *
 * 对照真实 `@deepseek-ai/dsh-shell`（抽象 `ShellExecutor`，本地后端是
 * `@deepseek-ai/dsh-bash-local` 的 `LocalBashExecutor`，它建在 `ctx.subprocess` seam 之上）：
 *   - resolve(request) 把实现自有的默认值/上限落成完整 spec（run/start 只收 resolved spec）；
 *   - run(spec) 前台：非零退出、超时、取消都 **resolve** 出 ShellRunResult
 *     （{ exitCode, signal, timedOut, aborted, timeoutMs, stdout, stderr }，timedOut/aborted 互斥）
 *     ——只有基础设施失败才 reject；`stdout`/`stderr` 是 `CollectedOutput`（`{ text, truncated }`），
 *     不是裸字符串，因为输出可能被上限截断/溢写；
 *   - start(spec) 后台：立即返回 ShellProcess（无超时）：status 三态、done 是 Promise<void>
 *     且**永不 reject**、readOutput() → { delta, lossy } 增量读、kill() 幂等。
 *
 * 本插件没有注册行为——shell 的本地实现由 harness 默认装配；这个 index.ts 只作为占位插件，
 * 展示"seam 也可以不挂监听器、只消费服务"的形状。
 */
import type { Context } from '@deepseek-ai/cordis'

// 插件名用于诊断；shell 是 harness 装配的 seam 服务，不是一个 shell 命令。
// 声明依赖后，apply 执行时 ctx.shell 一定已经指向具体后端。
export const name = 'shell-service'
export const inject = ['shell']

export function apply(ctx: Context) {
  console.log('[shell-service] shell seam 可用:', ctx.shell.constructor.name, '| sandboxMode =', ctx.shell.sandboxMode ?? '(未装沙箱)')
}
