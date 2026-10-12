---
title: "MCP 系统深挖：pi-mcp 客户端与 coding-agent 的 mcp 扩展"
---
# MCP 系统深挖：pi-mcp 客户端与 coding-agent 的 mcp 扩展

> 基于 `sources/pi/packages/mcp/`（client / protocol / transports / oauth）与 `packages/coding-agent/src/extensions/mcp/` 校对（pi `v1.1.0`）。

**目录**

- [1. 独立客户端，无官方 SDK](#1-独立客户端无官方-sdk)
- [2. McpClient：握手、分页与超时](#2-mcpclient握手分页与超时)
- [3. 传输三件与 JSON-RPC 帧](#3-传输三件与-json-rpc-帧)
- [4. OAuth：discovery + PKCE + pi.dev 元数据](#4-oauthdiscovery--pkce--pidev-元数据)
- [5. coding-agent 的 mcp 扩展](#5-coding-agent-的-mcp-扩展)
- [6. mcp-conformance 一致性测试](#6-mcp-conformance-一致性测试)

---

## 1. 独立客户端，无官方 SDK

`@earendil-works/pi-mcp` 是**自实现的 MCP 客户端**，不依赖 `@modelcontextprotocol/sdk`（外部依赖仅 `cross-spawn`）。协议层（JSON-RPC 编解码、typed 请求/响应/通知）与传输层全部手写，因此可以脱离 coding-agent 单独发布使用，也把编码约束（erasable TS、精确锁定依赖）延伸到了 MCP 生态边界。

## 2. McpClient：握手、分页与超时

`src/client.ts`（615 行）的 `McpClient`：

- **initialize 握手**：connect 时完成 MCP `initialize` 版本协商；
- **分页列举**：`listTools` / `listResources` / `listResourceTemplates` 循环翻页，上限 `MAX_LIST_PAGES = 1000`（`:39`，超页抛错）；
- **callTool**：`callTool(name, args, { signal, timeoutMs, onProgress })`，请求超时默认 `DEFAULT_REQUEST_TIMEOUT_MS = 30_000`（`:38`），进度经 `onProgress` 回调上抛；另有 notification / error / close 监听器。

## 3. 传输三件与 JSON-RPC 帧

| 传输 | 文件 | 用途 |
| --- | --- | --- |
| stdio | `transports/stdio.ts` | 子进程 stdin/stdout（`cross-spawn`） |
| streamable-http | `transports/streamable-http.ts` | Streamable HTTP，fetch 可注入（便于测试/代理） |
| in-memory | `transports/in-memory.ts` | 进程内直连，测试用 |

帧协议在 `protocol/jsonrpc.ts`（JSON-RPC 编解码）+ `protocol/types.ts`（typed 协议对象），传输基类契约 `transports/transport.ts`。

## 4. OAuth：discovery + PKCE + pi.dev 元数据

远程 server 的 OAuth 全套在 `src/oauth/`：

- `discovery.ts`：RFC 9728 式 `.well-known/oauth-authorization-server` 发现；
- `flow.ts`：authorization-code + **PKCE** 流程；
- `callback.ts`：本地回调 server 接 code；
- `provider.ts`：provider 配置。

coding-agent 侧把 client-id 元数据指向云端：`CLIENT_METADATA_BASE_URL = "https://pi.dev/oauth"`（`src/extensions/mcp/oauth.ts:42`），由 pi.dev 代管 client.json 与回调 ID 的元数据文档——pi 的 MCP OAuth 因此无需用户自建 client_id。

## 5. coding-agent 的 mcp 扩展

`src/extensions/mcp/` 是内置可替换扩展（第三方同名扩展可覆盖它）：

- **配置**：`~/.pi/agent/mcp.json`（全局）+ 项目 `.pi/mcp.json`（需 project trust），schema 校验在 `core/mcp-servers.ts`；
- **运行时**：`runtime.ts` 管理连接生命周期与重连；`resources.ts` 暴露 MCP resources；重加载走 `cli.lazy.ts` / `runtime.lazy.ts` 显式懒加载（符合仓库"禁动态 import、用 `.lazy.ts`"约束）；
- **工具命名空间**：MCP 工具注册为 `mcp__<server>__<tool>`，非法字符清洗、超长名截断加 hash 后缀（`tools.ts:89`）；默认 `exposure: "codemode"`——MCP 工具默认只暴露给 codemode 沙箱脚本而非模型直调（`index.ts:9` 注释）；
- **toLlmContent**：`packages/mcp/src/protocol/content.ts:111` 把 `CallToolResult` 内容块转成 pi-ai 的 `TextContent` / `ImageContent`（嵌入的 text/image resource 解包，audio/链接/二进制置占位符），MCP 工具因此可包装成 `AgentTool` 直接产出模型可见结果；
- **UI/CLI**：交互内 `/mcp` 打开管理器（登录、重连、启停 server）；命令行 `pi mcp` 子命令读写 mcp.json（`cli.ts`，`-l` 选项目文件）。

## 6. mcp-conformance 一致性测试

`packages/coding-agent/test/mcp-conformance/`（`baseline.json`、`client.ts`、`run.ts`、`README.md`）是一套独立于 vitest 单测的一致性 harness：以固定 baseline 驱动真实 MCP server，校验 pi-mcp 客户端行为（握手、分页、callTool 语义）不漂移。配合 pi-mcp 自带的 `in-memory` 传输，构成"协议层单测 + 端到端一致性"两层验证。

## 源码锚点

- [`sources/pi/packages/mcp/src/client.ts`](../../sources/pi/packages/mcp/src/client.ts)：`McpClient`（超时 `:38`、分页 `:39`）
- [`sources/pi/packages/mcp/src/protocol/content.ts`](../../sources/pi/packages/mcp/src/protocol/content.ts)：`toLlmContent`（`:111`）
- [`sources/pi/packages/mcp/src/transports/stdio.ts`](../../sources/pi/packages/mcp/src/transports/stdio.ts)：stdio 传输
- [`sources/pi/packages/mcp/src/oauth/flow.ts`](../../sources/pi/packages/mcp/src/oauth/flow.ts)：PKCE 流程
- [`sources/pi/packages/coding-agent/src/extensions/mcp/tools.ts`](../../sources/pi/packages/coding-agent/src/extensions/mcp/tools.ts)：`mcp__*` 命名空间（`:89`）
- [`sources/pi/packages/coding-agent/test/mcp-conformance/README.md`](../../sources/pi/packages/coding-agent/test/mcp-conformance/README.md)：一致性测试说明
