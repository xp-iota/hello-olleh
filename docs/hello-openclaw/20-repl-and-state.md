---
title: "REPL 与状态：TuiBackend 双形态与 Gateway 实时状态投影"
---
# REPL 与状态：TuiBackend 双形态与 Gateway 实时状态投影

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。openclaw 没有独立的"REPL 进程"：终端 TUI 与 Web Control UI 都是 Gateway 的客户端，交互状态的唯一权威在 Gateway。

**目录**

- [1. 客户端矩阵：状态归 Gateway](#1-客户端矩阵状态归-gateway)
- [2. TUI：一个后端抽象，两种运行形态](#2-tui一个后端抽象两种运行形态)
- [3. 斜杠命令与组件](#3-斜杠命令与组件)
- [4. Control UI：WebSocket 协议与 outbox](#4-control-uiwebsocket-协议与-outbox)
- [5. Gateway 实时状态投影](#5-gateway-实时状态投影)

---

## 1. 客户端矩阵：状态归 Gateway

pi 的 `InteractiveMode` 把 UI、会话与 agent loop 装进一个进程；openclaw 反其道而行：**所有会话状态由 Gateway 拥有**，UI 客户端（Control UI、TUI、CLI、20+ 消息通道）只是投影（`docs/concepts/session.md`）。因此"REPL 与状态"在 openclaw 里拆成两半——客户端负责渲染与输入，实时状态（会话列表、运行进度、排队消息、审批）全部经 `sessions.subscribe` / `chat.history` 等方法从 Gateway 订阅。第三方客户端有正式契约：`@openclaw/gateway-protocol`（schema + 运行时校验 + 线版本常量，wire version 4）与 `@openclaw/gateway-client`（参考实现），见 `docs/gateway/clients.md` 与协议规范 `docs/gateway/protocol.md`。

## 2. TUI：一个后端抽象，两种运行形态

`src/tui/tui.ts`（1836 行）是终端交互入口，它的关键设计是把所有后端差异收敛到 `TuiBackend` 接口之后（`tui.ts:745-757`）：`opts.backend` 注入测试桩；`--local` 时实例化 `EmbeddedTuiBackend`（`embedded-backend.ts:174`）——**进程内**运行 agent runtime，却完整实现 gateway-protocol 的客户端面（chat history、session patch、question 认领等直接调 `agentCommandFromIngress`、embedded-agent-runner）；否则实例化 `GatewayChatClient`（`gateway-chat.ts:168`），经 WebSocket 连接远端 Gateway（支持 bound gateway 与 TLS fingerprint）。同一套 TUI 前端因此可以在"本地单机"与"连远端网关"之间无感切换，这与 pi 单进程 REPL 是结构级差异。

## 3. 斜杠命令与组件

TUI 命令表在 `src/tui/commands.ts:92-176` 以字面量数组声明：`/status`（远端）、`/model`、`/think`、`/fast`、`/agent`（切换 agent 或打开 picker）、`/session`（切换会话）、`/goal`（目标状态机：start/edit/pause/resume/complete/block/clear）、`/btw`（旁路问题）、`/queue`、`/stop`、`/new`、`/abort`、`/settings` 等——注意其中相当一部分标了 `shared: true`：它们不是 TUI 私有命令，而是 Gateway 侧的共享命令，消息通道里同样可用。

| 组件（`src/tui/`） | 用途 |
| --- | --- |
| `components/chat-log.ts` | 对话流渲染（assistant/tool/user 消息分层） |
| `components/custom-editor.ts` | 输入编辑器 |
| `components/filterable-select-list.ts` / `searchable-select-list.ts` | model/session/agent 各类 picker |
| `components/question-prompt.ts` | agent 提问的选项应答 |
| `tui-session-picker.ts` / `tui-session-history.ts` | 会话选择与历史浏览 |
| `tui-waiting.ts` | 等待/空闲状态行 |
| `tui-stream-assembler.ts` | 流式增量拼装成稳定视图 |
| `tui-session-run-coordinator.ts` | 本地提交与远端 run 的生命周期协调 |

刷新路径上刻意做了节流：`coalesced-refresh.ts` 合并高频状态更新，避免逐 token 重绘整屏；`tui-submit-state.ts` 与 `tui-submit.ts` 把"提交中/排队/已被 Gateway 确认"的提交态从渲染态中分离，断线时界面仍可输入（重连后按 outbox 语义补投）。

## 4. Control UI：WebSocket 协议与 outbox

Control UI 是 `ui/` 下的独立前端（Vite + Lit，`ui/src/` 含 pages、features、app-navigation），由 Gateway 进程托管。客户端生命周期围绕 wire 契约组织：持久化 Ed25519 设备身份 → `connect.challenge` 挑战签名 → 按 `operator.read` / `operator.write` / `operator.approvals`（另有 questions/pairing/admin）scope 申请能力 → 断线后凭设备 token 重连并恢复订阅。输入可靠性靠 **outbox**：已接受的文本/附件在浏览器端留档直到 Gateway 确认 transcript 消费，重连后按回执去重重提（服务端对应 `session_pending_inputs` 表，见 [10-session-resume.md](./10-session-resume.md) §5）。网关配对（pairing）安全模型让手机、桌面浏览器与 CLI 共享同一套设备认证。

## 5. Gateway 实时状态投影

Gateway 侧的实时状态是一组投影器：`src/gateway/live-chat-projector.ts` 把活动 assistant 文本限流投影给订阅客户端（流式语义见 `docs/concepts/streaming.md`）；`src/status/status-text.ts` 汇总 `/status` 输出（上下文用量、模型、压缩计数、fast mode、thinking 等开关），`status-subagents.runtime.ts` 附带子代理运行状态，`status-plugin-health.runtime.ts` 反映插件健康，`status-queue.runtime.ts` 投影排队消息；`src/status/` 同时维护 memory 插件与 session store 的状态行。排队与转向也在 Gateway：用户在 agent 运行中发消息先进 collect 队列按 mode/cap/drop 合并（`docs/concepts/queue.md`、`docs/concepts/queue-steering.md`），由 `src/chat/work-context.ts` 之类的投影模块决定何时注入。通道侧的"活着"信号（typing indicator）同样是 Gateway 驱动的有界状态（`docs/concepts/typing-indicators.md`），恢复中的轮次会持续续期直到回合结算。

最后，`src/interactive/payload.ts` 定义**可移植的交互呈现**——按钮样式、question 选项动作、model-picker 动作——让同一个交互负载在 TUI、Control UI 与支持的通道里渲染为原生控件而非裸文本，这是"多客户端共享状态"哲学在 UI 层的延伸（agent loop 见 [03-agent-loop.md](./03-agent-loop.md)）。

## 源码锚点

- [`sources/openclaw/src/tui/tui.ts`](../../sources/openclaw/src/tui/tui.ts)：TUI 主入口与后端选择（`:745-757`）
- [`sources/openclaw/src/tui/embedded-backend.ts`](../../sources/openclaw/src/tui/embedded-backend.ts)：EmbeddedTuiBackend（`:174`），进程内 runtime 实现 gateway 协议面
- [`sources/openclaw/src/tui/gateway-chat.ts`](../../sources/openclaw/src/tui/gateway-chat.ts)：GatewayChatClient（`:168`），WebSocket 客户端后端
- [`sources/openclaw/src/tui/commands.ts`](../../sources/openclaw/src/tui/commands.ts)：斜杠命令表（`:92-176`）
- [`sources/openclaw/src/tui/components/chat-log.ts`](../../sources/openclaw/src/tui/components/chat-log.ts)：对话流组件
- [`sources/openclaw/src/tui/tui-session-picker.ts`](../../sources/openclaw/src/tui/tui-session-picker.ts)：会话选择器
- [`sources/openclaw/src/tui/coalesced-refresh.ts`](../../sources/openclaw/src/tui/coalesced-refresh.ts)：高频状态刷新合并
- [`sources/openclaw/src/status/status-text.ts`](../../sources/openclaw/src/status/status-text.ts)：/status 状态文本汇总
- [`sources/openclaw/src/status/status-queue.runtime.ts`](../../sources/openclaw/src/status/status-queue.runtime.ts)：排队消息状态投影
- [`sources/openclaw/src/interactive/payload.ts`](../../sources/openclaw/src/interactive/payload.ts)：可移植交互呈现负载
- [`sources/openclaw/docs/concepts/queue.md`](../../sources/openclaw/docs/concepts/queue.md)：命令队列与 queue-steering
- [`sources/openclaw/docs/concepts/typing-indicators.md`](../../sources/openclaw/docs/concepts/typing-indicators.md)：通道 typing indicator 语义
- [`sources/openclaw/src/chat/work-context.ts`](../../sources/openclaw/src/chat/work-context.ts)：工作上下文投影
- [`sources/openclaw/ui/`](../../sources/openclaw/ui/)：Control UI 前端（Vite + Lit）
- [`sources/openclaw/packages/gateway-protocol/`](../../sources/openclaw/packages/gateway-protocol/)：线协议 schema 与校验
- [`sources/openclaw/docs/gateway/clients.md`](../../sources/openclaw/docs/gateway/clients.md)：第三方客户端构建指南
- [`sources/openclaw/docs/gateway/protocol.md`](../../sources/openclaw/docs/gateway/protocol.md)：Gateway WebSocket 协议规范
