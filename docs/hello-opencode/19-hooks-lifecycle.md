---
title: "Hooks 生命周期：五域 hooks 与失败通道规则"
---
# Hooks 生命周期：五域 hooks 与失败通道规则

> 基于 `sources/opencode/packages/core/src/plugin/hooks.ts` 与 `packages/plugin/src/effect/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. hooks 的定位](#1-hooks-的定位)
- [2. 五个域](#2-五个域)
- [3. 失败通道规则](#3-失败通道规则)
- [4. 注册与触发](#4-注册与触发)
- [5. 生命周期语义](#5-生命周期语义)

---

## 1. hooks 的定位

v2 的 hooks 是**插件对运行时事件的类型化回调**，不是独立的插件 API 层：hook 形状定义在公共契约包（`packages/plugin/src/effect/`），注册与触发编排在 Core（`plugin/hooks.ts` 的 `PluginHooks`）。

## 2. 五个域

`hooks.ts` 的 `Domains` 接口穷举了可挂接的域：

| 域 | 形状来源 | 典型用途 |
| --- | --- | --- |
| `aisdk` | `@opencode/plugin/effect/aisdk` | 模型请求/响应拦截 |
| `session` | `@opencode/plugin/effect/session` | 会话生命周期事件 |
| `permission` | `@opencode/plugin/effect/permission` | 权限判定参与 |
| `shell` | `@opencode/plugin/effect/shell` | shell 执行拦截 |
| `tool` | `@opencode/plugin/effect/tool` | 工具执行前后（`execute.before` / `execute.after`） |

hook 可按 provider 维度筛选：`eventProviderID` 从事件的 `model.providerID` 提取归属，注册时可带 `ModelHookOptions` 限定生效范围。

## 3. 失败通道规则

`Failures` 接口编码了一条硬规则：**只有 tool 域的 `execute.before` 可以失败**——以 `Tool.Error` 在执行前拒绝调用；其余域（aisdk、session、permission、shell）的所有 hook 事件都是 `NoFailures`（失败通道为 `never`）。

这条规则保证了：权限/会话等域的 hook 不能借错误通道阻断主流程，唯一合法的"拦截并拒绝"点在工具执行前。

## 4. 注册与触发

- `PluginHooks` 接口暴露 `has(domain, name, providerID?)` 与 `register(domain, name, callback, options?)`；`has` 让调用方在不构造事件的情况下判断是否需要走 hook 路径。
- 工具执行的 `execute.after` 由 registry 在规范结果与受管输出路径上触发（见 [05-tool-system.md](./05-tool-system.md) §4 第 7 步）；hook 可刻意变换结果，变更后的内容会再次被归一化与限界后才发布。
- `PluginHost` 把 `PluginHooks` 注入插件可见服务面；插件 supervisor 负责插件失败时的隔离（见 [14-plugin-system.md](./14-plugin-system.md)）。

## 5. 生命周期语义

- hook 注册跟随插件的 Scope：插件关闭其 Scope 即卸载全部注册，与工具注册的覆盖栈语义一致。
- hook 回调是 Effect：取消语义即 Effect 中断，不把中断翻译成业务失败（与工具章的失败法则同律）。
- hook 不是托盘状态：每次请求的工具快照、每次尝试的 instruction 基线都是重新物化的，hook 看到的是当时的规范值而不是缓存。

## 源码锚点

- [`sources/opencode/packages/core/src/plugin/hooks.ts`](../../sources/opencode/packages/core/src/plugin/hooks.ts)：`PluginHooks` 编排
- [`sources/opencode/packages/plugin/src/effect/`](../../sources/opencode/packages/plugin/src/effect)：五域 hooks 的公共形状
- [`sources/opencode/packages/core/src/tool/runtime.ts`](../../sources/opencode/packages/core/src/tool/runtime.ts)：`execute.after` 触发点
