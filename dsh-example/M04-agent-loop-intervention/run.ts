/**
 * M04 的运行入口：**只跑真实推理服务**。
 *
 *   node M04-agent-loop-intervention/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *
 * 阶段清单由 runtime/harness.ts 的 runModule() 驱动：逐阶段校验"确实发生过成功的推理服务调用"，
 * 缺证据即 fail loud；mechanism 阶段另有一次入口 probe 作为完整装配链的真实证据。
 */

import { runModule, type StageSpec } from '../runtime/harness.ts'

const stages: readonly StageSpec[] = [
  { id: 'M04.1', title: '观察 turn/step/session 事件', kind: 'model', path: './scenes/01-observe-turn-events.ts' },
  { id: 'M04.2', title: '在生命周期边界请求 steering', kind: 'model', path: './scenes/02-steer-at-boundary.ts' },
  { id: 'M04.3', title: '比较 inbox 四种输入通道', kind: 'model', path: './scenes/03-compare-inbox-channels.ts' },
  { id: 'M04.4', title: '捕获会话遥测账本', kind: 'mechanism', path: './scenes/04-capture-telemetry-ledger.ts' },
  { id: 'M04.5', title: '注册包归属运行时不变量', kind: 'mechanism', path: './scenes/05-attribute-invariant-failure.ts' },
]

await runModule('M04', 'Agent 循环与干预面：先观察，再引导', stages, import.meta.url)
