---
title: "Plugin 系统：宿主、监督器与模块生命周期"
---
# Plugin 系统：宿主、监督器与模块生命周期

> 基于 `sources/opencode/packages/core/src/plugin/` 与 `sources/opencode/packages/plugin/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 双层结构：公共契约 + 运行时宿主](#1-双层结构公共契约--运行时宿主)
- [2. 运行时子域](#2-运行时子域)
- [3. 激活与 Scope 生命周期](#3-激活与-scope-生命周期)
- [4. 配置驱动的生命周期](#4-配置驱动的生命周期)
- [5. 管理命令](#5-管理命令)

---

## 1. 双层结构：公共契约 + 运行时宿主

| 层 | 包 | 内容 |
| --- | --- | --- |
| 公共契约 | `packages/plugin` | `Tool.make`、插件 app 形状、`effect/` 下五域 hooks 接口（aisdk/session/permission/shell/tool）、`host.ts`、`rpc.ts`、`storage.ts`、source 抽象（`source.bun.ts` / `source.node.ts`）、`tui/` 与 `promise/` 入口 |
| 运行时宿主 | `packages/core/src/plugin/` | 加载、监督、注册、hooks 编排与插件对运行时各域的贡献 |

`plugin/host.ts` 的 `PluginHost.make` 展示了插件可见的服务面：App、Agent、AISDK、Catalog、Command、Credential、Bus、Integration、KV、Location、LocationServiceMap、Model、Mcp、Session、PersistentPty、Provider、Reference、Rpc、Skill、Tool、Workspace、Vcs、WebSearch、Worktree、Generate、Permission、PluginHooks 等——插件在受控能力集上编程，而不是任意 import Core 内部。

## 2. 运行时子域

`packages/core/src/plugin/` 的子域划分（每域一个文件或子目录）：

| 子域 | 职责 |
| --- | --- |
| `host.ts` / `supervisor.ts` / `instance.ts` / `service.ts` | 插件宿主构造、监督与实例生命周期 |
| `module.ts` / `internal.ts` / `source-directory.ts` | 模块加载与来源目录解析 |
| `hooks.ts` | 五域 hooks 的注册与触发编排（见 [19-hooks-lifecycle.md](./19-hooks-lifecycle.md)） |
| `provider.ts` + `provider/` | 插件贡献 provider |
| `command.ts` + `command/` | 插件贡献 slash command |
| `skill.ts` + `skill/` | 插件贡献 skill |
| `system-prompt/` | 插件参与系统提示塑造 |
| `agent.ts` / `plan.ts` / `variant.ts` | agent 目录、plan 形态、variant 参与 |
| `vcs/` / `websearch/` / `models-dev.ts` | VCS、web 搜索、模型目录的插件面 |
| `mcp-codemode-exclusion.ts` | MCP 与 Code Mode 的互斥规则 |
| `optimize.ts` / `warming.ts` / `update.ts` / `promise.ts` | 优化、预热、更新与 Promise 桥 |

## 3. 激活与 Scope 生命周期

- 插件激活时获取所在 Location 的服务、构造其贡献（工具、hooks 等），并注册进**插件自有的新 Scope**；关闭 Scope 即整体卸载，工具注册按覆盖栈显露上一层（见 [05-tool-system.md](./05-tool-system.md) §3）。
- 事件面：插件可消费 Bus 事件；`host.ts` 里定义了 `rpc.*` 事件形状，把插件 RPC 事件接入统一事件流。
- 测试宿主：`PluginHost.make(plugin, pluginID = "test")` 支持以测试身份构造宿主。

## 4. 配置驱动的生命周期

插件的启用、来源与参数走配置；决策记录 `specs/v2/catalog-config-plugin-lifecycle.md` 解释了为何采用**可重放的 Location 作用域 catalog 变换**：配置发现 -> 归一化 -> 插件变换 -> 终态 catalog，每一步可重放、可审计（与 [17-settings-config.md](./17-settings-config.md) 配套阅读）。

## 5. 管理命令

CLI 提供完整生命周期命令：`opencode plugin list / add / check / update / remove`（handler 在 `packages/cli/src/commands/handlers/plugin/`）。`check` 用于校验插件与当前版本的契约兼容性，`update` 走插件来源的更新通道。

## 源码锚点

- [`sources/opencode/packages/plugin/src/`](../../sources/opencode/packages/plugin/src)：公共契约
- [`sources/opencode/packages/core/src/plugin/host.ts`](../../sources/opencode/packages/core/src/plugin/host.ts)：宿主服务面
- [`sources/opencode/packages/core/src/plugin/supervisor.ts`](../../sources/opencode/packages/core/src/plugin/supervisor.ts)：监督器
- [`sources/opencode/specs/v2/catalog-config-plugin-lifecycle.md`](../../sources/opencode/specs/v2/catalog-config-plugin-lifecycle.md)：生命周期决策记录
