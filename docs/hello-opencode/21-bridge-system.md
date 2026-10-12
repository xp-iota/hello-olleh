---
title: "Bridge / 外部集成：ACP 与 Desktop/Web 宿主"
---
# Bridge / 外部集成：ACP 与 Desktop/Web 宿主

> 基于 `sources/opencode/packages/cli/src/acp/` 与 `sources/opencode/packages/desktop/` 中的 OpenCode `v2.0.27` 源码校对。

**目录**

- [1. 桥接面总览](#1-桥接面总览)
- [2. ACP：Agent Client Protocol](#2-acpagent-client-protocol)
- [3. Desktop 与 Web 宿主](#3-desktop-与-web-宿主)

---

## 1. 桥接面总览

v2 的"桥接"不是 Claude Code 那种远程控制 bridge，而是两条外部集成路径：**ACP**（IDE 编辑器协议）与 **Desktop/Web 宿主**（同一 client 协议的另一批宿主）。两条路径都复用公共协议面，不引入私有通道。

## 2. ACP：Agent Client Protocol

`opencode acp` 子命令把 OpenCode 作为 ACP agent 运行，供 Zed 等支持 ACP 的编辑器接入。`packages/cli/src/acp/` 的文件划分：

| 文件 | 职责 |
| --- | --- |
| `agent.ts` | ACP agent 主体 |
| `client.ts` / `connection.ts` | ACP client 与连接管理 |
| `sessions.ts` / `prompt.ts` / `turn.ts` | 会话、prompt 与回合映射 |
| `content.ts` / `tool.ts` | 内容块与工具调用转换 |
| `translate.ts` | 会话更新事件映射（OpenCode 事件 → ACP SessionUpdate） |
| `permission.ts` / `elicitation.ts` | 权限请求与 elicitation 桥接 |
| `compaction.ts` / `replay.ts` | compaction 与重放适配 |
| `error.ts` / `capabilities.ts` / `catalog.ts` | 错误、能力与目录适配 |
| `service.ts` / `config-option.ts` / `directories.ts` / `child.ts` | 服务装配、配置选项映射、目录与子进程 |

每条文件对应 ACP 协议的一个适配面：编辑器侧的会话/权限/工具语义被翻译成 OpenCode 的协议操作，运行时的 durable 事件再映射回 ACP 的 session update。

## 3. Desktop 与 Web 宿主

- `packages/desktop`：桌面宿主（打包分发）；`packages/app` 与 `packages/web`：浏览器侧宿主与界面。它们与 TUI 同级——都经 client/SDK 消费公共 API（见 [15-sdk-transport.md](./15-sdk-transport.md)）。
- `packages/session-ui`、`packages/ui`、`packages/theme`、`packages/storybook` 承载跨宿主复用的会话界面与设计系统。

## 源码锚点

- [`sources/opencode/packages/cli/src/acp/`](../../sources/opencode/packages/cli/src/acp)：ACP 适配层
- [`sources/opencode/packages/desktop/`](../../sources/opencode/packages/desktop)：桌面宿主
- [`sources/opencode/packages/cli/src/acp/translate.ts`](../../sources/opencode/packages/cli/src/acp/translate.ts)：ACP 会话更新事件映射
