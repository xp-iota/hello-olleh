/**
 * M02 的运行入口：**只跑真实推理服务**。
 *
 *   node M02-context-assembly-economics/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *
 * 阶段清单由 runtime/harness.ts 的 runModule() 驱动：逐阶段校验"确实发生过成功的推理服务调用"，
 * 缺证据即 fail loud；mechanism 阶段另有一次入口 probe 作为完整装配链的真实证据。
 */

import { runModule, type StageSpec } from '../runtime/harness.ts'

const stages: readonly StageSpec[] = [
  { id: 'M02.1', title: '按顺序贡献 Prompt section', kind: 'mechanism', path: './scenes/01-assemble-system-prompt.ts' },
  { id: 'M02.2', title: '变量解析与 assembly waterfall', kind: 'mechanism', path: './scenes/02-interpolate-variable.ts' },
  { id: 'M02.3', title: '压缩历史并替换模型可见 surface', kind: 'mechanism', path: './scenes/03-fold-history.ts' },
  { id: 'M02.4', title: '回放日志估算 token 压力', kind: 'mechanism', path: './scenes/04-estimate-token-pressure.ts' },
  { id: 'M02.5', title: '确定性裁剪超长工具结果', kind: 'mechanism', path: './scenes/05-prune-long-result.ts' },
  { id: 'M02.6', title: '把超长结果 spill 到本地文件', kind: 'mechanism', path: './scenes/06-spill-to-file.ts' },
]

await runModule('M02', '上下文装配与经济学：构造、改写、压缩', stages, import.meta.url)
