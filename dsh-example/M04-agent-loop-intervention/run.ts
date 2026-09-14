/**
 * M04 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M04-agent-loop-intervention/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M04-agent-loop-intervention/run.ts --mock     # 离线确定性机制（走 runtime/llm-mock.ts，不联网）
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
  { id: 'M04.1', title: '观察 turn/step/session 事件', kind: 'model', path: './phases/01-observe-turn-events.ts' },
  { id: 'M04.2', title: '在生命周期边界请求 steering', kind: 'model', path: './phases/02-steer-at-boundary.ts' },
  { id: 'M04.3', title: '比较 inbox 四种输入通道', kind: 'model', path: './phases/03-compare-inbox-channels.ts' },
  { id: 'M04.4', title: '捕获会话遥测账本', kind: 'mechanism', path: './phases/04-capture-telemetry-ledger.ts' },
  { id: 'M04.5', title: '注册包归属运行时不变量', kind: 'mechanism', path: './phases/05-attribute-invariant-failure.ts' },
]

await runModule('M04', 'Agent 循环与干预面：先观察，再引导', stages, import.meta.url)
