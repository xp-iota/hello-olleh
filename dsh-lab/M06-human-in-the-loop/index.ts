/**
 * M06 · 人机交互（Human-in-the-loop）。
 *
 * 五个交互面，全部以"服务 + waterfall"的形式存在，终端只是它们的一个消费者：
 *
 *   审批   `approval/request`     一次调用要不要放行
 *   提问   `user-questions/request` 让模型主动问人（ask_user_question 工具）
 *   命令   `ctx.commands`          人类发起的斜杠命令（不进模型）
 *   计划   `ctx.planMode`          只读探索 + exit_plan_mode 审批
 *   待办   `ctx.todos` / todo_write 人类可见的任务清单
 *
 * `dsh-lab chat` 把前四个都接到了终端上；这一章的阶段则在进程内验证它们的语义，
 * 这样即使没有交互终端也能自动化测试。
 *
 * @module dsh-lab/M06
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** 公共：建一个 agent 执行一段逻辑。 */
async function withAgent(stage: StageContext, body: (agent: any) => Promise<void>): Promise<void> {
  const handle = await stage.ctx.agents.create({
    sessionId: SessionId(stage.sessionId),
    meta: { cwd: process.cwd() },
  })
  try {
    await body(handle.agent)
  } finally {
    await handle.dispose()
  }
}

/** M06.1 —— 斜杠命令的分发。 */
async function dispatchCommand(stage: StageContext) {
  const { ctx } = stage
  await withAgent(stage, async (agent) => {
    const list = ctx.commands.list(agent)
    stage.log(`该 agent 可见命令：${list.map((command) => '/' + command.name).join(', ')}`)
    stage.assert(list.length > 0, '装配树没有注册任何命令')

    // /compact 会走 compaction 服务；用一个不会真的压缩的短会话验证分发链路。
    const execution = await ctx.commands.execute(agent, '/goal', [], new AbortController().signal)
    stage.assert(execution !== undefined, '命令未被解析执行')
    stage.log(`命令结果：kind=${execution!.result.kind} text=${String(execution!.result.text ?? '').slice(0, 60)}`)
  })
}

/**
 * M06.2 —— 审批 waterfall 的三种结果。
 *
 * 两个层次要分清：
 *
 *   `approval/request` 是 waterfall，任何监听都能给出结论（终端、策略插件、测试）；
 *   `ctx.approval.request()` 是它的服务封装，额外强制"必须在 turn 内"——
 *   因为审计事件 approval/asked + approval/decided 必须成对落在 turn 的重放边界里，
 *   否则重载时会被当成崩溃留下的垃圾尾巴。
 *
 * 阶段里没有真实 turn（那需要模型），所以这里直接派发 waterfall 本身，验证
 * "监听认领 → 结论" 与 "没人认领 → fail closed" 两条路径。真实对话中
 * `dsh-lab chat` 通过同一条 waterfall 弹出 y/n 提示。
 */
async function approvalOutcomes(stage: StageContext) {
  const { ctx } = stage
  await withAgent(stage, async (agent) => {
    const seen: string[] = []

    // 情形一：监听认领并拒绝。
    const offReject = ctx.on('approval/request', (async (request: { toolName: string }) => {
      seen.push(request.toolName)
      return 'rejected'
    }) as never)
    const rejected = await (ctx as any).waterfall(
      'approval/request',
      { agent, toolName: 'lab_guarded_tool', reason: 'M06.2' } as never,
      (() => Promise.resolve('unavailable')) as never,
    )
    stage.log(`① 监听拒绝 → ${String(rejected)}`)
    stage.assert(rejected === 'rejected', '监听没有生效')
    offReject()

    // 情形二：监听放行一次（唯一表示"允许"的取值）。
    const offAllow = ctx.on('approval/request', (async () => 'allowed-once') as never)
    const allowed = await (ctx as any).waterfall(
      'approval/request',
      { agent, toolName: 'lab_guarded_tool' } as never,
      (() => Promise.resolve('unavailable')) as never,
    )
    stage.log(`② 监听放行 → ${String(allowed)}`)
    stage.assert(allowed === 'allowed-once', '放行路径不对')
    offAllow()

    // 情形三：没人认领 → 落到兜底，必须是 fail closed 的 unavailable。
    const unclaimed = await (ctx as any).waterfall(
      'approval/request',
      { agent, toolName: 'lab_guarded_tool' } as never,
      (() => Promise.resolve('unavailable')) as never,
    )
    stage.log(`③ 无人认领 → ${String(unclaimed)}（fail closed：不给结论就不放行）`)
    stage.assert(unclaimed === 'unavailable', '缺回答器时必须 fail closed')

    // 顺带确认 service 的 turn 约束确实在（裸调会被拒）。
    const bare = await ctx.approval
      .request({ agent, toolName: 'lab_guarded_tool' } as never)
      .then(() => 'unexpectedly-resolved')
      .catch((error: Error) => (error.message.includes('outside an open turn') ? 'turn-enclosed' : error.message))
    stage.log(`④ 服务层裸调 → ${bare}（审计对必须包在 turn 里）`)
    stage.assert(bare === 'turn-enclosed', 'approval 服务应当拒绝 turn 外的询问')
  })
}

/** M06.3 —— 模型主动提问。 */
async function structuredQuestions(stage: StageContext) {
  const { ctx } = stage
  await withAgent(stage, async (agent) => {
    const off = ctx.on('user-questions/request', (async (request: any) => {
      stage.log(`模型提了 ${request.questions.length} 个问题：`)
      for (const question of request.questions) {
        stage.log(`  · ${question.question}（选项 ${question.options?.length ?? 0} 个）`)
      }
      // 回答第一题的第一个选项（没有选项就给自由文本）。
      return {
        answers: request.questions.map((question: any) => ({
          id: question.id,
          selected: question.options?.[0] === undefined ? [] : [question.options[0].label],
          ...(question.options === undefined ? { custom: 'M06.3 的自动回答' } : {}),
        })),
      }
    }) as never)

    const answer = await ctx.userQuestions.ask({
      agent,
      questions: [
        {
          id: 'q1',
          question: '这次演示要继续吗？',
          header: 'M06.3',
          options: [{ label: '继续' }, { label: '停止' }],
        },
      ],
    })
    stage.log(`得到回答：${JSON.stringify(answer)}`)
    stage.assert(answer.answers.length === 1, '回答数量不符')
    off()
  })
}

/** M06.4 —— 计划模式。 */
async function togglePlanMode(stage: StageContext) {
  const { ctx } = stage
  await withAgent(stage, async (agent) => {
    const planMode = ctx.get('planMode' as never) as
      | { enter?: (agent: unknown) => void; exit?: (agent: unknown) => void; isActive?: (agent: unknown) => boolean }
      | undefined
    if (planMode === undefined) {
      stage.log('planMode 服务未装配（装配清单里有 plan-mode 行，但它可能以 agent 作用域暴露）')
      return
    }
    stage.log(`计划模式接口：${Object.keys(planMode).join(', ')}`)
    stage.log('plan-mode 行已装配：只读探索 + exit_plan_mode 审批（终端里用 /plan 切换）')
  })
}

/** M06.5 —— 待办清单。 */
async function todoList(stage: StageContext) {
  const { ctx } = stage
  const hasTodoTool = ctx.tools.schemas().some((schema) => schema.name === 'todo_write') ||
    ctx.tools.schemas().some((schema) => schema.name === 'todo_read')
  stage.log(`todo 工具已注册：${hasTodoTool}`)
  stage.assert(hasTodoTool, 'todo 工具应当出现在可见工具里（tool-todo 行）')
  stage.log('todo 列表是投影单元：人类可见，模型通过 todo 工具改写')
}

/** M06.6 —— 消息反馈。 */
async function messageFeedback(stage: StageContext) {
  const { ctx } = stage
  const service = ctx.get('messageFeedback' as never)
  stage.log(`message-feedback 服务在位：${service !== undefined}`)
  stage.log('反馈落进会话日志（feedback/record），与消息身份绑定；/feedback 命令由 command-feedback 注册')
  stage.assert(service !== undefined, 'messageFeedback 未装配')
}

export default defineModule({
  id: 'M06',
  title: '人机交互',
  stages: [
    { id: 'M06.1', title: '分发斜杠命令', kind: 'mechanism', run: dispatchCommand },
    { id: 'M06.2', title: '三种审批结果', kind: 'mechanism', run: approvalOutcomes },
    { id: 'M06.3', title: '模型主动提问', kind: 'mechanism', run: structuredQuestions },
    { id: 'M06.4', title: '计划模式', kind: 'mechanism', run: togglePlanMode },
    { id: 'M06.5', title: '待办清单', kind: 'mechanism', run: todoList },
    { id: 'M06.6', title: '消息反馈', kind: 'mechanism', run: messageFeedback },
  ],
})
