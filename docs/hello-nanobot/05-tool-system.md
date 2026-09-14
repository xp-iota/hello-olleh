---
title: "工具系统：Tool 契约、注册表与内建工具"
---
# 工具系统：Tool 契约、注册表与内建工具

> 基于 `sources/nanobot/nanobot/agent/tools/` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. Tool 契约](#1-tool-契约)
- [2. ToolRegistry：查找、纠错与执行](#2-toolregistry查找纠错与执行)
- [3. ToolLoader：内建发现与插件](#3-toolloader内建发现与插件)
- [4. 内建工具地图](#4-内建工具地图)
- [5. 运行时上下文工具](#5-运行时上下文工具)

---

## 1. Tool 契约

`base.py` 定义三个抽象：

- `Schema`：JSON Schema 的类型解析（`resolve_json_schema_type`）、值校验（`validate_json_schema_value`，返回错误路径列表而非抛异常）与片段导出；
- `ToolResult(str)`：结果就是字符串，附 `is_error` 标记（`ToolResult.error(...)` 构造错误结果）——刻意简单，方便直接回流给模型；
- `Tool`（ABC）：`name` / `description` 属性加参数 schema，子类实现执行体。

## 2. ToolRegistry：查找、纠错与执行

`registry.py` 的 `ToolRegistry`：

- 注册面：`register` / `unregister` / `get` / `has` / `tool_names` / `__contains__`；查找键经 `_lookup_key` 归一化，找不到时 `_suggest_name` 给出"你是不是想调用 X"的纠错建议（直接写回给模型的错误文本里）；
- 定义导出：`get_definitions()` 生成给模型的工具声明（按 `_schema_name` 去重）；
- 调用面：`prepare_call(...)` 做参数规整——`_coerce_argument_value` / `_coerce_params` 把模型给的松散参数向 schema 收敛，`_unwrap_arguments_payload` 解开嵌套 arguments；`execute(name, params)` 执行并统一包装结果；
- `is_tool_error_result(name, result)` 供 runner 判定工具结果是否错误（配合 `fail_on_tool_error`）。

## 3. ToolLoader：内建发现与插件

`loader.py` 的 `ToolLoader.discover()`：

1. 扫描 `agent/tools/` 包内所有 `Tool` 子类（`package` 可注入以便测试，`test_classes` 直接注入类）；
2. `_discover_plugins()` 经 `importlib.metadata.entry_points` 发现第三方工具插件（见 [14-plugin-system.md](./14-plugin-system.md)）。

`AgentLoop._register_default_tools` 把发现的类实例化进注册表；MCP 工具由 `tools/mcp.py` 在 `_connect_mcp` 时动态注册（见 [24-mcp-system.md](./24-mcp-system.md)）。

## 4. 内建工具地图

| 文件 | 能力 |
| --- | --- |
| `filesystem.py` / `apply_patch.py` / `path_utils.py` | 文件读写、补丁应用、路径安全 |
| `shell.py` / `exec_session.py` / `sandbox.py` | shell 执行、持久 exec 会话、沙箱 |
| `web.py` / `search.py` | 网页抓取（readability）与 ddgs 搜索 |
| `message.py`（MessageTool） | 回合内向其他渠道发消息 |
| `spawn.py` | 派生子代理（见 [12-multi-agent.md](./12-multi-agent.md)） |
| `cron.py` / `long_task.py` | 定时任务与长任务管理 |
| `image_generation.py` | 图像生成（经 provider 的 image 能力） |
| `self.py`（MyTool） / `runtime_state.py` | 检视自身配置与运行时状态 |
| `cli_apps.py` | 调用本机 CLI 应用 |
| `file_state.py` / `context.py` | 文件状态跟踪与请求上下文绑定 |
| `mcp.py` | MCP server 工具的动态适配 |

## 5. 运行时上下文工具

`tools/context.py` 提供 `RequestContext` 与 `bind_request_context` / `reset_request_context`：把当前回合的请求上下文（渠道、会话键等）绑到 contextvar，让任何工具在执行时都能感知"我在替谁服务"而不用显式传参。`registry.get_runtime_context_providers()` 收集实现了 `RuntimeContextProvider` 的工具，让工具可以向 system prompt 注入动态上下文块（见 [11-prompt-system.md](./11-prompt-system.md)）。

## 源码锚点

- [`sources/nanobot/nanobot/agent/tools/base.py`](../../sources/nanobot/nanobot/agent/tools/base.py)：Tool/Schema/ToolResult 契约
- [`sources/nanobot/nanobot/agent/tools/registry.py`](../../sources/nanobot/nanobot/agent/tools/registry.py)：ToolRegistry
- [`sources/nanobot/nanobot/agent/tools/loader.py`](../../sources/nanobot/nanobot/agent/tools/loader.py)：ToolLoader
- [`sources/nanobot/nanobot/agent/tools/`](../../sources/nanobot/nanobot/agent/tools)：内建工具目录
