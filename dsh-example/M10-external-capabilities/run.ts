/**
 * M10 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M10-external-capabilities/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M10-external-capabilities/run.ts --mock     # 离线确定性机制（走 runtime/llm-mock.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/real.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import type { StageSpec } from '../runtime/real.ts'
import { applyMockFlag } from '../runtime/mode.ts'

// ① 先解析 --mock。这一句必须早于 real.ts 求值：REAL_MODE 是模块级常量，
//    而静态 import 会被提升到模块体之前执行，所以 real.ts 只能动态 import。
applyMockFlag()
const { runModule } = await import('../runtime/real.ts')

const stages: readonly StageSpec[] = [
  { id: 'M10.1', title: '注册、发现并注入代码审查 Skill', kind: 'model', path: './phases/01-inject-skill-into-turn.ts' },
  { id: 'M10.2', title: '跨进程 MCP：真实成功往返与明确拒绝', kind: 'mechanism', path: './phases/02-mcp-round-trip.ts' },
  { id: 'M10.3', title: '检查 Webhook Host-plane 组合边界', kind: 'mechanism', path: './phases/03-check-webhook-boundary.ts' },
  { id: 'M10.4', title: '装配动态 Cordis 扩展工具', kind: 'mechanism', path: './phases/04-mount-dynamic-tool.ts' },
  { id: 'M10.5', title: '配置 Webhook 所需默认模型路由', kind: 'mechanism', path: './phases/05-route-default-model.ts' },

  // 专项真实演示：并入同一份阶段清单，mock 模式下打印 skip 而不是执行。
  { id: 'M10.d', title: '专项真实演示：注入 SKILL.md 前后的真实作答对照', kind: 'model', path: './real/skill-code-review-minimax.ts', realOnly: true },
]

await runModule('M10', '外部能力接入：知识、协议、Webhook 与动态扩展', stages, import.meta.url)
