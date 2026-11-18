/**
 * dsh-jobs-demo —— 长期运行的工作，全部离线（不跑模型 turn，不需要 key）：
 *   S1 后台任务：producer 推输出进环、游标读取、kill 取消；
 *   S2 目标生命周期：create → pause → resume → complete + /goal 命令；
 *   S3 PTC run_code：程序传输面在沙箱子进程里执行代码；
 *   S4 workflow：脚本编排（phase/log/args 钩子，不 fan-out 子代理）；
 *   S5 schedule：durable 定时任务的创建、列表、删除。
 * 关键认识：活得比 turn 久的东西都走"注册 + 持久化 + 可观测"——状态落在
 * 会话日志或存储域里，而不是只活在某个 Promise 里。
 * Node 与 Bun 双运行时：Bun 的 stripTypeScriptTypes 与 runner 分隔符两条缝
 * 由 runtime/ 迷你层修补。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-jobs-local'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-commands'
import { callTool, preview } from './tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })
// 宿主进程调 stripTypeScriptTypes 会报实验警告（带随机 pid，破坏双运行时
// 输出逐行一致）：start 脚本用 node --no-warnings 抑制；Bun 侧无此警告。

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-jobs-demo', CONFIG,
  loadOverlayPatches('dsh-jobs-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const suffix = Date.now().toString(36)
const handle = await ctx.agents.create({
  sessionId: SessionId(`jobs-${suffix}`),
  meta: { cwd: process.cwd() },
})
const agent = handle.agent
const sid = agent.session.id

// ── S1：后台任务与输出环 ───────────────────────────────────────────────────
console.log('\n=== S1 后台任务与输出环 ===')
{
  // JobSpec 没有 "command 字符串" 字段：producer 自己在 run(handle) 里推输出，
  // registry 只负责有界环缓冲、生命周期事件和按游标读取。
  const id = ctx.jobs.start({
    kind: 'bash',
    label: 'S1 演示任务',
    owner: sid,
    run(job) {
      job.append('第一行输出\n', { channel: 'stdout' })
      job.append('第二行输出\n', { channel: 'stdout' })
      job.updateProgress('2/2 done')
      // JobHooks 两项都必需：cancel 同步幂等，done 必须不 reject。
      return {
        cancel: () => {},
        done: Promise.resolve({ status: 'completed' as const, detail: 'S1 完成' }),
      }
    },
  })
  const listed = ctx.jobs.list(sid)
  console.log(`会话可见 job 数：${listed.length}`)
  assert(listed.length >= 1, 'job 未出现在列表里')

  const first = ctx.jobs.read(id, sid)
  console.log(`首次读：${first.chunks.length} 个 chunk，status=${first.job.status}`)
  assert(first.chunks.length === 2, '应当一次读到两个 chunk')
  const second = ctx.jobs.read(id, sid)
  console.log(`游标再读：${second.chunks.length} 个 chunk（游标已推进）`)
  assert(second.chunks.length === 0, '游标之后的重复读应当为空')

  // 第二个任务演示 kill：producer 的 done 悬着，cancel 钩子负责收尾。
  let release: (() => void) | undefined
  const id2 = ctx.jobs.start({
    kind: 'bash',
    label: 'S1 可取消任务',
    owner: sid,
    run(job) {
      job.append('等待取消\n', { channel: 'stdout' })
      return {
        cancel: () => release?.(),
        done: new Promise(resolve => {
          release = () => resolve({ status: 'killed' as const, detail: '被演示取消' })
        }),
      }
    },
  })
  const outcome = ctx.jobs.kill(id2, sid, '演示取消')
  console.log(`kill 返回：${outcome}`)
  assert(outcome === 'requested', 'kill 应当返回 requested')
  // 等 producer 的 cancel 钩子把 done 收尾。
  for (let i = 0; i < 100 && ctx.jobs.read(id2, sid).job.status !== 'killed'; i++) {
    await new Promise(r => setTimeout(r, 10))
  }
  const killed = ctx.jobs.read(id2, sid)
  console.log(`取消后状态：${killed.job.status}`)
  assert(killed.job.status === 'killed', '被 kill 的任务应当进入 killed')
}

// ── S2：目标生命周期 ───────────────────────────────────────────────────────
console.log('\n=== S2 目标生命周期 ===')
{
  console.log(`初始目标：${ctx.goals.get(agent) === undefined ? '(无)' : '(已存在)'}`)
  const goal = ctx.goals.create(agent, { objective: 'S2：演示目标对象落在会话日志里' })
  console.log(`create：phase=${goal.phase}，activation=${goal.activation}`)
  assert(goal.phase === 'active', '新目标应当 active')
  // 挂了续跑驱动时 create 即 armed（随时准备自动续跑）；离线演示用 disarm
  // 同步解除，避免驱动在 idle 边缘偷跑一个没有适配器的 turn。
  const disarmed = ctx.goals.disarm(agent)
  console.log(`disarm：activation=${disarmed?.activation}`)
  assert(disarmed?.activation === 'disarmed', 'disarm 应当解除续跑武装')

  const paused = ctx.goals.pause(agent, { id: goal.id, revision: disarmed?.revision ?? goal.revision })
  const resumed = ctx.goals.resume(agent, { id: paused.id, revision: paused.revision })
  console.log(`pause → ${paused.phase}；resume → ${resumed.phase}（activation=${resumed.activation}）`)
  assert(paused.phase === 'paused' && resumed.phase === 'active', 'pause/resume 相位迁移失败')
  assert(resumed.activation === 'armed', 'resume 应当重新武装续跑')
  ctx.goals.disarm(agent)

  // 重复 create 被拒：一个会话同时只容一个未完成目标。
  let duplicate = ''
  try { ctx.goals.create(agent, { objective: '重复目标' }) } catch (error) {
    duplicate = error instanceof Error ? error.message : String(error)
  }
  console.log(`重复 create：${preview(duplicate.replace(/goal "[^"]+"/, 'goal "<id>"'), 80)}`)
  assert(duplicate.includes('already exists'), '重复 create 应当被拒绝')

  const names = ctx.commands.list(agent).map(command => command.name)
  console.log(`/goal 命令可见：${names.includes('goal')}`)
  assert(names.includes('goal'), '/goal 命令未注册（command-goal 行）')
  const shown = await ctx.commands.execute(agent, '/goal', [], new AbortController().signal)
  console.log(`/goal 执行：kind=${shown?.result.kind}`)
  assert(shown?.result.kind === 'success', '/goal 执行失败')

  const done = ctx.goals.complete(agent, { id: resumed.id, revision: ctx.goals.get(agent)?.revision ?? resumed.revision })
  console.log(`complete：phase=${done.phase}`)
  assert(done.phase === 'complete', 'complete 应当进入 complete 相位')
}

// ── S3：PTC run_code ───────────────────────────────────────────────────────
console.log('\n=== S3 PTC run_code ===')
{
  // run_code 不在 tools.schemas() 里：它是执行器拥有的传输面，在注册能力之外
  // 构建（tool-executor-ptc/src/ptc.ts:268）。PTC 模式下顶层只容 run_code，
  // 直接调别的工具会被拒——其他工具要从程序内的 SDK 绑定调。
  const direct = await callTool(ctx, 'workflow', {
    script: 'return 1', meta: { name: 'x', description: 'x' },
  }, agent)
  console.log(`顶层直调 workflow：isError=${direct.isError}，${preview(direct.content, 80)}`)
  assert(direct.isError && direct.content.includes('run_code'), 'PTC 模式应当拒绝顶层直调其他工具')

  // per-call 模式：程序是 async 函数体，return 即输出；在沙箱子进程里执行。
  const result = await callTool(ctx, 'run_code', { code: 'return 6 * 7', description: '演示程序传输面' }, agent)
  console.log(`run_code：isError=${result.isError}，${preview(result.content, 80)}`)
  assert(!result.isError && result.content.includes('42'), 'run_code 执行失败')
}

// ── S4：workflow 脚本编排 ──────────────────────────────────────────────────
console.log('\n=== S4 workflow 脚本编排 ===')
{
  const tools = ctx.tools.schemas().map(schema => schema.name)
  console.log(`workflow 工具已注册：${tools.includes('workflow')}（在 SDK 声明里，不在顶层）`)
  assert(tools.includes('workflow'), 'workflow 工具未注册')
  // 脚本只用 phase/log/args 钩子，不 fan-out 子代理——离线可跑。
  // PTC 模式下 workflow 要从 run_code 程序内的 SDK 绑定调。
  const result = await callTool(ctx, 'run_code', {
    code: 'return await tools.workflow({ script: \'phase("compute"); log("adding two numbers"); return args.a + args.b\', meta: { name: "add-two-numbers", description: "演示 workflow 脚本钩子" }, args: { a: 20, b: 22 } })',
    description: '在程序内调 workflow',
  }, agent)
  console.log(`workflow：isError=${result.isError}，${preview(result.content.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'), 80)}`)
  assert(!result.isError && result.content.includes('42'), 'workflow 脚本执行失败')
}

// ── S5：schedule 定时任务 ──────────────────────────────────────────────────
console.log('\n=== S5 schedule 定时任务 ===')
{
  // 存储是 durable 的：上次运行残留的任务还在。先幂等清理，保证计数确定。
  for (const item of (await ctx.schedule.list()).items) {
    await ctx.schedule.edit({ id: item.id, action: 'delete' }, sid)
  }
  // 服务 API 直接驱动（不经工具面）：一小时后的一次性提醒，创建后立刻删除。
  // 目标选已存在的会话：默认 new_once 要 Host 能建会话（sessionController），
  // 本示例没挂那条缝。
  const entry = await ctx.schedule.create({
    title: '演示提醒',
    prompt: '检查演示状态',
    timing: { kind: 'after', after_seconds: 3600 },
    target: { kind: 'session', sessionId: sid },
  }, sid)
  console.log(`create：status=${entry.status}，title=${entry.title}`)
  assert(entry.status === 'active', '新建任务应当 active')

  const listed = await ctx.schedule.list()
  console.log(`list：total=${listed.total}`)
  assert(listed.total === 1, '应当恰好一个任务')

  // 工具面（schedule_create/list/edit）在 PTC 模式下从程序内调：
  // 注意工具面与服务 API 的参数形状不同——timing 换成 rrule（RFC 5545 子集），
  // target 换成枚举 this_session/new_once/new（tool-schedule/src/index.ts:375-383）。
  const viaTool = await callTool(ctx, 'run_code', {
    code: `const created = await tools.schedule_create({ title: "工具面提醒", prompt: "检查工具面", rrule: "DTSTART:20270101T000000Z\\nRRULE:FREQ=DAILY;COUNT=1", target: "this_session" });
const listed = await tools.schedule_list({});
const deleted = await tools.schedule_edit({ id: created.id, action: "delete" });
return { total: listed.total, deleted: deleted.deleted === true }`,
    description: '在程序内调 schedule 工具面',
  }, agent)
  console.log(`工具面 create/list/delete：isError=${viaTool.isError}，${preview(viaTool.content, 80)}`)
  assert(!viaTool.isError && /"total":\s*2/.test(viaTool.content) && /"deleted":\s*true/.test(viaTool.content), 'schedule 工具面执行失败')

  const deleted = await ctx.schedule.edit({ id: entry.id, action: 'delete' }, sid)
  console.log(`delete：deleted=${'deleted' in deleted ? deleted.deleted : '?'}`)
  assert('deleted' in deleted && deleted.deleted === true, '删除应当成功')
  const after = await ctx.schedule.list()
  console.log(`删除后 list：total=${after.total}`)
  assert(after.total === 0, '删除后应当没有任务')
}

await handle.dispose()
await ctx.fiber.dispose()
console.log('\nJOBS_OK')