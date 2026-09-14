/**
 * M01 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M01-tool-pipeline/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M01-tool-pipeline/run.ts --mock     # 离线确定性机制（走 runtime/llm-mock.ts，不联网）
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
  { id: 'M01.1', title: '注册工具与 Fiber 回收', kind: 'mechanism', path: './phases/01-register-and-dispose.ts' },
  { id: 'M01.2', title: 'pre-execute 权限门', kind: 'mechanism', path: './phases/02-deny-bash-call.ts' },
  { id: 'M01.3', title: 'post-execute 结果变换', kind: 'mechanism', path: './phases/03-append-model-notice.ts' },
  { id: 'M01.4', title: '按 Agent 收紧可见工具', kind: 'mechanism', path: './phases/04-narrow-visible-set.ts' },
  { id: 'M01.5', title: '不可翻案的单调守卫', kind: 'mechanism', path: './phases/05-guard-overrides-allow.ts' },

  // 专项真实演示：并入同一份阶段清单，mock 模式下打印 skip 而不是执行。
  { id: 'M01.d', title: '专项真实演示：模型自主决定调用 word_count', kind: 'model', path: './real/word-count-minimax.ts', realOnly: true },
]

await runModule('M01', '工具管线：从注册、可见性到执行前后策略', stages, import.meta.url)
