/**
 * M09 的**真实 MiniMax 运行入口**：`DSH_REAL=1 node M09-long-running-orchestration/run-real.ts`
 * （或用根目录 `npm run M09:real`；整套真实验收用 `npm run real:all`）。
 *
 * 与 `run.ts` 的区别不是"换个开关"，而是三件事同时成立：
 *   1. provider 路由固定为 minimax-m3，缺密钥立即失败，不会静默退回 mock；
 *   2. 每个阶段结束后必须留下至少一次成功的真实调用证据，否则非零退出；
 *   3. 纯机制阶段（注册、回收、队列、状态机）在**阶段入口**先用完整装配链打一次真实
 *      请求，证明这条链真的能把模型响应送回会话日志，再跑本地机制断言。
 */
import type { StageSpec } from '../runtime/real.ts'
import { runRealModule } from '../runtime/real.ts'

const stages: readonly StageSpec[] = [
  { id: 'M09.1', title: '管理后台 Job 的启动、读取、终止与等待', kind: 'mechanism', path: './phases/01-jobs-background.ts' },
  { id: 'M09.2', title: '以追加日志和 CAS 推进 Goal 生命周期', kind: 'mechanism', path: './phases/02-goal-lifecycle.ts' },
  { id: 'M09.3', title: '在 worker thread 执行工作流脚本', kind: 'mechanism', path: './phases/03-workflow-engine.ts' },
  { id: 'M09.4', title: '把计划调度注册到耐久会话', kind: 'mechanism', path: './phases/04-schedule.ts' },
]

await runRealModule('M09', '长任务与编排：运行句柄与目标状态', stages, import.meta.url)
