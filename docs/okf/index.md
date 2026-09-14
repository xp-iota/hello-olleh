---
type: Bundle Index
title: "dsh-example 知识包"
description: 用 OKF v0.2 记录 DeepSeek Harness 示例工程里可复用的结论，附 graphify 结构证据与 archify 图。
tags: [okf, dsh, dsh-example]
status: stable
generated: { by: kiro/gpt-5.6-sol, at: 2026-09-12T12:25:04Z }
---
# dsh-example 知识包

本目录是一个 [OKF v0.2](../../tools/okf/SPEC-v0.2.md) bundle，记录 `dsh-example/`
这个示例工程在阅读与改造过程中沉淀下来的、**跨任务可复用**的结论。

它与仓库其他文档的分工：

| 位置 | 回答的问题 | 形态 |
|:-----|:-----------|:-----|
| [`docs/hello-dsh/`](../hello-dsh/README.md) | 源码怎么实现、在哪一行 | 按章节编排的长文 |
| [`dsh-example/`](../../dsh-example/README.md) | 怎么亲手跑一遍 | 可执行示例 |
| 本目录 | 结论是什么、凭什么这么说、什么时候会过期 | 带 provenance 的概念条目 |

## Concepts

- [装配枢纽 createHarness](concepts/01-assembly-hub.md) — 12 个方向模块为什么仍能保持细粒度步骤：装配成本一次性付在 runtime 层。
- [能力缝的三角色](concepts/02-capability-seam.md) — Definition、Provider、Consumer 如何切分，以及为什么故意留两个缝不装。
- [推理服务可替换](concepts/03-provider-swap.md) — 从 mock 换到真实 MiniMax，业务代码为什么一行都不用改。
- [一次工具调用等于两步](concepts/04-tool-call-round-trip.md) — 工具调用回路的步数从哪里来，怎么用会话日志验证。

## References

- [graphify 对 dsh-example 的建图结果](references/01-graphify-dsh-example.md) — 本包所有结构性断言的数字来源。

## 本包的约定

- 每个概念都带 `sources`、`generated.by`、`status`、`stale_after`，便于判断新鲜度与可信度（SPEC §5）。
- `verified` 只记录**真实跑过的自动化验证**，用 `process:` 前缀；没有人工复核就不写 `human:`，因此按 SPEC §5.3 这些条目是 machine-confirmed 而非 human-reviewed。
- 结构性数字（节点数、度数、边的可信度分布）一律来自 graphify，不靠人工估算；推断边（`INFERRED`）在正文里显式标注，不与提取边混为一谈。
- **与 SPEC §6.1 的一处有意偏离**：SPEC 建议 cross-link 使用「从 bundle 根算起的绝对路径」，本包改用相对路径。原因是仓库的链接门禁 `scripts/check_doc_links.py` 会把 `/concepts/x.md` 解析成文件系统绝对路径而判为断链；相对路径同样能构成 SPEC 要求的知识图谱，且能被门禁校验。

更新历史见 [log.md](log.md)。
