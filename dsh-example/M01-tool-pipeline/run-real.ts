/**
 * M01 的**真实推理服务运行入口**：`DSH_REAL=1 node M01-tool-pipeline/run-real.ts`
 * （或用根目录 `npm run M01:real`；整套真实验收用 `npm run real:all`）。
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
  { id: 'M01.1', title: '注册工具与 Fiber 回收', kind: 'mechanism', path: './phases/01-register.ts' },
  { id: 'M01.2', title: 'pre-execute 权限门', kind: 'mechanism', path: './phases/02-permission-gate.ts' },
  { id: 'M01.3', title: 'post-execute 结果变换', kind: 'mechanism', path: './phases/03-result-transform.ts' },
  { id: 'M01.4', title: '按 Agent 收紧可见工具', kind: 'mechanism', path: './phases/04-tool-restrict.ts' },
  { id: 'M01.5', title: '不可翻案的单调守卫', kind: 'mechanism', path: './phases/05-tool-guard.ts' },
]

await runRealModule('M01', '工具管线：从注册、可见性到执行前后策略', stages, import.meta.url)
