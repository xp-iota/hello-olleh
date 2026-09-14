/**
 * M03 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M03-inference-service-access/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M03-inference-service-access/run.ts --mock     # 离线确定性机制（走 runtime/llm-mock.ts，不联网）
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
  { id: 'M03.1', title: '注册并消费离线 LLM Adapter', kind: 'mechanism', path: './phases/01-consume-chunk-protocol.ts' },
  { id: 'M03.2', title: '用 llm/stream waterfall 包装 chunk 流', kind: 'mechanism', path: './phases/02-wrap-chunk-stream.ts' },

  // 专项真实演示：并入同一份阶段清单，mock 模式下打印 skip 而不是执行。
  { id: 'M03.d', title: '专项真实演示：同一消费循环接真实推理服务', kind: 'model', path: './real/llm-adapter-minimax.ts', realOnly: true },
]

await runModule('M03', '推理服务接入：Provider 路由与流协议', stages, import.meta.url)
