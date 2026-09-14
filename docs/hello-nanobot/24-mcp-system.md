---
title: "MCP 系统：连接管理、工具适配与容错"
---
# MCP 系统：连接管理、工具适配与容错

> 基于 `sources/nanobot/nanobot/agent/tools/mcp.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. MCP 在 nanobot 的位置](#1-mcp-在-nanobot-的位置)
- [2. 连接管理](#2-连接管理)
- [3. 工具名适配](#3-工具名适配)
- [4. 容错设计](#4-容错设计)

---

## 1. MCP 在 nanobot 的位置

MCP 是唯一的"动态远端工具"来源：配置里的 `MCPServerConfig` 列表由 `AgentLoop._connect_mcp()` 在启动时连接，`agent/tools/mcp.py` 把每个远端工具适配成本地 `Tool` 注册进 ToolRegistry——此后模型看到的是与内建工具同构的声明（见 [05-tool-system.md](./05-tool-system.md)）。`agent/context.py` 提供独立的 `connect_mcp(state, tools)` / `close_mcp(state)` 供子代理等复用方走同一管线。

## 2. 连接管理

- `MCPConnection`（Protocol）抽象连接面；`_OwnedMCPConnection` 包装"本进程派生、本进程回收"的连接；
- HTTP 传输在连接前 `_probe_http_url(url, timeout=3.0)` 探活，日志里 `_redact_url` 脱敏；
- 连接生命周期挂在 AgentLoop 上，进程关停统一关闭。

## 3. 工具名适配

远端工具名进入本地前要过两道清洗：

- `_sanitize_name` 去掉 provider 不允许的字符；
- `_limit_tool_name(name, max_length=_MAX_TOOL_NAME_LENGTH)` 截断超长名（不同 provider 对工具名长度有硬限制）；
- 组合入口 `_sanitize_mcp_tool_name`。

这一步把"MCP server 的自由命名"约束到"所有 provider 都能接受"的子集，避免工具声明被 provider 拒绝。

## 4. 容错设计

| 问题 | 机制 |
| --- | --- |
| 畸形进度通知 | `_filter_malformed_mcp_progress_notifications` 包一层流，过滤缺 token/形状的进度通知，防止污染主流 |
| 瞬时错误 | `_is_transient(exc)` 判定可重试 |
| 会话终结 | `_is_session_terminated(exc)` 判定后不再重试，直接拆除 |
| 单 server 失败 | 只影响该 server 的工具，其他 server 与内建工具不受影响 |

JSON-RPC 层 `_mcp_jsonrpc_payload` / `_payload_value` / `_progress_params_have_token` 负责从流消息里安全提取载荷。

## 源码锚点

- [`sources/nanobot/nanobot/agent/tools/mcp.py`](../../sources/nanobot/nanobot/agent/tools/mcp.py)：MCP 连接与适配
- [`sources/nanobot/nanobot/config/schema.py`](../../sources/nanobot/nanobot/config/schema.py)：MCPServerConfig
- [`sources/nanobot/nanobot/webui/mcp_presets_api.py`](../../sources/nanobot/nanobot/webui/mcp_presets_api.py)：WebUI 的 MCP 预设管理
