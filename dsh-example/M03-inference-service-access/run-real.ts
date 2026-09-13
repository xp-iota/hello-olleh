/**
 * M03 的**真实 MiniMax 运行入口**：`DSH_REAL=1 node M03-inference-service-access/run-real.ts`
 * （或用根目录 `npm run M03:real`；整套真实验收用 `npm run real:all`）。
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
  { id: 'M03.1', title: '注册并消费离线 LLM Adapter', kind: 'mechanism', path: './phases/01-llm-adapter.ts' },
  { id: 'M03.2', title: '用 llm/stream waterfall 包装 chunk 流', kind: 'mechanism', path: './phases/02-llm-stream.ts' },
]

await runRealModule('M03', '推理服务接入：Provider 路由与流协议', stages, import.meta.url)
