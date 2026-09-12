---
layout: content
title: "OpenCode 深度专题 B13：MCP，Model Context Protocol 扩展系统的全部实现细节"
---
# OpenCode 深度专题 B13：MCP，Model Context Protocol 扩展系统的全部实现细节

> 本文基于 `sources/opencode/packages/opencode/package.json` 中的 OpenCode `v1.4.14` 源码校对

B09 里把 MCP 定位为"扩展面之一"，但那篇只讲了它产出 tool/prompt/resource，没有展开内部实现。B13 的任务是把 MCP 的全部实现细节拆清楚：状态机、认证、远程/本地两类传输、tool 投影，以及 OAuth 完整流程。

---

**目录**

- [1. MCP 在 OpenCode 里到底是什么](#1-mcp-在-opencode-里到底是什么)
- [2. 五状态状态机](#2-五状态状态机)
- [3. 两类 MCP Server 的连接方式](#3-两类-mcp-server-的连接方式)
- [4. Tool 的投影过程](#4-tool-的投影过程)
- [5. Prompt 和 Resource 的投影](#5-prompt-和-resource-的投影)
- [6. OAuth 完整流程](#6-oauth-完整流程)
- [7. 子进程清理问题](#7-子进程清理问题)
- [8. `ToolsChanged` 通知的传播链](#8-toolschanged-通知的传播链)
- [9. MCP 为什么不是插件系统的另一套](#9-mcp-为什么不是插件系统的另一套)
- [10. 把 B13 压成一句代码级结论](#10-把-b13-压成一句代码级结论)

---

## 1. MCP 在 OpenCode 里到底是什么

在 `packages/opencode/src/mcp/index.ts` 里，MCP 命名空间（1484 行）是一个完整的二级扩展子系统。它不只是一个"远端工具代理"，而是同时承担四种角色的 runtime 扩展：

| MCP 角色 | 对应导出函数 | 在 runtime 里的投影 |
| --- | --- | --- |
| 工具来源 | `tools()` | 变成 agent 可调用的 Tool |
| Prompt 模板来源 | `prompts()` | 变成 slash command 模板 |
| Resource 来源 | `resources()` / `readResource()` | 变成可读取的上下文内容 |
| 事件源 | `ToolsChanged` BusEvent | MCP server 发 `ToolListChangedNotification` 时触发 OpenCode Bus 刷新 |

因此 MCP 对 OpenCode 来说是一个"带状态、带认证、带生命周期的二级 runtime"，而不是静态挂载的远端工具列表。

---

## 2. 五状态状态机

`MCP.Status`（`67-110`）是一个 discriminated union，包含五种状态：

| 状态 | 含义 | 典型触发条件 |
| --- | --- | --- |
| `connected` | 已连接 | 成功建立 transport 并完成 handshake |
| `disabled` | 已禁用 | `mcp.enabled === false` 或从未配置 |
| `failed` | 连接失败 | transport 连接失败或无法获取 tool list |
| `needs_auth` | 需认证 | OAuth 流程需要用户授权 |
| `needs_client_registration` | 需客户端注册 | server 不支持动态注册，需要预注册 clientId |

这个状态机是通过 `Instance.state()` 挂载的 instance-scoped 单例（`182-244`），所以每个 workspace/project 的 MCP 连接状态互相独立。

---

## 3. 两类 MCP Server 的连接方式

### 3.1 远程 MCP（`mcp.type === "remote"`）

`325-446` 处理远程 server。关键逻辑：

**传输层选择**：会同时尝试两种 transport，优先用能连上的：

1. `StreamableHTTPClientTransport`（MCP 官方标准）
2. `SSEClientTransport`（Server-Sent Events 降级）

**认证处理**：

- 默认开启 OAuth（`oauth: false` 可禁用）
- OAuth 配置可以是内联 `clientId`/`clientSecret`，也可以让 provider 自动发现
- `UnauthorizedError` 会触发 `needs_auth` 或 `needs_client_registration` 状态

**超时控制**：默认 30 秒，可通过 `mcp.timeout` 覆盖

### 3.2 本地 MCP（`mcp.type === "local"`）

`448-490` 处理本地子进程。关键逻辑：

- 用 `StdioClientTransport`，`cwd` 是 `Instance.directory`
- 环境变量会继承 `process.env` 并追加 `mcp.environment`
- 如果 `cmd === "opencode"`，额外设置 `BUN_BE_BUN: "1"`
- `stderr` 会 pipe 回 MCP logger 输出

这意味着本地 MCP 可以是任意命令行工具，OpenCode 只是它的 parent process。

---

## 4. Tool 的投影过程

`tools()`（`606-646`）把 MCP tool 转换成 OpenCode runtime 可调用的 AI SDK `Tool`：

```ts
result[sanitizedClientName + "_" + sanitizedToolName] = await convertMcpTool(mcpTool, client, timeout)
```

`convertMcpTool()`（`121-149`）的核心逻辑：

1. 把 MCP 的 `inputSchema`（JSON Schema）规范化为 AI SDK 的 `jsonSchema`
2. `execute` 里直接调用 `client.callTool()`，带上 `resetTimeoutOnProgress: true`
3. 超时会按 `mcp.timeout` 或 `experimental.mcp_timeout` 设置

工具名称会做安全 sanitize（替换非法字符为 `_`），所以最终 tool name 格式是 `clientName_toolName`。

---

## 5. Prompt 和 Resource 的投影

`prompts()`（`648-667`）和 `resources()`（`669-688`）分别把 MCP prompts/resources 映射成 OpenCode 的 command 和 resource：

- MCP prompt `listPrompts()` → OpenCode `Command`（通过 `sanitizedClientName:sanitizedPromptName` 做 key）
- MCP resource `listResources()` → OpenCode `Resource`（同样用 key 隔离不同 client）

`getPrompt()`（`690-716`）和 `readResource()`（`718-743`）则是按需读取：给定 client name 和 prompt/resource 名称，实际调用 MCP server 的对应 API。

---

## 6. OAuth 完整流程

MCP 的 OAuth 是最复杂的子系统，涉及四个文件协同。

### 6.1 OAuth 三件套

| 文件 | 角色 |
| --- | --- |
| `mcp/auth.ts` | 凭证存储：tokens、codeVerifier、oauthState 写进 `~/.local/share/opencode/mcp-auth.json` |
| `mcp/oauth-provider.ts` | 实现 MCP SDK 的 `OAuthClientProvider` 接口，管理 token 刷新和动态注册 |
| `mcp/oauth-callback.ts` | 起一个本地 HTTP server（端口 19876）接收 OAuth 回调 |
| `mcp/index.ts` | `startAuth()` / `authenticate()` / `finishAuth()` 三步串联整个流程 |

### 6.2 完整认证链路

```
startAuth(mcpName)
  → McpOAuthCallback.ensureRunning()        // 启动 callback server
  → 生成 crypto.random oauthState          // 防 CSRF
  → McpAuth.updateOAuthState()              // 存 state
  → 创建带 authProvider 的 transport
  → client.connect() 触发 OAuth 重定向
  → 如果需要授权：返回 authorizationUrl

authenticate(mcpName)
  → startAuth() 获取 authorizationUrl
  → open(authorizationUrl) 打开浏览器
  → McpOAuthCallback.waitForCallback(state) 阻塞等待
  → 用户在浏览器完成授权
  → callback server 收到 code
  → finishAuth(mcpName, code)
    → transport.finishAuth(code)
    → McpAuth.clearCodeVerifier()
    → add(mcpName, mcpConfig) 重新连接
```

### 6.3 Token 刷新和动态注册

`oauth-provider.ts` 实现了完整的 OAuth 客户端能力：

- 有 `clientId`/`clientSecret` 时走 `client_secret_post`
- 无密钥时用 `none`（公共客户端）
- `clientInformation()` 会优先查配置，其次查已动态注册的 stored entry
- token 过期时自动用 refresh_token 刷新

---

## 7. 子进程清理问题

`state` 的 teardown（`217-243`）解决了一个关键问题：**MCP SDK 只杀直接子进程，不杀孙进程**。

代码里对每个 client 的 transport pid 遍历其所有 descendant（`descendants()` 用 `pgrep -P` 实现），先全部 SIGTERM，再关闭 client。这在 chrome-devtools-mcp 这类会拉起 Chrome 的场景下尤其重要，否则会留下孤儿进程。

---

## 8. `ToolsChanged` 通知的传播链

`registerNotificationHandlers()`（`113-118`）在每次连接成功时注册：

```ts
client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
  Bus.publish(ToolsChanged, { server: serverName })
})
```

这意味着 MCP server 如果动态更新了 tool list，OpenCode 会把这个变化通过 Bus 广播出去。runtime 订阅这条 BusEvent 后，会触发 tool registry 重新加载，实现动态感知。

---

## 9. MCP 为什么不是插件系统的另一套

[23-bridge-system.md](./21-bridge-system.md) 已经提到 plugin 和 MCP 都是扩展入口，它们的本质区别在于：

| 维度 | Plugin | MCP |
| --- | --- | --- |
| 运行位置 | 主进程内，直接拿 SDK/client/instance 上下文 | 通过 transport 连接到独立进程 |
| 扩展内容 | 可影响认证、tool schema、shell 环境、bus 事件 | 只暴露 tool/prompt/resource |
| 生命周期 | 跟随 instance | 按 server 独立管理状态 |
| 认证 | 通过 auth hook 覆写 provider 行为 | 通过 OAuth/OAuth2 独立管理 |

所以 plugin 是"受信内部扩展"，MCP 是"标准协议外部扩展"。两者都在 runtime 边界内，但切入角度完全不同。

---

## 10. 把 B13 压成一句代码级结论

> OpenCode 的 MCP 实现是一个完整的二级扩展 runtime：它通过五状态状态机管理连接生命周期，用 OAuth 和动态注册处理远程认证，把 tool/prompt/resource 投影成 OpenCode 可调用的 runtime 对象，并通过 `ToolsChanged` 通知实现动态感知。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `McpClientManager` | `mcp/client.ts` | MCP 客户端生命周期管理：创建、复用、销毁连接 |
| state machine transitions | `mcp/client.ts` | 五态（disconnected/connecting/connected/error/disabled）转换驱动 |
| `convertMcpTool()` | `mcp/tool.ts` | 将 MCP tool schema 转换为 opencode 内部 Tool 格式 |
| Prompt+Resource projector | `mcp/resource.ts` | 将 MCP Prompt/Resource 投影为等效 Tool，统一工具注册接口 |
| `ToolsChanged` handler | `mcp/client.ts` | 监听服务端的 `notifications/tools/list_changed`，刷新工具缓存 |
| OAuth flow | `mcp/auth.ts` | 处理 MCP OAuth 2.0 授权流程：code exchange、token 存储 |

---

## 代码质量评估

**优点**

- **五态机完整覆盖**：disconnected/connecting/connected/error/disabled 五态覆盖了 MCP 连接的所有生命周期阶段，包括主动 disable。
- **Prompt/Resource 投影为 Tool**：统一接口设计，LLM 和业务代码无需区分工具来自 built-in 还是 MCP，降低消费方复杂度。
- **`ToolsChanged` 动态刷新**：支持服务端热更新工具列表，无需重启 session；适配 MCP server 动态添加工具的场景。

**风险与改进点**

- **MCP 连接无超时限制**：长时间未收到响应的 MCP 请求不会主动超时，阻塞工具调用可能导致 session 永久挂起。
- **OAuth token 无持久化**：每次进程重启后 OAuth token 丢失，需重新走授权流程，用户体验差。
- **子进程 MCP server 无资源回收保证**：session 崩溃时 stdio 模式的子进程 MCP server 可能成为孤儿进程。
