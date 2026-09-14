/**
 * M08 的**真实推理服务运行入口**：`DSH_REAL=1 node M08-delegation-presets/run-real.ts`
 * （或用根目录 `npm run M08:real`；整套真实验收用 `npm run real:all`）。
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
  { id: 'M08.1', title: '注册子代理 Provider，并显式包装成工具', kind: 'mechanism', path: './phases/01-subagent-delegation.ts' },
  { id: 'M08.2', title: '装配不扫描用户目录的空 preset roster', kind: 'mechanism', path: './phases/02-agent-presets.ts' },
  { id: 'M08.3', title: '拒绝未隔离 shell 的权限预设', kind: 'mechanism', path: './phases/03-permission-presets.ts' },
  { id: 'M08.4', title: '配置子代理精确模型路由', kind: 'mechanism', path: './phases/04-subagent-model-selection.ts' },
]

await runRealModule('M08', '委派与预设：Provider、组合、权限与模型选择', stages, import.meta.url)
