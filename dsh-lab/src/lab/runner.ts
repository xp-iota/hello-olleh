/**
 * runner.ts —— 12 个能力模块的阶段驱动器。
 *
 * 旧工程的 `runtime/harness.ts` 里既有"装配服务"也有"驱动阶段"；装配已经交给
 * 官方 `boot()`，这里只剩驱动这一半，而且刻意做得很薄：
 *
 *   * 每个阶段是一个 `(lab: StageContext) => Promise<void>`；
 *   * 阶段通过 `ctx` 拿真实服务，自己决定演示什么；
 *   * 阶段抛错 = 该阶段失败；模块汇总后以非零码退出（fail loud）；
 *   * `REAL_STAGE_OK` / `REAL_MODULE_OK` 仍然打印，作为脚本化的证据行。
 *
 * 与旧驱动的差别：不再有"证据账本"和"必须发生过真实推理调用"的硬校验——那套
 * 机制在旧工程里是为了防止"看起来跑通其实是假数据"，现在每个阶段自己断言自己
 * 的关键事实（并且 `model` 类阶段缺 key 时会明显失败）。
 *
 * @module dsh-lab/lab/runner
 */
import './services.ts'
import type { Context } from '@deepseek-ai/cordis'
import { line, style } from '../cli/term.ts'

/** 阶段收到的上下文。 */
export interface StageContext {
  /** 已启动的服务树。 */
  readonly ctx: Context
  /** 本阶段专用的会话 id（每个阶段一条可查的 trajectory）。 */
  readonly sessionId: string
  /** 打印一行普通输出。 */
  readonly log: (message: string) => void
  /** 打印一行缩进细节。 */
  readonly detail: (message: string) => void
  /** 断言：失败即抛错并终止本阶段。 */
  readonly assert: (condition: unknown, message: string) => asserts condition
}

/** 一个阶段。 */
export interface StageSpec {
  /** 稳定 id，如 `M01.1`。 */
  readonly id: string
  /** 一句话标题。 */
  readonly title: string
  /** `mechanism` 不需要模型；`model` 会真的请求 provider。 */
  readonly kind: 'mechanism' | 'model'
  /** 阶段实现。 */
  run: (stage: StageContext) => Promise<void>
}

/** 一个模块。 */
export interface ModuleSpec {
  /** `M01` … `M12`。 */
  readonly id: string
  /** 模块标题（与目录名一致）。 */
  readonly title: string
  /** 阶段列表。 */
  readonly stages: readonly StageSpec[]
}

/** 已注册的模块（由各模块的 index.ts 注册进来）。 */
const registry = new Map<string, ModuleSpec>()

/** 注册一个模块。 */
export function defineModule(module: ModuleSpec): ModuleSpec {
  registry.set(module.id, module)
  return module
}

/** 取一个模块。 */
export function getModule(id: string): ModuleSpec | undefined {
  return registry.get(id)
}

/** 全部模块 id（排序后）。 */
export function moduleIds(): string[] {
  return [...registry.keys()].sort()
}

/**
 * 跑一个模块（或 `all`）。
 *
 * @param ctx - 已启动的服务树。
 * @param module - 模块 id，或 `all`。
 * @param options.stage - 只跑指定阶段（id 或序号）。
 * @returns 进程退出码：全部通过为 0。
 */
export async function runModule(
  ctx: Context,
  module: string,
  options: { stage?: string } = {},
): Promise<number> {
  await loadAllModules()
  const targets =
    module === 'all'
      ? moduleIds().map((id) => registry.get(id)!)
      : (() => {
          const found = registry.get(module)
          return found === undefined ? [] : [found]
        })()

  if (targets.length === 0) {
    line(style.red(`✗ 未知模块 ${module}；可用：${moduleIds().join(', ')} 或 all`))
    return 2
  }

  let failures = 0
  let total = 0
  for (const target of targets) {
    // 每个模块单独计数：`REAL_MODULE_OK` 报告的是这一个模块是否全绿。
    // 用全局 failures 会让"M03 有一阶段失败"把后面 9 个模块的证据行也一起吞掉。
    let moduleFailures = 0
    const stages =
      options.stage === undefined
        ? target.stages
        : target.stages.filter(
            (stage, index) => stage.id === options.stage || String(index + 1) === options.stage,
          )
    if (stages.length === 0) {
      line(style.red(`✗ ${target.id} 没有阶段 ${options.stage}`))
      failures += 1
      continue
    }

    line()
    line(style.bold(`${target.id} ${target.title}`))
    for (const stage of stages) {
      total += 1
      const sessionId = `${target.id}.${stage.id.split('.').pop()}-${Date.now().toString(36)}`
      const started = Date.now()
      // 每个阶段跑在自己的插件 fiber 里，阶段结束即整棵子树回收。
      //
      // 这一条是必需的，不是风格问题：`ctx.on(...)` 注册的监听挂在该上下文的 fiber
      // 上。如果直接在根 ctx 上注册，一个阶段的 pre-execute 监听会活到下一个阶段，
      // 于是 M01.5 会被 M01.2 的"一律拒绝"污染。把阶段包进一个可释放的 fiber，
      // 就把"阶段隔离"变成运行时保证，而不是靠作者记得手动 off()。
      let stageError: unknown
      const stageContext: StageContext = {
        ctx,
        sessionId,
        log: (message) => line(`  ${message}`),
        detail: (message) => line(style.dim(`    ${message}`)),
        assert: (condition, message) => {
          if (!condition) throw new Error(message)
        },
      }
      const fiber = await ctx.plugin({
        name: `stage:${stage.id}`,
        // cordis 强制访问控制：不写在这里的服务，插件里读 `ctx.xxx` 会抛
        // "cannot get property without inject"。阶段脚本要摸整棵树，所以全量声明。
        // 真正可选的服务（如 schedule）用 `ctx.get(name)` 读，不进 inject。
        inject: [
          'llm',
          'sessions',
          'sessionQuery',
          'sessionProjections',
          'tools',
          'agents',
          'agentLoop',
          'systemPrompt',
          'tokenMeter',
          'approval',
          'userQuestions',
          'commands',
          'storage',
          'storageDomain',
          'loader',
          'credentials',
          'skills',
          'subagents',
          'jobs',
          'goals',
          'workflowEngine',
          'sandbox',
          'invariants',
        ] as never,
        apply: async (inner: Context) => {
          // 把阶段换成 scope 内的上下文：它的 on()/段注册都随 fiber 一起回收。
          ;(stageContext as { ctx: Context }).ctx = inner
          try {
            await stage.run(stageContext)
          } catch (error) {
            stageError = error
          }
        },
      })
      try {
        if (stageError !== undefined) throw stageError
        const used = Date.now() - started
        line(`  ${style.green('✓')} ${stage.id} ${stage.title} ${style.dim(`(${used}ms)`)}`)
        line(style.dim(`REAL_STAGE_OK ${stage.id}`))
      } catch (error) {
        moduleFailures += 1
        failures += 1
        const message = error instanceof Error ? error.message : String(error)
        line(`  ${style.red('✗')} ${stage.id} ${stage.title}`)
        line(style.red(`    ${message}`))
      } finally {
        // 阶段 fiber 回收：这一步才让"上一阶段的监听不影响下一阶段"成立。
        await fiber.dispose()
      }
    }
    if (moduleFailures === 0) line(style.dim(`REAL_MODULE_OK ${target.id}`))
  }

  line()
  if (failures === 0) {
    line(style.green(`全部通过：${total} 个阶段`))
    return 0
  }
  line(style.red(`失败 ${failures} 个 / 共 ${total} 个阶段`))
  return 1
}

/**
 * 载入全部模块定义。
 *
 * 用动态 import 而不是静态表：某个模块的依赖问题不应该让 `dsh-lab chat` 一起挂掉。
 */
let loaded: Promise<void> | undefined
async function loadAllModules(): Promise<void> {
  loaded ??= (async () => {
    await Promise.all([
      import('../../M01-tool-pipeline/index.ts'),
      import('../../M02-context-assembly-economics/index.ts'),
      import('../../M03-inference-service-access/index.ts'),
      import('../../M04-agent-loop-intervention/index.ts'),
      import('../../M05-session-surface/index.ts'),
      import('../../M06-human-in-the-loop/index.ts'),
      import('../../M07-execution-backends/index.ts'),
      import('../../M08-delegation-presets/index.ts'),
      import('../../M09-long-running-work/index.ts'),
      import('../../M10-external-capabilities/index.ts'),
      import('../../M11-config-data-durability/index.ts'),
      import('../../M12-cordis-runtime/index.ts'),
    ])
  })()
  await loaded
}
