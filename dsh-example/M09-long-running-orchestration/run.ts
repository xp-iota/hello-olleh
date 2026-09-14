/**
 * M09 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M09-long-running-orchestration/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M09-long-running-orchestration/run.ts --mock     # 离线确定性机制（走 runtime/llm-mock.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/real.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import type { StageSpec } from '../runtime/real.ts'
import { applyMockFlag } from '../runtime/mode.ts'

// ① 先解析 --mock。这一句必须早于 real.ts 求值：REAL_MODE 是模块级常量，
//    而静态 import 会被提升到模块体之前执行，所以 real.ts 只能动态 import。
applyMockFlag()
const { runModule } = await import('../runtime/real.ts')

const stages: readonly StageSpec[] = [
  { id: 'M09.1', title: '管理后台 Job 的启动、读取、终止与等待', kind: 'mechanism', path: './phases/01-job-start-read-kill.ts' },
  { id: 'M09.2', title: '以追加日志和 CAS 推进 Goal 生命周期', kind: 'mechanism', path: './phases/02-goal-cas-conflict.ts' },
  { id: 'M09.3', title: '在 worker thread 执行工作流脚本', kind: 'mechanism', path: './phases/03-run-script-in-worker.ts' },
  { id: 'M09.4', title: '把计划调度注册到耐久会话', kind: 'mechanism', path: './phases/04-attach-schedule.ts' },
]

await runModule('M09', '长任务与编排：运行句柄与目标状态', stages, import.meta.url)
