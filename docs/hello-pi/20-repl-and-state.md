---
title: "REPL 与状态：InteractiveMode 的运行结构"
---
# REPL 与状态：InteractiveMode 的运行结构

> 基于 `sources/pi/packages/coding-agent/src/modes/interactive/`、`packages/tui/src/` 与 `core/keybindings.ts` 校对（pi `v1.1.0`）。

**目录**

- [1. 总体结构](#1-总体结构)
- [2. chat viewport 与渲染器](#2-chat-viewport-与渲染器)
- [3. 编辑器组件](#3-编辑器组件)
- [4. 键绑定](#4-键绑定)
- [5. 流式期间的用户输入：steer vs followUp](#5-流式期间的用户输入steer-vs-followup)
- [6. 选择器组件与 program-status-reporter](#6-选择器组件与-program-status-reporter)

---

## 1. 总体结构

pi 的交互式 REPL 全部在 `modes/interactive/interactive-mode.ts`（7109 行，`class InteractiveMode` 在 `:451`）。它不是模式基类的子类——四种模式（interactive / print / json / rpc）共享同一个 `AgentSessionRuntime`，由 `cli.ts` 各自选 runner（见 [21-bridge-system.md](./21-bridge-system.md) §2）。生命周期两段：`init()`（`:943`）建 UI 并先于扩展 `session_start` 启动界面（让扩展能用对话框），`run()`（`:1146`）再做模型目录后台刷新、版本检查等。斜杠命令走 `:3280` 起的字面量分发，命令清单的 source of truth 在 `core/slash-commands.ts:19-44`。

## 2. chat viewport 与渲染器

`createChatViewport()`（`chat-viewport.ts:22`）组装 document / pending / status / widgets / editor / footer 六个容器，是整个 TUI 的骨架。渲染器由 `tui-renderer.ts` 的 `createInteractiveTui()` 选择 `TuiMainScreen`（常规分屏）或 `TuiAltScreen`（全屏），主题从 `theme/` 加载并支持热重载。底层差分渲染在 pi-tui：只重绘变化行、CSI 2026 同步输出防闪烁，键盘输入绕过 16ms 节流走 `requestImmediateRender()`。

## 3. 编辑器组件

输入框是 pi-tui 的 `components/editor.ts`（2472 行），带完整编辑器语义：

- **undo-stack**：`UndoStack<EditorSnapshot>`（`undo-stack.ts`，`:367`）；
- **kill-ring**：类 Emacs 的 `KillRing`（`kill-ring.ts`，`:350`），连续 kill 累积粘贴；
- 词导航、外部编辑器（`external-editor.ts`，`app.editor.external` 动作）。

## 4. 键绑定

键绑定刻意不硬编码（AGENTS.md 明文规则）：应用动作用命名动作（`app.session.new`、`app.message.followUp`、`app.model.cycleForward`……），默认表在 `core/keybindings.ts:75` 的 `KEYBINDINGS` 与 pi-tui `tui/src/keybindings.ts:71` 的 `TUI_KEYBINDINGS`；运行时由 `KeybindingsManager` 管理。用户在 `<agent-dir>/keybindings.json` 覆盖（空数组可禁用动作），`/reload` 生效，`/hotkeys` 查看。UI 代码只允许引用动作名，不允许写死键位。

## 5. 流式期间的用户输入：steer vs followUp

模型正在流式输出时，用户在编辑器里按 Enter 的语义不同（队列机制详见 [23-input-command-queue.md](./23-input-command-queue.md)）：

- **steer**：`interactive-mode.ts:3376-3381`，流式中直接 `session.prompt(text, { streamingBehavior: "steer" })`，消息进 steering 队列，在**工具调用之间**注入，不打断正在执行的工具；
- **followUp**：编辑器内 `app.message.followUp` 动作（`:3116`）→ `handleFollowUp()`，消息进 followUp 队列（`:4496`），只在 agent 即将停止时作为**新一轮 prompt** 启动；
- 界面提示（`:1044`）明示两者差异；队列检视/清空用 `getAllQueuedMessages()`（`:4691`）与 `clearAllQueues()`（`:4708`）。

这解决了"流式期间用户打字去哪"的问题：既不丢输入，也不粗暴打断工具执行。

## 6. 选择器组件与 program-status-reporter

`components/` 下约 50 个 widget，覆盖 REPL 的所有状态切换：

| 组件 | 用途 |
| --- | --- |
| `model-selector.ts` / `model-search.ts` | 选模型、跨目录搜索 |
| `theme-selector.ts` / `settings-selector.ts` | 主题与设置项列表 |
| `session-selector.ts` / `session-selector-search.ts` / `tree-selector.ts` | 会话与分支树切换 |
| `thinking-selector.ts` / `scoped-models-selector.ts` | 推理等级、分域模型 |
| `login-dialog.ts` / `oauth-selector.ts` | `/login` OAuth/API key 流程 |

`program-status-reporter.ts`（111 行）向上报流式/工具执行进度，驱动 footer 状态；`status-indicator.ts` 渲染。

## 源码锚点

- [`sources/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts`](../../sources/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts)：`InteractiveMode` 主体（`:451`）
- [`sources/pi/packages/coding-agent/src/modes/interactive/chat-viewport.ts`](../../sources/pi/packages/coding-agent/src/modes/interactive/chat-viewport.ts)：viewport 容器组装
- [`sources/pi/packages/tui/src/components/editor.ts`](../../sources/pi/packages/tui/src/components/editor.ts)：编辑器（undo-stack / kill-ring）
- [`sources/pi/packages/coding-agent/src/core/keybindings.ts`](../../sources/pi/packages/coding-agent/src/core/keybindings.ts)：命名动作与默认键绑定
- [`sources/pi/packages/coding-agent/src/modes/interactive/program-status-reporter.ts`](../../sources/pi/packages/coding-agent/src/modes/interactive/program-status-reporter.ts)：运行状态上报
- [`sources/pi/packages/coding-agent/docs/keybindings.md`](../../sources/pi/packages/coding-agent/docs/keybindings.md)：键绑定用户文档
