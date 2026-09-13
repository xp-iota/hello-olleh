/**
 * M10 的**真实 MiniMax 运行入口**：`DSH_REAL=1 node M10-external-capabilities/run-real.ts`
 * （或用根目录 `npm run M10:real`；整套真实验收用 `npm run real:all`）。
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
  { id: 'M10.1', title: '注册、发现并注入代码审查 Skill', kind: 'model', path: './phases/01-skill-code-review.ts' },
  { id: 'M10.2', title: '跨进程 MCP：真实成功往返与明确拒绝', kind: 'mechanism', path: './phases/02-mcp-client.ts' },
  { id: 'M10.3', title: '检查 Webhook Host-plane 组合边界', kind: 'mechanism', path: './phases/03-webhook-runtime.ts' },
  { id: 'M10.4', title: '装配动态 Cordis 扩展工具', kind: 'mechanism', path: './phases/04-cordis-extensions.ts' },
  { id: 'M10.5', title: '配置 Webhook 所需默认模型路由', kind: 'mechanism', path: './phases/05-agent-default-model.ts' },
]

await runRealModule('M10', '外部能力接入：知识、协议、Webhook 与动态扩展', stages, import.meta.url)
