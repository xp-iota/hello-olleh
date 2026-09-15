/**
 * 模块 M06 的对应场景：加载命令插件 → 派发 /hello（带参数与不带参数各一次）。命令不进模型 turn。
 * `npm run M06`。
 *
 * 真实 `CommandRuntime` 的口是 `list(agent)` / `execute(agent, line, images, signal)`：
 * `line` 是**完整的斜杠命令行**（含前导 `/`），解析失败或命令不存在时返回 `undefined`。
 * 每次成功派发都会往会话日志写 `command/run` + `command/done` 一对事件。
 */
import { createHarness } from '../../runtime/harness.ts'
import * as helloPlugin from '../impl/01-command-hello.ts'

const harness = await createHarness()
await harness.loadPlugin(helloPlugin)

const { ctx, agent } = harness
const signal = new AbortController().signal

console.log('已注册命令:', ctx.commands.list(agent).map((descriptor) => `/${descriptor.name} ${descriptor.input?.hint ?? ''}`.trim()))

for (const line of ['/hello 张三', '/hello', '/nope']) {
  const execution = await ctx.commands.execute(agent, line, [], signal)
  console.log(`${line.padEnd(12)} →`, execution ? JSON.stringify(execution.result) : '(undefined：不是已注册命令)')
}

console.log('会话日志里的命令事件:', agent.session.snapshotEvents().filter((event) => event.type.startsWith('command/')).map((event) => event.type))

await harness.dispose()
