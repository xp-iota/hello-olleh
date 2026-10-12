---
title: "性能：差分渲染、懒加载与缓存友好的 prompt"
---
# 性能：差分渲染、懒加载与缓存友好的 prompt

> 基于 `sources/pi/` 快照（pi v1.1.0），对照 pi-tui 渲染循环、check 门禁脚本与 coding-agent 核心路径校对。

**目录**

- [1. pi-tui 差分渲染](#1-pi-tui-差分渲染)
- [2. 懒加载：.lazy.ts 与入口图预算](#2-懒加载lazy-ts-与入口图预算)
- [3. 缓存友好的 prompt 分节 diff](#3-缓存友好的-prompt-分节-diff)
- [4. 后台模型目录刷新与 cache-warmer](#4-后台模型目录刷新与-cache-warmer)
- [5. Bun --compile 独立二进制](#5-bun---compile-独立二进制)

---

## 1. pi-tui 差分渲染

pi-tui 把"终端 UI 慢"归因于全量重绘（其 README 第一段就是 "Updates only changed lines or viewport rows"），因此整条渲染链路围绕"只画变化"设计。整个组件树的契约也只有一行：`Component.render(width): string[]`——UI 就是样式化字符串数组的合成，这让行级 diff 天然可行：

- **节流**：`requestRender()` 经 `process.nextTick` 合并重复请求，`scheduleRender()` 节流到 `MIN_RENDER_INTERVAL_MS = 16`（`packages/tui/src/tui.ts:507`，恰好一个 60fps 帧）；键盘输入绕过节流走 `requestImmediateRender()`（`tui.ts:1001`）——注释里点名 "even setTimeout(0) can take a full 16 ms tick on Windows"，按键回显延迟被当作一等性能指标；
- **差分绘制**：`TuiMainScreen.doRender()` 渲染出整屏行数组后与 `previousLines` 做行级 diff（`computeLineDiff`），只输出变化行并按 diff 移动硬件光标；全量重绘仅发生在首帧、宽度/高度变化与收缩清理（Termux 例外），`fullRedraws` 计数器是公开 API 字段，全量重绘是"异常"而非常态；
- **原子更新**：全量重绘输出包裹在 `\x1b[?2026h` / `\x1b[?2026l`（CSI 2026 synchronized output，`tui-main-screen.ts:280` 等）中，多行更新一次上屏，消除闪烁与撕裂；
- **输入管线旁路**：`handleTerminalInput()` 先拦截终端的颜色/单元格尺寸应答等控制响应，再分发到扩展输入监听器与焦点组件，避免终端查询响应混入编辑器输入流。

渲染之外，pi-tui 还以原生预编译模块（`native/darwin|linux|win32`）提供剪贴板与键盘修饰键支持，免去 spawn 子进程调 `pbcopy`/`xclip` 的路径。

## 2. 懒加载：.lazy.ts 与入口图预算

pi 反对动态 `import()`：`AGENTS.md` 明令 "No inline imports (`await import()`, ...). Top-level imports only."，懒加载改用**显式的 `.lazy.ts` 文件**——一个只导出加载器函数的薄模块（如 `src/extensions/mcp/runtime.lazy.ts`、`packages/ai/src/api/lazy.ts` 的 `lazyStream`：把 stream 句柄同步返回、把 auth 解析挪进异步内部），加载边界静态可见、可被工具分析。构建层面同样有离线路径：根 `build:offline` 让 `ai` 包改用预填充的模型数据（`scripts/hydrate-model-catalog.ts`）而非现场刷新 provider 目录，保证断网环境下构建仍然确定。

配套的结构性防线是 `scripts/check-entry-graphs.mjs`（进 `npm run check` 门禁）：它遍历每个 `exports` 入口的值导入图，给入口设**文件数预算**和 `forbid` 列表（例如 `packages/ai` 的 `./models` 入口 ≤ 15 个文件、禁止拖入 `providers/` 与 `models.generated.ts`；`packages/durable` 主入口 ≤ 63 个文件）。脚本头注释把入口称作"成本契约"（"Entry points are cost contracts"），动机写得很直白：`export *` 会让一个"1 文件纯类型入口"拖动整个 barrel 的模块图（实测可达数十 MB 的模块图），预算让这类回归在提交时即失败，而不是在用户按下第一次回车时。同一条门禁流水线上，`check-runtime-deps` 禁止幻影依赖（`src` 里的每个非相对导入必须在 `dependencies` 中声明），`check-ts-imports` 强制相对导入带 `.ts` 后缀以匹配 strip-types 运行模型——懒加载边界因此是**静态可审计**的，而不是藏在字符串里的 `await import("...")`。

## 3. 缓存友好的 prompt 分节 diff

system prompt 不是一整块字符串，而是**有名分节**（`src/core/system-prompt.ts`）：`preamble`、`tools`、`rules`、`docs`、`addendum`、`project_context`、`skills`、`cwd`，加上扩展自定义的 XML 包裹节。`diffSystemPromptSections()`（`:217`）对比"模型当前持有的节"（从 transcript 重放而来）与"期望的节"，只输出发生变化的 `SystemMessage.sections` 补丁——切换模型档位或 `cwd` 变化时，未变的节不再重发。这与工具集变化走同一条 transcript-delta 机制（agent-loop 的 `declareToolChanges` 只声明工具增删），共同构成对 provider prompt cache 的系统性友好（详见 [11-prompt-system.md](./11-prompt-system.md)）。

分节 diff 能成立，靠的是 pi-ai 把 `SystemMessage` 设计成 **transcript-delta** 而非静态块：首条系统消息持有完整基座（base prompt + `toolsAdded`），后续系统消息只携带 `content` 追加、命名 `sections` 补丁与 `toolsAdded`/`toolsRemoved` 增量；重放端 `normalizeContext` / `getCurrentSystemMessage`（`packages/ai/src/utils/transcript.ts`）把序列折叠回当前态。任何"只发变化"的优化都落在这个可折叠的表示之上。

## 4. 后台模型目录刷新与 cache-warmer

- **模型目录**：`src/core/remote-catalog-provider.ts` 以 4 小时为新鲜窗口（`REMOTE_CATALOG_REFRESH_INTERVAL_MS`，`:15`）向 `pi.dev` 拉取各 provider 目录，带 **ETag** 再验证：304 直接沿用缓存并更新 `checkedAt`，避免下载数十 KB 的模型 JSON；刷新在交互模式下于后台执行，不阻塞首屏；
- **cache-warmer**（`src/core/cache-warmer.ts`）：在真实请求的间隙，用"上限一 token 输出"的重放请求预写 provider prompt cache；何时预热由扩展事件 `cache_warming_decision` 决定，并按 cache 留存时长与请求到达概率估算收益（流式预热有明确的时间上限，空闲预热用更短的预测窗口），把 Anthropic 式 prompt caching 从被动命中变成主动投资；
- **cache-stats**（`src/core/cache-stats.ts`）：事后账本——`computeCacheWaste()` 重放会话 entry 估算 cache 命中/浪费金额（按 `CACHE_TTL_MS` 5 分钟窗口与各模型费率），让"预热是否值得"有数据可查，而不是拍脑袋。

## 5. Bun --compile 独立二进制

`packages/coding-agent` 的 `build:binary` 先重建六个运行时依赖（tui、telemetry、ai、agent、protocol、client），再用 `bun build --compile` 把 `dist/bun/cli.js` 连同 image-resize worker 与 codemode worker 打成**单文件 `dist/pi` 二进制**——用户无需 Node/Bun 运行时。二进制路径上的资产解析必须走 `src/config.ts` 的安装探测助手（禁止 `__dirname` 直取），使同一份代码在源码 checkout、npm 安装、独立二进制三种形态下都能定位 docs/themes 等资源；虚拟模块映射（见 [06-extension-mcp.md](./06-extension-mcp.md)）保证二进制内扩展仍能 import 宿主的 `@earendil-works/*`。

单文件二进制也是启动性能的一部分：无模块解析、无 npm 包查找，冷启动只剩进程创建与配置读取，这是 pi 与"必须先装 Node"的竞品在首次体验上的分水岭。

## 源码锚点

- [`sources/pi/packages/tui/src/tui.ts`](../../sources/pi/packages/tui/src/tui.ts)：16ms 节流与即时渲染旁路
- [`sources/pi/packages/tui/src/tui-main-screen.ts`](../../sources/pi/packages/tui/src/tui-main-screen.ts)：行级差分与 CSI 2026 同步输出
- [`sources/pi/scripts/check-entry-graphs.mjs`](../../sources/pi/scripts/check-entry-graphs.mjs)：入口图文件数预算与 forbid 列表
- [`sources/pi/packages/coding-agent/src/core/system-prompt.ts`](../../sources/pi/packages/coding-agent/src/core/system-prompt.ts)：分节 diff
- [`sources/pi/packages/coding-agent/src/core/remote-catalog-provider.ts`](../../sources/pi/packages/coding-agent/src/core/remote-catalog-provider.ts)：4h/ETag 目录刷新
- [`sources/pi/packages/coding-agent/src/core/cache-warmer.ts`](../../sources/pi/packages/coding-agent/src/core/cache-warmer.ts)：prompt cache 主动预热
