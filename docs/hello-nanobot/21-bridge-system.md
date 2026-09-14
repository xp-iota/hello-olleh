---
title: "Bridge / 外部集成：17 个渠道、gateway 与 WebUI"
---
# Bridge / 外部集成：17 个渠道、gateway 与 WebUI

> 基于 `sources/nanobot/nanobot/channels/`、`sources/nanobot/nanobot/gateway/` 与 `sources/nanobot/nanobot/webui/` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 渠道模型](#1-渠道模型)
- [2. BaseChannel 契约](#2-basechannel-契约)
- [3. ChannelManager 生命周期](#3-channelmanager-生命周期)
- [4. gateway 与 WebUI](#4-gateway-与-webui)
- [5. 渠道清单](#5-渠道清单)

---

## 1. 渠道模型

渠道是 nanobot 的"bridge"层：每个聊天平台是一个 `nanobot/channels/<name>/` 自包含包，包含 descriptor（字段、激活、setup 元数据，见 `contracts.py` 的 `ChannelSetupSpec` / `ChannelFieldSpec` / `ChannelManagementSpec`）与惰性加载的运行时。发现走 `registry.py` 的 pkgutil 扫描（不是 entry points，见 [14-plugin-system.md](./14-plugin-system.md) §4）。

## 2. BaseChannel 契约

`channels/base.py` 的 `BaseChannel`：

| 方法 | 语义 |
| --- | --- |
| `start()` / `stop()` | 连接生命周期 |
| `send(msg)` | 发送完整回复（OutboundMessage） |
| `send_delta` / `send_reasoning_delta` / `send_reasoning_end` / `send_reasoning` | 流式与推理内容的尽力投递 |
| `send_file_edit_events` | 文件编辑活动通知 |
| `login(force=False)` | 交互登录（`nanobot channels login`） |
| `transcribe_audio(...)` | 语音转文字（经 TranscriptionConfig） |
| `supports_streaming` | 配置开启且子类实现了 send_delta 时为真 |

渠道不需要全实现：不支持流式的渠道只实现 `send`，运行时按能力降级。

## 3. ChannelManager 生命周期

`channels/manager.py` 的 `ChannelManager`：

- `_init_channels()` 按配置 `_build_channel` 逐个构造；构造失败记 `_mark_channel_error` 不阻塞其他渠道；
- `_start_channel` / `_start_channel_task` 把每个渠道跑成命名 asyncio task；`start_all` / `_stop_channel` 对称；
- `_validate_allow_from()` 校验发送者白名单配置；`_should_send_progress(...)` 按渠道与开关决定进度消息投递；
- 媒体文件落 `get_media_dir(channel)`（按渠道分目录）。

## 4. gateway 与 WebUI

- **gateway**：常驻编排（`gateway/runtime.py` + `service.py`），健康端口 18790，systemd/launchd 安装（见 [02-startup-flow.md](./02-startup-flow.md) §5）；
- **WebUI**：`nanobot webui`（默认 8765）是 aiohttp 应用，`webui/` 下约 30 个模块覆盖设置（settings_api）、技能（skills_api）、媒体（media_api/media_gateway）、转写（transcription_ws）、分叉（forking）、token 统计（token_usage）、会话自动化（session_automations）、MCP 预设（mcp_presets_*）等——WebUI 不是独立后端，而是同一个 AgentLoop 的又一个渠道式宿主。

## 5. 渠道清单

v0.3.0 内建 17 个渠道包：dingtalk、discord、email、feishu、matrix、mattermost、mochat、msteams、napcat、qq、signal、slack、telegram、wecom、weixin、whatsapp、websocket。`nanobot channels status` 检视激活状态，`channel_default_enabled(name)` 读取各包 descriptor 的默认激活策略。

## 源码锚点

- [`sources/nanobot/nanobot/channels/base.py`](../../sources/nanobot/nanobot/channels/base.py)：BaseChannel
- [`sources/nanobot/nanobot/channels/manager.py`](../../sources/nanobot/nanobot/channels/manager.py)：ChannelManager
- [`sources/nanobot/nanobot/webui/`](../../sources/nanobot/nanobot/webui)：WebUI 模块群
- [`sources/nanobot/docs/chat-apps.md`](../../sources/nanobot/docs/chat-apps.md)：渠道配置指南
