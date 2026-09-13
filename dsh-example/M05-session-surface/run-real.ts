/**
 * M05 的**真实 MiniMax 运行入口**：`DSH_REAL=1 node M05-session-surface/run-real.ts`
 * （或用根目录 `npm run M05:real`；整套真实验收用 `npm run real:all`）。
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
  { id: 'M05.1', title: '验证会话日志和模型可见面的不变量', kind: 'model', path: './phases/01-session-log.ts' },
  { id: 'M05.2', title: '装载 JSONL persistence Provider', kind: 'mechanism', path: './phases/02-session-persistence.ts' },
  { id: 'M05.3', title: '查询 live-preferred 会话语料', kind: 'mechanism', path: './phases/03-session-query.ts' },
  { id: 'M05.4', title: '耐久化 projection checkpoint', kind: 'mechanism', path: './phases/04-session-projection-cache.ts' },
  { id: 'M05.5', title: '把标题写成 latest-wins 日志事件', kind: 'mechanism', path: './phases/05-session-title.ts' },
]

await runRealModule('M05', '会话面：日志、持久化、查询、投影与标题', stages, import.meta.url)
