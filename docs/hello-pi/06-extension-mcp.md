---
title: "扩展与 MCP 总览：第一公民的 ExtensionAPI"
---
# 扩展与 MCP 总览：第一公民的 ExtensionAPI

> 基于 `sources/pi/` 快照（pi v1.1.0），对照 `packages/coding-agent/` 的扩展加载器与内建扩展注册表校对。

**目录**

- [1. 扩展是 pi 的第一公民](#1-扩展是-pi-的第一公民)
- [2. 扩展工厂与 jiti 加载](#2-扩展工厂与-jiti-加载)
- [3. 发现位置与 trust 门控](#3-发现位置与-trust-门控)
- [4. 内建扩展与同名替换](#4-内建扩展与同名替换)
- [5. MCP 总览](#5-mcp-总览)

---

## 1. 扩展是 pi 的第一公民

pi 的定位写在 README 第一屏（`packages/coding-agent/README.md`）："Pi ships with powerful defaults but skips features like sub-agents and plan mode. **Ask Pi to build what you want**, or install a package that does it your way." 子代理、plan mode 这类别家 CLI 的核心功能在 pi 中都不进核心，而是留给扩展生态。`CONTRIBUTING.md` 把这条写成硬约束：核心必须保持极简且可扩展，"PRs that bloat the core will likely be rejected"。

因此扩展 API 是 pi 最大的一张面：`src/core/extensions/types.ts` 有 2273 行，覆盖事件订阅（`pi.on(...)`，40 余种事件，很多事件还能**返回结果**实现审批/改写/拦截）、工具与斜杠命令注册、自定义 `--flags`、markdown/entry 渲染器注入、UI 组件（select/confirm/editor/dialog，按 `ExtensionMode = "tui" | "rpc" | "json" | "print"` 降级）。官方示例 `examples/extensions/` 有约 80 个可直接运行的扩展，本身就是文档的一部分。

## 2. 扩展工厂与 jiti 加载

扩展模块的契约极简：**default export 一个工厂函数**，接收 `ExtensionAPI`：

```typescript
export default function (pi: ExtensionAPI) {
  // pi.on(...) / pi.registerTool(...) / pi.registerCommand(...) ...
}
```

加载由 `src/core/extensions/loader.ts` 完成：

- `loadExtensionModule()` 经 **jiti** 导入 TS/JS 源文件——本地扩展**无需预编译**（`docs/extensions.md`："Pi uses jiti, so local TypeScript extensions do not need a separate compilation step"）；
- 虚拟模块映射（`virtual-modules.ts` / `getAliases()`）把 `@earendil-works/pi-*` 等导入别名指向宿主进程内的真实包实例，保证扩展与宿主共享同一份类型与运行时，避免双实例；编译后的二进制模式走 `virtualModules`，Node 构建走 dist alias；
- 扩展模块缓存按 cwd 键控，`clearExtensionCache()` 支撑 `/reload` 热重载；
- `discoverExtensionsInDir()` 认三种形态：目录下的直接 `*.ts/*.js`、子目录 `index.ts/index.js`、以及带 `package.json` 且 `"pi"` 字段声明 extensions 的包（manifest 由 `src/core/pi-manifest.ts` 解析）。

事件分发由 `src/core/extensions/runner.ts` 的 `ExtensionRunner`（`:357`）统一调度（`emit()` / `emitBoundary()` 等），详见 [07-error-security.md](./07-error-security.md) 的错误隔离一节。

## 3. 发现位置与 trust 门控

| 来源 | 位置 | 说明 |
| --- | --- | --- |
| 用户目录 | `~/.pi/agent/extensions/` | 直接文件或子目录，无条件加载 |
| 项目目录 | `.pi/extensions/` | **trust-gated**：项目未信任则整体跳过（见 [07-error-security.md](./07-error-security.md)） |
| settings 显式列表 | `settings.json` 的 `extensions: []` | 用户/项目两级 overrides，可精确启用或禁用某个路径（`package-manager.ts` 的 `isEnabledByOverrides`） |
| Pi 包 | `pi install` 安装的 npm/git 包 | npm 源装到 `~/.pi/agent/npm/node_modules`（用户级）或 `.pi/npm/node_modules`（项目级）；git 源克隆到托管根目录 |

Pi 包是分发形态：一个包可以通过 `"pi"` manifest 捆绑 extensions、skills、prompts、themes 四类资源（见 `docs/packages.md`），CLI 对应 `pi install | remove | update | list`。

## 4. 内建扩展与同名替换

`src/extensions/index.ts` 以 `InlineExtension` 形式注册了四个内建扩展：

| 名称 | 能力 | 可替换 |
| --- | --- | --- |
| `llama.cpp` | 本地 llama.cpp / HuggingFace provider | 否 |
| `codemode` | QuickJS 沙箱内执行模型写的 JS 脚本 | 是（`replaceable: true`） |
| `tool-search` | 动态工具发现 | 是 |
| `mcp` | MCP 客户端、OAuth、资源、`/mcp` 命令 | 是 |

"可替换"是显式设计：`resource-loader.ts` 的 `omitReplacedExtensions` 会在加载时检查——若第三方扩展注册了与内建扩展相同的工具/命令/flag 名（例如另一个注册 `/mcp` 的 MCP 扩展），**内建的那个直接不加载**，并给出一条警告说明如何取舍。内建功能因此享有与第三方完全同赛的机制，而非特权。

## 5. MCP 总览

MCP 在 pi 中不是独立子系统，而是**内建扩展 + 独立客户端包**的组合：

- `@earendil-works/pi-mcp`（`packages/mcp/`）：不依赖官方 SDK 的 MCP 客户端，含 JSON-RPC framing、stdio/Streamable HTTP/in-memory 三种 transport、远程服务器的 OAuth（PKCE）流程；
- `src/extensions/mcp/`：内建扩展把 pi-mcp 包装进 pi 的工具面——服务器配置（`.pi/mcp.json`）、工具以 `mcp__*` 命名空间暴露、资源浏览、`/mcp` 命令；重量级依赖经 `runtime.lazy.ts` / `cli.lazy.ts` 懒加载（见 [08-performance.md](./08-performance.md)）。

协议细节、OAuth 流程与 trust 交互留给 [24-mcp-system.md](./24-mcp-system.md)，本章不展开。

## 源码锚点

- [`sources/pi/packages/coding-agent/src/extensions/index.ts`](../../sources/pi/packages/coding-agent/src/extensions/index.ts)：内建扩展注册表与 `replaceable` 标记
- [`sources/pi/packages/coding-agent/src/core/extensions/loader.ts`](../../sources/pi/packages/coding-agent/src/core/extensions/loader.ts)：jiti 加载、虚拟模块别名、目录发现
- [`sources/pi/packages/coding-agent/src/core/extensions/types.ts`](../../sources/pi/packages/coding-agent/src/core/extensions/types.ts)：ExtensionAPI 与事件契约
- [`sources/pi/packages/coding-agent/src/core/package-manager.ts`](../../sources/pi/packages/coding-agent/src/core/package-manager.ts)：资源目录发现与 overrides
- [`sources/pi/packages/coding-agent/docs/extensions.md`](../../sources/pi/packages/coding-agent/docs/extensions.md)：扩展作者文档
