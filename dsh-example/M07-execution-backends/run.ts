/**
 * M07 的运行入口：**只跑真实推理服务**。
 *
 *   node M07-execution-backends/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *
 * 阶段清单由 runtime/harness.ts 的 runModule() 驱动：逐阶段校验"确实发生过成功的推理服务调用"，
 * 缺证据即 fail loud；mechanism 阶段另有一次入口 probe 作为完整装配链的真实证据。
 */

import { runModule, type StageSpec } from '../runtime/harness.ts'

const stages: readonly StageSpec[] = [
  { id: 'M07.1', title: '通过 fs/subprocess seam 执行副作用', kind: 'mechanism', path: './scenes/01-write-and-run.ts' },
  { id: 'M07.2', title: '消费 shell 的 run/start 双形态', kind: 'mechanism', path: './scenes/02-run-and-start.ts' },
  { id: 'M07.3', title: '用 sandbox provider 强制策略', kind: 'mechanism', path: './scenes/03-confine-and-fail-closed.ts' },
  { id: 'M07.4', title: '观察 terminal backend 注册边界', kind: 'mechanism', path: './scenes/04-terminal-backend-guard.ts' },
  { id: 'M07.5', title: '解析共享 sandbox policy', kind: 'mechanism', path: './scenes/05-merge-session-policy.ts' },
]

await runModule('M07', '执行侧后端：I/O、进程与沙箱边界', stages, import.meta.url)
