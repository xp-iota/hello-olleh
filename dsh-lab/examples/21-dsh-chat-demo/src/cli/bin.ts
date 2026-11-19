#!/usr/bin/env node
/**
 * dsh-chat-demo CLI 入口。
 *
 * 四个子命令，覆盖"人怎么用它"的全部路径：
 *
 *   chat              交互式会话（REPL：聊天/审批/提问/斜杠命令）
 *   sessions          列出已落盘的会话
 *   traj [id]         查看某个会话的 trajectory
 *   info              打印装配树概况，并断言 19 服务 + 27 工具（启动探针）
 *
 * 设计原则：**启动一次树，做完事，优雅释放**。`chat` 以外的子命令都只读，
 * 不创建对话、不调模型，因此不需要 LLM_API_KEY——只有真正发消息的路径才要求 key
 * （缺 key 时适配器在调用期报 MISSING_CREDENTIAL，fail loud）。
 *
 * `info` 同时是启动探针：Bun 缺 node:module.stripTypeScriptTypes 时是**静默少 1 个
 * 工具**（26 对 27），单测也可能全绿，只有把服务清单与工具数变成断言才抓得住。
 */
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootChatDemo, ensureDemoHome, DEMO_ROOT } from '../boot.ts'
import { line, style } from './term.ts'

// .env 读取：本示例不引 dotenv，自己解析（只有 KEY=VALUE 与 # 注释两种形态）。
loadDotEnv()

const program = new Command()
program
  .name('dsh-chat-demo')
  .description('基于 @deepseek-ai/dsh 0.2.2-rc.3 的独立交互式示例：完整 89 行装配 + REPL + trajectory')
  .version('0.1.0')

program
  .command('chat')
  .description('交互式会话（REPL）')
  .option('-r, --resume <id>', '恢复已有会话')
  .option('-p, --provider <route>', '覆盖模型路由（如 anthropic-compat / deepseek-official）')
  .option('-m, --model <name>', '覆盖模型名')
  .action(async (options: { resume?: string; provider?: string; model?: string }) => {
    const { Repl } = await import('./repl.ts')
    const demo = await bootChatDemo()
    try {
      await new Repl(demo.ctx).run(options)
    } finally {
      await demo.dispose()
    }
  })

program
  .command('sessions')
  .description('列出已落盘的会话')
  .action(async () => {
    const { renderSessionList } = await import('./traj.ts')
    const demo = await bootChatDemo()
    try {
      await renderSessionList(demo.ctx)
    } finally {
      await demo.dispose()
    }
  })

program
  .command('traj')
  .argument('[sessionId]', '会话 id（省略时列出最近一个）')
  .description('查看 trajectory')
  .option('--surface', '同时打印模型表面折叠结果')
  .option('--no-events', '只打印概览与 turn 大纲')
  .action(async (sessionId: string | undefined, options: { surface?: boolean; events?: boolean }) => {
    const { renderTrajectory } = await import('./traj.ts')
    const demo = await bootChatDemo()
    try {
      let id = sessionId
      if (id === undefined) {
        const records = await demo.ctx.sessionQuery.listSessions()
        if (records.length === 0) {
          line(style.dim('还没有任何会话。先 `npm start` 聊一句。'))
          return
        }
        id = String(records[0]!.header.id)
        line(style.dim(`(默认最近会话 ${id})`))
      }
      await renderTrajectory(demo.ctx, id, { surface: options.surface, events: options.events })
    } finally {
      await demo.dispose()
    }
  })

/** 启动探针的必检服务（与旧 dsh-lab boot-probe 判据一致）。 */
const REQUIRED_SERVICES = [
  'llm',
  'sessions',
  'sessionQuery',
  'sessionProjections',
  'tools',
  'agents',
  'agentLoop',
  'systemPrompt',
  'tokenMeter',
  'approval',
  'userQuestions',
  'commands',
  'storage',
  'skills',
  'subagents',
  'jobs',
  'goals',
  'workflowEngine',
  'invariants',
] as const

/**
 * 期望的工具数（Node 下的实测值；Bun 必须相同才算通过）。
 * rc.1 基线是 26；rc.3 新增 wait_agent（子代理等待），实测 27——
 * 与旧根工程逐项 diff 确认只差这一个，其余 26 个完全一致。
 */
const EXPECTED_TOOLS = 27

program
  .command('info')
  .description('打印装配树概况，并断言 19 服务 + 27 工具（启动探针）')
  .action(async () => {
    const demo = await bootChatDemo()
    try {
      const missing = REQUIRED_SERVICES.filter((name) => demo.ctx.get(name as never) === undefined)
      const tools = demo.ctx.tools.schemas()
      // commands.list 按 agent 作用域求值；info 只想要全局盘点，所以借一个临时 agent。
      const probe = await demo.ctx.agents.create({
        sessionId: SessionId(`info-${Date.now().toString(36)}`),
        meta: { cwd: process.cwd() },
      })
      const commands = demo.ctx.commands.list(probe.agent)
      await probe.dispose()
      const providers = demo.ctx.llm.listProviders()
      line()
      line(style.bold('dsh-chat-demo 装配概况'))
      line(`  工程      ${DEMO_ROOT}`)
      line(`  harness   ${demo.home}`)
      line(`  路由      ${providers.map((p: { id?: string; provider?: string }) => p.id ?? p.provider).join(', ') || '(未注册)'}`)
      line(`  服务      ${REQUIRED_SERVICES.length - missing.length}/${REQUIRED_SERVICES.length} 必检在场`)
      line(`  工具      ${tools.length}`)
      line(`  命令      ${commands.map((c: { name: string }) => '/' + c.name).join(', ')}`)
      line(`  护栏      pre-execute 日志（${process.env.DSH_GUARDRAIL === '0' ? '已关闭' : '开启'}）`)
      line()
      // 机器可读标记 + 硬断言：缺服务或工具数不对就非零退出。
      console.log(`BOOT_PROBE ${JSON.stringify({ missing, tools: tools.length })}`)
      if (missing.length > 0 || tools.length !== EXPECTED_TOOLS) {
        throw new Error(
          `启动探针失败：missing=${JSON.stringify(missing)} tools=${tools.length}（期望 ${EXPECTED_TOOLS}）。` +
          'Bun 下少 1 个工具通常是 ptc-runtime 的 stripTypeScriptTypes shim 未生效，检查 runtime/bun-preload.mjs。',
        )
      }
    } finally {
      await demo.dispose()
    }
  })

program.parseAsync(process.argv).catch((error: unknown) => {
  line(style.red(`✗ ${error instanceof Error ? error.message : String(error)}`))
  process.exitCode = 1
})

/** 读示例根的 .env（若存在）。已存在的环境变量不覆盖。 */
function loadDotEnv(): void {
  ensureDemoHome()
  const path = `${DEMO_ROOT}/.env`
  try {
    const text = readFileSync(path, 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const trimmed = raw.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // 没有 .env 是正常情况：用户也可能直接用环境变量。
  }
}