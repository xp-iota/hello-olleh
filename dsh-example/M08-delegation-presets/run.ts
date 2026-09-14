/**
 * M08 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M08-delegation-presets/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M08-delegation-presets/run.ts --mock     # 离线确定性机制（走 runtime/llm.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/harness.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import { applyMockFlag, runModule, type StageSpec } from '../runtime/harness.ts'

// 静态 import 共享同一份可变模式状态；执行模块前先应用 --mock。
applyMockFlag()

const stages: readonly StageSpec[] = [
  { id: 'M08.1', title: '注册子代理 Provider，并显式包装成工具', kind: 'mechanism', path: './phases/01-delegate-a-review.ts' },
  { id: 'M08.2', title: '装配不扫描用户目录的空 preset roster', kind: 'mechanism', path: './phases/02-empty-preset-roster.ts' },
  { id: 'M08.3', title: '拒绝未隔离 shell 的权限预设', kind: 'mechanism', path: './phases/03-reject-unisolated-shell.ts' },
  { id: 'M08.4', title: '配置子代理精确模型路由', kind: 'mechanism', path: './phases/04-authorize-subagent-route.ts' },
]

await runModule('M08', '委派与预设：Provider、组合、权限与模型选择', stages, import.meta.url)
