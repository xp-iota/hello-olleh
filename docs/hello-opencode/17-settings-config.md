---
title: "设置与配置：发现、归一化与 catalog 变换管线"
---
# 设置与配置：发现、归一化与 catalog 变换管线

> 基于 `sources/opencode/packages/core/src/config/`、`catalog.ts` 与 `specs/v2/catalog-config-plugin-lifecycle.md` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 配置模型总览](#1-配置模型总览)
- [2. 配置发现](#2-配置发现)
- [3. 归一化、变量与 watch](#3-归一化变量与-watch)
- [4. catalog 变换管线](#4-catalog-变换管线)
- [5. provider 与模型配置](#5-provider-与模型配置)

---

## 1. 配置模型总览

v2 的配置不是一次性读取的静态文件，而是一条**可重放的 Location 作用域 catalog 变换管线**：发现 -> 归一化 -> 变量插值 -> 插件变换 -> 终态 catalog。配置公共形状在 `packages/schema/src/config.ts` 与 `schema/config/`，运行时管线的选择在 `specs/v2/catalog-config-plugin-lifecycle.md` 的决策记录里解释。

## 2. 配置发现

`config/discovery.ts`：

- 配置文件名只认 `opencode.json` / `opencode.jsonc`。
- 全局根目录按序扫描：全局配置目录、`~/.claude`、`~/.agents`（`Global.config` / `Global.home` 提供基础路径）；`global: false` 可关闭全局文件参与。
- 目录解析经 `FSUtil.resolve`，发现结果与全局文件合并为生效配置来源集。

## 3. 归一化、变量与 watch

`config/` 目录的职责划分：

| 文件 | 职责 |
| --- | --- |
| `discovery.ts` | 来源发现 |
| `normalize.ts` | 形状归一化（含兼容性修正） |
| `variable.ts` | 变量插值 |
| `markdown.ts` | 配置内 markdown 内容处理 |
| `watch.ts` | 变更监听，驱动 catalog 重放 |
| `plugin/` | 配置侧的插件变换挂载点 |

配置变更通过 `config.updated` 事件广播（事件日志器会把它桥接进进程日志，见 [09-observability.md](./09-observability.md) §3），watch 触发 catalog 重放使新配置生效。

## 4. catalog 变换管线

`catalog.ts` 承载终态目录的组装；`specs/v2/catalog-config-plugin-lifecycle.md` 记录了为何选择"可重放的 Location 作用域变换"而不是其它方案。管线上的关键事实：

- 变换按 Location 作用域执行与重放，与会话的 Location 服务解析模型一致（见 [01-architecture.md](./01-architecture.md) §4）。
- provider policy 由**最后一个 catalog 插件**在所有其它变换之后解释执行（见 [07-error-security.md](./07-error-security.md) §3）。
- agent、命令、skill、provider 等目录对象都来自终态 catalog——插件对它们的贡献必须经过这条管线，而不是旁路注入。

## 5. provider 与模型配置

- `providers` 配置描述端点、选项与模型覆盖；授权判定走独立的 `experimental.policies`（配置与授权分离）。
- 模型目录来自 models.dev（`model.ts`、`models-dev.ts`、`models-dev/`），`model-resolver.ts` 把"agent 的模型选择"解析为具体 provider+模型。
- `opencode models`、`opencode auth login/logout/switch` 是模型与凭据的管理入口。

## 源码锚点

- [`sources/opencode/packages/core/src/config/discovery.ts`](../../sources/opencode/packages/core/src/config/discovery.ts)：配置发现
- [`sources/opencode/packages/core/src/catalog.ts`](../../sources/opencode/packages/core/src/catalog.ts)：catalog 组装
- [`sources/opencode/packages/core/src/model-resolver.ts`](../../sources/opencode/packages/core/src/model-resolver.ts)、[`models-dev.ts`](../../sources/opencode/packages/core/src/models-dev.ts)：模型解析与目录
- [`sources/opencode/specs/v2/catalog-config-plugin-lifecycle.md`](../../sources/opencode/specs/v2/catalog-config-plugin-lifecycle.md)：管线决策记录
