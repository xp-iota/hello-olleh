/**
 * M09 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M09-long-running-orchestration/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M09-long-running-orchestration/run.ts --mock     # 离线确定性机制（走 runtime/llm.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/harness.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import { applyMockFlag, runModule, type StageSpec } from '../runtime/harness.ts'

// 静态 import 共享同一份可变模式状态；执行模块前先应用 --mock。
applyMockFlag()

const stages: readonly StageSpec[] = [
  { id: 'M09.1', title: '管理后台 Job 的启动、读取、终止与等待', kind: 'mechanism', path: './phases/01-job-start-read-kill.ts' },
  { id: 'M09.2', title: '以追加日志和 CAS 推进 Goal 生命周期', kind: 'mechanism', path: './phases/02-goal-cas-conflict.ts' },
  { id: 'M09.3', title: '在 worker thread 执行工作流脚本', kind: 'mechanism', path: './phases/03-run-script-in-worker.ts' },
  { id: 'M09.4', title: '把计划调度注册到耐久会话', kind: 'mechanism', path: './phases/04-attach-schedule.ts' },
]

await runModule('M09', '长任务与编排：运行句柄与目标状态', stages, import.meta.url)
