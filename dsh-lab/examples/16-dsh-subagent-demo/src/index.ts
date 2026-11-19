/**
 * dsh-subagent-demo —— 委派（delegation），全部离线（脚本化 LlmAdapter，不需要 key）：
 *   S1 委派工具与 provider：subagent / subagent_fork 两个工具、spawn / fork 两条 provider；
 *   S2 spawn：registry 直建子 agent，会话头记录 origin/深度归属；
 *   S3 fork：父会话先跑一个真实 turn，子会话带 seed 前缀 + inheritedEventCount；
 *   S4 真实委派工具：callTool('subagent') 激活子 agent，子继承父的模型路由跑完自己的 turn；
 *   S5 深度预算：maxDepth=1 时，深度 1 的子 agent 再委派被 provider 拒绝。
 * 关键认识：spawn 与 fork 的差别在会话层——独立上下文 vs 继承前缀；归属与预算在运行期层。
 * word-count 工具与脚本化适配器在 cordis.patch.yml 里声明，全程在位。
 * Node 与 Bun 双运行时：不挂 ptc/subprocess，无需任何 Bun 补丁。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query-sqlite'
import type {} from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { callTool, preview } from './tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-subagent-demo', CONFIG,
  loadOverlayPatches('dsh-subagent-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const userMsg = (text: string) =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

const suffix = Date.now().toString(36)
const makeAgent = (tag: string, model: string) =>
  ctx.agents.create({
    sessionId: SessionId(`subagent-${tag}-${suffix}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'lab-scripted', model },
  })

// word_count 工具与脚本化适配器由 patch 清单声明，boot 后已在位。

// ── S1：委派工具与 provider ────────────────────────────────────────────────
console.log('\n=== S1 委派工具与 provider ===')
{
  const names = ctx.tools.schemas().map(schema => schema.name)
  const delegationTools = names.filter(name => name === 'subagent' || name === 'subagent_fork').sort()
  console.log(`委派工具：${delegationTools.join(', ')}`)
  assert(delegationTools.length === 2, '两个委派工具都应当注册')
  for (const providerName of ['spawn', 'fork']) {
    const provider = ctx.subagents.getProvider(providerName)
    if (provider === undefined) throw new Error(`断言失败：provider ${providerName} 未注册`)
    console.log(`provider ${providerName}：inheritsParentContext=${provider.inheritsParentContext}，depthLimit=${provider.capabilities.depthLimit}`)
  }
}

// ── S2：spawn——独立子 agent 与运行期归属 ───────────────────────────────────
console.log('\n=== S2 spawn：独立子 agent ===')
{
  const handle = await makeAgent('s2', 's2')
  const child = await ctx.agents.create({
    sessionId: SessionId(`subagent-s2-child-${suffix}`),
    // rc.3 的子 agent 身份落在会话头元数据：origin + delegationDepth。
    meta: { cwd: process.cwd(), origin: 'subagent', delegationDepth: 1 },
  })
  // registry 直建的子 agent：归属落在会话头（origin + delegationDepth），
  // 运行期 rootOf() 只认 manager 管理的激活（见 S4）。
  const childHeader = await ctx.sessionQuery.readSession(child.agent.id)
  const parentHeader = await ctx.sessionQuery.readSession(handle.agent.id)
  const listed = ctx.agents.list().some(agent => String(agent.id) === String(child.agent.id))
  console.log(`子 agent 已创建：会话头 origin=${childHeader.session.origin}，delegationDepth=${childHeader.session.delegationDepth}，父 origin=${parentHeader.session.origin ?? '(无)'}，注册表可见=${listed}`)
  assert(childHeader.session.origin === 'subagent' && childHeader.session.delegationDepth === 1, '会话头应当记录子 agent 身份与深度')
  assert(parentHeader.session.origin === undefined && listed, '父应当是普通会话，子应当在注册表里')
  await child.dispose()
  await handle.dispose()
  console.log('子 agent 与父 agent 已释放')
}

// ── S3：fork——继承父会话前缀 ───────────────────────────────────────────────
console.log('\n=== S3 fork：继承父会话前缀 ===')
{
  const handle = await makeAgent('s3', 'fork-parent')
  const parent = handle.agent
  // 先让父会话跑一个真实 turn，才有前缀可继承。
  parent.followup(userMsg('统计一下这段文本的词数'))
  await parent.whenIdle()
  const parentSnapshot = await ctx.sessionQuery.readSession(parent.id)
  console.log(`父会话事件数：${parentSnapshot.events.length}`)

  // fork 的语义在会话层：parentSession + isSeeded + 显式 seed。
  // 设了 isSeeded 却不给 seed，会话构造直接失败——自称继承却拿不出前缀是自相矛盾。
  const forked = await ctx.agents.create({
    sessionId: SessionId(`subagent-s3-fork-${suffix}`),
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
  const prefixMatches = parentSnapshot.events.every((event, i) => snapshot.events[i]?.type === event.type)
  console.log(`fork 事件数：${snapshot.events.length}，继承前缀：${snapshot.inheritedEventCount}，前缀逐条同型：${prefixMatches}`)
  assert(snapshot.inheritedEventCount === parentSnapshot.events.length, '继承前缀长度不符')
  assert(prefixMatches, 'fork 前缀应当与父会话逐条同型')
  await forked.dispose()
  await handle.dispose()
}

// ── S4：真实委派工具——激活子 agent 并跑完它自己的 turn ─────────────────────
console.log('\n=== S4 真实 subagent 工具 ===')
const delegHandle = await makeAgent('s4', 'delegator')
let child: Agent
{
  const parent = delegHandle.agent
  // 工具立即返回 activation（子 agent 的名字），子在后台独立跑。
  const started = await callTool(ctx, 'subagent', {
    description: '统计词数',
    prompt: '统计一下这段文本的词数，然后给出结论。',
  }, parent)
  const value = started.value as { kind?: string; name?: string } | undefined
  console.log(`工具返回：isError=${started.isError}，kind=${value?.kind}，name=${value?.name}，${preview(started.content, 160)}`)
  assert(!started.isError && value?.kind === 'activation', '委派工具应当返回 activation')

  const found = ctx.agents.list().find(agent => String(agent.id) !== String(parent.id))
  if (found === undefined) throw new Error('断言失败：子 agent 未出现在注册表里')
  child = found
  // 子继承父的兼容路由（lab-scripted / delegator），跑的是它自己的会话与 turn。
  await child.whenIdle()
  const childSnapshot = await ctx.sessionQuery.readSession(child.id)
  const toolCalls = childSnapshot.events.filter(event => event.type === 'tool/call').length
  const turns = childSnapshot.events.filter(event => event.type === 'turn/start').length
  console.log(`子 agent 跑完：事件 ${childSnapshot.events.length} 条，turn × ${turns}，tool/call × ${toolCalls}`)
  assert(turns === 1 && toolCalls === 1, '子 agent 应当独立跑完一个脚本化 turn')
  assert(String(child.id) !== String(parent.id), '子会话必须独立于父会话')
  // 工具激活的子是 manager 管理的激活：rootOf() 沿委派链回溯到活根。
  const root = ctx.subagents.rootOf(child)
  console.log(`rootOf(子)===父：${root === parent}`)
  assert(root === parent, 'rootOf 应当回溯到父 agent')
}

// ── S5：深度预算——深度 1 的子 agent 不能再委派 ─────────────────────────────
console.log('\n=== S5 深度预算 ===')
{
  console.log(`subagents.resolveMaxDepth() = ${ctx.subagents.resolveMaxDepth()}`)
  // 深度预算由 provider 在每次委派时执行：子深度 1 再委派 → 深度 2 超限被拒。
  const blocked = await callTool(ctx, 'subagent', {
    description: '再委派一层',
    prompt: '试着再委派一个子 agent。',
  }, child)
  console.log(`深度 1 再委派：isError=${blocked.isError}，${preview(blocked.content, 100)}`)
  assert(blocked.isError && blocked.content.includes('exceeds maxDepth'), '深度预算应当拒绝超限委派')
  await delegHandle.dispose()
}

await ctx.fiber.dispose()
console.log('\nSUBAGENT_OK')