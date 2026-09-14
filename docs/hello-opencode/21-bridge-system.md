---
title: "Bridge / 外部集成：ACP、Desktop 与 IDE 事件"
---
# Bridge / 外部集成：ACP、Desktop 与 IDE 事件

> 基于 `sources/opencode/packages/cli/src/acp/`、`packages/desktop/` 与 `packages/schema/src/ide-event.ts` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 桥接面总览](#1-桥接面总览)
- [2. ACP：Agent Client Protocol](#2-acpagent-client-protocol)
- [3. Desktop 与 Web 宿主](#3-desktop-与-web-宿主)
- [4. IDE 事件](#4-ide-事件)

---

## 1. 桥接面总览

v2 的"桥接"不是 Claude Code 那种远程控制 bridge，而是三条外部集成路径：**ACP**（IDE 编辑器协议）、**Desktop/Web 宿主**（同一 client 协议的另一批宿主）、**IDE 事件**（编辑器状态进入事件流的公共形状）。三条路径都复用公共协议面，不引入私有通道。

## 2. ACP：Agent Client Protocol

`opencode acp` 子命令把 OpenCode 作为 ACP agent 运行，供 Zed 等支持 ACP 的编辑器接入。`packages/cli/src/acp/` 的文件划分：

| 文件 | 职责 |
| --- | --- |
| `agent.ts` | ACP agent 主体 |
| `service.ts` | 服务装配 |
| `config-option.ts` | ACP 配置选项映射 |
| `content.ts` | 内容块转换 |
| `event.ts` | 会话更新事件映射 |
| `permission.ts` | 权限请求桥接 |
| `tool.ts` | 工具调用映射 |
| `error.ts` | 错误映射 |

每条文件对应 ACP 协议的一个适配面：编辑器侧的会话/权限/工具语义被翻译成 OpenCode 的协议操作，运行时的 durable 事件再映射回 ACP 的 session update。

## 3. Desktop 与 Web 宿主

- `packages/desktop`：桌面宿主（打包分发）；`packages/app` 与 `packages/web`：浏览器侧宿主与界面。它们与 TUI 同级——都经 client/SDK 消费公共 API（见 [15-sdk-transport.md](./15-sdk-transport.md)）。
- `packages/session-ui`、`packages/ui`、`packages/theme`、`packages/storybook` 承载跨宿主复用的会话界面与设计系统。

## 4. IDE 事件

`packages/schema/src/ide-event.ts` 定义 IDE 侧事件的公共形状，与 LSP 事件（见 [18-lsp-integration.md](./18-lsp-integration.md)）同属"编辑器智能"的公共事件层：Core 不内嵌编辑器能力，但为宿主/插件约定可互操作的事件形状。

## 源码锚点

- [`sources/opencode/packages/cli/src/acp/`](../../sources/opencode/packages/cli/src/acp)：ACP 适配层
- [`sources/opencode/packages/desktop/`](../../sources/opencode/packages/desktop)：桌面宿主
- [`sources/opencode/packages/schema/src/ide-event.ts`](../../sources/opencode/packages/schema/src/ide-event.ts)：IDE 事件形状
