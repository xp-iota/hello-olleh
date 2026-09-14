/**
 * M06 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M06-human-in-the-loop/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M06-human-in-the-loop/run.ts --mock     # 离线确定性机制（走 runtime/llm-mock.ts，不联网）
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
  { id: 'M06.1', title: '人类斜杠命令直接进入宿主', kind: 'mechanism', path: './phases/01-dispatch-slash-command.ts' },
  { id: 'M06.2', title: '工具 ask 请求进入审批 seam', kind: 'model', path: './phases/02-three-approval-outcomes.ts' },
  { id: 'M06.3', title: '结构化问题进入宿主 answerer', kind: 'mechanism', path: './phases/03-answer-structured-questions.ts' },
  { id: 'M06.4', title: '用日志投影切换计划模式', kind: 'mechanism', path: './phases/04-toggle-plan-mode.ts' },
  { id: 'M06.5', title: '整体替换 todo 列表', kind: 'mechanism', path: './phases/05-replace-todo-list.ts' },
  { id: 'M06.6', title: '读取耐久消息反馈', kind: 'mechanism', path: './phases/06-read-durable-feedback.ts' },
]

await runModule('M06', '人在环路：显式命令与执行审批', stages, import.meta.url)
