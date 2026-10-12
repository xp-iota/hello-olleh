---
title: "LSP 集成：bundle 声明的语言服务器工具面"
---
# LSP 集成：bundle 声明的语言服务器工具面

> 基于 `sources/openclaw/`（openclaw `v2026.10.2`，OpenClaw Foundation）源码校对。OpenClaw 是开源个人 AI 助理网关：Gateway 常驻本机作为控制面，把 agent 桥接到 20+ 消息通道，模型 provider 与插件均可替换。

**目录**

- [1. 结论与形态](#1-结论与形态)
- [2. 自研 LSP 成帧与请求生命周期](#2-自研-lsp-成帧与请求生命周期)
- [3. 能力协商与工具化](#3-能力协商与工具化)
- [4. 生命周期与清理](#4-生命周期与清理)
- [5. 边界：刻意没有覆盖的部分](#5-边界刻意没有覆盖的部分)

---

## 1. 结论与形态

与 pi 的"完全没有 LSP"（见 [docs/hello-pi/18-lsp-integration.md](../hello-pi/18-lsp-integration.md)）不同，OpenClaw **有内建 LSP 客户端**，但形态很特别：LSP 不是给用户 IDE 用的，而是**插件 bundle 向 embedded agent 捐赠的工具面**。链路是：

1. 启用了的（Claude 兼容）bundle 通过 `.lsp.json` 或 manifest 声明的 `lspServers` 路径贡献 LSP server 配置（`src/plugins/bundle-lsp.ts:75`、`src/plugins/bundle-manifest.ts:428`），合并进 effective embedded OpenClaw LSP defaults（`docs/plugins/bundles.md:119-128`）。
2. agent run 的每次 attempt 启动时，`createBundleLspToolRuntime()`（`src/agents/agent-bundle-lsp-runtime.ts:528`）把每个 stdio LSP server 作为子进程拉起，按其 capabilities **物化成 `lsp_hover_<server>` / `lsp_definition_<server>` / `lsp_references_<server>` 三个 agent 工具**（`:450`）。
3. 只有 stdio 传输的 server 可运行；其他传输仅在 `openclaw plugins inspect` 中可见。

换言之 LSP 在 OpenClaw 里是"模型可调用的符号查询工具"，与文件读写工具并列进入 agent 的工具列表（见 [03-agent-loop.md](./03-agent-loop.md)），而非宿主编辑器协议。

## 2. 自研 LSP 成帧与请求生命周期

运行时没有引第三方 LSP 库，成帧是手写的（`agent-bundle-lsp-runtime.ts`）：

- **编码**：`encodeLspMessage()`（`:124`）拼 `Content-Length: <bytes>\r\n\r\n` + JSON，标准 LSP base protocol。
- **解析**：`parseLspMessages()`（`:188`）增量解析，头部上限 8 KB、单帧 body 上限 64 MB（`:130-131`），几何扩容缓冲避免每 chunk 全量拷贝；畸形帧置 `forceClose` 并 fail 整个 session。
- **请求**：`sendRequest()`（`:252`）每请求 10 s 超时（`:286`）；abort 时先发 `$/cancelRequest` 再本地 reject——因为多个工具共享同一 server 进程，只能取消单请求而不是杀进程。进程退出错误被缓存进 `session.failure`，后续请求立即拒绝而非干等超时。
- **初始化**：`initializeSession()`（`:365`）声明 `rootUri: null`（`:374`），客户端能力只报 hover / completion / definition / references 四项。

## 3. 能力协商与工具化

`initialize` 返回的 server capabilities 决定工具裁剪：`LspServerCapabilities` 记录 `hoverProvider` / `completionProvider` / `definitionProvider` / `referencesProvider` / `diagnosticProvider`（`:43-47`），但 `buildLspTools()`（`:489`）只物化 **hover / definition / references 三种**，且各自 filter 于 `${method}Provider` 为真。工具 schema 极简：`uri` + `line` + `character`（references 额外 `includeDeclaration`），结果是原样 `JSON.stringify` 的 text content，并在 `details` 附 `lspServer` / `lspMethod`。工具名经 normalize 后与已占用名单（内置工具 + MCP bundle 工具）去重，撞名跳过并告警。

## 4. 生命周期与清理

LSP runtime 是 **attempt 作用域**：`src/agents/embedded-agent-runner/run/attempt-bundle-tools.ts:154` 先问 `shouldCreateBundleLspRuntimeForAttempt()`（`attempt-tool-construction-plan.ts:265`，受工具 allowlist 门控），再拉起 server。取消 turn 或 compaction 会取消未完成的 LSP 启动并清理已获得的 server（`docs/plugins/bundles.md:128-130`）。dispose 走协议握手：`shutdown` 请求给 500 ms 宽限（`LSP_SHUTDOWN_GRACE_MS`，`:65`），随后写 `exit` 通知，再由 `closeOwnedStdioProcess` 以 1 s 进程树清理宽限（`:66`）确认后代终止；清理失败计入 `recordAgentCleanupFailure()`。全局兜底 `disposeAllBundleLspRuntimes()`（`:633`）遍历 active session 集合。

## 5. 边界：刻意没有覆盖的部分

| 缺位 | 说明 |
| --- | --- |
| 诊断回流 | `diagnosticProvider` 只在类型里占位（`:47`），不物化任何诊断工具；编译错误仍靠模型自己跑命令 |
| completion 工具 | 客户端能力声明了 completion，但没有对应工具——补全对 agent 无意义 |
| 文档同步 | 从不发 `textDocument/didOpen` / `didChange`；server 需要自己按 URI 读磁盘，模型传的位置必须与磁盘一致 |
| 工作区索引 | `rootUri: null`，无 workspace-wide symbol / 重命名 / 格式化 |
| 工具策略 | `toolsAllow` 可用 `bundle-lsp`、`group:plugins` 或 `lsp_*` glob 圈选（`docs/plugins/bundles.md:125-127`），每层限制都须放行 |

这个窄面是刻意取舍：OpenClaw 的 agent 跑在消息通道对面（见 [21-bridge-system.md](./21-bridge-system.md)），工具调用要经通道审批与配额约束，把 LSP 收窄成三个幂等只读查询，比拖进整套编辑协议更可控。

## 源码锚点

- [`sources/openclaw/src/agents/agent-bundle-lsp-runtime.ts`](../../sources/openclaw/src/agents/agent-bundle-lsp-runtime.ts)：LSP runtime 主体——成帧（`:124-131`）、`sendRequest`（`:252`）、工具物化（`:443-510`）、`createBundleLspToolRuntime`（`:528`）
- [`sources/openclaw/src/agents/agent-bundle-lsp-process.ts`](../../sources/openclaw/src/agents/agent-bundle-lsp-process.ts)：LSP 子进程 spawn（环境消毒 + Windows wrapper 处理）
- [`sources/openclaw/src/plugins/bundle-lsp.ts`](../../sources/openclaw/src/plugins/bundle-lsp.ts)：从插件 bundle 加载 `lspServers` / `.lsp.json`
- [`sources/openclaw/src/plugins/bundle-manifest.ts`](../../sources/openclaw/src/plugins/bundle-manifest.ts)：bundle 检测与 `.lsp.json` 组件路径（`:428`）
- [`sources/openclaw/src/agents/embedded-agent-runner/run/attempt-bundle-tools.ts`](../../sources/openclaw/src/agents/embedded-agent-runner/run/attempt-bundle-tools.ts)：attempt 内 MCP/LSP 工具装配（`:154`）
- [`sources/openclaw/docs/plugins/bundles.md`](../../sources/openclaw/docs/plugins/bundles.md)：Embedded OpenClaw LSP 上游说明（`:119-130`）
