---
title: "REPL 与状态：prompt-toolkit 交互与流式渲染"
---
# REPL 与状态：prompt-toolkit 交互与流式渲染

> 基于 `sources/nanobot/nanobot/cli/commands.py` 与 `sources/nanobot/nanobot/cli/stream.py` 中的 nanobot `v0.3.0` 源码校对。

**目录**

- [1. 交互形态](#1-交互形态)
- [2. 输入层](#2-输入层)
- [3. 输出层](#3-输出层)
- [4. 状态同步](#4-状态同步)

---

## 1. 交互形态

`nanobot agent` 不带消息参数时进入交互 REPL（commands.py 的交互段）：prompt-toolkit 驱动输入，回合在 asyncio 事件循环里跑，流式增量渲染回复。它是"渠道=本地终端"的一个特殊宿主——与其他渠道共享同一个 AgentLoop，只是输入来自 `_read_interactive_input_async()`、输出去向 `_print_interactive_response`。

## 2. 输入层

- `_init_prompt_session()` 构造 prompt-toolkit 会话；`SafeFileHistory`（commands.py L204）是容错的命令历史——历史文件损坏不阻塞启动；
- `_build_cli_key_bindings()` 自定义键绑定；`_ensure_interactive_tty_mode()` 检查 TTY；
- `_flush_pending_tty_input()` 丢弃回合进行中积压在终端缓冲的输入，防止回车串扰下一回合；
- `_is_exit_command` 识别退出词；`_restore_terminal()` 保证任何退出路径恢复终端状态。

## 3. 输出层

- `cli/stream.py` 的 `StreamRenderer` 增量渲染 Markdown 流；`_ReasoningBuffer` 缓冲 thinking 内容，与正文分流显示；
- `_print_cli_progress_line` / `_print_cli_reasoning` / `_print_interactive_progress_line` 处理进度与推理行（配 `ThinkingSpinner`）；
- `_print_agent_response` / `_response_renderable` 决定按 Markdown 还是纯文本渲染（`render_markdown` 与 metadata 控制）。

## 4. 状态同步

REPL 没有独立 UI 状态树（对照 OpenCode 的 Solid context 树）：交互状态就是"当前会话键 + AgentLoop 运行时"。模型/preset 切换（`/model` 命令）直接调 `AgentLoop.set_session_model_preset`，下一回合生效；`/new` 清会话；`/status` 检视。简化的代价是富交互能力弱，收益是 REPL 与任何渠道行为完全一致——在终端里验证过的行为在 Telegram 里也成立。

## 源码锚点

- [`sources/nanobot/nanobot/cli/commands.py`](../../sources/nanobot/nanobot/cli/commands.py)：交互循环与渲染辅助
- [`sources/nanobot/nanobot/cli/stream.py`](../../sources/nanobot/nanobot/cli/stream.py)：StreamRenderer
