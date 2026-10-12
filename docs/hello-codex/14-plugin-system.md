---
title: "Plugin 系统：MCP 作为 Codex 的主要插件机制"
---
# Plugin 系统：MCP 作为 Codex 的主要插件机制

本文分析 Codex 的插件扩展机制。Codex 以 **MCP（Model Context Protocol）** 作为外部工具接入标准；插件（plugin）则是把 skills、MCP server 与 apps 打包在一起的本地资产，由 `codex-core-plugins` 的 `PluginsManager` 统一发现与加载（`sources/codex/codex-rs/core-plugins/src/manager.rs:548`）。

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
    + plugin（skills / MCP servers / apps 的本地打包）
    = 完整工具集
```

plugin 本身不引入独立的生命周期沙箱——它复用 MCP 的进程隔离与 skill 的 prompt 注入路径；MCP 协议本身已经提供了进程隔离。

## 2. MCP 配置与加载

```toml
# ~/.codex/config.toml
[mcp_servers.filesystem-extended]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"]

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env_vars = ["GITHUB_TOKEN"]

[mcp_servers.remote-tool]
url = "https://example.com/mcp"
bearer_token_env_var = "REMOTE_TOOL_TOKEN"
```

### 配置字段说明

| 字段 | 类型 | 说明 |
| :------| :------| :------|
| `command` / `args` / `env` | string / string[] / map | stdio 传输：启动命令、参数与环境变量 |
| `url` / `bearer_token_env_var` / `http_headers` | string | streamable HTTP 传输与鉴权头 |
| `env_vars` | list | 声明要透传给子进程的环境变量名（`sources/codex/codex-rs/config/src/mcp_types.rs:99`） |
| `startup_timeout_sec` | number | 初始化 server 与首次 list_tools 的超时（秒） |
| `tool_timeout_sec` | number | 该 server 上工具调用的默认超时 |
| `default_tools_approval_mode` | string | 该 server 工具的默认审批档位（见 §5） |

## 3. MCP 工具注册流程

MCP 工具的发现由 `McpManager` 驱动：它根据 config 建立连接、列出工具并维护工具目录缓存（`sources/codex/codex-rs/core/src/mcp.rs:104`），实际调用经连接管理器转发（`sources/codex/codex-rs/codex-mcp/src/connection_manager.rs:977` 的 `call_tool()`）。

模型可见的工具名是 `mcp__<server>__<tool>` 形式的 namespaced 名称，避免命名冲突（`sources/codex/codex-rs/protocol/src/tool_name.rs:32` 的 `ToolName::namespaced()`；`sources/codex/codex-rs/codex-mcp/src/tools.rs:58` 的 `canonical_tool_name()`）。

## 4. 工具执行与隔离

MCP 服务器作为独立进程运行，通过 stdin/stdout 进行 JSON-RPC 通信：

![工具执行与隔离](diagrams/14-plugin-system-diagram.svg)

**工具执行与隔离** — [交互版](diagrams/14-plugin-system-diagram.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/14-plugin-system-diagram.architecture.json)

- **组成**：5 个节点
- **关系**：源图为文本框图，未提供可解析的有向关系 · 画布按源图中的出现顺序串联，供顺序阅读
- **要点**：首节点：CodexThread · 末节点：文件系统 / API / 数据库

**进程级隔离**：MCP 服务器崩溃不影响 Codex 主进程，仅该工具不可用。

## 5. 权限控制

Codex 通过两层机制对 MCP 工具调用进行权限控制：

- **server 级默认审批档位**：`McpServerConfig.default_tools_approval_mode` 取 `AppToolApproval` 枚举值（`auto` / `prompt` / `writes` / `approve`，`sources/codex/codex-rs/config/src/mcp_types.rs:28`），决定该 server 工具默认免批、每次提示还是写操作提示。
- **线程级 approval policy**：`approval_policy` 与沙箱策略仍然约束真实执行，MCP 工具不因来自外部 server 而绕过审批链路（`sources/codex/codex-rs/core/src/tools/approvals.rs`）。

## 6. 与其他系统 Plugin 机制的对比

| 特性 | Codex | Claude Code | Gemini CLI | OpenCode |
| :------| :-------| :-------------| :-----------| :---------|
| **插件协议** | MCP + plugin 打包（skills/MCP/apps） | MCP + 内置 Skills | MCP（带 trust 级别）| MCP + 自定义 |
| **进程隔离** | 进程级（stdio） | 进程级 | 进程级 | 进程级 |
| **发现机制** | config.toml 显式配置 + plugin 安装 | settings.json | settings.json | 配置文件 |
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
| `McpManager` | `codex-rs/core/src/mcp.rs:104` | MCP 运行时入口：解析配置、维护连接与工具目录缓存 |
| `ConnectionManager::call_tool()` | `codex-rs/codex-mcp/src/connection_manager.rs:977` | 向对应 server 发送 tools/call 请求并返回结果 |
| `McpServerConfig` | `codex-rs/config/src/mcp_types.rs:223` | config.toml 中 MCP server 定义结构：transport/env/timeout/approval |
| `AppToolApproval` | `codex-rs/config/src/mcp_types.rs:28` | server/工具级审批档位：auto / prompt / writes / approve |
| `ToolRegistry` | `codex-rs/core/src/tools/registry.rs:307` | 统一工具注册表，MCP 工具与内置工具共享同一调用路径 |
| `ToolName::namespaced()` | `codex-rs/protocol/src/tool_name.rs:32` | 生成 `mcp__<server>__<tool>` 形式的模型可见工具名 |

---

## 代码质量评估

**优点**

- **Rust 实现 MCP 客户端**：相比 JS 实现，Rust MCP 客户端内存安全、无 GC 暂停，适合高频工具调用场景。
- **stdio/HTTP 双模式支持**：`McpServerTransportConfig` 同时覆盖子进程 stdio 与 streamable HTTP 两种传输（`codex-rs/config/src/mcp_types.rs:614`），切换无需改调用代码。
- **工具注册中心化**：所有 MCP 工具通过 `ToolRegistry` 统一注册，工具调用路径一致，避免 built-in/MCP 双重路径。

**风险与改进点**

- **MCP 连接无自动重连**：连接断开后不会自动重连，依赖调用方检测错误后重新初始化客户端。
- **子进程 MCP server 生命周期不托管**：codex 退出时子进程 MCP server 未被显式终止，可能留下孤儿进程。
- **MCP 工具 schema 无版本管理**：server 更新工具 schema 后 codex 无通知机制，cached schema 与实际实现可能不一致。

## Codex Plugin 是本地打包资产，外部能力仍走 MCP

Codex 当前应按“外部能力通过 MCP 进入 Rust runtime，plugin 把 skills/MCP/apps 打包成可安装的本地资产”来理解 plugin 系统。和 Claude Code/OpenCode 的 plugin 生命周期不同，Codex 的插件治理主要体现在 plugin 安装、MCP server、tool spec、approval/sandbox 统一治理。

| 层级 | Codex 对应物 | 对齐说明 |
| --- | --- | --- |
| 插件发现 | plugin 安装与 skill dependency（`codex-rs/core-plugins/src/manager.rs:548`） | 不以 JS/TS plugin package 为主 |
| 工具注册 | `ToolRegistry` / MCP tool spec | MCP 工具进入统一工具池 |
| 执行治理 | `tools/orchestrator.rs`, `tools/sandboxing.rs` | 外部工具仍要经过 approval/sandbox |
| 传输 | stdio / streamable HTTP MCP transport | 对应 Claude/OpenCode/Gemini 的 MCP transport |

横向读 `14-plugin-system.md` 时，应把 Codex 的“plugin”解释为 protocol-level extensibility 加本地能力打包，而不是应用内插件框架。
