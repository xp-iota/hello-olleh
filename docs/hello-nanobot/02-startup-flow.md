---
title: "启动链路：typer 命令树与常驻形态"
---
# 启动链路：typer 命令树与常驻形态

> 基于 `sources/nanobot/nanobot/cli/`、`sources/nanobot/nanobot/gateway/` 与 `sources/nanobot/nanobot/config/loader.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 入口与命令树](#1-入口与命令树)
- [2. 配置加载时机](#2-配置加载时机)
- [3. onboard 向导](#3-onboard-向导)
- [4. agent：前台回合](#4-agent前台回合)
- [5. gateway 与常驻形态](#5-gateway-与常驻形态)

---

## 1. 入口与命令树

入口是 `nanobot/__main__.py` -> `cli/commands.py` 的 typer `app`。`main()` 回调处理全局选项（`--version` 经 `version_callback`）。命令树：

| 命令 | 作用 |
| --- | --- |
| `nanobot onboard` | 初始化/刷新 `config.json` 与工作区（`--wizard` 交互向导、`--refresh` 保留现有设置的非交互刷新） |
| `nanobot agent` | 前台跑回合：单条消息或 prompt-toolkit 交互 REPL |
| `nanobot trigger` | 触发一次本地 automation turn |
| `nanobot serve` | 启动 OpenAI 兼容 API（aiohttp） |
| `nanobot webui` | 启动浏览器 UI（默认端口 8765） |
| `nanobot status` | 检视配置、provider 与会话状态 |
| `nanobot gateway ...` | 常驻服务编排（`cli/gateway.py` 的 `create_gateway_app` 子树） |
| `nanobot channels status/login` | 渠道检视与登录（`channels_app` 子树） |
| `nanobot plugins ...` / `nanobot provider ...` | 插件与 provider 管理子树 |

## 2. 配置加载时机

`config/loader.py` 的 `get_config_path()` 默认解析到 `~/.nanobot/config.json`；`--config` 选项经 `set_config_path()` 覆盖。`load_config()` 负责读取、`_migrate_config()` 迁移旧键、`resolve_env_refs` 做环境变量插值、`_apply_ssrf_whitelist` 把配置里的 SSRF 白名单灌进 `security/network.py`。各命令在真正构造运行时才调用加载（`_load_runtime_config`），保证 `nanobot status` 这类检视命令不需要完整运行时。

## 3. onboard 向导

`onboard` 命令（commands.py L630 起）的决策树：

1. 解析 `--config` / `--workspace` 覆盖；
2. 配置已存在时：`--wizard` 走交互重配，`--refresh` 走 `merge_missing_defaults` 合入新增默认值，否则提示用户；
3. 写入 `config.json` 并初始化工作区（身份文件、memory 目录等）；
4. `_onboard_plugins()` 处理随安装检测到的插件。

## 4. agent：前台回合

`nanobot agent`（commands.py L2236 起）是最常用的前台形态：构造 `AgentLoop.from_config(...)`，连接 MCP（`_connect_mcp`），然后要么跑单条消息，要么进入 prompt-toolkit 交互循环（见 [20-repl-and-state.md](./20-repl-and-state.md)）。交互模式的关键细节：`_init_prompt_session()` 用 `SafeFileHistory`（容错的历史文件）、`_build_cli_key_bindings()` 自定义键绑定、`_restore_terminal()` 保证退出时恢复终端。

## 5. gateway 与常驻形态

`gateway/` 把 nanobot 跑成常驻服务：

- `gateway/runtime.py`：`GatewayRuntime` 与 `build_gateway_command`，负责组装常驻进程的启动命令；
- `gateway/service.py`：`GatewayServiceInstaller` 把服务安装为 systemd unit（Linux）或 launchd plist（macOS）；
- 健康检查端口默认 `18790`（`config/schema.py` 的 `GatewayConfig.port`）；
- `_install_gateway_shutdown_handlers()` 注册信号处理器，保证 SIGTERM/SIGINT 时渠道、总线与会话都能 flush 后退出。

常驻形态下，channels、cron、local triggers 作为命名 asyncio 任务并行启动（如 `asyncio.create_task(channels.start_all(), name="nanobot-channels")`），共享同一个 `AgentLoop` 与 `MessageBus`。

## 源码锚点

- [`sources/nanobot/nanobot/cli/commands.py`](../../sources/nanobot/nanobot/cli/commands.py)：typer 命令树
- [`sources/nanobot/nanobot/cli/gateway.py`](../../sources/nanobot/nanobot/cli/gateway.py)：gateway 子命令
- [`sources/nanobot/nanobot/config/loader.py`](../../sources/nanobot/nanobot/config/loader.py)：配置加载与迁移
- [`sources/nanobot/nanobot/gateway/`](../../sources/nanobot/nanobot/gateway)：常驻服务运行时与安装器
