/**
 * dsh-sandbox-demo —— 执行后端与边界，全部离线（不跑模型 turn，不需要 key）：
 *   S1 沙箱内写文件并读回（fs-sandbox + tool-fs）；
 *   S2 一次性 shell 命令（pwsh/bash → subprocess-local 的私有 runner 子进程）；
 *   S3 沙箱模式与 workspaceRoot（sandbox-policy）；
 *   S4 观察策略：未读先编辑被拒，读过之后编辑放行（fs-observation-policy）；
 *   S5 /permission 会话级权限切换：read-only 拒写，workspace-write 恢复。
 * 关键认识："能力"和"权限"是两层——工具注册不等于放行，判决发生在沙箱策略与审批策略上。
 * Node 与 Bun 双运行时：Bun 的 subprocess runner 分隔符缝由 runtime/ 迷你层修补。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands'
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
  'dsh-sandbox-demo', CONFIG,
  loadOverlayPatches('dsh-sandbox-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const suffix = Date.now().toString(36)
const handle = await ctx.agents.create({
  sessionId: SessionId(`sandbox-${suffix}`),
  meta: { cwd: process.cwd() },
})
const agent = handle.agent

// ── S1：沙箱内写文件并读回 ─────────────────────────────────────────────────
console.log('\n=== S1 沙箱内写文件并读回 ===')
{
  // 文件名带时间戳：观察策略要求覆盖已存在文件前先读过它，
  // 固定文件名会让第二次运行变成"未读先写"，从而误报失败。
  const path = resolve(HOME, `sandbox-write-${suffix}.txt`)
  const write = await callTool(ctx, 'write', { file_path: path, content: '沙箱内写入\n' }, agent)
  console.log(`write：isError=${write.isError}，${preview(write.content, 80)}`)
  assert(!write.isError, '在沙箱内写新文件失败')
  const read = await callTool(ctx, 'read', { file_path: path }, agent)
  console.log(`read：isError=${read.isError}，${preview(read.content, 80)}`)
  assert(!read.isError && read.content.includes('沙箱内写入'), '读回自己写的文件失败')
}

// ── S2：一次性 shell 命令 ──────────────────────────────────────────────────
console.log('\n=== S2 一次性 shell 命令 ===')
{
  const toolName = process.platform === 'win32' ? 'pwsh' : 'bash'
  const command = process.platform === 'win32' ? "'sandbox ok' | Write-Output" : 'echo "sandbox ok"'
  const result = await callTool(ctx, toolName, { command, description: '演示一次性 shell 命令' }, agent)
  console.log(`${toolName}：isError=${result.isError}，${preview(result.content, 80)}`)
  assert(!result.isError && result.content.includes('sandbox ok'), `${toolName} 执行失败`)
}

// ── S3：沙箱模式 ───────────────────────────────────────────────────────────
console.log('\n=== S3 沙箱模式 ===')
{
  // 服务上没有现成的 mode 字段：部署默认叫 defaultMode，生效策略要按会话
  // resolve()——会话头 cwd 是 workspace-write 边界，会话 sandbox/mode 事件
  // 覆盖部署默认（sandbox-policy/src/index.ts:208-220）。
  const policy = ctx.get('sandboxPolicy' as never) as unknown as {
    defaultMode: string
    workspaceRoot: string
    resolve(request?: { session?: unknown }): { mode: string; workspaceRoot: string }
  }
  const resolved = policy.resolve({ session: agent.session })
  console.log(`部署默认：defaultMode=${policy.defaultMode}，fallbackRoot=${policy.workspaceRoot}`)
  console.log(`会话解析：mode=${resolved.mode}，workspaceRoot=${resolved.workspaceRoot}`)
  assert(policy.defaultMode === 'workspace-write', '部署默认应当是 workspace-write（patch 行）')
  assert(resolved.mode === 'workspace-write', '会话解析策略应当是 workspace-write')
}

// ── S4：观察策略——写前必须先读 ─────────────────────────────────────────────
console.log('\n=== S4 观察策略 ===')
{
  const path = resolve(HOME, `sandbox-obs-${suffix}.txt`)
  // 关键：用 node 直接落盘，不经过工具。若用 write 工具建立文件，那次 write
  // 本身就登记了一次"观察"，后面的 edit 自然合法——那样就演示不出策略了。
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'original\n', 'utf8')

  const blind = await callTool(ctx, 'edit', { file_path: path, old_string: 'original', new_string: 'changed' }, agent)
  console.log(`未读先编辑：isError=${blind.isError}，${preview(blind.content, 80)}`)
  assert(blind.isError, '观察策略应当拒绝未读先编辑')

  await callTool(ctx, 'read', { file_path: path }, agent)
  const informed = await callTool(ctx, 'edit', { file_path: path, old_string: 'original', new_string: 'changed' }, agent)
  console.log(`读过之后编辑：isError=${informed.isError}，${preview(informed.content, 80)}`)
  assert(!informed.isError, '读后编辑应当成功')
}

// ── S5：/permission 会话级权限切换 ─────────────────────────────────────────
console.log('\n=== S5 /permission 切换 ===')
{
  const names = ctx.commands.list(agent).map(command => command.name)
  console.log(`/permission 命令可见：${names.includes('permission')}`)
  assert(names.includes('permission'), '/permission 命令未注册（permission-presets 行）')

  const signal = new AbortController().signal
  const toReadOnly = await ctx.commands.execute(agent, '/permission read-only', [], signal)
  console.log(`切到 read-only：kind=${toReadOnly?.result.kind}`)
  assert(toReadOnly?.result.kind === 'success', '/permission read-only 执行失败')

  const deniedPath = resolve(HOME, `sandbox-readonly-${suffix}.txt`)
  const denied = await callTool(ctx, 'write', { file_path: deniedPath, content: '不该写进去\n' }, agent)
  console.log(`read-only 下写：isError=${denied.isError}，${preview(denied.content, 80)}`)
  assert(denied.isError, 'read-only 下写操作应当被拒绝')

  const toWrite = await ctx.commands.execute(agent, '/permission workspace-write', [], signal)
  const restored = await callTool(ctx, 'write', { file_path: deniedPath, content: '恢复后可写\n' }, agent)
  console.log(`切回 workspace-write：kind=${toWrite?.result.kind}，写 isError=${restored.isError}`)
  assert(toWrite?.result.kind === 'success' && !restored.isError, '切回 workspace-write 后应当恢复写入')
}

await handle.dispose()
await ctx.fiber.dispose()
console.log('\nSANDBOX_OK')