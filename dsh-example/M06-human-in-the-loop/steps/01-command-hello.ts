/**
 * M06.1 · 注册一个人类斜杠命令 /hello。
 *
 * `ctx.commands.register(...)` 加的是"给人用"的命令，走独立派发，**不经过模型 turn**。
 * 适合：状态查询、开关切换、直接驱动 agent 等无需模型推理的动作。
 *
 * 关键点：
 *   - name 小写、不带前导斜杠；用户在 UI 里输入 `/hello`。
 *   - handler 拿到 CommandInvocation（含 rawInput、目标 agent、取消 signal），
 *     返回 CommandResult：{ kind:'success', text? } 或 { kind:'error', text }。
 *   - 想让命令"反过来喂模型"，在 handler 里调用 invocation.agent.followup(...)。
 */
import type { Context } from '@deepseek-ai/cordis'

// 这是插件的诊断名称，不是用户输入的命令名；用户命令名在下方 register 的 name 中。
// 依赖 commands 服务后，Cordis 才会运行 apply 并允许注册 /hello。
export const name = 'command-hello'
export const inject = ['commands']

export function apply(ctx: Context) {
  ctx.commands.register({
    name: 'hello',
    description: '打印一句问候，并把当前会话名回显给你。',
    input: { hint: '[可选: 要问候的名字]' },

    handler: (invocation) => {
      const who = invocation.rawInput.trim() || '朋友'
      // 纯本地动作：直接返回文本，UI 渲染。不产生模型请求。
      return { kind: 'success', text: `你好，${who}！` }
    },
  })
}
