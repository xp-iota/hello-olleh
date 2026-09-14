/**
 * M11 的运行入口：**默认真实**，`--mock` 离线。
 *
 *   node M11-config-data-infrastructure/run.ts            # 真实推理服务（需 LLM_API_KEY，会发起网络请求）
 *   node M11-config-data-infrastructure/run.ts --mock     # 离线确定性机制（走 runtime/llm.ts，不联网）
 *
 * 两个模式共用下面这份阶段清单，由 runtime/harness.ts 的 runModule() 分叉：
 * 真实模式逐阶段校验"确实发生过成功的推理服务调用"，缺证据即 fail loud；
 * mock 模式只跑离线阶段，`realOnly` 的专项演示打印 skip。
 */
import { applyMockFlag, runModule, type StageSpec } from '../runtime/harness.ts'

// 静态 import 共享同一份可变模式状态；执行模块前先应用 --mock。
applyMockFlag()

const stages: readonly StageSpec[] = [
  { id: 'M11.1', title: '注册并驱动 settings 命名空间', kind: 'mechanism', path: './phases/01-settings-cas-conflict.ts' },
  { id: 'M11.2', title: '装配 JSON storage 与 domain 路由', kind: 'mechanism', path: './phases/02-route-storage-domain.ts' },
  { id: 'M11.3', title: '保存 content-addressed 本地附件', kind: 'mechanism', path: './phases/03-store-attachment.ts' },
  { id: 'M11.4', title: '按 Agent workspace 搜索文件引用', kind: 'mechanism', path: './phases/04-search-workspace-refs.ts' },
  { id: 'M11.5', title: '只读取凭证状态并列出授权 flow', kind: 'mechanism', path: './phases/05-list-authorization-flows.ts' },
  { id: 'M11.6', title: '组合 workspace 与耐久 Session', kind: 'mechanism', path: './phases/06-combine-workspace-session.ts' },
]

await runModule('M11', '配置与数据设施：配置、存储、附件、凭证与工作区', stages, import.meta.url)
