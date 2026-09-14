---
title: "架构全景：单包分层与两层循环"
---
# 架构全景：单包分层与两层循环

> 基于 `sources/nanobot/nanobot/` 与 `sources/nanobot/docs/architecture.md` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 总体形态](#1-总体形态)
- [2. 包结构与职责](#2-包结构与职责)
- [3. 两层循环：AgentLoop 与 AgentRunner](#3-两层循环agentloop-与-agentrunner)
- [4. 数据流主干](#4-数据流主干)
- [5. 部署形态](#5-部署形态)

---

## 1. 总体形态

nanobot 是单 Python 包架构（`pyproject.toml` 包名 `nanobot-ai`，运行时包 `nanobot/`），要求 Python ≥ 3.11。与多包 monorepo（如 OpenCode v2）不同，它把所有运行时代码放在一个包内，用子模块划界：`agent/` 是推理核心，`channels/` 是聊天接入，`bus/` 是消息总线，`providers/` 是模型接入，`session/`、`config/`、`security/` 等是支撑服务。入口是 `python -m nanobot`（`__main__.py`）或安装后的 `nanobot` CLI。

## 2. 包结构与职责

| 子包 | 职责 |
| --- | --- |
| `agent/` | 推理核心：`loop.py`（AgentLoop）、`runner.py`（AgentRunner）、`context.py`（ContextBuilder）、`memory.py`、`subagent.py`、`skills.py`、`hook.py`、`autocompact.py`、`context_governance.py`、`tools/` |
| `bus/` | 消息总线：`events.py`（Inbound/OutboundMessage）、`queue.py`（MessageBus）、`runtime_events.py` |
| `channels/` | 17 个自包含聊天渠道包 + `base.py`/`contracts.py`/`registry.py`/`manager.py` |
| `providers/` | 模型接入：`registry.py`（45 个 ProviderSpec）、`factory.py`、`fallback_provider.py`、各供应商实现 |
| `session/` | JSONL 会话持久化（`manager.py`） |
| `config/` | pydantic 配置 schema、加载器、路径助手 |
| `cli/` | typer 命令树（`commands.py` 约 2700 行） |
| `command/` | 聊天内 slash 命令路由与内建命令 |
| `api/` | OpenAI 兼容 HTTP 服务（aiohttp） |
| `webui/` | 浏览器 UI 服务（aiohttp，约 30 个模块） |
| `gateway/` | 常驻进程编排与健康端口 |
| `cron/`、`triggers/` | 定时与本地触发自动化 |
| `sdk/` | 进程内 Python SDK |
| `security/` | 工作区边界与 SSRF 防护 |
| `templates/` | prompt 模板与身份文件（SOUL.md、AGENTS.md、HEARTBEAT.md 等） |

## 3. 两层循环：AgentLoop 与 AgentRunner

nanobot 把"agent 循环"拆成两个类，这是它区别于其他 CLI 的核心结构：

- **`AgentLoop`（`agent/loop.py`）面向渠道**：按回合（turn）组织工作，维护 `TurnState` 状态机（RESTORE -> COMPACT -> COMMAND -> BUILD -> RUN -> SAVE -> RESPOND -> DONE），负责会话恢复、命令分发、上下文构建、持久化与回投。它知道渠道、会话键、cron/trigger 回合。
- **`AgentRunner`（`agent/runner.py`）面向模型**：接收一个 `AgentRunSpec`（max_iterations、注入回调、错误文案等），执行"请求模型 -> 执行工具 -> 回流"的迭代循环，直到模型停止调用工具或触达迭代上限。它不知道渠道存在。

拆分的收益：Runner 可以被子代理、SDK、cron 复用而不拖入渠道语义；Loop 可以把持久化、命令、注入等渠道侧关切集中在一处。

## 4. 数据流主干

```
渠道(telegram/feishu/...) --InboundMessage--> MessageBus.publish_inbound
  -> AgentLoop._dispatch -> TurnContext(TurnState 状态机)
    -> ContextBuilder 组装 messages -> AgentRunner.run(spec)
      -> LLMProvider.chat <-> ToolRegistry 执行 -> 迭代
  -> Session 持久化(JSONL) -> OutboundMessage -> MessageBus.publish_outbound -> 渠道发送
```

`InboundMessage.session_key` 默认是 `{channel}:{chat_id}`（可被 `session_key_override` 覆盖实现线程级会话），这个键贯穿会话存储、取消与自动化。

## 5. 部署形态

- **CLI 前台**：`nanobot agent`（单条/交互）、`nanobot trigger`。
- **常驻 gateway**：`nanobot gateway` 安装 systemd/launchd 服务，健康端口默认 `18790`（`GatewayConfig.port`）。
- **WebUI**：`nanobot webui`，默认端口 `8765`。
- **OpenAI 兼容 API**：`nanobot serve`，暴露 `/v1/chat/completions`、`/v1/models`、`/health`。
- **容器**：根目录 `Dockerfile` 与 `docker-compose.yml`（含 bwrap 沙箱变体）。

## 源码锚点

- [`sources/nanobot/nanobot/agent/loop.py`](../../sources/nanobot/nanobot/agent/loop.py)：AgentLoop 与 TurnState
- [`sources/nanobot/nanobot/agent/runner.py`](../../sources/nanobot/nanobot/agent/runner.py)：AgentRunner 与 AgentRunSpec
- [`sources/nanobot/nanobot/bus/events.py`](../../sources/nanobot/nanobot/bus/events.py)：Inbound/OutboundMessage
- [`sources/nanobot/docs/architecture.md`](../../sources/nanobot/docs/architecture.md)：上游架构说明
