/**
 * M06 的运行入口：**只跑真实推理服务**。
 *
 *   node M06-human-in-the-loop/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *
 * 阶段清单由 runtime/harness.ts 的 runModule() 驱动：逐阶段校验"确实发生过成功的推理服务调用"，
 * 缺证据即 fail loud；mechanism 阶段另有一次入口 probe 作为完整装配链的真实证据。
 */

import { runModule, type StageSpec } from '../runtime/harness.ts'

const stages: readonly StageSpec[] = [
  { id: 'M06.1', title: '人类斜杠命令直接进入宿主', kind: 'mechanism', path: './scenes/01-dispatch-slash-command.ts' },
  { id: 'M06.2', title: '工具 ask 请求进入审批 seam', kind: 'model', path: './scenes/02-three-approval-outcomes.ts' },
  { id: 'M06.3', title: '结构化问题进入宿主 answerer', kind: 'mechanism', path: './scenes/03-answer-structured-questions.ts' },
  { id: 'M06.4', title: '用日志投影切换计划模式', kind: 'mechanism', path: './scenes/04-toggle-plan-mode.ts' },
  { id: 'M06.5', title: '整体替换 todo 列表', kind: 'mechanism', path: './scenes/05-replace-todo-list.ts' },
  { id: 'M06.6', title: '读取耐久消息反馈', kind: 'mechanism', path: './scenes/06-read-durable-feedback.ts' },
]

await runModule('M06', '人在环路：显式命令与执行审批', stages, import.meta.url)
