/**
 * M05 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M05-session-surface/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M05-session-surface/run.ts --mock     # 离线确定性机制（走 runtime/llm.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/harness.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import { applyMockFlag, runModule, type StageSpec } from '../runtime/harness.ts'

// 静态 import 共享同一份可变模式状态；执行模块前先应用 --mock。
applyMockFlag()

const stages: readonly StageSpec[] = [
  { id: 'M05.1', title: '验证会话日志和模型可见面的不变量', kind: 'model', path: './phases/01-check-log-invariants.ts' },
  { id: 'M05.2', title: '装载 JSONL persistence Provider', kind: 'mechanism', path: './phases/02-load-jsonl-provider.ts' },
  { id: 'M05.3', title: '查询 live-preferred 会话语料', kind: 'mechanism', path: './phases/03-list-live-preferred.ts' },
  { id: 'M05.4', title: '耐久化 projection checkpoint', kind: 'mechanism', path: './phases/04-resume-from-checkpoint.ts' },
  { id: 'M05.5', title: '把标题写成 latest-wins 日志事件', kind: 'mechanism', path: './phases/05-project-title.ts' },
]

await runModule('M05', '会话面：日志、持久化、查询、投影与标题', stages, import.meta.url)
