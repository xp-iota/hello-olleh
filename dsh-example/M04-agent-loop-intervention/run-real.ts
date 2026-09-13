/**
 * M04 的**真实 MiniMax 运行入口**：`DSH_REAL=1 node M04-agent-loop-intervention/run-real.ts`
 * （或用根目录 `npm run M04:real`；整套真实验收用 `npm run real:all`）。
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
  { id: 'M04.1', title: '观察 turn/step/session 事件', kind: 'model', path: './phases/01-agent-events-telemetry.ts' },
  { id: 'M04.2', title: '在生命周期边界请求 steering', kind: 'model', path: './phases/02-lifecycle-steering.ts' },
  { id: 'M04.3', title: '比较 inbox 四种输入通道', kind: 'model', path: './phases/03-agent-inbox.ts' },
  { id: 'M04.4', title: '捕获会话遥测账本', kind: 'mechanism', path: './phases/04-session-telemetry.ts' },
  { id: 'M04.5', title: '注册包归属运行时不变量', kind: 'mechanism', path: './phases/05-invariants.ts' },
]

await runRealModule('M04', 'Agent 循环与干预面：先观察，再引导', stages, import.meta.url)
