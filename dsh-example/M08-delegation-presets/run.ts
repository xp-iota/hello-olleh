/**
 * M08 的运行入口：**只跑真实推理服务**。
 *
 *   node M08-delegation-presets/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *
 * 阶段清单由 runtime/harness.ts 的 runModule() 驱动：逐阶段校验"确实发生过成功的推理服务调用"，
 * 缺证据即 fail loud；mechanism 阶段另有一次入口 probe 作为完整装配链的真实证据。
 */

import { runModule, type StageSpec } from '../runtime/harness.ts'

const stages: readonly StageSpec[] = [
  { id: 'M08.1', title: '注册子代理 Provider，并显式包装成工具', kind: 'mechanism', path: './scenes/01-delegate-a-review.ts' },
  { id: 'M08.2', title: '装配不扫描用户目录的空 preset roster', kind: 'mechanism', path: './scenes/02-empty-preset-roster.ts' },
  { id: 'M08.3', title: '拒绝未隔离 shell 的权限预设', kind: 'mechanism', path: './scenes/03-reject-unisolated-shell.ts' },
  { id: 'M08.4', title: '配置子代理精确模型路由', kind: 'mechanism', path: './scenes/04-authorize-subagent-route.ts' },
]

await runModule('M08', '委派与预设：Provider、组合、权限与模型选择', stages, import.meta.url)
