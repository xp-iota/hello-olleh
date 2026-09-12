/**
 * 02 · 往 System Prompt 注入一段指令。
 *
 * `ctx.systemPrompt.section(...)` 注册一个"有序片段"。所有片段按 `order` 升序拼接。
 * 约定：-100 = harness 身份，0 = 部署 persona，100~199 = 工具指引。
 * 本例用 300（放在靠后位置），追加一段"回复风格"约束。
 *
 * 关键点：
 *   - `text` 可以是静态字符串，也可以是每次组装时求值的函数（可读 AssembleContext）。
 *   - `Config` 用 schemastery 的 `z` 声明：用户可在 cordis.yml 的 config 里覆盖，
 *     支持环境变量 fallback（cordis 原生），绝不在代码里硬读密钥/配置。
 *   - 同名 section 在"同层"会抛错；scoped（按 agent）注册可遮蔽全局同名段。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export interface Config {
  /** 追加到每次回复末尾的署名句。 */
  signature: string
}

// 插件标识用于 Cordis 的 Fiber 诊断；它不会成为模型看到的 prompt 内容。
// 这里依赖 `systemPrompt` 服务，服务未就绪时插件会保持等待，不会提前执行 apply。
export const name = 'prompt-section'
export const inject = ['systemPrompt']
// Config 是插件配置的运行时 schema；cordis.yml 传入的值会先经过这里的默认值和校验。
export const Config: z<Config> = z.object({
  signature: z.string().default('希望这段回答对你有帮助。'),
})

export function apply(ctx: Context, config: Config) {
  ctx.systemPrompt.section({
    name: 'example-reply-style',
    order: 300,
    // 静态文本即可满足大多数场景；需要动态内容时改成 (context) => string
    text: [
      '# 回复风格',
      '- 保持简洁，先给结论再给理由。',
      '- 涉及代码时给出可运行的最小示例。',
      `- 结尾署名：${config.signature}`,
    ].join('\n'),
  })
  // 返回值是 disposer；这里不接也没关系——插件 fiber 销毁时 effect 会自动回收。
}
