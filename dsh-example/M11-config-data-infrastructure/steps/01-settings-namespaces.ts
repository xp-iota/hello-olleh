/**
 * M11.1 · 设置命名空间（ctx.settings）：schema 注册 + 分层解析 + 乐观并发。
 *
 * 对照真实 `@deepseek-ai/dsh-settings`（`SettingsProvider` / `SettingsScope`）：
 *   - provider 负责原始文档存取（本示例用 runtime/harness.ts 的内存子类），
 *     基座负责命名空间注册、分层解析、修订号、变化检测与提交事件；
 *   - 命名空间不是自由字符串：要用 `settingsNamespace('demo')` 铸一个 branded 值；
 *   - register(ns, schema) 返回属主 scope：get() / watch((next, prev)) / update(patch) /
 *     replace(section) —— scope 级**不带**乐观并发；重复注册抛错；
 *   - 值 = schema 默认值 + 组合 base 层 + user 层覆盖；
 *   - provider 级写路径带 CAS：update / replace / mutate(ns, ops, expectedRevision)
 *     —— 修订号不匹配抛 SettingsConflictError；mutate 的 op 是 set / unset。
 *
 * 本插件注册一个 `demo` 命名空间并订阅它的提交。
 */
import type { Context } from '@deepseek-ai/cordis'
// 0.1.5 起没有 settingsNamespace() 工厂：命名空间就是字符串字面量，
// 由 register() 的 SettingsNamespaceInput 在类型层校验（必须小写字母开头）。
import z from '@deepseek-ai/schemastery'

// 插件名用于 Fiber 诊断；DEMO_NS 是设置命名空间，不是插件名。
// settings 服务准备好后 apply 才能注册命名空间和 watch 回调。
export const name = 'settings-namespaces'
export const inject = ['settings']

/** 命名空间字面量，导出给 run.ts 复用同一个值。 */
export const DEMO_NS = 'demo' as const

export interface DemoSettings {
  theme: string
  fontSize: number
}

export const DemoSchema: z<DemoSettings> = z.object({
  theme: z.string().default('dark'),
  fontSize: z.number().default(14),
})

export function apply(ctx: Context) {
  const scope = ctx.settings.register(DEMO_NS, DemoSchema)

  // scope.watch：只观测本命名空间的提交，拿 (next, prev) 两个解析值；返回注销 disposer。
  ctx.effect(() => scope.watch((next, prev) => {
    console.log('  [watch] demo 提交 →', JSON.stringify(next), `（prev: ${JSON.stringify(prev)}）`)
  }))
}
