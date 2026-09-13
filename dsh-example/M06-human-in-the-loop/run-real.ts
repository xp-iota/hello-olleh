/**
 * M06 的**真实 MiniMax 运行入口**：`DSH_REAL=1 node M06-human-in-the-loop/run-real.ts`
 * （或用根目录 `npm run M06:real`；整套真实验收用 `npm run real:all`）。
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
  { id: 'M06.1', title: '人类斜杠命令直接进入宿主', kind: 'mechanism', path: './phases/01-command-hello.ts' },
  { id: 'M06.2', title: '工具 ask 请求进入审批 seam', kind: 'model', path: './phases/02-approval-answerer.ts' },
  { id: 'M06.3', title: '结构化问题进入宿主 answerer', kind: 'mechanism', path: './phases/03-user-questions.ts' },
  { id: 'M06.4', title: '用日志投影切换计划模式', kind: 'mechanism', path: './phases/04-plan-mode.ts' },
  { id: 'M06.5', title: '整体替换 todo 列表', kind: 'mechanism', path: './phases/05-todo.ts' },
  { id: 'M06.6', title: '读取耐久消息反馈', kind: 'mechanism', path: './phases/06-message-feedback.ts' },
]

await runRealModule('M06', '人在环路：显式命令与执行审批', stages, import.meta.url)
