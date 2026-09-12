---
layout: content
title: "Hello Harness: 源码分析质量横向评估"
---

# Hello Harness: 源码分析质量横向评估

> 四套 AI Coding CLI 源码阅读文档的证据标准、横向对比和合并计划

---

## 项目概述

Hello Harness 是 `docs/hello-claude-code/`、`docs/hello-codex/`、`docs/hello-gemini-cli/`、`docs/hello-opencode/` 的横向综合层。它不替代单项目源码细读，而是回答三个问题：这些 `hello-*` 文档是否真正回链源码、四个项目在相同主题上如何比较、后续应该如何补强和合并文档。

### 核心价值

1. **质量门禁**：统一覆盖度、证据密度、链路完整性、差异表达和维护性标准。
2. **主题对齐**：用 `01-25` 共享主干保证四个项目可以按相同编号横向阅读。
3. **证据闭环**：要求关键结论回链到 repo-root 源码路径或项目章节锚点。
4. **合并路线**：把项目源码笔记和 Harness 横向结论分层维护，减少重复摘要。

---

## 文档导航

### 核心设计文档

| 文档 | 内容 | 状态 |
| :------| :------| :------|
| [14-source-analysis-quality.md](14-source-analysis-quality.md) | 四套 `hello-*` 源码分析质量、证据密度和补强策略 | 完成 |
| [15-topic-alignment-matrix.md](15-topic-alignment-matrix.md) | 四项目 `01-25` 共享主干与项目附录规则 | 完成 |
| [16-tool-governance-comparison.md](16-tool-governance-comparison.md) | 工具注册、权限、审批、沙箱、结果回注横向对比 | 完成 |
| [17-prompt-systems-comparison.md](17-prompt-systems-comparison.md) | Prompt 注入面、项目指令、工具 prompt 与 skill 注入对比 | 完成 |
| [18-extension-mcp-comparison.md](18-extension-mcp-comparison.md) | Skill、Plugin、MCP、Command、Hook 扩展面分层 | 完成 |
| [19-runtime-surface-comparison.md](19-runtime-surface-comparison.md) | 入口、传输、REPL、Bridge、Input Queue 合并视角 | 完成 |
| [20-doc-merge-plan.md](20-doc-merge-plan.md) | 项目源码笔记与 Harness 横向结论的逐主题合并计划 | 完成 |
| [21-final-audit.md](21-final-audit.md) | 五目录主题验收、证据等级、术语表和维护风险 | 完成 |
| [40-pluggable-context-memory-module.md](40-pluggable-context-memory-module.md) | 统一抽象层设计、核心接口定义、适配器实现、使用示例 | ✅ 完成 |
| [42-runtime-comparison.md](42-runtime-comparison.md) | OpenCode vs Hermes Agent 详细对比分析 | ✅ 完成 |
| [pluggable-architecture.mermaid](pluggable-architecture.mermaid) | 分层架构可视化图表 | ✅ 完成 |

### 快速开始

1. **先看质量标准**：阅读 [14-source-analysis-quality.md](14-source-analysis-quality.md)，确认四套 `hello-*` 文档的证据密度和剩余风险。
2. **再看主题骨架**：阅读 [15-topic-alignment-matrix.md](15-topic-alignment-matrix.md)，按统一编号比较相同主题。
3. **进入专题对比**：阅读 [16-tool-governance-comparison.md](16-tool-governance-comparison.md) 到 [19-runtime-surface-comparison.md](19-runtime-surface-comparison.md)，查看工具、Prompt、扩展和入口传输的横向结论。
4. **最后看合并计划与验收页**：阅读 [20-doc-merge-plan.md](20-doc-merge-plan.md) 和 [21-final-audit.md](21-final-audit.md)，确认哪些内容留在项目章、哪些内容进入 Harness、还有哪些维护风险。

---

## 历史设计附录

以下内容保留为 OpenCode/Hermes 跨运行时模块设计的历史附录，不是当前四项目源码分析质量评估的主入口。

| 文档 | 内容 |
| --- | --- |
| [40-pluggable-context-memory-module.md](40-pluggable-context-memory-module.md) | 可插拔 context/memory 抽象层设计、接口和示例 |
| [42-runtime-comparison.md](42-runtime-comparison.md) | OpenCode 与 Hermes Agent 的 runtime 对比 |
| [pluggable-architecture.mermaid](pluggable-architecture.mermaid) | 历史模块设计的架构图 |

当前主线只维护 `14-20` 的源码分析质量评估、主题对齐、横向对比和文档合并计划。
