---
title: "扩展与 MCP 总览：原生插件作为第一公民"
---
# 扩展与 MCP 总览：原生插件作为第一公民

> 基于 sources/openclaw/（openclaw v2026.10.2，OpenClaw Foundation）源码校对。OpenClaw 是开源个人 AI 助理网关：Gateway 常驻本机作为控制面，Control UI/CLI/TUI 与 20+ 消息通道都是客户端，模型 provider、通道、工具全部由可替换的原生插件（native plugin）提供。

**目录**

- [1. 扩展面：native plugin、compatible bundle 与 MCP](#1-扩展面native-plugincompatible-bundle-与-mcp)
- [2. 原生插件与内建插件树](#2-原生插件与内建插件树)
- [3. 四层加载管线与激活边界](#3-四层加载管线与激活边界)
- [4. 内建扩展的同型替换](#4-内建扩展的同型替换)
- [5. MCP 总览：三个方向](#5-mcp-总览三个方向)

---

## 1. 扩展面：native plugin、compatible bundle 与 MCP

OpenClaw 没有独立的 "extension" 目录概念；它的扩展性由三种形态共同构成（`docs/plugins/architecture.md`）：

| 形态 | 载体 | 信任模型 |
| --- | --- | --- |
| **native plugin** | `openclaw.plugin.json` manifest + `register(api)` 代码，进程内加载 | **无沙箱**：与核心同进程同信任级，靠 allowlist 与 capability consent 门控 |
| **compatible bundle** | Codex/Claude/Cursor/Agent 风格的 bundle manifest，归一化为 skills/hooks 等元数据包，不执行代码 | 更安全：当前版本仅当 metadata/content pack 处理 |
| **MCP server** | `mcp.servers` 配置连接的外部进程/HTTP 服务 | 工具面走与内建工具完全相同的 tool-profile / tool-policy 管控 |

bundle 兼容层是刻意设计的生态通道：`src/plugins/bundle-manifest.ts` 同时读取 `plugin.json`（agent-plugins.org schema）、`.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.cursor-plugin/plugin.json` 四种 manifest（`:21-24`），归一化为统一的 `BundlePluginManifest`（id + skills + hooks + activation）。也就是说 OpenClaw 可以直接"吃进"Claude/Codex 生态的分发包——但只吸收它能在 OpenClaw 信任模型内执行的部分（skill 文件与 `HOOK.md`+handler 的 hook 根），不吸收任意运行时代码。

## 2. 原生插件与内建插件树

native plugin 是承载一切的一等公民。`extensions/` 目录是一棵 **174 个内建插件**的树，每个插件一个 `openclaw.plugin.json` + TypeScript 源码：模型 provider（`anthropic`、`openai`、`google`……）、消息通道（`discord`、`slack`、`telegram`……）、功能插件（`voice-call`、`coding-agent`、`memory-lancedb`……）全部同构。以 `anthropic` 为例：manifest 声明 `categories: ["models"]`、`enabledByDefault: true`、`providers: ["anthropic"]` 与 `activation.onStartup`，代码通过 `api.registerProvider(...)` / `api.registerCliBackend(...)` 注册能力。

对比其他 CLI 的"核心功能"：Claude Code 的模型调用在核心里，OpenClaw 的模型调用在 `extensions/anthropic` 这个普通插件里——**模型 provider 本身就是插件**，这是它"个人助理网关"定位的直接推论。内建插件由 `src/plugins/bundled-dir.ts` 定位（源码 checkout、dist 构建、测试三种场景解析同一目录），可用 `OPENCLAW_DISABLE_BUNDLED_PLUGINS` 整体关闭。

## 3. 四层加载管线与激活边界

`docs/plugins/architecture.md` 把加载描述为四层：**manifest + discovery**（配置路径、workspace 根、全局安装根、内建目录）→ **enablement + validation**（enabled/disabled/blocked，以及 memory 这类独占槽位的选择）→ **runtime loading**（进程内 `register(api)`，`registrationMode === "full"`）→ **surface consumption**（工具、通道、hooks、HTTP 路由、CLI 命令、服务）。关键设计边界是：

- manifest/配置校验只读 **元数据**，不执行插件代码；
- 能力发现可以加载可信插件入口构建一个 **不激活的 registry 快照**（`PluginMetadataSnapshot` / `PluginLookUpTable`）；
- 真正的运行时行为才走 `register(api)` 全量路径。

这条"激活边界"由 `src/plugin-activation-boundary.test.ts` 从根包启动路径逐点验证：manifest 声明（如 `channels: [...]`、`configuredState.env.anyOf`）足以驱动控制面决策，未激活的插件不得被控制面触碰。`src/plugins/activation-planner.ts` 在此之上提供"这个命令/provider/通道需要哪些插件"的窄化计划，`activation.*` manifest 字段是显式 planner 提示，ownership 字段（`providers`、`channels`……）是回退依据。

## 4. 内建扩展的同型替换

内建插件没有任何特权机制：第三方插件用同样的 `register(api)` 注册同名能力即可替代内建实现。文档给出的信号（`openclaw plugins inspect`）只有 shape 分类——`plain-capability` / `hybrid-capability` / `hook-only` / `non-capability`——内建与第三方完全同赛。防护靠配置而非机制：`plugins.allow`/`plugins.deny` 控制 id 级加载，`plugins.load.paths` 显式选择加载路径；同名冲突时有完整的 discovery precedence（源码构建 > 受管全局安装 > 内建副本）而非"内建优先"的硬编码。这与 pi 的"同名替换"（见 `docs/hello-pi/06-extension-mcp.md` §4）思路一致，但 OpenClaw 把裁决权交给 install record 与 provenance，而不是注册表里的 `replaceable` 标记。

## 5. MCP 总览：三个方向

MCP 在 OpenClaw 里不是单点功能，而是三个方向的组合：

- **作为客户端**：内建 MCP 客户端连接 `mcp.servers` 配置的第三方服务器（stdio/SSE/Streamable HTTP + OAuth），实现散布在 `src/agents/agent-bundle-mcp-*` 与 `src/agents/mcp-*` 的几十个文件里，按 session 与 requester 维度管理连接租约；
- **作为服务器（通道桥）**：`openclaw mcp serve` 把 OpenClaw 的通道会话暴露给任意 MCP 客户端（`src/mcp/channel-server.ts` + `channel-bridge.ts`），工具面是 `conversations_list` / `conversation_get` / `messages_read` 等（`src/mcp/channel-tools.ts`）；
- **作为服务器（工具面）**：`src/mcp/openclaw-tools-serve.ts` 把选定的内建工具、`plugin-tools-serve.ts` 把插件注册的工具分别以独立 stdio server 暴露给 Claude Code / ACP 会话。

三条腿的连接细节、传输与审批策略留给 [24-mcp-system.md](./24-mcp-system.md)；插件形态、ClawHub 市场与 capability consent 见 [14-plugin-system.md](./14-plugin-system.md)；`api.on(...)` typed hooks 见 [19-hooks-lifecycle.md](./19-hooks-lifecycle.md)。

## 源码锚点

- [`sources/openclaw/src/plugins/manifest.ts`](../../sources/openclaw/src/plugins/manifest.ts)：`openclaw.plugin.json` 字段与 activation 归一化
- [`sources/openclaw/src/plugins/activation-planner.ts`](../../sources/openclaw/src/plugins/activation-planner.ts)：激活计划器（显式提示 + ownership 回退）
- [`sources/openclaw/src/plugin-activation-boundary.test.ts`](../../sources/openclaw/src/plugin-activation-boundary.test.ts)：根包启动路径的激活边界契约测试
- [`sources/openclaw/src/plugins/bundle-manifest.ts`](../../sources/openclaw/src/plugins/bundle-manifest.ts)：Codex/Claude/Cursor/Agent bundle manifest 归一化
- [`sources/openclaw/src/plugins/bundled-dir.ts`](../../sources/openclaw/src/plugins/bundled-dir.ts)：内建插件目录解析
- [`sources/openclaw/extensions/anthropic/openclaw.plugin.json`](../../sources/openclaw/extensions/anthropic/openclaw.plugin.json)：内建 provider 插件 manifest 实例
- [`sources/openclaw/src/agents/agent-bundle-mcp-manager.ts`](../../sources/openclaw/src/agents/agent-bundle-mcp-manager.ts)：MCP 客户端会话运行时管理器
- [`sources/openclaw/src/mcp/channel-server.ts`](../../sources/openclaw/src/mcp/channel-server.ts)：`openclaw mcp serve` stdio 服务器入口
- [`sources/openclaw/docs/plugins/architecture.md`](../../sources/openclaw/docs/plugins/architecture.md)：插件系统架构总文档
