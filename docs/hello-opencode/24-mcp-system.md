---
title: "MCP 系统：client、传输、OAuth 与指令注入"
---
# MCP 系统：client、传输、OAuth 与指令注入

> 基于 `sources/opencode/packages/core/src/mcp/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. MCP 在 v2 的位置](#1-mcp-在-v2-的位置)
- [2. client 契约](#2-client-契约)
- [3. stdio 传输](#3-stdio-传输)
- [4. remote 与 OAuth](#4-remote-与-oauth)
- [5. elicitation 与 roots](#5-elicitation-与-roots)
- [6. MCP 指引注入](#6-mcp-指引注入)

---

## 1. MCP 在 v2 的位置

MCP 是动态工具与指引的来源：`packages/core/src/mcp/`（`client.ts`、`stdio.ts`、`oauth.ts`、`instructions.ts`、`index.ts`），动态工具经 `tool/mcp.ts` 转成与内建同构的结构工具进入注册管线（见 [05-tool-system.md](./05-tool-system.md)）。server 配置形状在 `packages/schema/src/mcp.ts`（`ConfigMCP.Server`），CLI 管理命令为 `opencode mcp list/add/auth/logout`。

## 2. client 契约

`McpClient.connect(server, config, directory, authProvider?, elicitation?, clientInfo?)` 返回 `Connection`：

| 方法 | 语义 |
| --- | --- |
| `tools()` / `prompts()` / `resources()` / `resourceTemplates()` | server 未广告对应能力时返回 `[]`；传输错误则失败 |
| `readResource({ uri })` | 未支持 resource 时返回 `undefined` |
| `prompt({ name, args })` / `callTool({ name, args, sessionID? })` | 调用；**中断会中止在途请求** |
| `instructions` | initialize 结果里 server 自带的使用说明 |
| `onClose` / `onLog` | 关闭与日志通知回调 |
| `onToolsChanged` / `onPromptsChanged` / `onResourcesChanged` | 目录变更通知；server 不支持时为 no-op |

超时默认：启动 30s、目录列举 30s、执行 12h。列表结果用 `TolerantListToolsResult` 容错解析。关闭调用方 Scope 即拆除传输与派生进程。

## 3. stdio 传输

`mcp/stdio.ts` 的关键参数：`OUTGOING_CAPACITY = 64`（出站有界队列）、`MAX_FRAME_BYTES = 16 MiB`、关闭宽限 2s 后强杀（2s）。**stdio server 经所在 Location 的 `Environment` 派生**——它运行在该 Location 的执行平面上（与 shell 命令同平面），而不是永远在 host 上，这与 Location 作用域模型一致。

## 4. remote 与 OAuth

- remote 传输才消费 `authProvider`；stdio 无认证概念。无存储 token（且 redirect 为 no-op）时 surface `UnauthorizedError`，映射为 `needs_auth`（`NeedsAuthError`）。
- `oauth.ts` 提供 client metadata URL（`https://opencode.ai/oauth/opencode/client.json`）与 `loggedFetch`：按 `grant_type` 区分 `exchange` / `refresh`，记录状态码与耗时，解析错误响应——OAuth 交互全程可观测。
- `Store` 接口抽象 token 存储。

## 5. elicitation 与 roots

- 传入 `elicitation` handler 时声明 elicitation 能力（`form.applyDefaults: true` + `url`）。
- client 固定声明 `roots` 能力并应答 `ListRootsRequestSchema`，返回当前工作目录的 file URL——MCP server 借此感知工作区根。

## 6. MCP 指引注入

`mcp/instructions.ts` 把每个 server 的 `instructions` 渲染成 `<mcp_instructions>` 块进入 instruction 谱系（见 [11-prompt-system.md](./11-prompt-system.md)）。渲染规则：

- 每个 server 一段 `<server name="...">`，正文逐行缩进；
- 除非该 server 被标记 `codemode: false`，否则追加指引"经 `execute` 使用此 server 的工具"，命名空间来自 `McpTool.namespace(server)`——即 Code Mode 下 MCP 工具经 `execute` 调用而非逐个广告（`plugin/mcp-codemode-exclusion.ts` 承载互斥规则）。

## 源码锚点

- [`sources/opencode/packages/core/src/mcp/client.ts`](../../sources/opencode/packages/core/src/mcp/client.ts)：`Connection` 契约与连接
- [`sources/opencode/packages/core/src/mcp/stdio.ts`](../../sources/opencode/packages/core/src/mcp/stdio.ts)：stdio 传输参数
- [`sources/opencode/packages/core/src/mcp/oauth.ts`](../../sources/opencode/packages/core/src/mcp/oauth.ts)：OAuth 与可观测 fetch
- [`sources/opencode/packages/core/src/mcp/instructions.ts`](../../sources/opencode/packages/core/src/mcp/instructions.ts)：指引渲染
- [`sources/opencode/packages/core/src/tool/mcp.ts`](../../sources/opencode/packages/core/src/tool/mcp.ts)：动态工具转换
