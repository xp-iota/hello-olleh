/**
 * 15 · 子代理委派（ctx.subagents 具名 provider 注册表 + 把委派暴露成模型工具）。
 *
 * 先厘清默认行为：**不写本插件的任何代码，模型与子代理毫无关系** ——
 * `ctx.subagents` 只是一个服务缝（具名 provider 注册表），对模型完全不可见；
 * agent 循环里也不存在"自动派子代理"。模型唯一能发起委派的通路是：
 *
 *   1. 装载 `dsh-subagent` → 注册表存在（harness 已做，模型不可见）
 *   2. registerProvider(...) → 注册表里有一个"怎么跑"（本文件第 1 步，模型不可见）
 *   3. 注册一个**模型可见工具**，execute 里调 ctx.subagents.start(...)
 *      （本文件第 2 步 —— 只有这一步改变模型可见面；是否调用由模型自己决定，
 *       与调用任何普通工具是同一套机制）
 *
 * 真实产品里第 3 步由 `@deepseek-ai/dsh-tool-subagent` 包做：`Config.provider` 指定
 * 委派给谁，它监听 `subagent/provider-added`、在 provider 就绪时注册默认名 `subagent`
 * 的工具，并按 provider 的 `inheritsParentContext` 生成对模型 truthful 的描述
 * （子代理看没看过这段对话，措辞完全不同）。本例把这两件事合在一个插件里手写最小版：
 * 注册一个本地评审 provider + 一个把任务委派给它、把结论作为工具结果返回的模型工具。
 *
 * `SubagentProvider` 是一个 **interface**（不是可继承的运行时基类），官方 provider 一律
 * 用 `implements`：
 *   `{ name, capabilities, inheritsParentContext, start(request): Promise<SubagentRun> }`
 *
 * `SubagentRun` 的形状是**句柄**而不是结果：
 *   `{ id: SessionId, localAgent, result: Promise<SubagentResult>, dispose() }`
 * —— start() 立刻兑现一个句柄，真正的输出在 `result` 上等。这样"运行已建立"和
 * "运行已结束"才能分成 `subagent/start` / `subagent/end` 两个事件。
 * start() 抛错 = 没有 published child = 两个事件都不发（见 [06] 的观测方式）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedSubagentStartRequest, SubagentCapabilities, SubagentProvider, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 一个"进程内本地评审"子代理 provider（离线可跑：不真的调模型，固定产出一段结论）。 */
class LocalReviewerProvider implements SubagentProvider {
  /** 名字即注册键。 */
  readonly name = 'local-reviewer'
  /** 本 provider 支持的 start-time 特性；真实后端按自己的能力声明。 */
  readonly capabilities: SubagentCapabilities = { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }
  /** 描述性声明：spawn 型子代理从零开始，看不到父会话前缀。 */
  readonly inheritsParentContext = false

  private seq = 0

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const prompt = request.prompt.map((block) => (block.type === 'text' ? block.text : '')).join(' ')
    this.seq += 1
    const id = `${this.name}-${this.seq}` as SessionId
    // 真实 provider 会派生一个子 Agent 跑独立 turn，并把它的最终输出兑现到 result 上。
    const report = `【子代理·${this.name}】已评审：「${prompt}」 → 结论：可合并，建议补边界测试。`
    return {
      id,
      // 进程内派生真实子 Agent 时这里给出那个 Agent；本例不派生，故为 undefined。
      localAgent: undefined,
      result: Promise.resolve({
        output: [{ type: 'text', text: report }],
        stopReason: 'completed',
      }),
      async dispose() { /* 没有需要回收的子进程/子 fiber */ },
    }
  }
}

// 插件标识用于诊断；subagent 和工具的具体注册发生在 apply 中。
// 两项依赖都就绪后 Cordis 才启动插件，避免 apply 里读到未装载的服务。
export const name = 'subagent-delegation'
export const inject = ['subagents', 'tools']

export function apply(ctx: Context) {
  // 1) 注册 provider（effect-based，fiber 销毁即撤销）。
  //    这一步对模型不可见 —— 它只是让 ctx.subagents.start('local-reviewer') 可用。
  ctx.subagents.registerProvider(new LocalReviewerProvider())

  // 2) 把"委派一次评审"暴露成模型可见工具（对照 dsh-tool-subagent）。
  //    **只有这一步改变模型可见面**：注册后模型在 turn 里看到工具 schema，
  //    是否发起委派由模型自己决定，与调用普通工具没有特殊通道。
  //    真实 dsh-tool-subagent 还会监听 subagent/provider-added 延迟注册、
  //    按 inheritsParentContext 生成工具描述 —— 本例在 apply 里同步注册（provider 一定已就绪）。
  ctx.tools.register(defineTool({
    name: 'review_with_subagent',
    description: '把一个代码评审任务委派给子代理，返回其独立结论。',
    parameters: {
      task: { type: 'string', required: true, description: '要委派给子代理的评审任务' },
    },
    output: {
      // output.schema 是**必填**的规范返回值 schema（object 必须显式写 additionalProperties）。
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string', required: true },
          childId: { type: 'string', required: true },
          stopReason: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('委派需要一个发起 agent')
      const run = await ctx.subagents.start('local-reviewer', {
        prompt: [{ type: 'text', text: args.task }],
        parent: exec.agent,
        signal: exec.signal,
      })
      try {
        const result = await run.result
        const text = result.output.map((block) => (block.type === 'text' ? block.text : '')).join('')
        return { text, childId: run.id, stopReason: result.stopReason }
      } finally {
        await run.dispose()
      }
    },
  }))
}
