---
title: "LSP 集成：v2 只保留公共事件形状"
---
# LSP 集成：v2 只保留公共事件形状

> 基于 `sources/opencode/packages/schema/src/lsp-event.ts` 与 `packages/core/src/v1/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 结论](#1-结论)
- [2. v2 保留的部分](#2-v2-保留的部分)
- [3. v1 残留与迁移边界](#3-v1-残留与迁移边界)
- [4. 阅读建议](#4-阅读建议)

---

## 1. 结论

与 v1（内置 LSP client、懒启动多 server、diagnostics 回流）不同，**OpenCode v2 的运行时不再携带 LSP client**。当前快照中 LSP 的踪迹只有两类：Schema 里的公共事件形状，以及 `core/src/v1/` 下的 v1 兼容残留。引用"v1 的 LSP 集成"的旧文档一律视为过期。

## 2. v2 保留的部分

`packages/schema/src/lsp-event.ts` 的全部内容：

```ts
export const Updated = Event.ephemeral({ type: "lsp.updated", schema: {} })
export const Definitions = Event.inventory(Updated)
```

即：v2 只定义了一个 ephemeral（live-only、不进 durable 回放）的 `lsp.updated` 事件形状及其 inventory。它的存在让宿主/插件可以约定一个公共的 LSP 状态通知形状，但 Core 本身不启动、不管理、不诊断任何 language server。

## 3. v1 残留与迁移边界

- `packages/core/src/v1/` 保留 v1 兼容代码（`v1/config/`、`v1/permission.ts`），其中 `v1/config/lsp.ts` 是 v1 LSP 配置的残留——它服务旧配置形状的读取，不代表 v2 运行时能力。
- 代码库其它位置出现的 `lsp` 字样（如 `tool/plugin/edit.ts`、`file-mutation.ts`）是编辑/诊断相关的局部引用，不构成 LSP 子系统。
- TUI 侧的 `util/permission.ts`、`mini/tool.ts` 出现的 lsp 引用同理是局部的。

## 4. 阅读建议

研究"编辑器智能"主题时，v2 的正确入口是 ACP 桥接（见 [21-bridge-system.md](./21-bridge-system.md)）：IDE 能力经 ACP 与 IDE 事件（`schema/ide-event.ts`）进入，而不是经内嵌 LSP client。

## 源码锚点

- [`sources/opencode/packages/schema/src/lsp-event.ts`](../../sources/opencode/packages/schema/src/lsp-event.ts)：仅存的公共 LSP 事件形状
- [`sources/opencode/packages/core/src/v1/config/lsp.ts`](../../sources/opencode/packages/core/src/v1/config/lsp.ts)：v1 兼容残留
