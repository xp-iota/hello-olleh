---
layout: content
title: "Plugin 系统：MCP 作为 Codex 的主要插件机制"
---
# Plugin 系统：MCP 作为 Codex 的主要插件机制

本文分析 Codex 的插件扩展机制。Codex 没有独立的 Plugin 子系统，而是以 **MCP（Model Context Protocol）** 作为唯一的外部工具接入标准。

**目录**

- [1. Codex 的插件哲学](#1-codex-的插件哲学)
- [2. MCP 配置与加载](#2-mcp-配置与加载)
- [3. MCP 工具注册流程](#3-mcp-工具注册流程)
- [4. 工具执行与隔离](#4-工具执行与隔离)
- [5. 权限控制](#5-权限控制)
- [6. 与其他系统 Plugin 机制的对比](#6-与其他系统-plugin-机制的对比)
- [7. 生态现状](#7-生态现状)

---

## 1. Codex 的插件哲学

Codex 的 Plugin 哲学比其他系统更为简洁：

```
内置工具（Rust 实现）
    + MCP 服务器（任意语言）
    = 完整工具集
```

不引入 Plugin 生命周期管理，不需要专门的插件沙箱——MCP 协议本身已经提供了进程隔离。

## 2. MCP 配置与加载

```toml
# ~/.config/codex/config.toml 或 .codex/config.toml
[[mcp_servers]]
name = "filesystem-extended"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"]

[[mcp_servers]]
name = "github"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "$GITHUB_TOKEN" }

[[mcp_servers]]
name = "custom-tool"
command = "/usr/local/bin/my-mcp-server"
args = []
```

### 配置字段说明

| 字段 | 类型 | 说明 |
| :------| :------| :------|
| `name` | string | MCP 服务器标识名 |
| `command` | string | 启动命令 |
| `args` | string[] | 命令参数 |
| `env` | object | 环境变量注入（支持 `$VAR` 引用） |
| `timeout_ms` | number | 工具调用超时（毫秒，默认 30000） |

## 3. MCP 工具注册流程

```rust
// codex-rs/core/src/mcp.rs
pub async fn discover_mcp_tools(
    servers: &[McpServerConfig],
) -> Vec<Tool> {
    let mut tools = Vec::new();
    for server in servers {
        let client = McpClient::connect(server).await?;
        let server_tools = client.list_tools().await?;
        tools.extend(server_tools.into_iter().map(|t| Tool {
            name: format!("{}:{}", server.name, t.name),
            description: t.description,
            input_schema: t.input_schema,
            executor: ToolExecutor::Mcp(client.clone()),
        }));
    }
    tools
}
```

MCP 工具以 `<server_name>:<tool_name>` 格式注册，避免命名冲突。

## 4. 工具执行与隔离

MCP 服务器作为独立进程运行，通过 stdin/stdout 进行 JSON-RPC 通信：

```
Codex Agent
    │
    │ JSON-RPC over stdio
    ▼
MCP Server Process（独立进程）
    │
    │ 访问外部资源
    ▼
文件系统 / API / 数据库
```

**进程级隔离**：MCP 服务器崩溃不影响 Codex 主进程，仅该工具不可用。

## 5. 权限控制

Codex 通过 `approval_policy` 对 MCP 工具调用进行权限控制：

```toml
[approval]
# 自动批准安全工具（只读类）
auto_approve_tools = [
    "filesystem-extended:read_file",
    "filesystem-extended:list_directory",
]
# 需要用户确认的工具
require_approval_tools = [
    "filesystem-extended:write_file",
    "github:create_pull_request",
]
```

## 6. 与其他系统 Plugin 机制的对比

| 特性 | Codex | Claude Code | Gemini CLI | OpenCode |
| :------| :-------| :-------------| :-----------| :---------|
| **插件协议** | MCP only | MCP + 内置 Skills | MCP（带 trust 级别）| MCP + 自定义 |
| **进程隔离** | 进程级（stdio） | 进程级 | 进程级 | 进程级 |
| **发现机制** | config.toml 显式配置 | settings.json | settings.json | 配置文件 |
| **信任模型** | approval_policy | 工具权限系统 | `trust: trusted/untrusted` | 用户授权 |
| **Plugin 沙箱** | 无额外沙箱（MCP 进程隔离） | MCP 进程隔离 | MCP 进程隔离 | MCP 进程隔离 |

## 7. 生态现状

Codex 可以使用所有标准 MCP 服务器（与语言/框架无关），包括：

- `@modelcontextprotocol/server-filesystem` — 文件系统扩展
- `@modelcontextprotocol/server-github` — GitHub API
- `@modelcontextprotocol/server-postgres` — PostgreSQL
- 用户自定义 MCP 服务器

**MCP 协议的开放性**确保了 Codex 的 Plugin 生态与整个 MCP 生态共享，无需维护独立的插件仓库。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `McpClient::new()` | `codex-rs/mcp-client/src/lib.rs` | MCP 客户端工厂：初始化 stdio/HTTP 连接 |
| `McpClient::call_tool()` | `codex-rs/mcp-client/src/lib.rs` | 发送 tools/call 请求并返回结果 |
| `ToolRegistry::register_mcp()` | `codex-rs/core/src/tool_registry.rs` | 将 MCP server 的工具注册到全局工具表 |
| `ConfigMcpServer` | `codex-rs/core/src/config.rs` | config.toml 中 MCP server 定义结构：command/args/env/type |
| `mcp_server_list()` | `codex-rs/core/src/config.rs` | 从配置中读取所有已配置 MCP server 列表 |
| connection health check | `codex-rs/mcp-client/src/lib.rs` | 定期 ping MCP server 检测连接存活 |

---

## 代码质量评估

**优点**

- **Rust 实现 MCP 客户端**：相比 JS 实现，Rust MCP 客户端内存安全、无 GC 暂停，适合高频工具调用场景。
- **stdio/HTTP 双模式支持**：同一 `McpClient` 接口支持子进程 stdio 和远程 HTTP 两种传输，切换无需改调用代码。
- **工具注册中心化**：所有 MCP 工具通过 `ToolRegistry` 统一注册，工具调用路径一致，避免 built-in/MCP 双重路径。

**风险与改进点**

- **MCP 连接无自动重连**：连接断开后不会自动重连，依赖调用方检测错误后重新初始化客户端。
- **子进程 MCP server 生命周期不托管**：codex 退出时子进程 MCP server 未被显式终止，可能留下孤儿进程。
- **MCP 工具 schema 无版本管理**：server 更新工具 schema 后 codex 无通知机制，cached schema 与实际实现可能不一致。

## 横向对齐补强：Codex Plugin 主体是 MCP，而不是 JS 插件市场

Codex 当前应按“外部能力通过 MCP 进入 Rust runtime”来理解 plugin 系统。和 Claude Code/OpenCode 的 plugin 生命周期不同，Codex 的插件性主要体现在 MCP server、tool spec、approval/sandbox 统一治理。

| 层级 | Codex 对应物 | 对齐说明 |
| --- | --- | --- |
| 插件发现 | MCP 配置与 skill dependency | 不以 JS/TS plugin package 为主 |
| 工具注册 | `ToolRegistry` / MCP tool spec | MCP 工具进入统一工具池 |
| 执行治理 | `tools/orchestrator.rs`, `tools/sandboxing.rs` | 外部工具仍要经过 approval/sandbox |
| 传输 | stdio / HTTP / SSE MCP transport | 对应 Claude/OpenCode/Gemini 的 MCP transport |

横向读 `14-plugin-system.md` 时，应把 Codex 的“plugin”解释为 protocol-level extensibility，而不是应用内插件框架。
