/**
 * M12 的运行入口：**只跑真实推理服务**。
 *
 *   node M12-framework-mechanisms/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *
 * 阶段清单由 runtime/harness.ts 的 runModule() 驱动：逐阶段校验"确实发生过成功的推理服务调用"，
 * 缺证据即 fail loud；mechanism 阶段另有一次入口 probe 作为完整装配链的真实证据。
 */

import { runModule, type StageSpec } from '../runtime/harness.ts'

const stages: readonly StageSpec[] = [
  { id: 'M12.1', title: '对照五种事件派发模式', kind: 'mechanism', path: './scenes/01-compare-dispatch-modes.ts' },
  { id: 'M12.2', title: '验证绑定 Fiber 的可处置定时器', kind: 'model', path: './scenes/02-dispose-pending-timer.ts' },
  { id: 'M12.3', title: '观察 Fiber 依赖状态机', kind: 'mechanism', path: './scenes/03-observe-pending-state.ts' },
  { id: 'M12.4', title: '隔离同名服务 realm', kind: 'mechanism', path: './scenes/04-isolate-same-name-service.ts' },
  { id: 'M12.5', title: '叠加调用域 intercept 配置', kind: 'mechanism', path: './scenes/05-layer-intercept-config.ts' },
]

await runModule('M12', '框架机制本体：事件语义与生命周期资源', stages, import.meta.url)
