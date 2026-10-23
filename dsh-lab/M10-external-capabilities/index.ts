/**
 * M10 · 外部能力接入。
 *
 * dsh 接入外部能力有四种形态，它们共享一个原则："能力是数据，装配是配置"。
 *
 *   Skill     一个目录 + SKILL.md，按需加载正文（ctx.skills / skill 工具）
 *   指令文件  工作区里的 AGENTS.md 等，自动进系统提示（agent-instructions）
 *   MCP       外部进程/HTTP 服务，工具名带命名空间前缀（ctx.tools + mcp-client）
 *   网络      web_search / web_fetch（ctx.web）
 *
 * 这一章演示前三种如何被"发现 → 声明 → 调用"，以及 MCP 的命名空间隔离。
 *
 * @module dsh-lab/M10
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** M10.1 —— 发现文件系统里的 skill。 */
async function discoverSkills(stage: StageContext) {
  const { ctx } = stage
  const skills = ctx.skills as unknown as {
    list?: (agent?: unknown) => Promise<unknown[]> | unknown[]
    search?: (query: string) => Promise<unknown[]> | unknown[]
  }
  const list = await skills.list?.()
  stage.log(`已发现 skill：${Array.isArray(list) ? list.length : 0} 个`)
  const names = Array.isArray(list)
    ? list.map((item) => (item as { name?: string }).name ?? '(unnamed)')
    : []
  if (names.length > 0) stage.log(`  ${names.join(', ')}`)
  const tools = ctx.tools.schemas().map((schema) => schema.name)
  stage.assert(tools.includes('skill'), 'skill 工具未注册')
  stage.log('skill 工具已注册：正文按需加载，不占常驻上下文')
}

/** M10.2 —— 写一个 skill 并让它被发现。 */
async function authorSkill(stage: StageContext) {
  const { ctx } = stage
  // 默认 skill 根之一是工程内的 .dsh/skills（依赖 skill-filesystem 的默认根）。
  const root = join(process.cwd(), '.dsh-home', 'skills', 'lab-demo-skill')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'SKILL.md'),
    [
      '---',
      'name: lab-demo-skill',
      'description: M10.2 现场写入的示例 skill，用来演示「能力即目录」。',
      '---',
      '',
      '# 示例 skill',
      '',
      '这段正文只在被调用时加载，因此可以写很长而几乎不占常驻上下文。',
      '',
    ].join('\n'),
    'utf8',
  )
  stage.log(`已写入 ${join(root, 'SKILL.md')}`)
  const skills = ctx.skills as unknown as { list?: () => Promise<unknown[]> }
  const list = (await skills.list?.()) ?? []
  const found = (list as { name?: string }[]).some((item) => item.name === 'lab-demo-skill')
  stage.log(`skill 目录被发现：${found}（watch 可能需要一点时间；未刷新属正常）`)
}

/** M10.3 —— 工作区指令文件。 */
async function instructionFiles(stage: StageContext) {
  const { ctx } = stage
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  try {
    const assembly = await ctx.systemPrompt.assemble()
    const hasInstructionSection = assembly.sections.some((section) =>
      section.name.toLowerCase().includes('instruction'),
    )
    stage.log(`系统提示里包含指令段落：${hasInstructionSection}`)
    stage.log(`上下文段落数：${assembly.contexts.length}（cwd / 沙箱策略等快照）`)
    stage.log('agent-instructions 会读取 AGENTS.md / CLAUDE.md 等候选文件，按预算截断')
  } finally {
    await handle.dispose()
  }
}

/** M10.4 —— MCP 的命名空间隔离。 */
async function mcpNamespace(stage: StageContext) {
  const { ctx } = stage
  const mcp = ctx.get('mcpResources' as never)
  stage.log(`mcp-resources：${mcp === undefined ? '(未装配)' : '在位'}`)
  stage.log('MCP 工具名形如 mcp__<serverName>__<toolName>：命名空间前缀保证多 server 不撞名')
  stage.log('本工程默认不挂 mcp-client 实例（没有真实 server 可连），MCP 的接线方式见 README')
}

/** M10.5 —— 网络能力。 */
async function webTools(stage: StageContext) {
  const { ctx } = stage
  const tools = ctx.tools.schemas().map((schema) => schema.name)
  stage.log(`web_fetch：${tools.includes('web_fetch')}；web_search：${tools.includes('web_search')}`)
  stage.assert(tools.includes('web_fetch'), 'web_fetch 工具未注册')
  stage.log('web_fetch 走匿名 HTTP（仅公网地址）；web_search 需要 DEEPSEEK_API_KEY')
}

export default defineModule({
  id: 'M10',
  title: '外部能力接入',
  stages: [
    { id: 'M10.1', title: '发现文件系统 skill', kind: 'mechanism', run: discoverSkills },
    { id: 'M10.2', title: '现场写一个 skill', kind: 'mechanism', run: authorSkill },
    { id: 'M10.3', title: '工作区指令文件', kind: 'mechanism', run: instructionFiles },
    { id: 'M10.4', title: 'MCP 命名空间隔离', kind: 'mechanism', run: mcpNamespace },
    { id: 'M10.5', title: '网络能力', kind: 'mechanism', run: webTools },
  ],
})
