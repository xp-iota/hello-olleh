#!/usr/bin/env node
/**
 * dsh-lab CLI 入口。
 *
 * 五个子命令，覆盖"人怎么用它"的全部路径：
 *
 *   dsh-lab chat              交互式会话（REPL：聊天/审批/提问/斜杠命令）
 *   dsh-lab sessions          列出已落盘的会话
 *   dsh-lab traj [id]         查看某个会话的 trajectory
 *   dsh-lab run <M01..M12|all> 跑模块的教学阶段
 *   dsh-lab info              打印装配树概况（服务/工具/命令/路由）
 *
 * 设计原则：**启动一次树，做完事，优雅释放**。`chat` 以外的子命令都只读或只跑一次，
 * 因此它们不创建 agent，也不要求 LLM_API_KEY——只有真正调模型的路径才会失败。
 *
 * @module dsh-lab/cli/bin
 */
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootLab, ensureLabHome, LAB_ROOT } from '../boot.ts'
import { line, style } from './term.ts'

// .env 读取：本工程不引 dotenv，自己解析（只有 KEY=VALUE 与 # 注释两种形态）。
loadDotEnv()

const program = new Command()
program
  .name('dsh-lab')
  .description('基于 @deepseek-ai/dsh 0.2.1-rc.2 的独立示例工程：12 个能力模块 + 交互式 CLI + trajectory')
  .version('0.1.0')

program
  .command('chat')
  .description('交互式会话（REPL）')
  .option('-r, --resume <id>', '恢复已有会话')
  .option('-p, --provider <route>', '覆盖模型路由（如 anthropic-compat / deepseek-official）')
  .option('-m, --model <name>', '覆盖模型名')
  .action(async (options: { resume?: string; provider?: string; model?: string }) => {
    const { Repl } = await import('./repl.ts')
    const lab = await bootLab()
    try {
      await new Repl(lab.ctx).run(options)
    } finally {
      await lab.dispose()
    }
  })

program
  .command('sessions')
  .description('列出已落盘的会话')
  .action(async () => {
    const { renderSessionList } = await import('./traj.ts')
    const lab = await bootLab()
    try {
      await renderSessionList(lab.ctx)
    } finally {
      await lab.dispose()
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
    const lab = await bootLab()
    try {
      let id = sessionId
      if (id === undefined) {
        const records = await lab.ctx.sessionQuery.listSessions()
        if (records.length === 0) {
          line(style.dim('还没有任何会话。先 `dsh-lab chat` 聊一句。'))
          return
        }
        id = String(records[0]!.header.id)
        line(style.dim(`(默认最近会话 ${id})`))
      }
      await renderTrajectory(lab.ctx, id, { surface: options.surface, events: options.events })
    } finally {
      await lab.dispose()
    }
  })

program
  .command('run')
  .argument('<module>', 'M01..M12 或 all')
  .description('跑模块的教学阶段')
  .option('-s, --stage <name>', '只跑一个阶段')
  .action(async (module: string, options: { stage?: string }) => {
    const { runModule } = await import('../lab/runner.ts')
    const lab = await bootLab()
    try {
      process.exitCode = await runModule(lab.ctx, module, options)
    } finally {
      await lab.dispose()
    }
  })

program
  .command('info')
  .description('打印装配树概况')
  .action(async () => {
    const lab = await bootLab()
    try {
      const tools = lab.ctx.tools.schemas()
      // commands.list 按 agent 作用域求值；info 只想要全局盘点，所以借一个临时 agent。
      const probe = await lab.ctx.agents.create({
        sessionId: SessionId(`info-${Date.now().toString(36)}`),
        meta: { cwd: process.cwd() },
      })
      const commands = lab.ctx.commands.list(probe.agent)
      await probe.dispose()
      const providers = lab.ctx.llm.listProviders()
      line()
      line(style.bold('dsh-lab 装配概况'))
      line(`  工程      ${LAB_ROOT}`)
      line(`  harness   ${lab.home}`)
      line(`  路由      ${providers.map((p: { id?: string; provider?: string }) => p.id ?? p.provider).join(', ') || '(未注册)'}`)
      line(`  工具      ${tools.length}`)
      line(`  命令      ${commands.map((c: { name: string }) => '/' + c.name).join(', ')}`)
      line()
    } finally {
      await lab.dispose()
    }
  })

program.parseAsync(process.argv).catch((error: unknown) => {
  line(style.red(`✗ ${error instanceof Error ? error.message : String(error)}`))
  process.exitCode = 1
})

/** 读工程根的 .env（若存在）。已存在的环境变量不覆盖。 */
function loadDotEnv(): void {
  ensureLabHome()
  const path = `${LAB_ROOT}/.env`
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
