/**
 * M05 的运行入口：**只跑真实推理服务**。
 *
 *   node M05-session-surface/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *
 * 阶段清单由 runtime/harness.ts 的 runModule() 驱动：逐阶段校验"确实发生过成功的推理服务调用"，
 * 缺证据即 fail loud；mechanism 阶段另有一次入口 probe 作为完整装配链的真实证据。
 */

import { runModule, type StageSpec } from '../runtime/harness.ts'

const stages: readonly StageSpec[] = [
  { id: 'M05.1', title: '验证会话日志和模型可见面的不变量', kind: 'model', path: './scenes/01-check-log-invariants.ts' },
  { id: 'M05.2', title: '装载 JSONL persistence Provider', kind: 'mechanism', path: './scenes/02-load-jsonl-provider.ts' },
  { id: 'M05.3', title: '查询 live-preferred 会话语料', kind: 'mechanism', path: './scenes/03-list-live-preferred.ts' },
  { id: 'M05.4', title: '耐久化 projection checkpoint', kind: 'mechanism', path: './scenes/04-resume-from-checkpoint.ts' },
  { id: 'M05.5', title: '把标题写成 latest-wins 日志事件', kind: 'mechanism', path: './scenes/05-project-title.ts' },
]

await runModule('M05', '会话面：日志、持久化、查询、投影与标题', stages, import.meta.url)
