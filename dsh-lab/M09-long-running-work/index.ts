/**
 * M09 · 长期运行的工作。
 *
 * 一次对话可能产生三类"活得比一个 turn 更久"的东西：
 *
 *   后台任务 `ctx.jobs`      命令跑很久，输出要能被持续读取（不阻塞 turn）
 *   目标     `ctx.goals`     跨轮次的完成目标，驱动自动续跑
 *   工作流   `ctx.workflowEngine`  用脚本把大量子任务编排出去
 *
 * 三者共同的模式是"注册 + 持久化 + 可观测"：状态落在会话日志或存储里，而不是
 * 只活在某个 Promise 里。
 *
 * @module dsh-lab/M09
 */
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** M09.1 —— 启动一个后台任务并读它的输出。 */
async function backgroundJob(stage: StageContext) {
  const { ctx } = stage
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  try {
    stage.log(`jobs 服务：${ctx.jobs.constructor.name}`)
    // JobSpec 的契约：producer 自己在 `run(handle)` 里推输出，registry 只负责
    // 有界环缓冲、生命周期事件和按游标读取。没有 "command 字符串" 这种字段——
    // 谁产生的字节由谁写，这样 bash/job/委派可以共用一套读取面。
    const id = ctx.jobs.start({
      // JobKind 是可合并扩展的联合；不注册自己的 kind 就用官方的 'bash' 形态。
      kind: 'bash',
      label: 'M09.1 后台任务',
      owner: handle.agent.session.id,
      run(job) {
        // append(text) 按 UTF-8 字节推进偏移；updateProgress 是给终端看的一行状态。
        job.append('M09.1 的输出写在 ring 里\n', { channel: 'stdout' })
        job.updateProgress('1/1 done')
        // JobHooks 的两项都是必需的：cancel 必须同步、幂等；done 必须不 reject。
        // registry 会 `hooks.cancel.bind(hooks)`，所以缺了就当场炸。
        return {
          cancel: () => {},
          done: Promise.resolve({ status: 'completed' as const, detail: 'M09.1 完成' }),
        }
      },
    })
    stage.log(`已启动 job：${id}`)
    const listed = ctx.jobs.list(handle.agent.session.id)
    stage.log(`会话可见 job 数：${listed.length}`)
    stage.assert(listed.length >= 1, 'job 未出现在列表里')
    const read = ctx.jobs.read(id, handle.agent.session.id)
    stage.log(`job 状态：${read.job.status}；本次读到 ${read.chunks.length} 个 chunk`)
    stage.log('后台任务的输出有界保留（ring buffer），模型用游标读取，观察者用字节偏移读')
  } finally {
    await handle.dispose()
  }
}

/** M09.2 —— 目标与自动续跑。 */
async function goalLifecycle(stage: StageContext) {
  const { ctx } = stage
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  const agent = handle.agent
  try {
    const goals = ctx.goals as unknown as {
      get: (agent: unknown) => unknown
      create: (agent: unknown, request: unknown) => { id?: string; objective?: string }
      complete?: (agent: unknown, id: string, reason?: string) => unknown
    }
    stage.log(`当前目标：${goals.get(agent) === undefined ? '(无)' : '(已存在)'}`)
    const goal = goals.create(agent, { objective: 'M09.2：演示目标对象落在会话日志里' })
    stage.log(`已创建目标：${JSON.stringify(goal).slice(0, 120)}`)
    const readBack = goals.get(agent)
    stage.assert(readBack !== undefined, '创建后读不到目标')
    stage.log('目标通过投影单元重建，因此重启后仍在')
  } finally {
    await handle.dispose()
  }
}

/** M09.3 —— 工作流引擎。 */
async function workflowEngine(stage: StageContext) {
  const { ctx } = stage
  const engine = ctx.workflowEngine
  stage.log(`workflowEngine：${engine?.constructor?.name ?? '(none)'}`)
  const tools = ctx.tools.schemas().map((schema) => schema.name)
  stage.log(`workflow 工具已注册：${tools.includes('workflow')}`)
  stage.assert(tools.includes('workflow'), 'workflow 工具未注册')
  stage.log('工作流用脚本把子任务 fan-out 出去，phase/pipeline/parallel 由引擎调度')
}

/** M09.4 —— PTC 运行时（run_code）。 */
async function ptcRuntime(stage: StageContext) {
  const { ctx } = stage
  const runtime = ctx.get('ptcRuntime' as never)
  stage.log(`ptc-runtime：${runtime === undefined ? '(未装配)' : '在位'}`)
  const tools = ctx.tools.schemas().map((schema) => schema.name)
  stage.log(`run_code 工具已注册：${tools.includes('run_code')}`)
  stage.log('native 执行器下不暴露 run_code；要启用 PTC 需另挂 @deepseek-ai/dsh-tool-executor-ptc（并保留 ptc-runtime）')
}

/** M09.5 —— 定时与提醒。 */
async function scheduling(stage: StageContext) {
  const { ctx } = stage
  const schedule = ctx.get('schedule' as never)
  stage.log(`schedule 服务：${schedule === undefined ? '未装配（本工程刻意不挂，避免测试期定时器干扰）' : '在位'}`)
  stage.log('需要时可加 dsh-schedule + dsh-tool-schedule 两行；语义是「到点把一条 prompt 送进会话」')
}

export default defineModule({
  id: 'M09',
  title: '长期运行的工作',
  stages: [
    { id: 'M09.1', title: '后台任务与输出环', kind: 'mechanism', run: backgroundJob },
    { id: 'M09.2', title: '目标生命周期', kind: 'mechanism', run: goalLifecycle },
    { id: 'M09.3', title: '工作流引擎', kind: 'mechanism', run: workflowEngine },
    { id: 'M09.4', title: 'PTC 运行时', kind: 'mechanism', run: ptcRuntime },
    { id: 'M09.5', title: '定时与提醒', kind: 'mechanism', run: scheduling },
  ],
})
