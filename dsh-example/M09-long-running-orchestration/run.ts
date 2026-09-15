/**
 * M09 的运行入口：**只跑真实推理服务**。
 *
 *   node M09-long-running-orchestration/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *
 * 阶段清单由 runtime/harness.ts 的 runModule() 驱动：逐阶段校验"确实发生过成功的推理服务调用"，
 * 缺证据即 fail loud；mechanism 阶段另有一次入口 probe 作为完整装配链的真实证据。
 */

import { runModule, type StageSpec } from '../runtime/harness.ts'

const stages: readonly StageSpec[] = [
  { id: 'M09.1', title: '管理后台 Job 的启动、读取、终止与等待', kind: 'mechanism', path: './scenes/01-job-start-read-kill.ts' },
  { id: 'M09.2', title: '以追加日志和 CAS 推进 Goal 生命周期', kind: 'mechanism', path: './scenes/02-goal-cas-conflict.ts' },
  { id: 'M09.3', title: '在 worker thread 执行工作流脚本', kind: 'mechanism', path: './scenes/03-run-script-in-worker.ts' },
  { id: 'M09.4', title: '把计划调度注册到耐久会话', kind: 'mechanism', path: './scenes/04-attach-schedule.ts' },
]

await runModule('M09', '长任务与编排：运行句柄与目标状态', stages, import.meta.url)
