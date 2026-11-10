---
type: Bundle Index
title: "dsh-lab 知识包"
description: 用 OKF v0.2 记录 DeepSeek Harness 配套工程 dsh-lab 里可复用的结论，附 graphify 结构证据与 archify 图。
tags: [okf, dsh, dsh-lab]
status: stable
generated: { by: mcode/minimax-m3.1-flash, at: 2026-10-23T10:00:00Z }
---
# dsh-lab 知识包

本目录是一个 [OKF v0.2](../../tools/okf/SPEC-v0.2.md) bundle，记录 `dsh-lab/`
的服务装配、扩展接口和工具调用流程。

`dsh-lab/` 是本仓库的配套可运行工程，基于已发布的 `@deepseek-ai/*` 0.2.2-rc.1，
含 12 个能力模块（M01–M12）、60 个可运行阶段，并支持 Node.js 与 Bun 双运行时。
本包 2026-09 的初版针对的是它的前身 `dsh-example/`，该目录已随提交 `40dfeb4`
删除；2026-10-23 整包迁移到 `dsh-lab/`，见 [log.md](log.md)。

它与仓库其他文档的分工：

| 位置 | 回答的问题 | 形态 |
|:-----|:-----------|:-----|
| [`docs/hello-dsh/`](../hello-dsh/README.md) | 源码怎么实现、在哪一行 | 按章节编排的长文 |
| [`dsh-lab/`](../../dsh-lab/README.md) | 怎么亲手跑一遍 | 可执行示例 |
| 本目录 | 结论是什么、凭什么这么说、什么时候会过期 | 带 provenance 的概念条目 |

## Concepts

- [装配枢纽：cordis.patch.yml 装配清单](concepts/01-assembly-hub.md) — 12 个模块共用的服务树，由一份声明式清单装配。
- [能力缝的三角色](concepts/02-capability-seam.md) — Definition、Provider、Consumer 的职责和后端注册方式。
- [推理服务可替换](concepts/03-provider-swap.md) — 推理协议适配与 provider 路由配置。
- [一次工具调用等于两步](concepts/04-tool-call-round-trip.md) — 工具调用回路的步数从哪里来，怎么用会话日志验证。

## References

- [graphify 对 dsh-lab 的建图结果](references/01-graphify-dsh-lab.md) — 本包所有结构性断言的数字来源。

## 本包的约定

- 每个概念都带 `sources`、`generated.by`、`status`、`stale_after`，便于判断新鲜度与可信度（SPEC §5）。
- `verified` 只记录**真实跑过的自动化验证**，用 `process:` 前缀；没有人工复核就不写 `human:`，因此按 SPEC §5.3 这些条目是 machine-confirmed 而非 human-reviewed。`verified` 是事件列表（SPEC §5.2），2026-09 的旧工程验证与 2026-10 的迁移复核各占一条。
- 结构性数字来自 graphify；`EXTRACTED` 表示提取关系，`INFERRED` 表示推断关系。**图谱数字的适用范围以 reference 页的说明为准**：上半部分是 2026-10-23 对 `dsh-lab/` 的实测，下半部分保留 2026-09-12 对已删除的 `dsh-example/` 的历史测量——两组数字不可混用。
- **与 SPEC §6.1 的一处有意偏离**：SPEC 建议 cross-link 使用「从 bundle 根算起的绝对路径」，本包改用相对路径。原因是仓库的链接门禁 `scripts/check_doc_links.py` 会把 `/concepts/x.md` 解析成文件系统绝对路径而判为断链；相对路径同样能构成 SPEC 要求的知识图谱，且能被门禁校验。
- **与 SPEC §8/§9 的一处有意偏离**：SPEC 说 index 文件不带 frontmatter；本包保留 frontmatter，以便用 `type` 与 `tags` 检索目录级文档。目录结构与条目格式仍按 §8、§9 走。

更新历史见 [log.md](log.md)。
