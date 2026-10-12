---
title: "输入与命令队列：从通道到 agent 的三段队列"
---
# 输入与命令队列：从通道到 agent 的三段队列

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。消息从 20+ 通道进入 Gateway 再驱动 agent turn，路径上排着三段性质不同的队列：入站 debounce、活跃运行的 followup 队列、agent-core 的 steering 队列；本篇对照 `src/routing/`、`src/auto-reply/` 与 `packages/agent-core/src/agent.ts`。

**目录**

- [1. 路由：从通道消息到 session key](#1-路由从通道消息到-session-key)
- [2. 入站 debounce：按键合并](#2-入站-debounce按键合并)
- [3. 命令面：检测、注册表与 activeRunSafe](#3-命令面检测注册表与-activerunsafe)
- [4. 活跃运行的入站队列：四模式与溢出策略](#4-活跃运行的入站队列四模式与溢出策略)
- [5. agent-core 双队列与 drain 检查点](#5-agent-core-双队列与-drain-检查点)
- [6. 前台回复 FIFO 与出站分块](#6-前台回复-fifo-与出站分块)

---

## 1. 路由：从通道消息到 session key

每条入站消息先经 `resolveRoute()`（`src/routing/resolve-route.ts`）落到一个 agent 与会话：配置里的 route bindings 按 channel/account/scope（DM、group、thread）匹配，thread 从 parent peer 继承绑定，Discord 还支持按 member role 路由；没有匹配绑定时回退 owner 默认 agent。路由产物是**结构化 session key**（`src/routing/session-key.ts`）：agent 主会话用 `buildAgentMainSessionKey`，peer 会话用 `buildAgentPeerSessionKey`，key 里编码 agentId、mainKey/peerId，另派生出 cron run、ACP、sub-agent 等专用形态。session key 是整个队列体系的分片键——后面的 debounce 队列、followup 队列、回复 FIFO 全部按它分道。

## 2. 入站 debounce：按键合并

通道消息天然成簇（WhatsApp 一句话拆三条、Telegram 连发），`createInboundDebouncer()`（`src/auto-reply/inbound-debounce.ts:120`）在消息进入处理前按 key 合并：同一 key 的消息在窗口内追加进 buffer，静默期到点 flush；`shouldDebounce` 决定哪些消息（如命令）直通不缓冲。窗口配置按 `override → messages.inbound.byChannel[channel] → messages.inbound.debounceMs` 三级解析，默认 0（不合并）。每个 flush 分成 **admission 与 completion 两个 Promise**：lane 在 admission 时就释放（后续消息可继续入站），完成态单独可等待——失败时未 admitted 的消息走 `onFailed` 回滚 source 认领，已 admitted 的 turn 自担后续失败。防呆细节：`maxTrackedKeys` 默认 2048，窗口上限是 debounce 的 5 倍（`MAX_DEBOUNCE_WINDOW_MULTIPLIER`），保证慢 flush 不至于无限积压。

## 3. 命令面：检测、注册表与 activeRunSafe

缓冲归缓冲，控制命令必须即时可见。`src/auto-reply/command-detection.ts` 在入站授权前做粗检测：`isControlCommandMessage` 匹配注册表里的精确别名（含 `acceptsArgs` 的前缀匹配），abort 触发词同样算命令；`hasInlineCommandTokens` 故意高估（"hey /status" 也算），但只用来决定是否计算 `CommandAuthorized` 元数据，不拦截普通聊天。注册表（`src/auto-reply/commands-registry.shared.ts`）每个命令带三档元数据：`nativeName`（通道原生斜杠命令，如 Telegram 的 `/think`）与 `textAliases`（纯文本别名如 `/t`）双形态；`activeRunSafe: true` 表示**运行中也能立刻执行**（`/help`、`/status` 类）；`modelIndependent` 声明无需模型参与。会话边界命令 `/new`、`/reset` 会开新 transcript 而非原地重置（`isSessionBoundaryCommandText`，`/reset soft` 例外）。消息里还可以内嵌 `/queue` directive 现场改队列参数（`src/auto-reply/reply/queue/directive.ts:114`，directive 会从消息文本中摘除后再进 turn）。

## 4. 活跃运行的入站队列：四模式与溢出策略

消息到达时 agent 正在跑 turn，怎么办？`messages.queue` 给出四种模式（`QUEUE_MODES`，`packages/gateway-protocol/src/schema/logs-chat.ts:276`）：

| 模式 | 语义 |
| --- | --- |
| `steer` | 注入当前运行（默认；`resolveQueueSettingsCore` 的兜底值） |
| `followup` | 排队，当前 run 结束后作为新 turn 依次执行 |
| `collect` | 排队合并成单个收集 run；不同发送者的消息合并时会**剥除发送者身份**（`resolveCollectedRun` 把 sender/owner 字段清空——混合身份共享下游权限是不安全的） |
| `interrupt` | 中断当前运行 |

队列参数（`src/auto-reply/reply/queue/settings.ts:24`）按 inline → session entry → per-channel config → 全局 config 解析：默认 debounce 500ms、cap 20、drop policy `summarize`（`src/auto-reply/reply/queue/state.ts:47-49`）。溢出三选一：`old`（丢最旧）、`new`（拒最新）、`summarize`——被丢的消息不消失，压成一行摘要随下一 run 注入（`summaryLines` 与 source 保持索引对齐，被摘要的 source 用 WeakMap 保留身份直到投递完成）。同一队列内按 channel route identity + messageId 去重，通道重投不会产生重复 turn。

## 5. agent-core 双队列与 drain 检查点

队列的"消费端"在 agent loop 里有第二条实现。`Agent`（`packages/agent-core/src/agent.ts`）持有两个 `PendingMessageQueue`（`:342-343`）：`steeringQueue`（在工具检查点/模型边界注入运行中的 turn）与 `followUpQueue`（agent 本应停止时注入、把"结束"变成"下一轮"）。每个队列各自带 `QueueMode`（`packages/agent-core/src/types.ts:42`）：`one-at-a-time` 每个检查点只放最旧一条（默认），`all` 一次放空——这决定"用户连发五条"时模型是逐条消化还是一口气看到全部。队列语义做到崩溃安全：drain 出的消息留在 `inFlight` 直到 `message_end` 提交；run 失败时按原顺序放回队首，排在后来消息之前。`peek()` 的注释写明并发契约：检查点固定了下一注入批后，后续输入必须等该批提交才能到达 provider。steer 模式的采纳有独立护栏（`src/auto-reply/reply/agent-runner-steer-adoption.ts`）：入站认领丢失（ingress adoption lost）或重启恢复场景下，steer 候选改为 park 而不是硬注入。

## 6. 前台回复 FIFO 与出站分块

输入有队列，输出也有次序约束：`src/auto-reply/dispatch.ts:64` 用 `createKeyedFifoLeaseRegistry` 按 (channel, account, sessionKey, chatType, target) 的 JSON 复合键 reserve **前台回复租约**——同一会话的前台回复严格 FIFO，防止两个并发 run 的回复交错；`activeRunSafe` 命令（`/status` 等）豁免租约，不许排在运行后面干等。出站侧，长回复由 `src/auto-reply/chunk.ts` 按 **grapheme 簇**分块，尊重 markdown fence 与括号感知断点，避免把代码块从中间劈开。至此三段队列闭环：debounce 决定"到达"，followup 队列决定"何时成为 turn"，steering/followUp 双队列决定"模型何时看到"，见 [03-agent-loop.md](./03-agent-loop.md)。

## 源码锚点

- [`sources/openclaw/src/routing/resolve-route.ts`](../../sources/openclaw/src/routing/resolve-route.ts)：binding 匹配与 thread 继承
- [`sources/openclaw/src/routing/session-key.ts`](../../sources/openclaw/src/routing/session-key.ts)：结构化 session key
- [`sources/openclaw/src/auto-reply/inbound-debounce.ts`](../../sources/openclaw/src/auto-reply/inbound-debounce.ts)：按键 debounce 与 admission/completion 分离
- [`sources/openclaw/src/auto-reply/command-detection.ts`](../../sources/openclaw/src/auto-reply/command-detection.ts)：控制命令检测
- [`sources/openclaw/src/auto-reply/commands-registry.shared.ts`](../../sources/openclaw/src/auto-reply/commands-registry.shared.ts)：命令定义与 activeRunSafe
- [`sources/openclaw/src/auto-reply/reply/queue/settings.ts`](../../sources/openclaw/src/auto-reply/reply/queue/settings.ts)：队列参数解析链
- [`sources/openclaw/src/auto-reply/reply/queue/state.ts`](../../sources/openclaw/src/auto-reply/reply/queue/state.ts)：500ms/20/summarize 默认值
- [`sources/openclaw/packages/gateway-protocol/src/schema/logs-chat.ts`](../../sources/openclaw/packages/gateway-protocol/src/schema/logs-chat.ts)：四队列模式枚举
- [`sources/openclaw/packages/agent-core/src/agent.ts`](../../sources/openclaw/packages/agent-core/src/agent.ts)：PendingMessageQueue 与双队列
- [`sources/openclaw/src/auto-reply/dispatch.ts`](../../sources/openclaw/src/auto-reply/dispatch.ts)：前台回复 FIFO 租约
- [`sources/openclaw/src/auto-reply/chunk.ts`](../../sources/openclaw/src/auto-reply/chunk.ts)：grapheme 感知出站分块
