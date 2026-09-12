---
layout: content
title: "20 - 文档合并执行计划"
---
<!-- markdownlint-disable MD060, MD024 -->

# 文档合并执行计划

本章把 [15-topic-alignment-matrix.md](15-topic-alignment-matrix.md) 的合并原则落成可执行清单。目标不是把四个 `hello-*` 目录合成一个大文档，而是让项目源码笔记和 Harness 横向结论各司其职。

## 1. 合并边界

| 内容类型 | 保留位置 | 合并动作 |
| --- | --- | --- |
| 项目源码细读 | `docs/hello-claude-code/`、`docs/hello-codex/`、`docs/hello-gemini-cli/`、`docs/hello-opencode/` | 保留，不搬运到 Harness |
| 横向判断 | `docs/hello-harness/` | 从项目章抽取差异结论，合并成主题对比章 |
| 项目特有深挖 | 各项目 `26+` 或 `24b/25b` | 作为附录保留，并在 README 标注原因 |
| 重复总览 | 优先压缩到 Harness | 项目章只保留与源码路径直接相关的部分 |
| 维护规则 | `docs/hello-harness/14`、`15`、`20` | 作为后续新增/重写文档的门禁 |

## 2. 逐主题合并表

| 共享主题 | 项目章保留内容 | Harness 合并位置 | 后续动作 |
| --- | --- | --- | --- |
| `03` Agent Loop | 各项目 loop 入口、模型流、工具回注源码链 | `13-agent-loop.md` | 保留项目细节；Harness 只维护闭环拓扑和差异 |
| `05` 工具系统 | registry、approval、sandbox、execution、result | `16-tool-governance-comparison.md` | 项目章补源码锚点；Harness 维护统一治理矩阵 |
| `06/24` 扩展与 MCP | MCP 配置、连接、tool discovery、tool call | `18-extension-mcp-comparison.md` | 合并重复 MCP 概念；项目章保留调用链 |
| `07/16` 安全与韧性 | approval、sandbox、retry、overflow、fallback | `05-tool-governance.md`、`04-feedback-controls.md` | Harness 维护风险矩阵；项目章保留源码证据 |
| `09/25` 可观测性与调试 | log、trace、event、debug command、replay | `14-source-analysis-quality.md` | 建议新增 symptom -> source 的横向调试表 |
| `10` 会话恢复 | transcript、rollout、JSONL、durable state | `06-context-and-memory.md` | Harness 维护恢复能力等级；项目章保留存储结构 |
| `11` Prompt 系统 | system prompt、项目指令、工具声明、skill 注入 | `17-prompt-systems-comparison.md` | 项目章补注入点；Harness 维护 prompt surface 对比 |
| `12/13/14/19` 多代理、Skill、Plugin、Hook | 扩展机制、运行时注入、生命周期 | `18-extension-mcp-comparison.md` | 合并概念重叠；项目章标明是否真实 runtime |
| `15/20/21/23` SDK、REPL、Bridge、输入队列 | UI/API route、transport、server、event stream | `19-runtime-surface-comparison.md` | Harness 维护入口表；项目章保留源码入口 |
| `22` 项目初始化报告 | 环境、版本、快照来源 | 项目 README / root README | 不进入横向结论，除非版本升级 |

## 3. 删除与降级规则

| 情况 | 处理 |
| --- | --- |
| 四个项目都在解释同一个通用概念 | 移到 Harness；项目章改为一句定位 + 源码证据 |
| 只有一个项目实现该机制 | 保留在项目附录；Harness 只在对比表标注“该项目特有” |
| 章节只有结论没有源码路径 | 不删除，先降级为“设计解读”，后续补源码锚点 |
| 章节重复但一个有源码、一个只有摘要 | 保留有源码版本；摘要改成索引或阅读路径 |
| 反编译快照推断 | 只在 Claude 章节保留，必须标注“反编译风险” |

## 4. 当前优先级

| 优先级 | 动作 | 完成标准 |
| --- | --- | --- |
| P0 已完成 | 四项目 `03/05/11/15/23/24/25` 都有源码锚点补强 | 每章至少 5 个 repo-root 路径，当前统计已达标 |
| P0 已完成 | Harness `14-20` 串成质量与合并闭环 | README、index、00-index 都可导航 |
| P1 | Codex/Gemini `11-21` 从摘要扩成生命周期链路 | 每章说明输入、处理、输出、横向差异 |
| P1 | OpenCode `26-38` 保持附录定位 | 不再复制 `03/13/19` 的总览结论 |
| P2 待环境验证 | 站点/PDF 渲染验证 | `npm run build` 需要本地可用的 Ruby Bundler；当前环境缺少 `bundle` |

## 5. 合并后的阅读契约

读者横向比较时，先读 `docs/hello-harness/14-20` 确认质量标准、主题对齐和合并计划；再按编号进入四个 `hello-*` 目录读取源码细节。项目章节只回答“这个项目源码怎么实现”，Harness 章节回答“横向比较下来说明什么、应该怎么合并和维护”。
