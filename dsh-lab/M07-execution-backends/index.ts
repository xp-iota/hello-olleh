/**
 * M07 · 执行后端与边界。
 *
 * 模型说要读文件、写文件、跑命令——这些动作最终都落到"边界"上：
 *
 *   文件系统   `ctx.fs`（沙箱化：读写都按会话的 sandbox 策略判定）
 *   观察策略   写之前必须先读、编辑必须基于已读内容（fs-observation-policy）
 *   shell      `ctx.shell`（一次性命令）与 sandbox 的执行包装
 *   沙箱模式   read-only / workspace-write / danger-full-access
 *
 * 这一章的价值在于看清"能力"和"权限"是两层：工具注册不等于放行，放行判决发生在
 * 沙箱策略与审批策略上。
 *
 * @module dsh-lab/M07
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineModule, type StageContext } from '../src/lab/runner.ts'

/** M07.1 —— 用沙箱化文件系统读写。 */
async function writeAndRun(stage: StageContext) {
  const { ctx } = stage
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  const agent = handle.agent
  try {
    // 工具执行要带 caller agent，沙箱策略才按该会话的模式判定。
    const path = `${process.cwd()}/.dsh-home/m07-demo.txt`
    const write = await ctx.tools.execute({
      callId: `m07w-${Date.now()}` as never,
      name: 'write',
      arguments: { file_path: path, content: 'M07.1 写入于沙箱内\n' },
      agent,
      signal: new AbortController().signal,
    })
    stage.log(`write：isError=${write.isError} ${preview(write.content)}`)

    const read = await ctx.tools.execute({
      callId: `m07r-${Date.now()}` as never,
      name: 'read',
      arguments: { file_path: path },
      agent,
      signal: new AbortController().signal,
    })
    stage.log(`read：isError=${read.isError} ${preview(read.content)}`)
    stage.assert(!read.isError, '读回自己写的文件失败')
  } finally {
    await handle.dispose()
  }
}

/** M07.2 —— 一次性 shell 命令。 */
async function runShell(stage: StageContext) {
  const { ctx } = stage
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  const agent = handle.agent
  try {
    const toolName = process.platform === 'win32' ? 'pwsh' : 'bash'
    const command = process.platform === 'win32' ? "'M07.2 ok' | Write-Output" : 'echo "M07.2 ok"'
    const result = await ctx.tools.execute({
      callId: `m07s-${Date.now()}` as never,
      name: toolName,
      arguments: { command, description: 'M07.2 演示一次性 shell 命令' },
      agent,
      signal: new AbortController().signal,
    })
    stage.log(`${toolName}：isError=${result.isError} ${preview(result.content)}`)
    stage.assert(!result.isError, `${toolName} 执行失败`)
  } finally {
    await handle.dispose()
  }
}

/** M07.3 —— 沙箱模式与 fail-closed。 */
async function sandboxMode(stage: StageContext) {
  const { ctx } = stage
  const sandbox = ctx.sandbox
  stage.log(`sandbox provider：${sandbox?.constructor?.name ?? '(none)'}`)
  const policy = ctx.get('sandboxPolicy' as never) as { mode?: string; workspaceRoot?: string } | undefined
  stage.log(`当前策略：mode=${policy?.mode ?? '?'} root=${policy?.workspaceRoot ?? '?'}`)
  stage.log('模式取自 DSH_PERMISSION_MODE（默认 workspace-write）；read-only 下写操作会被拒绝')
}

/** M07.4 —— 观察策略：写前必须先读。 */
async function observationPolicy(stage: StageContext) {
  const { ctx } = stage
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  const agent = handle.agent
  try {
    const path = `${process.cwd()}/.dsh-home/m07-obs.txt`
    // 关键：用 node 直接落盘，**不经过工具**。若用 write 工具建立文件，那次 write
    // 本身就登记了一次"观察"，后面的 edit 自然合法——那样就演示不出策略了。
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'original\n', 'utf8')

    // 该 agent 从未读过这个文件，却直接 edit：应当被观察策略拒绝。
    const blind = await ctx.tools.execute({
      callId: `m07o2-${Date.now()}` as never,
      name: 'edit',
      arguments: { file_path: path, old_string: 'original', new_string: 'changed' },
      agent,
      signal: new AbortController().signal,
    })
    stage.log(`未读先编辑：isError=${blind.isError} ${preview(blind.content)}`)
    stage.assert(blind.isError, '观察策略应当拒绝未读先编辑')

    // 读过之后再编辑：应当成功。
    await ctx.tools.execute({
      callId: `m07o3-${Date.now()}` as never,
      name: 'read',
      arguments: { file_path: path },
      agent,
      signal: new AbortController().signal,
    })
    const informed = await ctx.tools.execute({
      callId: `m07o4-${Date.now()}` as never,
      name: 'edit',
      arguments: { file_path: path, old_string: 'original', new_string: 'changed' },
      agent,
      signal: new AbortController().signal,
    })
    stage.log(`读过之后编辑：isError=${informed.isError} ${preview(informed.content)}`)
    stage.assert(!informed.isError, '读后编辑应当成功')
  } finally {
    await handle.dispose()
  }
}

/** M07.5 —— 会话级策略切换。 */
async function switchPolicy(stage: StageContext) {
  const { ctx } = stage
  const handle = await ctx.agents.create({ sessionId: SessionId(stage.sessionId), meta: { cwd: process.cwd() } })
  try {
    const commands = ctx.commands.list(handle.agent).map((command) => command.name)
    stage.log(`/permission 命令可见：${commands.includes('permission')}`)
    stage.log('会话内用 /permission 切换 read-only / workspace-write / danger-full-access')
    stage.assert(commands.includes('permission'), '/permission 命令未注册（permission-presets 行）')
  } finally {
    await handle.dispose()
  }
}

/** 取结果里的文本预览。 */
function preview(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, 120)
  if (Array.isArray(content)) {
    return content
      .map((block: { type?: string; text?: string }) => (block?.type === 'text' ? (block.text ?? '') : `[${block?.type}]`))
      .join(' ')
      .slice(0, 120)
  }
  return ''
}

export default defineModule({
  id: 'M07',
  title: '执行后端与边界',
  stages: [
    { id: 'M07.1', title: '沙箱内写文件并读回', kind: 'mechanism', run: writeAndRun },
    { id: 'M07.2', title: '一次性 shell 命令', kind: 'mechanism', run: runShell },
    { id: 'M07.3', title: '沙箱模式', kind: 'mechanism', run: sandboxMode },
    { id: 'M07.4', title: '观察策略：写前必须先读', kind: 'mechanism', run: observationPolicy },
    { id: 'M07.5', title: '会话级权限切换', kind: 'mechanism', run: switchPolicy },
  ],
})
