---
layout: content
type: Bundle Log
title: dsh-example 知识包更新历史
description: 本 OKF bundle 的按日更新记录。
tags: [okf, dsh-example]
---

# Directory Update Log

## 2026-09-12

A5 按 12 个方向模块重建结构证据；本节**取代** 2026-09-07 条目里的当前数字，但保留旧条目作为历史：

- graphify 0.9.53 仅扫描 `runtime` 与 `M01`–`M12`，共 169 文件；有向图为
  584 节点 / 744 边 / 45 社区，739 条 `EXTRACTED`、5 条 `INFERRED`。
- `createHarness()` 唯一，位于 `runtime/harness.ts` L136；度数 66（入 62、出 4）。
  数字已从 gitignored `graphify-out/dsh-example/graph.json` 独立复算，并通过
  multigraph 诊断（0 dangling、0 duplicate、0 same-endpoint collapse）。
- 四个概念条目迁移到 M01/M02/M03/M07 新路径；所有概念与 reference 都保留
  `sources`，并把 `stale_after` 规范化为绝对 UTC instant `2026-12-31T00:00:00Z`。

## 2026-09-07

建包。四个概念条目与一份 reference 首次写入：

- 用 graphify 0.9.53 对 `dsh-example/` 自有源码（87 个文件，排除 `node_modules`）建有向图，
  得到 584 节点 / 744 边 / 45 社区；`createHarness` 以度数 66 成为唯一枢纽。
  这组数字是 [装配枢纽](concepts/assembly-hub.md) 与
  [graphify reference](references/graphify-dsh-example.md) 的事实来源。
- 用 archify 补齐示例工程此前缺失的两张图（拓扑与工具调用回路），
  均通过 showcase 的 9 项检查，0 error 0 warning。
- [一次工具调用等于两步](concepts/tool-call-round-trip.md) 的 step 数与词数、字符数，
  来自 `01-tool-wordcount/run-minimax.ts` 在本地 SSE 桩下的实测输出，非估算。

已知限制（同日记录，便于后续复核）：

- 未对真实 MiniMax 端点发起请求：本机 Node 为 v20.20.2（工程要求 ≥ 22.18），
  且无 `MINIMAX_API_KEY`。真实 wire format 的正确性由 `runtime/llm-minimax.test.ts`
  的 fixture 测试与本地桩共同覆盖。
- graphify 的 4 条 `INFERRED` 边未计入任何结构性断言，仅在 reference 中列出。
