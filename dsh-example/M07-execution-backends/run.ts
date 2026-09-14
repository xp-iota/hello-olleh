/**
 * M07 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M07-execution-backends/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M07-execution-backends/run.ts --mock     # 离线确定性机制（走 runtime/llm.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/harness.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import { applyMockFlag, runModule, type StageSpec } from '../runtime/harness.ts'

// 静态 import 共享同一份可变模式状态；执行模块前先应用 --mock。
applyMockFlag()

const stages: readonly StageSpec[] = [
  { id: 'M07.1', title: '通过 fs/subprocess seam 执行副作用', kind: 'mechanism', path: './phases/01-write-and-run.ts' },
  { id: 'M07.2', title: '消费 shell 的 run/start 双形态', kind: 'mechanism', path: './phases/02-run-and-start.ts' },
  { id: 'M07.3', title: '用 sandbox provider 强制策略', kind: 'mechanism', path: './phases/03-confine-and-fail-closed.ts' },
  { id: 'M07.4', title: '观察 terminal backend 注册边界', kind: 'mechanism', path: './phases/04-terminal-backend-guard.ts' },
  { id: 'M07.5', title: '解析共享 sandbox policy', kind: 'mechanism', path: './phases/05-merge-session-policy.ts' },
]

await runModule('M07', '执行侧后端：I/O、进程与沙箱边界', stages, import.meta.url)
