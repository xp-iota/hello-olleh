---
title: "Claude Code 的 MCP 系统"
---
# Claude Code 的 MCP 系统

**目录**

- [1. MCP 系统概述](#1-mcp-系统概述)
- [2. MCP 客户端](#2-mcp-客户端)
- [3. MCP 传输](#3-mcp-传输)
- [4. MCP 工具集成](#4-mcp-工具集成)
- [5. MCP 资源](#5-mcp-资源)
- [6. MCP 配置](#6-mcp-配置)
- [7. MCP 权限](#7-mcp-权限)
- [8. MCP 状态管理](#8-mcp-状态管理)
- [9. MCP 生命周期](#9-mcp-生命周期)
- [10. MCP 提示 (Prompts)](#10-mcp-提示-prompts)
- [13. 补充：关键实现细节](#13-补充关键实现细节)

---

## 1. MCP 系统概述

本篇讨论 MCP client、transport、tool/resource/prompt 接口，以及它如何接入 Claude Code 的统一工具总线。

扩展总线的高层入口已经在 [06-extension-mcp.md](./06-extension-mcp.md) 说明；本篇只保留 MCP 协议与运行时本身。

![MCP 系统概述](diagrams/24-mcp-system-mcp-01.svg)

**MCP 系统概述** — [交互版](diagrams/24-mcp-system-mcp-01.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-mcp-01.architecture.json)

- **组成**：12 个节点
- **关系**：源图 7 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：MCPClient → JSON-RPC 消息（JSON-RPC） · 工具转换层 → MCPClient · 资源工具 → MCPClient

## 2. MCP 客户端

**位置**: `src/services/mcp/client.ts`

### 2.1 MCP 连接接口

```typescript
export interface MCPServerConnection {
  readonly name: string                    // 服务器名称
  readonly type: 'stdio' | 'http'        // 连接类型

  // 工具
  listTools(): Promise<McpTool[]>
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>

  // 资源
  listResources(): Promise<ServerResource[]>
  readResource(uri: string): Promise<ResourceContent>

  // 提示
  listPrompts(): Promise<Prompt[]>
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>

  // 生命周期
  close(): void
}
```

### 2.2 MCP 客户端实现

![MCP 客户端实现](diagrams/24-mcp-system-mcp-02.svg)

**MCP 客户端实现** — [交互版](diagrams/24-mcp-system-mcp-02.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-mcp-02.sequence.json)

- **组成**：4 个参与方
- **关系**：源图 6 条消息 · 画布展示前 5 条主链消息，其余列在要点
- **要点**：MCPClient 自调用：initialize() · 未上画布的调用：result

## 3. MCP 传输

### 3.1 Stdio 传输

**位置**: `src/services/mcp/InProcessTransport.ts`

![Stdio 传输](diagrams/24-mcp-system-stdio.svg)

**Stdio 传输** — [交互版](diagrams/24-mcp-system-stdio.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-stdio.architecture.json)

- **组成**：13 个节点
- **关系**：源图 7 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：spawn process → stdin/stdout · stdin/stdout → messageBuffer · send(message) → JSON.stringify

### 3.2 HTTP 传输 (SSE)

![HTTP 传输 (SSE)](diagrams/24-mcp-system-http-sse.svg)

**HTTP 传输 (SSE)** — [交互版](diagrams/24-mcp-system-http-sse.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-http-sse.architecture.json)

- **组成**：10 个节点
- **关系**：源图 9 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：connect() → fetch SSE 端点 · fetch SSE 端点 → 读取 ReadableStream · 读取 ReadableStream → 数据?

## 4. MCP 工具集成

### 4.1 工具转换为 Claude Tools

![工具转换为 Claude Tools](diagrams/24-mcp-system-claude-tools.svg)

**工具转换为 Claude Tools** — [交互版](diagrams/24-mcp-system-claude-tools.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-claude-tools.architecture.json)

- **组成**：8 个节点
- **关系**：源图 7 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：MCP 服务器 → listTools() · listTools() → McpTool · McpTool → 对每个工具

### 4.2 工具注册

```typescript
export async function loadMcpTools(
  clients: MCPServerConnection[]
): Promise<Tools> {
  const tools: Tools = []

  for (const client of clients) {
    try {
      const mcpTools = await client.listTools()

      for (const mcpTool of mcpTools) {
        tools.push(wrapMCPTool(client, mcpTool))
      }
    } catch (error) {
      console.error(`Failed to load tools from ${client.name}:`, error)
    }
  }

  return tools
}
```

## 5. MCP 资源

### 5.1 资源定义

```typescript
export interface ServerResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface ResourceContent {
  uri: string
  mimeType: string
  content: string | Uint8Array
}
```

### 5.2 资源工具

![资源工具](diagrams/24-mcp-system-diagram-06.svg)

**资源工具** — [交互版](diagrams/24-mcp-system-diagram-06.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-diagram-06.architecture.json)

- **组成**：8 个节点
- **关系**：源图 7 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：ListMcpResources → 遍历 mcpClients · 遍历 mcpClients → listResources() · listResources() → 合并资源

## 6. MCP 配置

### 6.1 配置格式

**位置**: `src/services/mcp/config.ts`

![配置格式](diagrams/24-mcp-system-diagram-07.svg)

**配置格式** — [交互版](diagrams/24-mcp-system-diagram-07.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-diagram-07.architecture.json)

- **组成**：7 个节点
- **关系**：源图 6 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：mcp.json → MCPConfig · MCPConfig → servers · servers → server.name

### 6.2 配置加载

```typescript
export function loadMCPConfig(): MCPConfig {
  // 尝试多个位置
  const locations = [
    path.join(cwd, 'mcp.json'),
    path.join(getConfigDir(), 'mcp.json'),
  ]

  for (const location of locations) {
    if (existsSync(location)) {
      const content = readFileSync(location, 'utf-8')
      return JSON.parse(content)
    }
  }

  return { servers: [] }
}
```

## 7. MCP 权限

### 7.1 权限检查

![权限检查](diagrams/24-mcp-system-diagram-08.svg)

**权限检查** — [交互版](diagrams/24-mcp-system-diagram-08.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-diagram-08.architecture.json)

- **组成**：9 个节点
- **关系**：源图 8 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：资源访问请求 → findMCPResource() · findMCPResource() → 资源存在? · 资源存在? → 返回 deny（否）

## 8. MCP 状态管理

### 8.1 连接状态

```typescript
export type MCPConnectionState =
  | { status: 'connecting' }
  | { status: 'connected' }
  | { status: 'disconnected'; error?: string }
  | { status: 'error'; error: string }
```

### 8.2 状态更新

![状态更新](diagrams/24-mcp-system-diagram-09.svg)

**状态更新** — [交互版](diagrams/24-mcp-system-diagram-09.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-diagram-09.architecture.json)

- **组成**：6 个节点
- **关系**：源图 5 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：updateMCPClientState() → setAppState() · setAppState() → prev.mcp.clients.map() · prev.mcp.clients.map() → 匹配 name?

## 9. MCP 生命周期

### 9.1 启动流程

![启动流程](diagrams/24-mcp-system-diagram-10.svg)

**启动流程** — [交互版](diagrams/24-mcp-system-diagram-10.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-diagram-10.architecture.json)

- **组成**：10 个节点
- **关系**：源图 11 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：startMCPClients() → loadMcpConfig() · loadMcpConfig() → servers · servers → createTransport()（每个服务器）

### 9.2 关闭流程

![关闭流程](diagrams/24-mcp-system-diagram-11.svg)

**关闭流程** — [交互版](diagrams/24-mcp-system-diagram-11.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-diagram-11.sequence.json)

- **组成**：5 个参与方
- **关系**：源图 4 条消息
- **要点**：消息标签保留源图中的调用名

## 10. MCP 提示 (Prompts)

### 10.1 提示定义

```typescript
export interface MCPPrompt {
  name: string
  description?: string
  arguments?: {
    name: string
    description?: string
    required?: boolean
  }[]
}
```

### 10.2 提示工具

![提示工具](diagrams/24-mcp-system-diagram-12.svg)

**提示工具** — [交互版](diagrams/24-mcp-system-diagram-12.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-diagram-12.architecture.json)

- **组成**：7 个节点
- **关系**：源图 7 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：MCPPromptsTool.call() → server 参数? · server 参数? → 过滤指定服务器（有） · server 参数? → 遍历所有服务器（无）

## 13. 补充：关键实现细节

### 13.1 MCP 认证体系

MCP 认证是这个子系统中最复杂的部分（auth.ts 88KB）：

- XAA (eXternal Auth for Anthropic)：Anthropic 自有的认证扩展
- XAA-IDP：通过身份提供商的间接认证
- OAuth 2.0：标准的授权码流程
- Bearer Token：简单的令牌认证

URL 诱导协议（URL Elicitation）允许 MCP 服务器在连接过程中请求用户输入 URL 或凭证，带有重试逻辑。

### 13.2 MCP 传输类型

实际支持 6 种传输：

1. stdio：spawn 子进程，stdin/stdout 通信
2. SSE：HTTP Server-Sent Events
3. HTTP：标准 HTTP POST（streamable-http）
4. claudeai-proxy：通过 claude.ai 代理
5. WebSocket：WS 连接
6. in-process（SDK 模式）：SdkControlClientTransport

### 13.3 工具调用超时

MCP 工具调用有超时竞赛机制。如果工具执行超时，会返回超时错误而非无限等待。超时期间会记录 progress 日志。

### 13.4 JSON-RPC 消息格式

所有 MCP 通信使用 JSON-RPC 2.0：

- 请求：{ jsonrpc: "2.0", id: number, method: string, params: object }
- 响应：{ jsonrpc: "2.0", id: number, result: object }
- 通知：{ jsonrpc: "2.0", method: string, params: object }（无 id）

消息缓冲器处理分帧：JSON 消息可能跨多个 chunk 到达，缓冲器负责拼接和解析。

### 13.5 Schema 转换

JSON Schema → Zod schema 的转换不是通用的。它处理常见的 JSON Schema 结构（object、string、number、boolean、array、enum），但对于高度复杂的 schema（如 allOf/anyOf 嵌套）可能降级为 z.any()。

---

*文档版本: 1.0*
*分析日期: 2026-03-31*

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `McpHub` | `src/services/mcp/mcpHub.ts` | MCP 连接管理中心：初始化、健康检查、断线处理 |
| `McpHub.listTools()` | `src/services/mcp/mcpHub.ts` | 聚合所有 MCP server 的工具列表，返回统一格式 |
| `McpHub.callTool()` | `src/services/mcp/mcpHub.ts` | 路由工具调用到对应 MCP server，收集结果 |
| `McpHub.listResources()` | `src/services/mcp/mcpHub.ts` | 获取所有 server 的 Resource 列表 |
| `StdioClientTransport` | `@modelcontextprotocol/sdk` | SDK 提供的 stdio 传输层：fork 子进程通信 |
| `StreamableHTTPClientTransport` | `@modelcontextprotocol/sdk` | SDK 提供的 HTTP SSE 传输层 |

---

## 代码质量评估

**优点**

- **官方 SDK 传输层**：直接复用 `@modelcontextprotocol/sdk` 的 stdio/SSE 传输实现，无需维护自定义传输逻辑，协议升级跟随 SDK。
- **McpHub 统一多 server 路由**：多个 MCP server 的调用通过 McpHub 统一分发，客户端无需感知 server 边界。
- **按工具名路由**：`callTool()` 根据工具名自动路由到注册对应工具的 server，无需客户端指定 server。

**风险与改进点**

- **工具名冲突无处理策略**：多个 MCP server 注册同名工具时，McpHub 路由行为（取第一个？报错？）未文档化，用户无法预期行为。
- **callTool 无超时参数**：工具调用无调用级超时设置，全局超时无法适应不同工具时延差异。
- **Resource/Prompt 功能利用率低**：MCP 协议的 Resource 和 Prompt 特性在 Claude Code 中未充分暴露给 LLM，仅 Tool 被主动使用。

## Claude MCP 与 Plugin/Settings 强耦合

Claude Code 的 MCP 章节应比普通 MCP client 分析更宽：MCP server 可以来自用户配置、项目配置、plugin、SDK control message，并受企业策略和 permission rule 影响。

| MCP 面 | 横向对比 |
| --- | --- |
| server 来源 | 比 Codex/Gemini 更多层 |
| tool 权限 | 对应 Claude permission rule 和 enterprise allow/deny |
| OAuth/XAA | 由 `24b-mcp-deep.md` 深挖 |
| plugin MCP | 与 `14-plugin-system.md` 交叉 |

## MCP 调用链：Lifecycle 到 Tool Result

![MCP 调用链：Lifecycle 到 Tool Result](diagrams/24-mcp-system-mcp-lifecycle-tool-result.svg)

**MCP 调用链：Lifecycle 到 Tool Result** — [交互版](diagrams/24-mcp-system-mcp-lifecycle-tool-result.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-mcp-lifecycle-tool-result.sequence.json)

- **组成**：8 个参与方
- **关系**：源图 6 条消息 · 画布展示前 5 条主链消息，其余列在要点
- **要点**：McpHub / reconciliation 自调用：discover tools/resources/prompts · 未上画布的调用：tool result or tool error

| 阶段 | Claude 侧源码锚点 | 说明 |
| --- | --- | --- |
| Server lifecycle | `sources/claude-code/src/cli/print.ts:1535`, `sources/claude-code/src/cli/print.ts:5457` | SDK/control message 可以动态更新 MCP server |
| Auth | `sources/claude-code/src/services/mcp/auth.ts:847`, `sources/claude-code/src/services/mcp/auth.ts:664` | remote MCP 覆盖 OAuth 和 XAA |
| Plugin diff | `sources/claude-code/src/cli/print.ts:1795` | plugin 状态变化会重算 MCP server 集合 |
| Permission | `sources/claude-code/src/utils/settings/permissionValidation.ts:102`, `sources/claude-code/src/utils/permissions/permissions.ts:236` | MCP 工具仍受权限规则约束 |
| Tool result | `queryLoop()` 的普通 tool result 路径 | MCP result 不应被视为 bridge 事件或 prompt 资源旁路 |

## 源码锚点

| MCP 子系统 | 源码锚点 | 说明 |
| --- | --- | --- |
| OAuth 主流程 | `sources/claude-code/src/services/mcp/auth.ts:847` | 远程 MCP 认证入口 |
| XAA 流程 | `sources/claude-code/src/services/mcp/auth.ts:664` | 共享 IdP cross-app access |
| 动态 server reconciliation | `sources/claude-code/src/cli/print.ts:1535`, `sources/claude-code/src/cli/print.ts:5457` | SDK/control message 更新 MCP server |
| plugin MCP diff | `sources/claude-code/src/cli/print.ts:1795` | plugin 状态变化后重算 MCP |
| MCP 权限规则 | `sources/claude-code/src/utils/settings/permissionValidation.ts:102`, `sources/claude-code/src/utils/permissions/permissions.ts:236` | MCP rule validation 与匹配 |
