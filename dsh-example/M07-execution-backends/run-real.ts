/**
 * M07 的**真实推理服务运行入口**：`DSH_REAL=1 node M07-execution-backends/run-real.ts`
 * （或用根目录 `npm run M07:real`；整套真实验收用 `npm run real:all`）。
 *
 * 与 `run.ts` 的区别不是"换个开关"，而是三件事同时成立：
 *   1. provider 路由固定为 anthropic-compat，缺密钥立即失败，不会静默退回 mock；
 *   2. 每个阶段结束后必须留下至少一次成功的真实调用证据，否则非零退出；
 *   3. 纯机制阶段（注册、回收、队列、状态机）在**阶段入口**先用完整装配链打一次真实
 *      请求，证明这条链真的能把模型响应送回会话日志，再跑本地机制断言。
 */
import type { StageSpec } from '../runtime/real.ts'
import { runRealModule } from '../runtime/real.ts'

const stages: readonly StageSpec[] = [
  { id: 'M07.1', title: '通过 fs/subprocess seam 执行副作用', kind: 'mechanism', path: './phases/01-fs-shell-side-effects.ts' },
  { id: 'M07.2', title: '消费 shell 的 run/start 双形态', kind: 'mechanism', path: './phases/02-shell-service.ts' },
  { id: 'M07.3', title: '用 sandbox provider 强制策略', kind: 'mechanism', path: './phases/03-sandbox-seam.ts' },
  { id: 'M07.4', title: '观察 terminal backend 注册边界', kind: 'mechanism', path: './phases/04-terminal-sessions.ts' },
  { id: 'M07.5', title: '解析共享 sandbox policy', kind: 'mechanism', path: './phases/05-sandbox-policy.ts' },
]

await runRealModule('M07', '执行侧后端：I/O、进程与沙箱边界', stages, import.meta.url)
