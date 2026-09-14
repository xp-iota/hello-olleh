---
title: "SDK 与传输：进程内 SDK 与 OpenAI 兼容 API"
---
# SDK 与传输：进程内 SDK 与 OpenAI 兼容 API

> 基于 `sources/nanobot/nanobot/sdk/` 与 `sources/nanobot/nanobot/api/server.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 两个接入面](#1-两个接入面)
- [2. 进程内 SDK](#2-进程内-sdk)
- [3. 流式契约](#3-流式契约)
- [4. OpenAI 兼容 API](#4-openai-兼容-api)
- [5. 与其他 CLI 的对照](#5-与其他-cli-的对照)

---

## 1. 两个接入面

| 面 | 形态 | 适用 |
| --- | --- | --- |
| `sdk/` | 进程内 Python 调用（同一事件循环驱动 AgentLoop/Runner） | 嵌入、脚本、测试 |
| `api/` | aiohttp HTTP 服务，OpenAI 兼容 | 外部系统、其他语言 |

两者都复用同一个 `AgentRunner`——SDK 是"把 runner 包成 Python 对象"，API 是"把 runner 包成 HTTP 端点"。

## 2. 进程内 SDK

`sdk/` 的组成：

- `clients.py`：`SessionClient`（会话级调用）、`MemoryClient`（记忆读写）、`RuntimeClient`（运行时检视）；
- `runtime.py`：`ensure_single_model_selector` / `build_process_direct_kwargs` 帮调用方构造直接进程内执行的参数；
- `types.py`：`RunResult`、`StreamEvent`、`SessionSnapshot`、`SessionInfo` 等公共数据形状，`snapshot_from_session` / `snapshot_from_payload` / `result_from_response` 做内部对象到 SDK 形状的转换。

SDK 的设计取向是"窄而稳定"：只暴露会话/记忆/运行时三类操作，不暴露 AgentLoop 内部状态机。

## 3. 流式契约

`sdk/streaming.py`：

- `RunStream`：一次执行的流式句柄，逐事件产出；
- `SDKStreamEmitter`：把 runner 内部事件转成 `StreamEvent`；
- `SDKStreamingHook(AgentHook)`：**流式是用 hook 实现的**——挂进 runner 的生命周期（on_stream 等）往外发事件，不改 runner 本体。这是 hook 系统最典型的生产级用法（见 [19-hooks-lifecycle.md](./19-hooks-lifecycle.md)）。

## 4. OpenAI 兼容 API

`nanobot serve` 启动 `api/server.py`（aiohttp）：

| 端点 | 处理 |
| --- | --- |
| `POST /v1/chat/completions` | `handle_chat_completions`——把 OpenAI 请求映射进一个会话回合 |
| `GET /v1/models` | `handle_models`——列出当前可用的模型/preset |
| `GET /health` | `handle_health`——探活 |

兼容层的意义：任何支持 OpenAI 协议的客户端（含其他 agent 框架）可以直接把 nanobot 当后端。监听配置在 `ApiConfig`；gateway 健康端口（18790）与 API 端口分离。

## 5. 与其他 CLI 的对照

| 维度 | nanobot | OpenCode v2 | Codex |
| --- | --- | --- | --- |
| 进程内 SDK | `sdk/`（Python） | `packages/sdk`（TS） | TS SDK 经协议接入 |
| HTTP API | OpenAI 兼容（chat/completions） | OpenAPI 生成的会话 API | app-server 协议 |
| 流式 | hook -> StreamEvent | 单编码 SSE 馈送 | JSON event protocol |

## 源码锚点

- [`sources/nanobot/nanobot/sdk/`](../../sources/nanobot/nanobot/sdk)：SDK 四个模块
- [`sources/nanobot/nanobot/api/server.py`](../../sources/nanobot/nanobot/api/server.py)：OpenAI 兼容服务
- [`sources/nanobot/docs/python-sdk.md`](../../sources/nanobot/docs/python-sdk.md)、[`openai-api.md`](../../sources/nanobot/docs/openai-api.md)：上游文档
