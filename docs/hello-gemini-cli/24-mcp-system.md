---
layout: content
title: "Gemini CLI 的 MCP 系统"
---
# Gemini CLI 的 MCP 系统

本篇讨论 MCP 客户端、传输层、认证体系、工具/提示词发现，以及与 Gemini CLI 工具总线的集成。

**目录**

- [1. MCP 系统概述](#1-mcp-系统概述)
- [2. 核心组件](#2-核心组件)
- [3. 传输层实现](#3-传输层实现)
- [4. 认证体系](#4-认证体系)
- [5. 工具发现与注册](#5-工具发现与注册)
- [6. 提示词发现](#6-提示词发现)
- [7. 动态更新处理](#7-动态更新处理)
- [8. 配置格式](#8-配置格式)
- [9. MCP 状态机](#9-mcp-状态机)
- [10. 与 Claude Code 的差异](#10-与-claude-code-的差异)
- [11. 关键源码锚点](#11-关键源码锚点)

---

## 1. MCP 系统概述

```mermaid
---
config:
  theme: neutral
---
flowchart TB
    subgraph Config["配置层"]
        A[MCPServerConfig JSON]
    end

    subgraph Manager["McpClientManager"]
        B[McpClientManager]
        C[Auth Provider]
    end

    subgraph Clients["McpClient 实例池"]
        D[Server A Client]
        E[Server B Client]
        F[Server C Client]
    end

    subgraph Transport["传输层"]
        G[StdioTransport]
        H[SSEClientTransport]
        I[StreamableHTTPTransport]
    end

    subgraph MCP["MCP Server"]
        J[本地进程]
        K[远程 HTTP]
    end

    Config --> Manager
    Manager --> D
    Manager --> E
    Manager --> F
    D --> G
    E --> H
    F --> I
    G --> J
    H --> K
    I --> K
```

## 2. 核心组件

### 2.1 组件拓扑

| 组件 | 路径 | 职责 |
| :------| :------| :------|
| McpClientManager | `sources/gemini-cli/packages/core/src/tools/mcp-client-manager.ts` | 客户端生命周期管理 |
| McpClient | `sources/gemini-cli/packages/core/src/tools/mcp-client.ts` | 单个 MCP 服务器连接 |
| Auth Provider | `sources/gemini-cli/packages/core/src/mcp/auth-provider.ts` | 认证抽象接口 |
| MCPOAuthProvider | `sources/gemini-cli/packages/core/src/mcp/oauth-provider.ts` | OAuth 2.0 实现 |
| Google Auth Provider | `sources/gemini-cli/packages/core/src/mcp/google-auth-provider.ts` | Google 凭据 |
| SA Impersonation Provider | `sources/gemini-cli/packages/core/src/mcp/sa-impersonation-provider.ts` | 服务账号模拟 |
| Token Storage | `sources/gemini-cli/packages/core/src/mcp/oauth-token-storage.ts` | Token 持久化 |

## 3. 传输层实现

### 3.1 传输类型选择

```typescript
// gemini-cli/packages/core/src/tools/mcp-client.ts

function createTransport(config: MCPServerConfig): Transport {
  // 1. 有 command → StdioTransport (本地进程)
  if (config.command) {
    return new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: finalEnv,
      cwd: config.cwd,
      stderr: 'pipe',
    });
  }

  // 2. 有 httpUrl + type:'sse' → SSEClientTransport
  if (config.url && config.type === 'sse') {
    return new SSEClientTransport(new URL(config.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
  }

  // 3. 有 url + type:'http' → StreamableHTTPClientTransport
  if (config.url && config.type === 'http') {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers },
      authProvider,
    });
  }

  // 4. 默认: StreamableHTTP，失败时回退 SSE
  return new StreamableHTTPClientTransport(new URL(config.url), ...);
}
```

### 3.2 StdioTransport 流程

```mermaid
---
config:
  theme: neutral
---
flowchart TB
    A[spawn(command, args)] --> B[子进程 stdin/stdout]
    B --> C[send message]
    C --> D[JSON.stringify]
    D --> E[stdin.write]
    E --> F[stdout.on data]
    F --> G[messageBuffer]
    G --> H[handleMessage]
    H --> I[JSON.parse]
    I --> J[通知处理器]
```

## 4. 认证体系

### 4.1 认证类型

```typescript
// gemini-cli/packages/core/src/mcp/auth-provider.ts

enum AuthProviderType {
  GOOGLE_CREDENTIALS,           // Google 应用默认凭据
  SERVICE_ACCOUNT_IMPERSONATION, // SA 模拟
  OAUTH,                        // OAuth 2.0 PKCE
}

interface AuthProvider {
  getAuthHeader(serverName: string): Promise<string | null>;
  refreshTokenIfNeeded(serverName: string): Promise<void>;
}
```

### 4.2 OAuth 流程

```mermaid
---
config:
  theme: neutral
---
sequenceDiagram
    participant Client as MCP Client
    participant Auth as MCPOAuthProvider
    participant TokenStorage as Token Storage
    participant Server as MCP Server

    Client->>Server: 连接请求
    Server-->>Client: 401 www-authenticate
    Client->>Auth: discoverOAuth()
    Auth->>Server: 动态客户端注册
    Server-->>Auth: client_id, client_secret
    Auth->>Auth: PKCE 生成 code_verifier
    Auth->>Server: 授权请求 (code_challenge)
    Server-->>User: 浏览器授权
    User-->>Server: 用户同意
    Server-->>Auth: authorization_code
    Auth->>Server: token 请求 (code_verifier)
    Server-->>Auth: access_token, refresh_token
    Auth->>TokenStorage: 存储 token
    Client->>Auth: getValidToken()
    Auth-->>Client: access_token
    Client->>Server: 重新请求
```

## 5. 工具发现与注册

### 5.1 工具发现流程

```mermaid
---
config:
  theme: neutral
---
flowchart LR
    A[listTools()] --> B[McpTool[]]
    B --> C{过滤}
    C -->|已启用| D[McpCallableTool]
    C -->|已禁用| E[跳过]
    D --> F[DiscoveredMCPTool]
    F --> G[ToolRegistry]
    G --> H[Agent 工具集]
```

### 5.2 工具调用

```typescript
// gemini-cli/packages/core/src/tools/mcp-client.ts

class McpCallableTool implements CallableTool {
  async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
    const results = [];

    for (const call of functionCalls) {
      const result = await this.client.callTool({
        name: call.name,
        arguments: call.args,
        _meta: { progressToken },  // 进度通知支持
      }, undefined, { timeout });

      results.push({
        functionResponse: {
          name: call.name,
          response: result,
        },
      });
    }

    return results;
  }
}
```

## 6. 提示词发现

### 6.1 MCP Prompts 作为 Slash 命令

```mermaid
---
config:
  theme: neutral
---
flowchart TB
    A[MCP listPrompts()] --> B[MCPPrompt[]]
    B --> C[McpPromptLoader]
    C --> D[SlashCommand]
    D --> E[CommandService]
    E --> F[用户 /promptName]
    F --> G[prompt.invoke()]
    G --> H[MCP getPrompt]
    H --> I[返回消息]
    I --> J[提交给模型]
```

## 7. 动态更新处理

### 7.1 List-Changed 通知

```typescript
// gemini-cli/packages/core/src/tools/mcp-client.ts

private registerNotificationHandlers(): void {
  // 工具列表变更
  this.client.setNotificationHandler(
    ToolListChangedNotificationSchema,
    async () => {
      await this.refreshTools();
    }
  );

  // 资源列表变更
  this.client.setNotificationHandler(
    ResourceListChangedNotificationSchema,
    async () => {
      await this.refreshResources();
    }
  );

  // 提示词列表变更
  this.client.setNotificationHandler(
    PromptListChangedNotificationSchema,
    async () => {
      await this.refreshPrompts();
    }
  );
}

// Coalescing Pattern: 合并突发刷新请求
private async refreshTools(): Promise<void> {
  if (this.isRefreshingTools) {
    this.pendingToolRefresh = true;  // 标记等待下一次刷新
    return;
  }

  do {
    this.isRefreshingTools = true;
    this.pendingToolRefresh = false;
    // ... 执行刷新
  } while (this.pendingToolRefresh);
}
```

## 8. 配置格式

### 8.1 MCPServerConfig

```typescript
// gemini-cli/packages/core/src/tools/types.ts

interface MCPServerConfig {
  name: string;
  command?: string;           // StdioTransport
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;              // HTTP/SSE/StreamableHTTP
  type?: 'http' | 'sse';     // 传输类型
  auth?: {
    type: 'google_credentials'
       | 'service_account_impersonation'
       | 'oauth';
    // ... 类型相关配置
  };
}
```

### 8.2 配置来源

```mermaid
---
config:
  theme: neutral
---
flowchart LR
    A[~/.gemini/mcp.json] --> B[MCPServerConfig[]]
    C[项目 .gemini/mcp.json] --> B
    B --> D[McpClientManager]
```

## 9. MCP 状态机

```mermaid
---
config:
  theme: neutral
---
stateDiagram-v2
    [*] --> NOT_STARTED
    NOT_STARTED --> IN_PROGRESS: 启动
    IN_PROGRESS --> COMPLETED: 发现完成
    IN_PROGRESS --> ERROR: 发现失败
    COMPLETED --> IN_PROGRESS: 刷新
    ERROR --> IN_PROGRESS: 重试

    DISCONNECTED --> CONNECTING: 连接
    CONNECTING --> CONNECTED: 连接成功
    CONNECTING --> DISCONNECTED: 连接失败
    CONNECTED --> DISCONNECTED: 断开
```

## 10. 与 Claude Code 的差异

| 特性 | Claude Code | Gemini CLI |
| :------| :-------------| :------------|
| 传输类型 | Stdio, SSE, HTTP, WebSocket, in-process | Stdio, SSE, StreamableHTTP |
| 认证 | XAA, OAuth, Bearer Token | Google Credentials, SA 模拟, OAuth PKCE |
| 工具发现 | `loadMcpTools()` | `discoverTools()` |
| 进度通知 | `progressToken` | `_meta.progressToken` |
| 动态更新 | `ToolListChangedNotification` | 同上 + Coalescing Pattern |

## 11. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| :------| :----------| :------|
| 客户端管理 | `sources/gemini-cli/packages/core/src/tools/mcp-client-manager.ts` | 生命周期管理 |
| 客户端实现 | `sources/gemini-cli/packages/core/src/tools/mcp-client.ts` | 单服务器连接 |
| OAuth | `sources/gemini-cli/packages/core/src/mcp/oauth-provider.ts` | OAuth 2.0 实现 |
| Google 认证 | `sources/gemini-cli/packages/core/src/mcp/google-auth-provider.ts` | 应用默认凭据 |
| Token 存储 | `sources/gemini-cli/packages/core/src/mcp/oauth-token-storage.ts` | 安全存储 |
| 提示词加载 | `sources/gemini-cli/packages/cli/src/services/McpPromptLoader.ts` | MCP → Slash 命令 |
| 工具包装 | `sources/gemini-cli/packages/core/src/agents/browser/mcpToolWrapper.ts` | 工具适配 |

---

*文档版本: 1.0*
*分析日期: 2026-04-06*

---

## 代码质量评估

**优点**

- **5 状态机清晰**：`connected/disabled/failed/needs_auth/needs_client_registration` 状态转移有完整定义，auth flow 与连接 flow 解耦，错误处理分支明确。
- **MCP prompt 与 slash command 统一**：MCP server 的 prompt 模板被自动投影为 slash command，用户无需区分"MCP prompt"和"内建命令"。
- **动态工具更新支持热刷新**：`ToolsChanged` 事件驱动 tool list 刷新，MCP server 添加新工具无需重启 Gemini CLI。

**风险与改进点**

## 横向对齐补强：MCP 要落回 ToolRegistry/Scheduler

Gemini CLI 的 MCP 系统最终必须回答两个问题：MCP server 发现的工具如何进入 ToolRegistry，MCP tool call 如何经过 Scheduler 和 PolicyEngine 执行。否则 MCP 章节会和扩展概念停留在配置层。

| 问题 | 需要回链的章节 |
| --- | --- |
| MCP server 如何配置、连接、失败恢复 | `06-extension-mcp.md`、`17-settings-config.md` |
| MCP tool 如何进入工具池 | `05-tool-system.md` |
| MCP tool 调用前是否需要确认 | `07-error-security.md`、`05-tool-system.md` |
| MCP tool 结果如何回到模型 | `03-agent-loop.md`、`23-input-command-queue.md` |

横向看，Gemini 的 MCP 文档应比 Codex 少讲 sandbox，比 OpenCode 少讲 durable part，但必须补清楚 Scheduler 这一跳。

- **MCP server 连接无全局超时**：`McpClientManager` 等待 stdio server 握手时无超时上限，MCP server 启动慢会阻塞整个 CLI 初始化。
- **认证令牌存储在进程内存**：OAuth2 令牌由 `mcp/auth.ts` 管理，进程重启后需要重新认证，无持久化 token 缓存机制。
- **工具名称 sanitize 后无冲突检测**：多个 MCP server 产生同名工具时，后注册的会静默覆盖前者，无冲突日志或报警。

## 源码锚点补强：MCP 工具最终要进入 ToolRegistry 和 Scheduler

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/gemini-cli/packages/core/src/tools/mcp-client-manager.ts` | MCP client 生命周期管理 | 对应 Codex connection manager |
| `sources/gemini-cli/packages/core/src/tools/mcp-client.ts` | 单 server MCP 连接和调用 | 对应 Claude MCP client |
| `sources/gemini-cli/packages/core/src/mcp/auth-provider.ts` | MCP auth 抽象 | 对应 OAuth/credential 层 |
| `sources/gemini-cli/packages/core/src/mcp/oauth-provider.ts` | OAuth provider 实现 | 横向安全/认证维度 |
| `sources/gemini-cli/packages/core/src/tools/tool-registry.ts:269` | MCP tool 注册回 ToolRegistry | 连接工具章节 |
| `sources/gemini-cli/packages/core/src/scheduler/scheduler.ts:191` | MCP tool call 仍进入 Scheduler | 说明 MCP 不绕过工具治理 |
| `sources/gemini-cli/packages/cli/src/services/McpPromptLoader.ts` | MCP prompt 转 slash 命令 | 连接输入队列章节 |

## 生命周期补强：MCP 状态、auth 与工具刷新

Gemini CLI 的 MCP 章节需要同时看清三条链：

| 链路 | 关键源码 | 说明 |
| --- | --- | --- |
| extension 启动 MCP | `sources/gemini-cli/packages/core/src/utils/extensionLoader.ts:75` | extension 中声明的 MCP server 交给 `McpClientManager.startExtension()` |
| extension 停止 MCP | `sources/gemini-cli/packages/core/src/utils/extensionLoader.ts:183` | stop 时调用 `McpClientManager.stopExtension()`，并刷新工具列表 |
| 工具注册 | `sources/gemini-cli/packages/core/src/tools/tool-registry.ts:269` | MCP tool 和内建工具进入同一 ToolRegistry |
| 工具执行 | `sources/gemini-cli/packages/core/src/scheduler/scheduler.ts:191` | Scheduler 统一处理 MCP tool call 的调度、确认和结果 |
| 认证抽象 | `sources/gemini-cli/packages/core/src/mcp/auth-provider.ts` | auth provider 与 MCP client 生命周期分离 |

因此，MCP 不是一条旁路执行链。连接/认证失败属于 MCP client manager 的状态问题；工具能否执行仍取决于 ToolRegistry、Scheduler 和 PolicyEngine；工具结果回到模型则走普通 tool response continuation。
