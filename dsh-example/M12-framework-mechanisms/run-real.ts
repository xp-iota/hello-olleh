/**
 * M12 的**真实推理服务运行入口**：`DSH_REAL=1 node M12-framework-mechanisms/run-real.ts`
 * （或用根目录 `npm run M12:real`；整套真实验收用 `npm run real:all`）。
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
  { id: 'M12.1', title: '对照五种事件派发模式', kind: 'mechanism', path: './phases/01-dispatch-modes.ts' },
  { id: 'M12.2', title: '验证绑定 Fiber 的可处置定时器', kind: 'model', path: './phases/02-cordis-timer.ts' },
  { id: 'M12.3', title: '观察 Fiber 依赖状态机', kind: 'mechanism', path: './phases/03-fiber-state-machine.ts' },
  { id: 'M12.4', title: '隔离同名服务 realm', kind: 'mechanism', path: './phases/04-isolate-realm.ts' },
  { id: 'M12.5', title: '叠加调用域 intercept 配置', kind: 'mechanism', path: './phases/05-intercept-config.ts' },
]

await runRealModule('M12', '框架机制本体：事件语义与生命周期资源', stages, import.meta.url)
