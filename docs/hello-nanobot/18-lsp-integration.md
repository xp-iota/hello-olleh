---
title: "LSP 集成：无内建集成的边界说明"
---
# LSP 集成：无内建集成的边界说明

> 基于 `sources/nanobot/` 全树检索校对（nanobot `v0.3.0`）。

**目录**

- [1. 结论](#1-结论)
- [2. 为什么可以没有](#2-为什么可以没有)
- [3. 替代能力](#3-替代能力)
- [4. 如果要补](#4-如果要补)

---

## 1. 结论

nanobot `v0.3.0` **没有 LSP 集成**：代码树中没有语言服务器客户端、没有 `lsp` 模块，代码语义理解不走 LSP。这与 Claude Code / Gemini CLI（有 IDE/LSP 周边）和 OpenCode v2（保留 `lsp.updated` 事件形状）形成对照。

## 2. 为什么可以没有

nanobot 的定位是"个人生活/工作助手"而非"IDE 内编码 agent"：主战场是聊天渠道与 WebUI，文件操作粒度是整文件读写与补丁（`filesystem.py` / `apply_patch.py`），不依赖精确符号索引。LSP 的价值场景（跳转、重命名、诊断回流）在这个定位下权重低。

## 3. 替代能力

| 需求 | 现有替代 |
| --- | --- |
| 代码检索 | `search.py` + shell 工具跑 grep/rg |
| 改代码 | `apply_patch.py` 补丁 |
| 项目约定 | 工作区 `AGENTS.md` 注入 system prompt |
| 代码智能 | 交给模型自身能力；需要深度集成的场景应换编码向 CLI |

## 4. 如果要补

最自然的接入点是写一个 LSP 工具插件（`nanobot.tools` entry point，见 [14-plugin-system.md](./14-plugin-system.md)）：封装一个语言服务器客户端为 `Tool`，把"查定义/查引用/诊断"暴露给模型。不需要改核心。

## 源码锚点

- [`sources/nanobot/nanobot/agent/tools/`](../../sources/nanobot/nanobot/agent/tools)：现有工具面（无 LSP）
- [`sources/nanobot/nanobot/agent/tools/loader.py`](../../sources/nanobot/nanobot/agent/tools/loader.py)：补 LSP 的插件入口
