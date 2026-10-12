---
title: "Bridge / 外部集成：通道系统、路由与配对安全模型"
---
# Bridge / 外部集成：通道系统、路由与配对安全模型

> 基于 `sources/openclaw/`（openclaw `v2026.10.2`，OpenClaw Foundation）源码校对。OpenClaw 是开源个人 AI 助理网关：Gateway 常驻本机作为控制面，把 agent 桥接到 20+ 消息通道，模型 provider 与插件均可替换。

**目录**

- [1. 通道版图：一切外部接入皆插件](#1-通道版图一切外部接入皆插件)
- [2. ChannelPlugin 契约](#2-channelplugin-契约)
- [3. 入站管线：从 envelope 到 dispatch](#3-入站管线从-envelope-到-dispatch)
- [4. 路由：九级匹配与 session key](#4-路由九级匹配与-session-key)
- [5. 配对安全模型（pairing）](#5-配对安全模型pairing)
- [6. 出站：确定性回路与分块流式](#6-出站确定性回路与分块流式)

---

## 1. 通道版图：一切外部接入皆插件

OpenClaw 把"外部世界怎么接入"统一成一个答案：**channel plugin**。上游 `docs/channels/` 有 55 个条目（每通道一篇并各带子目录），官方目录收录 30+ 通道（`docs/channels/index.md`），按分发方式分四类：

| 分类 | 含义 | 例 |
| --- | --- | --- |
| bundled plugin | 随核心安装 | Telegram、A2A、Reef（agent 间 E2E 加密互通） |
| official plugin | `openclaw plugins install @openclaw/<id>` 一条命令 | WhatsApp、Discord、Slack、Signal、iMessage、Matrix、LINE、IRC、SMS… |
| external plugin | 仓库外维护 | WeChat、WeCom、Yuanbao、Zalo ClawBot |
| included in core | 非可配置出站通道 | WebChat（Control UI 内置聊天，走 Gateway WebSocket） |

全部实现住在 `extensions/`（174 个条目，通道只是其中 `categories: ["channels"]` 的一族插件）；核心侧的通用机制在 `src/channels/`（129 个文件）、`src/routing/`、`src/pairing/`、`src/auto-reply/`。通道形态各异：Telegram 是 Bot API 轮询，WhatsApp 走 QR 配对，iMessage 经 imsg（stdio 上的 JSON-RPC），Signal 经 signal-cli——协议差异全部被插件契约吸收，Gateway 只面对统一抽象。

## 2. ChannelPlugin 契约

`createChatChannelPlugin()`（`src/plugin-sdk/core.ts:706`）用一个工厂把五个可选适配面叠在 base 上：`security` / `pairing` / `threading` / `outbound` / base（含 `messaging`、`groups`、`lifecycle`、`agentPrompt` 等）。完整类型 `ChannelPlugin`（`src/channels/plugins/types.core.ts`，876 行）允许通道只覆盖选中的表面，其余走核心默认。以 Telegram 为例（`extensions/telegram/src/channel.ts:687`）：

- **allowlist**：DM/群组两级 `allowFrom` + `dmPolicy`/`groupPolicy` 由 `buildDmGroupAccountAllowlistAdapter` 组装；
- **messaging**：`targetPrefixes: ["telegram", "tg"]`、`numericTopicShorthand`、线程感知的出站路由；
- **lifecycle**：`onAccountConfigChanged` 监听 token 轮换并重置 ingress；
- **manifest**（`extensions/telegram/openclaw.plugin.json`）：`activation.onStartup: false`——插件懒加载，注册表（`src/channels/registry.ts`）只引轻量 entry（`extensions/telegram/index.ts:4` 的 `defineBundledChannelEntry`），不拖运行时。

每个通道还有自己的 `config-doctor-api` / `doctor-contract-api`，把通道级健康检查接进 `openclaw doctor`（见 [25-debugging.md](./25-debugging.md) §4）。

## 3. 入站管线：从 envelope 到 dispatch

入站消息先被规范化为 `inbound-event` envelope 并分类（`src/channels/inbound-event/envelope.ts`、`classification.ts`），随后穿过一串核心闸门：

- **准入**：allowlist 匹配（`src/channels/allowlist-match.ts`）、群组 mention gating（`src/channels/mention-gating.ts`）、`dmPolicy: "pairing"` 通道触发配对挑战；
- **防抖**：`src/auto-reply/inbound-debounce.ts` 按会话 key 做 keyed FIFO 合并，吸收"连发多条"的碎片消息；
- **防环**：bot-to-bot 滑动窗口限速——默认 60 s 窗口内 20 条、超限冷却 60 s，A→B 与 B→A 计为同一对（`docs/channels/bot-loop-protection.md`）；
- **派发**：`src/auto-reply/dispatch.ts` 的 `foregroundReplyLeases`（`:64`，keyed FIFO lease 保证同会话顺序）经 `dispatchReplyFromConfig` 走 agent run，产物是 `ReplyPayload`；broadcast group 则由 `dispatchGroupThread` 给多个 agent 各自的会话并跑多轮。

## 4. 路由：九级匹配与 session key

回信**确定性路由回来源通道**——模型不能选择通道，路由完全由宿主配置决定（`docs/channels/channel-routing.md`）。入站选 agent 的匹配顺序（`src/routing/resolve-route.ts`）：exact peer → parent peer（线程继承）→ peer 通配 → Discord guild+roles → guild → Slack team → account → channel → fallback owner；无 owner 且多 agent 时路由直接报错而不是猜第一个。选中 agent 决定用哪个 workspace 和 session store（SQLite）。会话 key（`src/routing/session-key.ts`）默认把 DM 折叠进主会话 `agent:<agentId>:main`，群组按 `groupScope: "per-group"` 隔离为 `agent:<agentId>:<channel>:group:<id>`，Slack/Discord 线程追加 `:thread:<threadId>`；`session.dmScope` 可改为 `per-peer` 等四级粒度，binding 还能按房间覆盖 scope。

## 5. 配对安全模型（pairing）

"Pairing" 是 OpenClaw 的显式访问审批步，用两处：**DM pairing**（谁能私聊 bot）与 **node pairing**（哪些设备能加入网关网络）（`docs/channels/pairing.md`）。DM 侧流程：

1. 未知发送者按 `dmPolicy: "pairing"` 收到配对码，消息**不处理**直到审批；码为 8 位大写、剔除易混字符（字母表 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`，`src/pairing/pairing-store.ts:23-24`，`crypto.randomInt` 生成）。
2. 请求 1 小时过期，每账号挂起上限 3 条；持久化在共享状态库的 `channel_pairing_requests` / `channel_pairing_allow_entries` 表（`src/pairing/pairing-store-sqlite.ts`）。
3. 审批二选一：CLI `openclaw pairing approve <channel> <code>`（`src/cli/pairing-cli.ts:167`，首个审批同时 bootstrap `commands.ownerAllowFrom`，之后审批只给 DM 权限）或 Control UI 的 Settings → Channels → DM access requests 队列。
4. 通道插件经 `createPairingPrefixStripper` 等适配器接入；`channel_pairing_requested` hook 可拦截配对事件（`src/pairing/pairing-challenge.ts`）。

node 侧另有 `src/pairing/setup-code.ts` 的 setup code + trusted proxy 校验。这层模型是 OpenClaw 与典型 coding CLI 最大的差异：入口在不可信的消息平台，所以准入必须是带外审批而不是进程边界。

## 6. 出站：确定性回路与分块流式

出站同样核心托管：长回复按 grapheme 分块且**避让代码围栏**内部断行（`src/auto-reply/chunk.ts`，借助 `packages/markdown-core` 的 fence 解析）；流式回复由 `progress-draft-compositor` 组合成草稿增量（`src/channels/draft-streaming-chunking.ts`），配额/能力各通道自报（`src/channels/streaming.ts`）；`typing` 指示器、ack reactions、thread binding 均有核心实现。出站目标语法支持 `telegram:123` 类前缀，但仅作通道选择提示，前缀与已选通道不符会在插件归一化之前就失败——防止模型把消息投递到别的平台。

## 源码锚点

- [`sources/openclaw/src/plugin-sdk/core.ts`](../../sources/openclaw/src/plugin-sdk/core.ts)：`createChatChannelPlugin`（`:706`）与各适配面工厂
- [`sources/openclaw/src/channels/plugins/types.core.ts`](../../sources/openclaw/src/channels/plugins/types.core.ts)：`ChannelPlugin` 完整契约
- [`sources/openclaw/extensions/telegram/src/channel.ts`](../../sources/openclaw/extensions/telegram/src/channel.ts)：通道实现范例（`telegramPlugin`，`:687`）
- [`sources/openclaw/src/auto-reply/dispatch.ts`](../../sources/openclaw/src/auto-reply/dispatch.ts)：入站派发编排与 keyed FIFO lease（`:64`）
- [`sources/openclaw/src/routing/resolve-route.ts`](../../sources/openclaw/src/routing/resolve-route.ts)：九级 binding 匹配
- [`sources/openclaw/src/routing/session-key.ts`](../../sources/openclaw/src/routing/session-key.ts)：会话 key 形状与 scope
- [`sources/openclaw/src/pairing/pairing-store.ts`](../../sources/openclaw/src/pairing/pairing-store.ts)：配对码生成（`:23-24`）与请求生命周期
- [`sources/openclaw/src/pairing/pairing-challenge.ts`](../../sources/openclaw/src/pairing/pairing-challenge.ts)：配对挑战流程与 hook
- [`sources/openclaw/src/cli/pairing-cli.ts`](../../sources/openclaw/src/cli/pairing-cli.ts)：`openclaw pairing list/approve`
- [`sources/openclaw/docs/channels/channel-routing.md`](../../sources/openclaw/docs/channels/channel-routing.md)：路由与 session key 上游权威文档
- [`sources/openclaw/docs/channels/pairing.md`](../../sources/openclaw/docs/channels/pairing.md)：pairing 上游文档
- [`sources/openclaw/docs/channels/bot-loop-protection.md`](../../sources/openclaw/docs/channels/bot-loop-protection.md)：bot 环路防护默认值
- [`sources/openclaw/src/cli/channels-cli.ts`](../../sources/openclaw/src/cli/channels-cli.ts)：`openclaw channels add/status` 引导式设置
