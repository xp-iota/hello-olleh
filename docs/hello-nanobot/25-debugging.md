---
title: "调试指南：日志、状态命令与定位路径"
---
# 调试指南：日志、状态命令与定位路径

> 基于 `sources/nanobot/nanobot/cli/commands.py`、`sources/nanobot/nanobot/config/paths.py` 与 `sources/nanobot/docs/troubleshooting.md` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 调试面总览](#1-调试面总览)
- [2. 日志](#2-日志)
- [3. 检视命令](#3-检视命令)
- [4. 常见问题定位路径](#4-常见问题定位路径)

---

## 1. 调试面总览

nanobot 的调试入口分三层：**日志**（loguru 文件与 stderr）、**检视命令**（`nanobot status`、`channels status`、`/status`）、**回合内 trace**（StateTraceEntry，见 [09-observability.md](./09-observability.md) §3）。由于一切状态都是文件（config.json + JSONL + Markdown），多数问题可以直接打开数据目录检查。

## 2. 日志

- 日志目录：`get_logs_dir()`（实例数据目录下 `logs/`）；
- CLI 交互模式默认压低日志输出（`_set_nanobot_logs`），排障时跑常驻形态或查看日志文件；
- 渠道/插件加载失败、legacy entry point、配置废弃键都以 warning 级记录——启动异常先翻日志头部。

## 3. 检视命令

| 命令 | 用途 |
| --- | --- |
| `nanobot status` | 配置、provider、会话总览 |
| `nanobot channels status` | 各渠道激活与错误（`_mark_channel_error` 的记录） |
| `nanobot channels login <name>` | 重跑渠道登录 |
| `/status`（聊天内） | 当前会话运行时状态 |
| `/model`（聊天内） | 当前 preset 与可切换项 |
| `/history`（聊天内） | 会话历史检视 |

## 4. 常见问题定位路径

| 症状 | 首选路径 |
| --- | --- |
| 消息无回复 | 看渠道错误标记 -> 日志 -> `GET /health`/gateway 18790 探活 |
| 模型报错兜底回复 | 日志找 provider 异常；`provider_retry_mode` 与 fallback 配置（[16-resilience.md](./16-resilience.md)） |
| 工具"不存在" | `ToolRegistry._suggest_name` 的纠错文本；MCP 名字清洗（[24-mcp-system.md](./24-mcp-system.md) §3） |
| 会话历史异常 | 直接读 `sessions/<key>.jsonl`；`_repair` 截尾记录见日志 |
| 配置不生效 | `config.json` 键名别名（camelCase/snake_case）与 `_migrate_config` 迁移；env 插值是否解析 |
| 回合卡住 | 回合 StateTraceEntry 找停在哪态；`/stop` 取消后重试 |
| 自动化不触发 | cron 目录与 `pending_cron_job_ids_for_session`；`nanobot trigger` 手动复现 |

## 源码锚点

- [`sources/nanobot/nanobot/cli/commands.py`](../../sources/nanobot/nanobot/cli/commands.py)：status/channels 命令与日志开关
- [`sources/nanobot/nanobot/config/paths.py`](../../sources/nanobot/nanobot/config/paths.py)：数据目录布局
- [`sources/nanobot/docs/troubleshooting.md`](../../sources/nanobot/docs/troubleshooting.md)：上游排障文档
