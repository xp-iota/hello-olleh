---
title: "Codex 的 MCP/RMCP 系统"
---
# Codex 的 MCP/RMCP 系统

本篇讨论 Codex 的 MCP 客户端实现、RMCP 远程协议、工具调用审批流程和 OAuth 认证。

**目录**

- [1. MCP 系统概述](#1-mcp-系统概述)
- [2. 核心组件](#2-核心组件)
- [3. RMCP 客户端架构](#3-rmcp-客户端架构)
- [4. 连接管理](#4-连接管理)
- [5. 工具管理](#5-工具管理)
- [6. 工具调用与审批](#6-工具调用与审批)
- [7. OAuth 认证](#7-oauth-认证)
- [8. MCP 协议类型](#8-mcp-协议类型)
- [9. 沙箱状态能力](#9-沙箱状态能力)
- [10. 超时配置](#10-超时配置)
- [11. Codex Apps 集成](#11-codex-apps-集成)
- [12. 与 Claude Code 的差异](#12-与-claude-code-的差异)
- [13. 关键源码锚点](#13-关键源码锚点)
- [14. 总结](#14-总结)

---

## 1. MCP 系统概述

![MCP 系统概述](diagrams/24-mcp-system-mcp.svg)

**MCP 系统概述** — [交互版](diagrams/24-mcp-system-mcp.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-mcp.architecture.json)

- **组成**：14 个节点
- **关系**：源图 6 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：McpConnectionSet → RmcpClient · RmcpClient → TransportRecipe · TransportRecipe → StdioTransport

## 2. 核心组件

| 组件 | 路径 | 职责 |
| :------| :------| :------|
| McpConnectionSet | `codex-rs/codex-mcp/src/connection_manager.rs` | MCP 连接生命周期管理 |
| RmcpClient | `codex-rs/rmcp-client/src/rmcp_client.rs` | 远程 MCP 客户端实现 |
| McpToolCall 处理 | `codex-rs/core/src/mcp_tool_call.rs` | 工具调用的审批、沙箱与结果处理 |
| ToolHandler | `codex-rs/core/src/tools/handlers/mcp.rs` | MCP 工具入口 |
| OAuth | `codex-rs/rmcp-client/src/oauth.rs` | OAuth token 管理 |
| Protocol Types | `codex-rs/protocol/src/mcp.rs` | MCP 协议类型 |

## 3. RMCP 客户端架构

### 3.1 客户端结构

```rust
// codex-rs/rmcp-client/src/rmcp_client.rs:402

pub struct RmcpClient {
    state: Mutex<ClientState>,
    stdio_process: Option<StdioServerProcessHandle>,
    transport_recipe: TransportRecipe,
    protocol_mode: McpProtocolMode,
    // ...
    initialize_context: Mutex<Option<InitializeContext>>,
    session_recovery_lock: Semaphore,
    elicitation_pause_state: ElicitationPauseState,
}
```

### 3.2 传输类型

```rust
// codex-rs/rmcp-client/src/rmcp_client.rs:154

enum TransportRecipe {
    InProcess { factory: Arc<dyn InProcessTransportFactory> },
    Stdio { command: StdioServerCommand, launcher: Arc<dyn StdioServerLauncher> },
    StreamableHttp {
        server_name: String,
        url: String,
        bearer_token: Option<StreamableHttpBearerToken>,
        // http_headers、OAuth 配置与认证存储等字段
        // ...
    },
}
```

除 stdio 与 StreamableHTTP 两种远程传输外，还支持进程内（InProcess）传输，用于嵌入式 server。

## 4. 连接管理

### 4.1 McpConnectionSet

```rust
// codex-rs/codex-mcp/src/connection_manager.rs:213

pub(crate) struct McpConnectionSet {
    servers: HashMap<String, McpServerView>,
    disabled_servers: Vec<String>,
    required_servers: Vec<String>,
    // ...
    prefix_mcp_tool_names: bool,
    non_prefixed_mcp_tool_servers: Vec<String>,
    elicitation_requests: ElicitationRequestManager,
    pub(crate) trusted_access: Option<TrustedAccessContext>,
}
```

### 4.2 连接流程

![连接流程](diagrams/24-mcp-system-diagram-02.svg)

**连接流程** — [交互版](diagrams/24-mcp-system-diagram-02.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-diagram-02.sequence.json)

- **组成**：5 个参与方
- **关系**：源图 6 条消息 · 画布展示前 5 条主链消息，其余列在要点
- **要点**：McpConnectionSet 自调用：cache Codex Apps tools · 未上画布的调用：tools cached

## 5. 工具管理

### 5.1 ToolInfo 结构

```rust
// codex-rs/codex-mcp/src/tools.rs:25

pub struct ToolInfo {
    /// Raw MCP server name used for routing the tool call.
    pub server_name: String,
    /// Whether calls routed to this server may run in parallel.
    pub supports_parallel_tool_calls: bool,
    /// Model-visible tool name used in Responses API tool declarations.
    pub callable_name: String,
    /// Model-visible namespace used for deferred tool loading.
    pub callable_namespace: String,
    /// Raw MCP tool definition; `tool.name` is sent back to the MCP server.
    pub tool: Tool,
    pub connector_id: Option<String>,
    // ...
}
```

### 5.2 工具名称限定

MCP 工具名用 `__` 分隔符限定（`codex-rs/codex-mcp/src/tools.rs:225` 的 `MCP_TOOL_NAME_DELIMITER`）：

```rust
const MCP_TOOL_NAME_DELIMITER: &str = "__";

// 模型可见名: <server>__<tool>
// 例如: "filesystem__read_file"
```

是否加前缀由 `McpConnectionSet` 的 `prefix_mcp_tool_names` 与 `non_prefixed_mcp_tool_servers` 配置控制。

### 5.3 工具发现

工具列表由 RMCP 客户端拉取：`codex-mcp/src/rmcp_client.rs:678` 的 `list_tools_with_connector_ids(...)` 发送 `tools/list` 请求，结果经 `connection_manager.rs:198` 的 `listed_tools()` 过滤后包装为 `ToolInfo`，Codex Apps server 的工具还会经 `prepare_codex_apps_tools_for_model(...)` 特殊处理。

## 6. 工具调用与审批

### 6.1 调用流程

![调用流程](diagrams/24-mcp-system-diagram-03.svg)

**调用流程** — [交互版](diagrams/24-mcp-system-diagram-03.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-diagram-03.architecture.json)

- **组成**：11 个节点
- **关系**：源图 10 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：CodexThread → McpToolCall · McpToolCall → MCP Tool? · MCP Tool? → McpConnectionSet（是）

### 6.2 McpToolCall

`codex-rs/core/src/mcp_tool_call.rs` 是 MCP 工具调用的 core 侧编排点：按 `<server>__<tool>` 名称解析目标 server 与工具名，随后走审批模板渲染（`mcp_tool_approval_templates`）、guardian 审查（`guardian` 模块）、elicit 处理与结果生命周期处理（`tools/lifecycle.rs` 的 `process_mcp_tool_result`），把 MCP 调用纳入与内建工具一致的治理链。

### 6.3 审批策略

```rust
// codex-rs/protocol/src/protocol.rs:1002

pub enum AskForApproval {
    UnlessTrusted,               // 项目不受信：除非 exec policy 显式放行，否则需要审批
    #[default]
    OnRequest,                   // 由模型决定何时请求审批（兼容 "on-failure" 旧值）
    Granular(GranularApprovalConfig), // 按命令类别细粒度放行/拒绝
    Never,                       // 从不请求审批，失败直接返回模型
}

// Elicitation 请求处理
struct ElicitationRequestManager { /* 按 server 挂起用户输入请求 */ }
```

## 7. OAuth 认证

### 7.1 Token 持久化

```rust
// codex-rs/rmcp-client/src/oauth.rs:105

pub struct StoredOAuthTokens {
    // 凭证快照持久化到本地 secret store（keyring 等），
    // 按 server 维度隔离，支持刷新与并发读
    // ...
}
```

StreamableHTTP server 的 OAuth 凭证由 `StoredOAuthTokens` 及周边类型管理，凭实际配置选择 keyring 后端或内存存储。

### 7.2 OAuth 流程

![OAuth 流程](diagrams/24-mcp-system-oauth.svg)

**OAuth 流程** — [交互版](diagrams/24-mcp-system-oauth.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-oauth.sequence.json)

- **组成**：7 个参与方
- **关系**：源图 8 条消息 · 画布展示前 5 条主链消息，其余列在要点
- **要点**：未上画布的调用：new token · 未上画布的调用：store token · 未上画布的调用：set key, value

## 8. MCP 协议类型

### 8.1 核心类型

```rust
// codex-rs/protocol/src/mcp.rs

pub struct CallToolResult {          // :351
    pub content: Vec<serde_json::Value>,
    pub structured_content: Option<serde_json::Value>,
    pub is_error: Option<bool>,
    // ...
}

pub struct Tool {                    // :243
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
    // annotations、output_schema 等可选字段
    // ...
}
```

### 8.2 协议版本

协议版本协商由 `rmcp` crate 承担；Codex 测试固定断言握手协商值为 `"2025-06-18"`（见 `codex-rs/rmcp-client/src/ema_auth_tests.rs:317`）。

## 9. 沙箱状态能力

### 9.1 能力声明

```rust
// codex-rs/codex-mcp/src/rmcp_client.rs:97

pub const MCP_SANDBOX_STATE_META_CAPABILITY: &str = "codex/sandbox-state-meta";
```

MCP server 可以声明 `codex/sandbox-state-meta` 能力，宿主据此感知 server 侧的沙箱状态元信息（CLI 的 `debug_sandbox` 也通过 `--sandbox-state-json` 消费同类元数据）。

### 9.2 沙箱状态更新

沙箱状态元信息作为请求 meta 传递：客户端在 `RequestMetaObject` 中附加能力标记（如 `RmcpClient::apply_read_only_tools_meta()` 中的只读工具标记），server 端按能力声明处理，而不是通过独立的更新通知方法。

## 10. 超时配置

```rust
// codex-rs/codex-mcp/src/rmcp_client.rs:106

pub(crate) const DEFAULT_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const DEFAULT_TOOL_TIMEOUT: Duration = Duration::from_secs(300);
```

## 11. Codex Apps 集成

### 11.1 工具缓存

Codex Apps MCP server 以固定名称注册，其工具列表走独立的运行时缓存：

```rust
// codex-rs/codex-mcp/src/mcp/mod.rs:64

pub const CODEX_APPS_MCP_SERVER_NAME: &str = "codex_apps";
```

缓存在 `codex-rs/codex-mcp/src/runtime.rs:89` 以 `codex_apps_tools_cache`（`ConnectorRuntimeManager<ToolInfo>`）承载，支持硬刷新（`latest_hard_refresh_codex_apps_tools_cache()`，:616）。

### 11.2 连接流程

![连接流程](diagrams/24-mcp-system-diagram-05.svg)

**连接流程** — [交互版](diagrams/24-mcp-system-diagram-05.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-diagram-05.architecture.json)

- **组成**：7 个节点
- **关系**：源图 7 条有向关系 · 画布按主链顺序排列，完整关系见下方要点与正文
- **要点**：启动 → 检查缓存 · 检查缓存 → 缓存存在? · 缓存存在? → 加载缓存工具（是）

## 12. 与 Claude Code 的差异

| 特性 | Claude Code | Codex |
| :------| :-------------| :-------|
| 客户端实现 | TypeScript `@modelcontextprotocol/sdk` | Rust `rmcp-client` |
| 传输类型 | Stdio, SSE, HTTP, WebSocket, in-process | Stdio, StreamableHttp, InProcess |
| 认证 | XAA, OAuth, Bearer Token | OAuth + Keyring |
| 工具名限定 | 无 | `__` 分隔符 |
| 审批 | `AskForApproval` 枚举 | 同上 |
| 沙箱集成 | 沙箱状态通知 | `codex/sandbox-state-meta` 能力声明 |
| 协议版本 | JSON-RPC 2.0 | `2025-06-18` |

## 13. 关键源码锚点

| 主题 | 代码锚点 | 说明 |
| :------| :----------| :------|
| 连接管理 | `codex-rs/codex-mcp/src/connection_manager.rs` | 生命周期管理 |
| RMCP 客户端 | `codex-rs/rmcp-client/src/rmcp_client.rs` | 核心客户端 |
| 工具调用 | `codex-rs/core/src/mcp_tool_call.rs` | 调用与审批 |
| 工具处理器 | `codex-rs/core/src/tools/handlers/mcp.rs` | 入口点 |
| OAuth | `codex-rs/rmcp-client/src/oauth.rs` | Token 管理 |
| 协议类型 | `codex-rs/protocol/src/mcp.rs` | 类型定义 |
| MCP 工具类型 | `codex-rs/codex-mcp/src/tools.rs` | `ToolInfo` 等运行时类型 |

## 14. 总结

Codex 的 MCP 系统特点：

1. **Rust-native 实现**：性能与内存安全
2. **RMCP 远程协议**：支持 stdio、StreamableHTTP 与进程内三种传输
3. **OAuth 集成**：Keyring 安全存储 token
4. **工具名称限定**：避免命名冲突
5. **审批策略**：灵活的批准触发条件
6. **沙箱集成**：通过能力声明支持沙箱状态同步

---

*文档版本: 1.0*
*分析日期: 2026-04-06*

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `McpConnectionSet` | `codex-rs/codex-mcp/src/connection_manager.rs` | 管理一组 MCP server 连接的发布视图：启动、就绪等待、关闭 |
| `McpConnectionSet::call_tool()` | `codex-rs/codex-mcp/src/connection_manager.rs:977` | 向目标 server 发送 `tools/call` 请求 |
| `list_available_server_infos()` | `codex-rs/codex-mcp/src/connection_manager.rs:1059` | 聚合各 server 的工具/能力状态 |
| `list_tools_with_connector_ids()` | `codex-rs/codex-mcp/src/rmcp_client.rs:678` | 拉取工具列表（含 connector id） |
| `RmcpClient` | `codex-rs/rmcp-client/src/rmcp_client.rs:402` | 单 server 的协议客户端，承载传输、握手与会话恢复 |
| `StoredOAuthTokens` | `codex-rs/rmcp-client/src/oauth.rs:105` | OAuth 凭证的持久化与刷新 |

---

## MCP 必须和 approval/sandbox 一起读

Codex 的 MCP 不只是“连接外部 server 并发现工具”。真正的横向差异在于 MCP 工具进入同一套 Rust tool orchestration 后，会被 approval policy、sandbox、network approval 和 output truncation 统一治理。

| 问题 | Codex 侧落点 |
| --- | --- |
| MCP 工具如何进入模型可见列表 | turn 前构建 tool specs，与内建工具一起进入 prompt/request |
| MCP 调用是否绕过审批 | 不应绕过；需要回到 `tools/orchestrator.rs` 和 `tools/sandboxing.rs` 判断 |
| MCP 结果如何回注 | 转为 tool output/thread item，进入下一轮 prompt |
| MCP dependency 如何影响 session | `state/session.rs` 记录 dependency prompt 状态 |

横向看，Codex MCP 的优势是治理统一；短板是读者需要跨 `06`、`13`、`14`、`24` 和工具章节才能看完整闭环。

## MCP Tool Call 到 Turn Loop 的调用链

![MCP Tool Call 到 Turn Loop 的调用链](diagrams/24-mcp-system-mcp-tool-call-turn-loop.svg)

**MCP Tool Call 到 Turn Loop 的调用链** — [交互版](diagrams/24-mcp-system-mcp-tool-call-turn-loop.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/24-mcp-system-mcp-tool-call-turn-loop.sequence.json)

- **组成**：10 个参与方
- **关系**：源图 8 条消息 · 画布展示前 5 条主链消息，其余列在要点
- **要点**：tools orchestrator 自调用：approval / sandbox / network policy · 未上画布的调用：call target server · 未上画布的调用：MCP result

这个链路说明 MCP 在 Codex 中不是旁路：tool spec 暴露、模型调用、审批沙箱、结果回注都进入同一套 turn/tool runtime。

## 源码锚点：MCP 必须串起配置、连接、工具调用和审批

| 源码位置 | 说明 | 横向意义 |
| --- | --- | --- |
| `sources/codex/codex-rs/config/src/mcp_types.rs:223` | `McpServerConfig` 配置结构 | 对应 Claude/Gemini MCP server config |
| `sources/codex/codex-rs/codex-mcp/src/connection_manager.rs:229` | `McpConnectionSet::new()` 连接集合创建 | 连接扩展与运行时 |
| `sources/codex/codex-rs/codex-mcp/src/connection_manager.rs:1059` | `list_available_server_infos()` 工具/资源状态聚合 | 对应 OpenCode MCP status |
| `sources/codex/codex-rs/core/src/mcp_tool_call.rs` | MCP tool call 执行路径 | 对应 Gemini `mcp-client.ts` |
| `sources/codex/codex-rs/core/src/tools/handlers/mcp.rs` | MCP tool handler 入口 | 说明 MCP 最终进入工具治理 |
| `sources/codex/codex-rs/protocol/src/mcp.rs` | MCP 协议类型 | 对应 app-server / protocol 暴露面 |
