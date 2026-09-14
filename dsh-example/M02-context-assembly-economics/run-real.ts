/**
 * M02 的**真实推理服务运行入口**：`DSH_REAL=1 node M02-context-assembly-economics/run-real.ts`
 * （或用根目录 `npm run M02:real`；整套真实验收用 `npm run real:all`）。
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
  { id: 'M02.1', title: '按顺序贡献 Prompt section', kind: 'mechanism', path: './phases/01-prompt-section.ts' },
  { id: 'M02.2', title: '变量解析与 assembly waterfall', kind: 'mechanism', path: './phases/02-prompt-variable-assemble.ts' },
  { id: 'M02.3', title: '压缩历史并替换模型可见 surface', kind: 'mechanism', path: './phases/03-compaction-provider.ts' },
  { id: 'M02.4', title: '回放日志估算 token 压力', kind: 'mechanism', path: './phases/04-token-meter.ts' },
  { id: 'M02.5', title: '确定性裁剪超长工具结果', kind: 'mechanism', path: './phases/05-tool-result-pruner.ts' },
  { id: 'M02.6', title: '把超长结果 spill 到本地文件', kind: 'mechanism', path: './phases/06-spill-policy.ts' },
]

await runRealModule('M02', '上下文装配与经济学：构造、改写、压缩', stages, import.meta.url)
