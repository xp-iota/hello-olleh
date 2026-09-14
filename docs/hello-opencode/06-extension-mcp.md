---
title: "扩展与 MCP：四类扩展面的总览"
---
# 扩展与 MCP：四类扩展面的总览

> 基于 `sources/opencode/packages/core/src/` 与 `sources/opencode/specs/v2/` 中的 OpenCode `v2.0.2` 源码校对。本文是扩展面的总览入口，深挖见各专题章。

**目录**

- [1. 扩展面总览](#1-扩展面总览)
- [2. MCP：动态工具与指引来源](#2-mcp动态工具与指引来源)
- [3. Plugin：代码级扩展](#3-plugin代码级扩展)
- [4. Skill：指令级扩展](#4-skill指令级扩展)
- [5. Catalog：配置变换管线](#5-catalog配置变换管线)
- [6. 扩展面的权威差异](#6-扩展面的权威差异)

---

## 1. 扩展面总览

OpenCode v2 的扩展沿四条正交路径进入运行时：

| 扩展面 | 形态 | 入口 | 深挖章节 |
| --- | --- | --- | --- |
| MCP | 外部 server 提供的动态工具/prompt/resource/指引 | `packages/core/src/mcp/` | [24-mcp-system.md](./24-mcp-system.md) |
| Plugin | 作者编写的 TS 模块，注册工具、hooks、provider 等 | `packages/core/src/plugin/` + `packages/plugin` | [14-plugin-system.md](./14-plugin-system.md) |
| Skill | 指令级内容包，注入 instruction 增量 | `packages/core/src/skill/` | [13-skill-system.md](./13-skill-system.md) |
| Catalog 变换 | 配置驱动的目录变换（含 provider policy） | `packages/core/src/catalog.ts` + `config/` | [17-settings-config.md](./17-settings-config.md) |

四类扩展共享工具的结构契约（`Tool.make`，见 [05-tool-system.md](./05-tool-system.md)），但不共享权威级别。

## 2. MCP：动态工具与指引来源

- MCP client 在 `packages/core/src/mcp/client.ts`，支持 stdio 与 remote 连接（`stdio.ts`、`oauth.ts`），默认启动/目录超时 30s，执行超时 12h。
- 动态 MCP 工具与 manifest 工具使用与内建相同的结构工具形状（运行时 JSON Schema），经同一注册与执行管线进入模型请求快照。
- MCP server 同时是 **instruction 来源**之一（`mcp/instructions.ts`）：其指引以内容寻址的 instruction 增量进入系统提示装配（见 [11-prompt-system.md](./11-prompt-system.md)）。
- 发现管理命令在 CLI：`opencode mcp list/add/auth/logout`。

## 3. Plugin：代码级扩展

- 公共契约在 `packages/plugin`（含 `effect/` 下的 aisdk/session/permission/shell/tool 五域 hooks 形状）；运行时宿主在 `packages/core/src/plugin/`（host、supervisor、module、provider、command、skill、system-prompt、vcs、websearch 等子域）。
- 插件激活时获取所在 Location 的服务、构造工具，并在插件自有的新 Scope 里注册——关闭 Scope 即整体卸载（见 [05-tool-system.md](./05-tool-system.md) §3）。
- 生命周期管理走 CLI：`opencode plugin list/add/check/update/remove`；配置侧生命周期见决策记录 `specs/v2/catalog-config-plugin-lifecycle.md`。

## 4. Skill：指令级扩展

- `packages/core/src/skill/discovery.ts` 以并发上限（skill 4 / 文件 8）扫描 skill 包，并对路径做严格段校验（拒绝 `..`、反斜杠、NUL、URL 可解析值等）。
- skill 的指引经 `skill/instructions.ts` 汇入 instruction 谱系；所选 agent 的 skill 指引是 runner 显式组合的指令来源之一。
- 插件体系内还有 `plugin/skill`，让插件也能贡献 skill。

## 5. Catalog：配置变换管线

`catalog.ts` 与 `config/` 构成“可重放的 Location 作用域目录变换”管线（决策记录见 `specs/v2/catalog-config-plugin-lifecycle.md`）：配置发现 -> 归一化 -> 变量插值 -> 插件变换 -> 终态 catalog（含 provider policy 判定）。`experimental.policies` 由最后一个 catalog 插件解释执行，`provider.use` 动作在所有其它目录变换之后判定。

## 6. 扩展面的权威差异

| 扩展 | 能做什么 | 不能做什么 |
| --- | --- | --- |
| 内建工具 | 捕获受信 Location 服务（文件系统、权限），自行组织权限断言 | 绕过 `PermissionV2` 评估 |
| 静态插件工具 | 与内建同构的 `Tool.make` 契约 | 访问未授予的宿主服务 |
| 动态 MCP / manifest 工具 | 运行时 JSON Schema 定义，同形状注册 | 捕获宿主服务（权威低于受信工具） |
| Skill / 指令扩展 | 影响 prompt 装配 | 直接注册可执行工具 |

## 源码锚点

- [`sources/opencode/packages/core/src/mcp/`](../../sources/opencode/packages/core/src/mcp)：MCP client、stdio、OAuth、instructions
- [`sources/opencode/packages/core/src/plugin/`](../../sources/opencode/packages/core/src/plugin)：插件运行时
- [`sources/opencode/packages/core/src/skill/`](../../sources/opencode/packages/core/src/skill)：skill 发现与指令
- [`sources/opencode/specs/v2/catalog-config-plugin-lifecycle.md`](../../sources/opencode/specs/v2/catalog-config-plugin-lifecycle.md)：catalog/配置/插件生命周期决策记录
