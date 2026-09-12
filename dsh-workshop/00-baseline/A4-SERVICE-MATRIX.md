# A4 服务与能力缝矩阵

> 状态：A4 实施与验收契约。基线提交 `f84f1568`；DSH 源码 revision `fb2c4b9e69`，Cordis revision `f8ea3cd`。

## 口径

- 官方 `tool-cordis/src/api-catalog.ts` 在上述 DSH revision 中给出 **71 个 Service API key**、68 个 Event API。
- PLAN §3.2 的“服务覆盖”是教学工程的**公开扩展面覆盖**：既含 Cordis `Service` key，也含函数式 capability seam（如 `todo`、`schedule`、`mcp`）和 M12 框架机制。原因是 §3.2 本身把这三类放在同一“新纳入的缝”列。
- 可执行门禁 `npm run coverage:a4` 固化口径：A3 基线 25 个 + A4 新增 34 个 = **59 个**，要求 ≥50；不把明确排除的 `fileUploads` 算入 59。
- 状态分四类：**运行**（离线实际激活/调用）、**拒绝**（真实 fail-loud 路径）、**边界**（列出完整组合依赖但不装复杂 Host plane）、**排除**（PLAN §3.4 明确不做）。

## A4 新增矩阵

| 模块 | 服务/缝 | Definition / Provider / Consumer | 包 | 默认离线策略 | 状态与验收 |
|---|---|---|---|---|---|
| M02 | `tokenMeter` | Service + session projection consumer | `dsh-token-meter` | 回放本地 Session | 运行；输出 surface/total tokens |
| M02 | `toolResultPruner` | Service，消费 `tokenMeter` | `dsh-compaction-tool-result-pruner` | 纯内存 Unicode 文本 | 运行；112→55 code points |
| M02 | `spillStore` | Definition + Local Provider + policy | `dsh-spill*`、`dsh-output-retention` | 私有临时目录，阶段后删除 | 运行；255-byte 预览 + locator |
| M04 | `sessionTelemetry` | 抽象 Definition + Memory Provider + Coordinator | `dsh-session-telemetry` | 只写内存，不发网络 | 运行；捕获 ledger record |
| M04 | `invariants` | Service registry | `dsh-invariants` | 本地 installer | 运行；包 allowlist 生效 |
| M05 | `sessionPersistence` | Definition + JSONL Provider | `dsh-session-persistence*` | 临时 JSONL、无压缩 | 运行；list 可读 |
| M05 | `sessionQuery` | 抽象 Definition + exact-read demo Provider | `dsh-session-query` | live-preferred；全文检索明确拒绝 | 运行；读到 live Session |
| M05 | `sessionProjectionCache` | Service + JSON storage domain | `dsh-session-projection-cache` | 临时 JSON backend | 运行；checkpoint 可回读 |
| M05 | `sessionTitle` | Service + log projection | `dsh-session-title` | 用户 rename，不调用模型 | 运行；latest-wins 折叠 |
| M06 | `userQuestions` | Service + waterfall answerer | `dsh-user-questions` | 进程内固定 answerer | 运行；结构化 answer |
| M06 | `planMode` | Service + tool/prompt/projection consumers | `dsh-plan-mode` | mock Agent | 运行；状态 committed |
| M06 | `todo` | 函数式 tool + projection | `dsh-tool-todo` | 整表替换 | 运行；todos projection 可读 |
| M06 | `messageFeedback` | Service + JSONL persistence | `dsh-message-feedback`、`dsh-command-feedback` | 空反馈列表 | 运行；durable list 成功 |
| M07 | `terminals` | Service registry；bash Provider 可选 | `dsh-terminal*` | 不批准原生 install scripts | 拒绝；稳定 `NO_BACKEND` |
| M07 | `sandboxPolicy` | Service + session projection | `dsh-sandbox-policy` | read-only 默认 | 运行；日志 override 生效 |
| M08 | `agentPresets` | Service + Cordis Loader | `dsh-agent-presets`、`cordis-plugin-loader` | 空 roots，不扫描用户目录 | 运行；空 roster |
| M08 | `permissionPresets` | Service，要求 confining shell | `dsh-permission-presets` | 当前 shell 无 confinement | 拒绝；misconfiguration fail-loud |
| M08 | `subagentModelSelection` | Host settings Service | `dsh-tool-subagent/model-selection-settings` | 只授权 mock/mock-1 | 运行；精确路由可读 |
| M09 | `workflowEngine` | Definition + worker-thread Provider | `dsh-workflow*` | 本地 worker，固定 Provider | 运行；返回 42 |
| M09 | `schedule` | 函数式 consumer | `dsh-schedule` | JSONL Session，无定时外部调用 | 运行；3 个工具可见 |
| M10 | `mcp` | 函数式 MCP client | `dsh-mcp-client` | 不存在的本地 stdio 命令 | 拒绝；不联网，startup fail-loud |
| M10 | `webhookRuntime` | Host Service | `dsh-webhook` | 列出全部 static inject，不装 Host plane | 边界；缺失项显式输出 |
| M10 | `extensions` | Dynamic runner + inspect + tool consumer | `dsh-cordis-host-runner`、`dsh-tool-cordis` | 本地 VM/registry | 运行；7 个 Cordis 工具 |
| M10 | `agentDefaultModel` | Webhook 支持 Service | `dsh-agent-default-model` | mock 路由，不读凭证 | 运行；currentSelection 可读 |
| M11 | `storage` | Service hub + JSON backend | `dsh-storage`、`dsh-storage-json` | 临时根目录 | 运行；backend 可解析 |
| M11 | `storageDomain` | 函数式 domain facility | `dsh-storage-domain` | 显式路由 `json` | 运行；facility 可用 |
| M11 | `attachments` | Definition + Local Provider | `dsh-attachment*` | 临时 dshHome | 运行；content-addressed 文件 |
| M11 | `fileReferences` | Definition + Local Provider | `dsh-file-reference*` | 当前 workspace 索引 | 运行；README 候选可见 |
| M11 | `credentials` | Definition + Local Provider | `dsh-credentials*` | 只 describe 未设置引用 | 运行；不读取/打印 secret |
| M11 | `authorization` | Service + credential consumer | `dsh-authorization` | 无 flow | 运行；安全列举空表 |
| M11 | `workspaceRegistry` | Service + domain/persistence consumers | `dsh-workspace` | 临时 storage/session roots | 运行；空 registry |
| M11 | `fileUploads` | Client Host Service | `dsh-client-file-upload` | 依赖 connection/Host 传输面 | **排除**；不计覆盖数 |
| M12 | Fiber 状态机 | Cordis core | `@deepseek-ai/cordis` | 本地延迟依赖 | 运行；PENDING→ACTIVE→DISPOSED |
| M12 | isolate realm | Cordis core | `@deepseek-ai/cordis` | 两个本地 realm | 运行；同名服务隔离 |
| M12 | intercept 配置链 | Cordis core | `@deepseek-ai/cordis` | 调用域配置 | 运行；base/scoped 不同 |

## 依赖闭包

- 所有 `@deepseek-ai/dsh-*` 直接依赖精确锁定 `0.1.5-rc.2`。
- 发布包运行时缺口已显式补齐：`dsh-anonymous-user-id`、`dsh-cordis-host-runner`、`dsh-launch-environment` 均为 `0.1.5-rc.2`；Cordis loader/include 分别为 `1.0.3` / `1.0.7`。
- npm 安全策略没有批准 `dsh-subprocess-local`、`koffi`、`node-pty` 的安装脚本；A4 不绕过该策略。

## 显式排除

保持 PLAN §3.4：client/web/desktop 宿主、typert + api-gateway Host/Remote、e2b/code-runtime、agent-team、lsp、identity/guard/独立 feedback 不纳入 A4。`fileUploads` 虽在 §3.2 M11 行中，但其真实包是 client Host 服务且强依赖 connection，因此服从更具体的 §3.4 排除规则。
