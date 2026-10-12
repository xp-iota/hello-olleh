---
title: "LSP 集成：运行时不内嵌 LSP client"
---
# LSP 集成：运行时不内嵌 LSP client

> 基于 `sources/opencode/packages/schema/src/lsp-event.ts`、`packages/schema/src/config/lsp.ts` 与 `packages/core/src/config/normalize.ts` 中的 OpenCode `v2.0.27` 源码校对。

**目录**

- [1. 结论](#1-结论)
- [2. v2 保留的部分](#2-v2-保留的部分)
- [3. 配置形状与 v1 迁移边界](#3-配置形状与-v1-迁移边界)
- [4. 阅读建议](#4-阅读建议)

---

## 1. 结论

与 v1（内置 LSP client、懒启动多 server、diagnostics 回流）不同，**OpenCode v2 的运行时不再携带 LSP client**。当前快照中 LSP 的踪迹只有两类：Schema 里的公共事件形状（`lsp.updated`），以及 Schema 里随配置体系生效的 LSP 配置形状（`ConfigLSP`）。Core 本身不启动、不管理、不诊断任何 language server；引用"v1 的 LSP 集成"的旧文档一律视为过期。

## 2. v2 保留的部分

`packages/schema/src/lsp-event.ts` 的全部内容：

```ts
export const Updated = Event.ephemeral({ type: "lsp.updated", schema: {} })
export const Definitions = Event.inventory(Updated)
```

即：v2 只定义了一个 ephemeral（live-only、不进 durable 回放）的 `lsp.updated` 事件形状及其 inventory。它的存在让宿主/插件可以约定一个公共的 LSP 状态通知形状，但 Core 不据此做任何诊断。

## 3. 配置形状与 v1 迁移边界

- LSP 配置形状定义于 `packages/schema/src/config/lsp.ts`（`ConfigLSP`）：每个 server 条目声明 `command`、可选 `extensions` / `disabled` / `env` / `initialization`，也允许整条以 `disabled: true` 关闭。它接入当前配置 schema（`packages/schema/src/config.ts`），由 `packages/core/src/config/normalize.ts` 读取并做诊断式解码。
- v1 形状只作为迁移测试夹具保留（`packages/core/test/fixture/v1-config/lsp.ts`）；`packages/core/src/v1/` 的配置迁移层本身已不含 LSP 条目。
- 代码库其它位置出现的 `lsp` 字样是局部引用：TUI 侧 `util/permission.ts`、`mini/tool.ts` 里的 `lsp` 是权限 action 字面量，client 的生成类型里是 `lsp.updated` 事件名——都不构成 LSP 子系统。

## 4. 阅读建议

研究"编辑器智能"主题时，v2 的正确入口是 ACP 桥接（见 [21-bridge-system.md](./21-bridge-system.md)）：IDE 能力经 ACP 进入，而不是经内嵌 LSP client。

## 源码锚点

- [`sources/opencode/packages/schema/src/lsp-event.ts`](../../sources/opencode/packages/schema/src/lsp-event.ts)：仅存的公共 LSP 事件形状
- [`sources/opencode/packages/schema/src/config/lsp.ts`](../../sources/opencode/packages/schema/src/config/lsp.ts)：LSP 配置形状（`ConfigLSP`）
- [`sources/opencode/packages/core/src/config/normalize.ts`](../../sources/opencode/packages/core/src/config/normalize.ts)：配置归一化中读取 `ConfigLSP`
- [`sources/opencode/packages/core/test/fixture/v1-config/lsp.ts`](../../sources/opencode/packages/core/test/fixture/v1-config/lsp.ts)：v1 形状的迁移测试夹具
