/**
 * 模块 M01 的对应场景：注册两个演示工具（read_file / bash），加载权限门（denyList 含 'bash'），
 * 分别调用，观察：read_file 放行、bash 被 deny。`npm run M01`。
 *
 * 真实结果类型是 `ToolExecutionSuccess | ToolExecutionFailure`：判别字段是 `isError`，
 * 失败侧带一个结构化 `error`（`code` 是稳定的机器可读分类）。
 */
import { createHarness, demoTool } from '../../runtime/harness.ts'
import * as gatePlugin from '../impl/02-permission-gate.ts'

const harness = await createHarness()

harness.ctx.tools.register(demoTool('read_file', '读取一个文件'))
harness.ctx.tools.register(demoTool('bash', '执行 shell 命令'))

await harness.loadPlugin(gatePlugin, { denyList: ['bash'] })

const ok = await harness.callTool('read_file', { path: 'a.txt' })
console.log('read_file → isError:', ok.isError, '|', ok.content[0]?.type === 'text' ? ok.content[0].text : '')

const denied = await harness.callTool('bash', { cmd: 'rm -rf /' })
console.log('bash      → isError:', denied.isError, '| failure.message:', denied.isError ? denied.error.message : '-')
console.log('返回给模型的内容:', denied.content[0]?.type === 'text' ? denied.content[0].text : '')

await harness.dispose()
