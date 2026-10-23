/**
 * boot-probe.ts —— 启动探针：断言服务树完整、工具数正确。
 *
 * 为什么要有这个文件，而不是在 verify.mjs 里用 `-e` 内联一段脚本：
 * Windows 上 Bun 是通过 `bun.cmd` 调起来的，整条命令要经 cmd.exe 解析；
 * 带换行与引号的多行脚本会在那里被拆坏（`Unterminated string literal`）。
 * 落成文件后，两套运行时的调用形式完全一致：`<runtime> runtime/boot-probe.ts`。
 *
 * 输出一行机器可读标记，供 verify.mjs 解析：
 *
 *     BOOT_PROBE {"missing":[],"tools":26}
 *
 * 退出码 0 表示"服务齐全且工具数正确"。这一项存在的意义：Bun 缺
 * `node:module.stripTypeScriptTypes` 时是**静默少 1 个工具**，单元测试也可能
 * 全绿，只有把工具数变成断言才抓得住。
 *
 * @module dsh-lab/runtime/boot-probe
 */
import { bootLab } from '../src/boot.ts'

/** 与 src/boot.test.ts 保持一致的必检服务。 */
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

/** 期望的工具数（Node 下的实测值；Bun 必须相同才算通过）。 */
const EXPECTED_TOOLS = 26

const lab = await bootLab()
try {
  const missing = REQUIRED_SERVICES.filter((name) => lab.ctx.get(name as never) === undefined)
  const tools = lab.ctx.tools.schemas().length
  console.log(`BOOT_PROBE ${JSON.stringify({ missing, tools })}`)
  process.exitCode = missing.length === 0 && tools === EXPECTED_TOOLS ? 0 : 1
} finally {
  await lab.dispose()
}
