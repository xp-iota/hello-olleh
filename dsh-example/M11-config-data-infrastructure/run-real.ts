/**
 * M11 的**真实推理服务运行入口**：`DSH_REAL=1 node M11-config-data-infrastructure/run-real.ts`
 * （或用根目录 `npm run M11:real`；整套真实验收用 `npm run real:all`）。
 *
 * 与 `run.ts` 的区别不是"换个开关"，而是三件事同时成立：
 *   1. provider 路由固定为 anthropic-compat，缺密钥立即失败，不会静默退回 mock；
 *   2. 每个阶段结束后必须留下至少一次成功的真实调用证据，否则非零退出；
 *   3. 纯机制阶段（注册、回收、队列、状态机）在**阶段入口**先用完整装配链打一次真实
 *      请求，证明这条链真的能把模型响应送回会话日志，再跑本地机制断言。
 */
import type { StageSpec } from '../runtime/real.ts'
import { runRealModule } from '../runtime/real.ts'

const stages: readonly StageSpec[] = [
  { id: 'M11.1', title: '注册并驱动 settings 命名空间', kind: 'mechanism', path: './phases/01-settings-namespaces.ts' },
  { id: 'M11.2', title: '装配 JSON storage 与 domain 路由', kind: 'mechanism', path: './phases/02-json-storage-domain.ts' },
  { id: 'M11.3', title: '保存 content-addressed 本地附件', kind: 'mechanism', path: './phases/03-local-attachments.ts' },
  { id: 'M11.4', title: '按 Agent workspace 搜索文件引用', kind: 'mechanism', path: './phases/04-local-file-references.ts' },
  { id: 'M11.5', title: '只读取凭证状态并列出授权 flow', kind: 'mechanism', path: './phases/05-credentials-authorization.ts' },
  { id: 'M11.6', title: '组合 workspace 与耐久 Session', kind: 'mechanism', path: './phases/06-workspace-registry.ts' },
]

await runRealModule('M11', '配置与数据设施：配置、存储、附件、凭证与工作区', stages, import.meta.url)
