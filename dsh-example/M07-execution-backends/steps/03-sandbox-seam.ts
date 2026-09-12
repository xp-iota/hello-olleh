/**
 * 25 · 进程沙箱 seam（ctx.sandbox）。
 *
 * 对照真实 `@deepseek-ai/dsh-sandbox`（官方后端是 `@deepseek-ai/dsh-sandbox-local`）：
 *   - `SandboxProvider` 是**抽象 cordis Service**（构造里 `super(ctx)` 把服务名钉成 `sandbox`）。
 *     所以"提供一个沙箱后端"的形状与 14 的 compaction 完全同型：继承它、`static inject`/
 *     `static Config`、`constructor(ctx, config)` 里先 `super(ctx)`、最后 `export default`。
 *     构造即挂到 `ctx.sandbox`（effect-based），**没有** `ctx.provide('sandbox', impl)` 这种写法。
 *   - 唯一方法 `confine(argv, policy)`：把即将 spawn 的 argv 包装成"在 policy 约束下执行"的
 *     argv，连同强制力级别返回。注意 argv 是**程序 + 参数数组**，不是 shell 字符串；
 *     shell 形态的调用方自己传 `['bash','-c',command]`。
 *   - **策略由调用方给**，没有 `ctx.sandboxPolicy` 这样的服务：
 *     `SandboxExecutionPolicy = { mode, workspaceRoot, sessionId? }`，
 *     其中 `SandboxPolicy` 把 mode 收窄成"可约束的两档"（`read-only` / `workspace-write`）
 *     —— `danger-full-access` 在类型层面就进不了 confine()，因为那根本不需要沙箱。
 *   - 返回的 `ConfinedArgv` 除了 argv/enforcement，还要带 `denialSignatures`（怎么识别
 *     "是沙箱拒的"）与 `runnerFailureRules`（怎么区分 runner 自身失败 vs 被约束程序失败）。
 *   - 铁律：**要么返回可强制执行的 argv，要么 fail-closed 抛 `SandboxUnavailableError`**
 *     —— 禁止静默放行未加约束的命令。
 *
 * 本插件提供两个后端演示两端：
 *   - WrapSandbox：在 argv 前套一层 runner（"可强制执行的包装"）；
 *   - RefuseSandbox：对 read-only 之外的模式 fail-closed 抛错（"不静默放行"）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { SandboxProvider, SandboxUnavailableError, sandboxDenialMarker, writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/** 能真正强制执行的后端：把调用者 argv 包进一个受约束的 runner。 */
export class WrapSandbox extends SandboxProvider {
  constructor(ctx: Context) {
    // super(ctx) → SandboxProvider 内部把服务名钉成 'sandbox'：本实例即刻成为 ctx.sandbox。
    super(ctx)
    console.log('[sandbox] 已装载 WrapSandbox（enforcement=full）')
  }

  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    // writableRoots 是真实包导出的策略助手：把 policy 展开成允许写入的规范化根列表。
    const roots = writableRoots(policy)
    return {
      argv: ['demo-sandbox-exec', `--mode=${policy.mode}`, ...roots.map((root) => `--allow-write=${root}`), '--', ...argv],
      enforcement: 'full',
      // 调用方靠这些签名把"沙箱拒绝"和"程序自己失败"分开。
      denialSignatures: [sandboxDenialMarker(policy.mode)],
      runnerFailureRules: [{ fatalSignatures: ['demo-sandbox-exec: cannot start'] }],
    }
  }
}

/** 只能强制 read-only 的后端：其余模式抛错，绝不静默放行。 */
export class RefuseSandbox extends SandboxProvider {
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    if (policy.mode === 'read-only') {
      return {
        argv: ['demo-sandbox-exec', '--mode=read-only', '--', ...argv],
        enforcement: 'full',
        denialSignatures: [sandboxDenialMarker('read-only')],
        runnerFailureRules: [],
      }
    }
    // fail-closed：强制不了就抛 SandboxUnavailableError。返回未加约束的 argv 才是真正危险的选项。
    throw new SandboxUnavailableError(policy.mode, '本后端只会 read-only')
  }
}

// 这是插件/Fiber 的诊断名称；SandboxProvider 在 super(ctx) 中把服务名固定为 sandbox。
export const name = 'sandbox-seam'

// 导出类让 Cordis 负责实例化、依赖注入和卸载时恢复上一个 sandbox 实现。
export default WrapSandbox
