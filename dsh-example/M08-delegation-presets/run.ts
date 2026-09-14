/**
 * M08 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M08-delegation-presets/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M08-delegation-presets/run.ts --mock     # 离线确定性机制（走 runtime/llm-mock.ts，不联网）
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
  { id: 'M08.1', title: '注册子代理 Provider，并显式包装成工具', kind: 'mechanism', path: './phases/01-delegate-a-review.ts' },
  { id: 'M08.2', title: '装配不扫描用户目录的空 preset roster', kind: 'mechanism', path: './phases/02-empty-preset-roster.ts' },
  { id: 'M08.3', title: '拒绝未隔离 shell 的权限预设', kind: 'mechanism', path: './phases/03-reject-unisolated-shell.ts' },
  { id: 'M08.4', title: '配置子代理精确模型路由', kind: 'mechanism', path: './phases/04-authorize-subagent-route.ts' },
]

await runModule('M08', '委派与预设：Provider、组合、权限与模型选择', stages, import.meta.url)
