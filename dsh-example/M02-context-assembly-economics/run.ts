/**
 * M02 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M02-context-assembly-economics/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M02-context-assembly-economics/run.ts --mock     # 离线确定性机制（走 runtime/llm.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/harness.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import { applyMockFlag, runModule, type StageSpec } from '../runtime/harness.ts'

// 静态 import 共享同一份可变模式状态；执行模块前先应用 --mock。
applyMockFlag()

const stages: readonly StageSpec[] = [
  { id: 'M02.1', title: '按顺序贡献 Prompt section', kind: 'mechanism', path: './phases/01-assemble-system-prompt.ts' },
  { id: 'M02.2', title: '变量解析与 assembly waterfall', kind: 'mechanism', path: './phases/02-interpolate-variable.ts' },
  { id: 'M02.3', title: '压缩历史并替换模型可见 surface', kind: 'mechanism', path: './phases/03-fold-history.ts' },
  { id: 'M02.4', title: '回放日志估算 token 压力', kind: 'mechanism', path: './phases/04-estimate-token-pressure.ts' },
  { id: 'M02.5', title: '确定性裁剪超长工具结果', kind: 'mechanism', path: './phases/05-prune-long-result.ts' },
  { id: 'M02.6', title: '把超长结果 spill 到本地文件', kind: 'mechanism', path: './phases/06-spill-to-file.ts' },
]

await runModule('M02', '上下文装配与经济学：构造、改写、压缩', stages, import.meta.url)
