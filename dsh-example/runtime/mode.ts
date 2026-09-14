/**
 * mode.ts —— 唯一的运行模式开关。**默认 real**，`--mock` 才离线。
 *
 * 为什么会有一个"默认模式"这种东西：每个模块只有一个 `run.ts`，它要同时承担
 * 原先 `run.ts`（离线确定性机制）与 `run-real.ts`（真实推理服务验收）两份职责。
 * 既然文件名只有一个，模式就必须显式可切，且只有一处判据——否则"某个入口忘了带开关，
 * 于是真实模式误报缺密钥 / 离线模式偷偷退回 mock"这类偏差会到处冒出来。
 *
 * 两条通道，优先级从高到低：
 *   1. 进程内调用 `setMockMode()` —— `run.ts` 解析 `--mock` 后立即设置，
 *      之后动态 import 的每个阶段脚本都读到同一个值（它们共享同一个模块实例）。
 *   2. 环境变量 `DSH_MOCK=1` —— 给**子进程**用：`npm test` 的 `node --test` 与
 *      `run-all.sh --mock` 都靠它把模式传给下面真正装配 harness 的进程。
 *
 * 默认 real 的后果是明确的：不传 `--mock` 就要求 `LLM_API_KEY`，缺了就当场失败，
 * 绝不静默退回 mock。离线门禁请用 `npm run all:mock`。
 */

let mock = process.env.DSH_MOCK === '1'

/** 真实模式（默认）。`runtime/harness.ts` 与 `runtime/real.ts` 都读它，而不是各自读环境变量。 */
export function isMockMode(): boolean {
  return mock
}

/** 切到 mock 模式（幂等）。`run.ts` 解析 `--mock` 后调用它，对后续动态 import 同样生效。 */
export function setMockMode(): void {
  mock = true
  // 同步写回环境变量：阶段脚本可能再 fork 出子进程，子进程只能靠环境变量看到模式。
  process.env.DSH_MOCK = '1'
}

/**
 * 解析命令行里的 `--mock`：命中就切模式，并返回剩下的参数。
 * 单个开关不值得引入参数解析库，所以这里只认这一个 flag。
 */
export function applyMockFlag(argv: readonly string[] = process.argv.slice(2)): string[] {
  const rest = argv.filter((arg) => arg !== '--mock')
  if (rest.length !== argv.length) setMockMode()
  return rest
}
