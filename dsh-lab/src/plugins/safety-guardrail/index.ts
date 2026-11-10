/**
 * safety-guardrail —— dsh-lab 自己的「安全护栏」插件。
 *
 * 它挂在 **工具管线的 pre-execute** 接缝上：模型在一步里发出 tool-call 之后、
 * 工具真正执行之前，cordis 会先走一遍 `tools/pre-execute` waterfall。这个插件就是
 * 那条 waterfall 上的一个监听：
 *
 *   模型输出 tool-call
 *     → agent-loop 组装 ToolBatchInput
 *     → dsh-tools 管线
 *     → tools/pre-execute   ← 本插件在这里观察（当前实现：只打印，不拦截）
 *     → tools/execute       （真正的工具实现）
 *     → tools/post-execute
 *     → tools/result
 *
 * 为什么当前只打印：护栏的第一阶段是「可观测」——先把每次将要发生的调用记录下来，
 * 等日志证明它稳定命中之后再接策略（拒绝 / 审批 / 参数改写）。这个文件把扩展点
 * 留在 `decide()` 里：以后返回 `{ kind: 'deny', reason }` 即可从"观察"升级为"拦截"，
 * 不需要改装配清单。
 *
 * 与官方 `ctx.tools.guard()` 的区别：guard 是**单调拒绝**，只能返回拒绝理由；
 * pre-execute 是 waterfall，可 allow / deny / ask / cancel，是更完整的策略面。
 * 本插件选 pre-execute，就是为了给后续策略留出全部四种决定。
 *
 * @module dsh-lab/plugins/safety-guardrail
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'safety-guardrail'

/** 依赖 `tools`：没有工具注册表就没有 pre-execute 事件可听。 */
export const inject = ['tools']

/** 插件配置。 */
export interface Config {
  /** 参数预览的最大字符数；超出截断并加省略号。 */
  previewChars: number
  /** 需要脱敏的键名（规范化后精确/后缀匹配）。 */
  redactKeys: string[]
  /** 日志写到哪个流：stderr 不打断 REPL 的 stdout 流式渲染。 */
  sink: 'stderr' | 'stdout'
  /** 日志行前缀。 */
  prefix: string
}

export const Config: z<Config> = z.object({
  previewChars: z.natural().default(240),
  redactKeys: z
    .array(z.string())
    .default(['apiKey', 'api_key', 'authorization', 'cookie', 'credential', 'password', 'secret', 'token']),
  sink: z.union(['stderr', 'stdout'] as const).default('stderr'),
  prefix: z.string().default('[safety-guardrail]'),
})

/** 递归脱敏：只替换匹配键的**值**，键名本身保留，便于看出"这里本来有密钥"。 */
export function redactValue(value: unknown, keys: readonly string[], depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redactValue(item, keys, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const sensitive = keys.some((needle) => isSensitiveKey(key, needle))
    out[key] = sensitive ? '[REDACTED]' : redactValue(item, keys, depth + 1)
  }
  return out
}

/**
 * 判断一个键是否命中脱敏规则。
 *
 * 先去掉 `_` / `-` 并转小写，再做**精确匹配或后缀匹配**：
 * `apiKey` / `api_key` / `access_token` / `clientSecret` 会命中，而
 * `maxTokens` 不会被 `token` 误伤——否则模型配置里的预算字段也会被涂掉。
 */
function isSensitiveKey(key: string, needle: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const normalizedKey = normalize(key)
  const normalizedNeedle = normalize(needle)
  if (normalizedNeedle.length === 0) return false
  return normalizedKey === normalizedNeedle || normalizedKey.endsWith(normalizedNeedle)
}

/** 把工具参数压成一行可读预览；脱敏、截断、绝不因循环引用抛错。 */
export function previewArguments(args: unknown, maxChars: number, keys: readonly string[]): string {
  let text: string
  try {
    text = JSON.stringify(redactValue(args, keys)) ?? '{}'
  } catch {
    text = '[unserializable]'
  }
  if (maxChars <= 0 || text.length <= maxChars) return text
  return text.slice(0, Math.max(0, maxChars - 1)) + '…'
}

/**
 * 决定这次调用怎么处理。
 *
 * 当前实现永远放行——护栏只负责"看见"。升级为拦截时，在这里返回
 * `{ kind: 'deny', reason: '...' }` 即可；调用 `next()` 则表示交给下一个监听。
 */
function decide(_exec: Readonly<ToolExecution>): PreToolDecision {
  return { kind: 'allow' }
}

/** 挂载护栏：注册一个 pre-execute 监听，fiber 销毁时自动摘除。 */
export function apply(ctx: Context, config: Config): void {
  const emit = config.sink === 'stdout' ? process.stdout : process.stderr

  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = decide(exec)
    if (decision.kind !== 'allow') {
      // 任何非 allow 的决定都留痕：这是"谁在什么时候被哪条规则拦下"的唯一证据。
      const reason = decision.kind === 'deny' ? ` reason=${decision.reason}` : ''
      emit.write(
        `${config.prefix} ${decision.kind} tool=${exec.name} agent=${exec.agent === undefined ? '(standalone)' : String(exec.agent.id)}${reason}\n`,
      )
      return decision
    }

    const args = previewArguments(exec.arguments, config.previewChars, config.redactKeys)
    emit.write(
      `${config.prefix} pre-execute tool=${exec.name} agent=${exec.agent === undefined ? '(standalone)' : String(exec.agent.id)} args=${args}\n`,
    )
    return next()
  })
}
