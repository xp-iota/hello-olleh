---
title: "配置：config.json、pydantic schema 与环境变量"
---
# 配置：config.json、pydantic schema 与环境变量

> 基于 `sources/nanobot/nanobot/config/`（schema.py、loader.py、watcher.py、paths.py）中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 配置文件与路径](#1-配置文件与路径)
- [2. schema 结构](#2-schema-结构)
- [3. 加载管线](#3-加载管线)
- [4. 环境变量插值](#4-环境变量插值)
- [5. watch 与运行时刷新](#5-watch-与运行时刷新)

---

## 1. 配置文件与路径

默认配置是 `~/.nanobot/config.json`（`config/loader.py` L31）；`--config` 经 `set_config_path` 覆盖。`config/paths.py` 从配置路径派生实例数据目录：`get_data_dir()`（配置文件的父目录）、`get_runtime_subdir(name)`，以及 `media/`、`cron/`、`logs/`、`webui/` 等命名子目录——**配置位置决定一切运行时产物的位置**，多实例就是多份配置（见 `docs/multiple-instances.md`）。

## 2. schema 结构

`config/schema.py`（pydantic，基类 `Config(BaseSettings)`）的主要分组：

| 类 | 覆盖 |
| --- | --- |
| `AgentsConfig` / `AgentDefaults` / `ModelPresetConfig` | agent 默认值、工作区、模型 preset（命名的一套模型+参数） |
| `ProvidersConfig` / `ProviderConfig` / `BedrockProviderConfig` | 45 个 provider 的凭据与端点 |
| `ChannelsConfig` | 各渠道开关与凭据 |
| `GatewayConfig`（port 18790）/ `ApiConfig` / `HeartbeatConfig` | 常驻、API 与心跳 |
| `ToolsConfig` / `MCPServerConfig` | 工具开关与 MCP server 列表 |
| `DreamConfig` / `TranscriptionConfig` / `InlineFallbackConfig` | Dream、语音转写、行内 fallback |

配置键同时接受 camelCase 与 snake_case 别名（pydantic alias），兼容不同版本写法的存量配置。

## 3. 加载管线

`load_config(config_path=None)` 的顺序：

1. 读 JSON；
2. `_migrate_config(data)` 迁移废弃键（旧版本配置平滑升级）；
3. pydantic 校验成 `Config`；
4. `resolve_config_env_vars` 做环境变量插值；
5. `_apply_ssrf_whitelist(config)` 把安全相关配置灌进运行时（见 [07-error-security.md](./07-error-security.md)）。

`save_config` 写回；`merge_missing_defaults(existing, defaults)` 支撑 `onboard --refresh` 的"只补新增默认值"。

## 4. 环境变量插值

`resolve_env_refs(value)` 把配置字符串里的 `$ENV_VAR` / `${ENV_VAR}` 形式的引用替换为环境变量值（`_resolve_in_place` / `_env_replace` 递归处理嵌套结构）——密钥不落明文配置文件的官方做法。`_warn_deprecated_config_keys` 在加载后对废弃键告警。

## 5. watch 与运行时刷新

`config/watcher.py` 的 `watch_config_file(config_path, on_change)` 用 watchfiles 的 `awatch` 监听配置文件变更（`is_config_file` 过滤掉临时文件抖动），变更回调触发运行时侧的 `AgentLoop.invalidate_runtime_config()` 重建运行时配置。模型 preset 的运行时切换走 `set_session_model_preset` / `set_model_preset`（见 [03-agent-loop.md](./03-agent-loop.md)），不需要改文件。

## 源码锚点

- [`sources/nanobot/nanobot/config/schema.py`](../../sources/nanobot/nanobot/config/schema.py)：配置 schema
- [`sources/nanobot/nanobot/config/loader.py`](../../sources/nanobot/nanobot/config/loader.py)：加载、迁移、插值
- [`sources/nanobot/nanobot/config/watcher.py`](../../sources/nanobot/nanobot/config/watcher.py)：配置 watch
- [`sources/nanobot/docs/configuration.md`](../../sources/nanobot/docs/configuration.md)：上游配置文档
