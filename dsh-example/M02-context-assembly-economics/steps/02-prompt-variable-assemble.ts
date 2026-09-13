/**
 * M02.2 · 提示变量与整体装配（systemPrompt.variable + system-prompt/assemble）。
 *
 * 02 演示"加一段 section"；本例演示另外两个轴：
 *   - `ctx.systemPrompt.variable(name, provider)`：注册一个提示变量，渲染时把正文里的
 *     `{{name}}` 插值成 provider 的求值结果（provider 可随 AssembleContext 变化）。
 *   - `system-prompt/assemble`：**整体装配 waterfall**。监听者拿到的是结构化的
 *     `PromptAssembly`（`{ sections, contexts, tools, variables }`），改写后返回，
 *     其结果具有权威性。适合"统一加前后缀、脱敏、注入运行时信息"。
 *
 * 关键点：
 *   - 插值发生在 `renderPrompt(assembly)` 这一步，而不是 `assemble()`：装配体里 `variables`
 *     是一张"名字 → 值"的表，正文仍带着 `{{name}}` 占位。
 *   - 变量名必须形如 `[a-z][a-z0-9_]*`。**缺值 fail loud**：正文引用未注册的变量，
 *     或 provider 对本次装配返回 `undefined`，`renderPrompt` 都直接抛错 ——
 *     不静默清空、也不原样保留（见 run.ts ③④）。
 *   - 运行时自带若干内建变量（如 `{{provider}}` / `{{model}}`），别和它们重名。
 *   - section 与 variable 都是 effect-based：插件 fiber 销毁即自动回收。
 *   - **返回值必须仍是一个 PromptAssembly**。把它换成 `{ text: ... }` 会把 tools /
 *     contexts / variables 上别人的既有贡献（Code Mode、结构化输出…）整段丢掉 ——
 *     要加前言就往 `sections` 里插一段，而不是把装配体拍平成字符串。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

// `name` 供 Cordis 诊断使用；它不会自动生成一个 prompt section。
// `inject` 声明 apply 要使用的系统提示服务，服务就绪后才会注册变量和 waterfall。
export const name = 'prompt-variable-assemble'
export const inject = ['systemPrompt']

export function apply(ctx: Context) {
  // 1) 一个动态变量：每次装配都重新求值当天日期。
  ctx.systemPrompt.variable('today', () => new Date().toISOString().slice(0, 10))

  // 2) 一段引用该变量的正文（注意 {{today}} 占位，插值发生在 renderPrompt 阶段）。
  ctx.systemPrompt.section({
    name: 'date-aware',
    order: 100,
    text: '当前日期是 {{today}}。请在涉及"今天/昨天"的回答里以该日期为准。',
  })

  // 3) 整体装配 waterfall：拿到装配体，往 sections 最前面插一段权威前言。
  //    保留 assembly 的其余字段（contexts / tools / variables）—— 那是别人的贡献。
  //    注意 assembly.sections 里装的是**已排序的** AssembledSection（只有 name/text），
  //    order 在注册侧才有意义；想插到最前面就直接 unshift。
  ctx.on('system-prompt/assemble', async (assembly: PromptAssembly, _context, next) => {
    // 先让下游把它们的改写做完，再在最终结果上加前言（外层包装的典型写法）。
    const downstream = await next()
    return {
      ...downstream,
      sections: [
        { name: 'runtime-preamble', text: '# 运行时前言（由 assemble 钩子注入）' },
        ...downstream.sections,
      ],
    }
  })
}
