---
title: "项目初始化报告：仓库总览与阅读入口"
---
# 项目初始化报告：仓库总览与阅读入口

> 基于 `sources/nanobot/` 中的 nanobot `v0.3.0` 源码校对。本文是首次进入仓库时的总览报告。

**目录**

- [1. 仓库元信息](#1-仓库元信息)
- [2. 顶层目录地图](#2-顶层目录地图)
- [3. 包内模块地图](#3-包内模块地图)
- [4. 权威文档位置](#4-权威文档位置)
- [5. 推荐阅读路径](#5-推荐阅读路径)

---

## 1. 仓库元信息

| 项 | 值 |
| --- | --- |
| 包名 / 版本 | `nanobot-ai` / `0.3.0`（PyPI）；仓库 HKUDS/nanobot |
| 运行时 | Python ≥ 3.11；关键依赖 typer、anthropic、pydantic、httpx、loguru、prompt-toolkit、croniter、websockets |
| 许可证 | MIT |
| 定位 | 轻量级个人 AI 助手框架（"ultra-lightweight personal AI agent you can truly own"） |
| 测试 | `tests/` + `conftest.py`（pytest） |

## 2. 顶层目录地图

| 路径 | 内容 |
| --- | --- |
| `nanobot/` | 运行时包（全部产品代码） |
| `docs/` | 上游文档：architecture、concepts、configuration、providers、deployment、memory、automations、chat-apps、cli-reference、python-sdk、openai-api、webui、websocket、channel-package-guide 等 |
| `tests/` | pytest 测试 |
| `webui/` | WebUI 前端资源 |
| `case/`、`images/`、`scripts/` | 案例、图片与脚本 |
| `Dockerfile`、`docker-compose.yml`、`docker-compose.bwrap.yml` | 容器化（含 bwrap 沙箱变体） |
| `AGENTS.md`、`CLAUDE.md`、`COMMUNICATION.md`、`CONTRIBUTING.md`、`SECURITY.md` | 贡献与社区文档 |

## 3. 包内模块地图

`nanobot/` 包内按职责分：`agent/`（循环、runner、上下文、记忆、子代理、skills、hooks、tools）、`channels/`（17 渠道）、`bus/`（消息总线）、`providers/`（45 个 provider 规格）、`session/`（JSONL）、`config/`（schema/loader/watcher/paths）、`cli/`（typer 命令树）、`command/`（聊天命令）、`api/`（OpenAI 兼容）、`webui/`（浏览器 UI）、`gateway/`（常驻）、`cron/` + `triggers/`（自动化）、`sdk/`（进程内 SDK）、`security/`（边界与 SSRF）、`templates/`（prompt 素材）、`pairing/`（渠道配对）、`audio/`、`apps/`、`utils/`。

## 4. 权威文档位置

| 文档 | 权威内容 |
| --- | --- |
| `docs/architecture.md` | 运行时架构（渠道 -> 总线 -> 循环 -> provider） |
| `docs/concepts.md` | 核心概念定义 |
| `docs/configuration.md` | 配置全量参考 |
| `docs/cli-reference.md` | CLI 命令参考 |
| `docs/channel-package-guide.md` | 渠道包开发契约 |
| `AGENTS.md` / `CONTRIBUTING.md` | 贡献者约定 |

## 5. 推荐阅读路径

先读 [01-architecture.md](./01-architecture.md) 建立分层模型，沿 [02-startup-flow.md](./02-startup-flow.md) -> [03-agent-loop.md](./03-agent-loop.md) -> [04-state-session-memory.md](./04-state-session-memory.md) 走通主链路；扩展面从 [06-extension-mcp.md](./06-extension-mcp.md) 分发。完整索引见 [README.md](./README.md)。

## 源码锚点

- [`sources/nanobot/pyproject.toml`](../../sources/nanobot/pyproject.toml)：版本与依赖
- [`sources/nanobot/nanobot/`](../../sources/nanobot/nanobot)：运行时包
- [`sources/nanobot/docs/`](../../sources/nanobot/docs)：上游文档
