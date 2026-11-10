---
type: Bundle Log
title: "dsh-lab 知识包更新历史"
description: 本 OKF bundle 的按日更新记录。
tags: [okf, dsh-lab]
---
# dsh-lab 知识包更新历史

## 2026-10-23

迁移到继任工程 `dsh-lab/`（前身 `dsh-example/` 已随提交 `40dfeb4` 从仓库删除）：

- 全部链接与 `sources[].resource` 改指 `dsh-lab/`：旧 `runtime/harness.ts` →
  `src/boot.ts` + `src/lab/services.ts`；旧 `runtime/llm.ts` →
  `src/llm/anthropic-compat/index.ts`；旧 `runtime/llm-minimax.test.ts` →
  `src/llm/anthropic-compat.test.ts`；旧 `M0X-*/impl|scenes/*.ts` → `M0X-*/index.ts`。
- 概念 01 改写为「装配枢纽：cordis.patch.yml 装配清单」：dsh-lab **没有** `createHarness`，
  装配由官方 `boot()` 加声明式 patch 层完成——`cordis.patch.yml` 88 条 `- id:` 行，
  `src/lab/services.ts` 只是 24 个服务包的类型侧导入，运行时一行都不产生。
- 概念 02 改写 provider 归属：dsh-lab 全工程只有一处自写 provider
  （`src/llm/anthropic-compat/`）；compaction 与 sandbox 后端改由官方包
  （`@deepseek-ai/dsh-compaction-basic`、`@deepseek-ai/dsh-sandbox-local`）在装配清单里提供。
- 概念 03 补 0.2.1 的契约变化（工具结果是独立的 `role: 'tool'` 消息、
  每个 provider 请求必须带 `attributionHeaders()`），并改写缺 key 的失败时机：
  凭据在**调用期**解析，`dsh-lab sessions` / `traj` 这类本地读操作没有 key 也能用。
- 概念 04 的证据改指 `dsh-lab/scripts/probe-trajectory.ts`（脚本化适配器跑真实 turn，
  turn 大纲为「步 2 / 工具 1」）。
- reference 由 `01-graphify-dsh-example.md` 重命名为 `01-graphify-dsh-lab.md`。
  **图谱数字已重新测量**：装上 graphify 0.9.53，按 `collect_files → extract →
  build_from_json(directed=True) → cluster → god_nodes → to_json` 对 `dsh-lab/` 建图，
  扫描根 17 个（`src`、`runtime`、`scripts`、M01–M12、两份装配清单），
  得 51 文件 / 396 节点 / 600 边 / 32 社区（`EXTRACTED` 537、`INFERRED` 63），
  `graphify diagnose multigraph --directed` 报 0 dangling / 0 duplicate / 0 折叠。
  2026-09-12 那组旧数字（169 文件 / 584 节点 / 744 边 / 45 社区 / 枢纽度数 66）
  作为**历史小节**原样保留，并明确标注它属于已删除的旧工程。
- 由此得到一条新的结构性结论：dsh-lab **没有**旧工程那种单一装配枢纽——12 个模块
  全部 import `src/lab/runner.ts`，没有一个 import `boot.ts`；代码侧最接近枢纽的
  `bootLab`（`src/boot.ts` L180）度数只有 9；而两份 YAML 装配清单贡献 0 个节点
  （tree-sitter 的代码语法不覆盖 YAML），即**装配来源在 AST 图上不可见**。
- `stale_after` 统一顺延到 `2027-04-30T00:00:00Z`；`verified` 保留 2026-09 的历史条目，
  另加一条 2026-10-23 的 graphify 实测与一条迁移复核（actor `mcode/minimax-m3.1-flash`）。
- `stale_after` 的复核口径：结构性数字已按同一流程重新测量并复算；结论指向随工程名与
  文件路径一起更新，没有沿用旧工程的数字。

## 2026-09-12

A5 按 12 个方向模块重建结构证据；本节**取代** 2026-09-07 条目里的当前数字，但保留旧条目作为历史：

- graphify 0.9.53 仅扫描 `runtime` 与 `M01`–`M12`，共 169 文件；有向图为
  584 节点 / 744 边 / 45 社区，739 条 `EXTRACTED`、5 条 `INFERRED`。
- `createHarness()` 唯一，位于 `runtime/harness.ts` L136；度数 66（入 62、出 4）。
  数字已从 gitignored `graphify-out/dsh-example/graph.json` 独立复算，并通过
  multigraph 诊断（0 dangling、0 duplicate、0 same-endpoint collapse）。
- 四个概念条目迁移到 M01/M02/M03/M07 新路径；所有概念与 reference 都保留
  `sources`，并把 `stale_after` 规范化为绝对 UTC instant `2026-12-31T00:00:00Z`。

> 本节记录的工程是当时的 `dsh-example/`，2026-10-23 已整体迁移到 `dsh-lab/`；
> 上面这组数字仍然只对旧工程成立。

## 2026-09-07

建包。四个概念条目与一份 reference 首次写入：

- 用 graphify 0.9.53 对 `dsh-example/` 自有源码（87 个文件，排除 `node_modules`）建有向图，
  得到 584 节点 / 744 边 / 45 社区；`createHarness` 以度数 66 成为唯一枢纽。
  这组数字是 [装配枢纽](concepts/01-assembly-hub.md) 与
  [graphify reference](references/01-graphify-dsh-lab.md) 的事实来源。
- 用 archify 补齐示例工程此前缺失的两张图（拓扑与工具调用回路），
  均通过 showcase 的 9 项检查，0 error 0 warning。
- [一次工具调用等于两步](concepts/04-tool-call-round-trip.md) 的 step 数与词数、字符数，
  来自 `01-tool-wordcount/run-minimax.ts` 在本地 SSE 桩下的实测输出，非估算。

已知限制（同日记录，便于后续复核）：

- 未对真实 MiniMax 端点发起请求：本机 Node 为 v20.20.2（工程要求 ≥ 22.18），
  且无 `LLM_API_KEY`。真实 wire format 的正确性由 `runtime/llm-minimax.test.ts`
  的 fixture 测试与本地桩共同覆盖。
- graphify 的 4 条 `INFERRED` 边未计入任何结构性断言，仅在 reference 中列出。
