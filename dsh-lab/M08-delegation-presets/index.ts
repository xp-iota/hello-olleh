/**
 * M08 · 委派与预设。
 *
 * 一个 agent 可以创建子 agent。两条委派通道差别很大，这是本章的核心：
 *
 *   spawn（`subagent`） 子 agent 从零开始，独立上下文，适合"分头查资料/改文件"
 *   fork（`subagent_fork`）子 agent 继承父会话前缀，适合"接着我这条线索往下做"
 *
 * 第三条是"预设"（agent preset）：把模型路由、工具集合、提示词片段打包成一份可复用
 * 的 agent 模板，运行时按名字选取。
 *
 * @module dsh-lab/M08
 */
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** M08.1 —— 列出委派 provider。 */
async function listProviders(stage: StageContext) {
  const { ctx } = stage
  const subagents = ctx.subagents
  stage.log(`subagents 服务：${subagents?.constructor?.name ?? '(none)'}`)
  const tools = ctx.tools.schemas().map((schema) => schema.name)
  const delegationTools = tools.filter((name) => name === 'subagent' || name === 'subagent_fork' || name === 'list_agents')
  stage.log(`委派相关工具：${delegationTools.join(', ')}`)
  stage.assert(delegationTools.includes('subagent'), 'spawn 委派工具未注册')
  stage.assert(delegationTools.includes('subagent_fork'), 'fork 委派工具未注册')
}

/** M08.2 —— spawn 委派（父 agent 派一个子任务）。 */
async function spawnChild(stage: StageContext) {
  const { ctx } = stage
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  try {
    // 不通过工具，直接用 registry 建一个"子"agent：parentAgent 建立运行期归属。
    const child = await ctx.agents.create({
      sessionId: SessionId(`${stage.sessionId}-child`),
      parentAgent: handle.agent,
      meta: { cwd: process.cwd(), origin: 'subagent', delegationDepth: 1 },
    })
    stage.log(`子 agent：${child.agent.id}`)
    const roots = ctx.agents.roots()
    stage.log(`运行期根 agent 数：${roots.length}（子 agent 不是根）`)
    stage.assert(
      roots.every((root) => String(root.id) !== String(child.agent.id)),
      '子 agent 不应当出现在 roots() 里',
    )
    await child.dispose()
    stage.log('子 agent 已释放')
  } finally {
    await handle.dispose()
  }
}

/** M08.3 —— fork 委派（继承父会话前缀）。 */
async function forkChild(stage: StageContext) {
  const { ctx } = stage
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  const parent = handle.agent
  try {
    // fork 的语义在 session 层：子会话带 parentSession + 显式 seed 前缀。
    // `seed` 不是可选的装饰：设了 isSeeded 却不给 seed，session 构造函数会直接在
    // "seeded session requires an explicit constructor seed" 上失败——这是有意的，
    // 一个自称继承却拿不出前缀的会话是自相矛盾的。
    const parentSnapshot = await ctx.sessionQuery.readSession(parent.id)
    stage.log(`父会话事件数：${parentSnapshot.events.length}`)
    const forked = await ctx.agents.create({
      sessionId: SessionId(`${stage.sessionId}-fork`),
      parentAgent: parent,
      meta: {
        cwd: process.cwd(),
        parentSession: parent.id,
        isSeeded: true,
        origin: 'subagent',
        delegationDepth: 1,
      },
      seed: parentSnapshot.events,
      inheritedEventCount: parentSnapshot.events.length as never,
    })
    const snapshot = await ctx.sessionQuery.readSession(forked.agent.id)
    stage.log(`fork 出的事件数：${snapshot.events.length}，继承前缀：${snapshot.inheritedEventCount}`)
    stage.assert(snapshot.inheritedEventCount === parentSnapshot.events.length, '继承前缀长度不符')
    stage.log('fork 子会话保留了父会话的完整前缀（可回放、可审计）')
    await forked.dispose()
  } finally {
    await handle.dispose()
  }
}

/** M08.4 —— 预设注册表。 */
async function presetRegistry(stage: StageContext) {
  const { ctx } = stage
  const registry = ctx.get('agentPresetRegistry' as never)
  stage.log(`agent-preset-registry：${registry !== undefined ? '在位' : '未装配'}`)
  const presets = ctx.get('agentPresets' as never)
  stage.log(`agent-preset：${presets !== undefined ? '在位' : '未装配'}`)
  stage.log('预设把「模型路由 + 工具集合 + 提示词片段」打包，运行时按名字选取')
}

/** M08.5 —— 委派预算。 */
async function delegationBudget(stage: StageContext) {
  const { ctx } = stage
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  try {
    const deep = await ctx.agents.create({
      sessionId: SessionId(`${stage.sessionId}-deep`),
      parentAgent: handle.agent,
      meta: { cwd: process.cwd(), origin: 'subagent', delegationDepth: 9 },
    })
    const snapshot = await ctx.sessionQuery.readSession(deep.agent.id)
    stage.log(`delegationDepth 记录在会话头：${snapshot.session.delegationDepth ?? '(未记录)'}`)
    stage.log('深度预算由 subagent 服务执行（maxDepth），超限时创建会失败')
    await deep.dispose()
  } finally {
    await handle.dispose()
  }
}

export default defineModule({
  id: 'M08',
  title: '委派与预设',
  stages: [
    { id: 'M08.1', title: '委派 provider 与工具', kind: 'mechanism', run: listProviders },
    { id: 'M08.2', title: 'spawn：独立子 agent', kind: 'mechanism', run: spawnChild },
    { id: 'M08.3', title: 'fork：继承父会话前缀', kind: 'mechanism', run: forkChild },
    { id: 'M08.4', title: '预设注册表', kind: 'mechanism', run: presetRegistry },
    { id: 'M08.5', title: '委派深度预算', kind: 'mechanism', run: delegationBudget },
  ],
})
