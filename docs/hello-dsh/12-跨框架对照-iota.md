---
layout: default
title: "DSH 与 iota 跨框架对照"
---

# DSH 与 iota 跨框架对照

这篇对照不按类名或目录结构强行配对，而按**可观察语义**判断：两侧是否解决同一个问题，替换边界是否相同，缺失能力应补齐还是明确留在内核/宿主。

## 三种关系

- **语义等价**：结构不同，但运行结果与责任边界可以对位。
- **教学补齐**：复用 iota-core 已有通用机制，在示例层补出可运行路径。
- **结构性边界**：能力由具体内核或宿主拥有，不为外观一致扩大编排层。

完整的“文件::符号/章节”证据见 [`iota-example/docs/dsh-vs-iota.md`](../../iota-example/docs/dsh-vs-iota.md)。

## M01–M12 导航

| 模块 | DSH 教材 | iota 教材 | 关系摘要 |
|---|---|---|---|
| M01 工具管线 | [DSH](../../dsh-example/M01-tool-pipeline/README.md) | [iota](../../iota-example/M01-tool-pipeline/README.md) | ToolPipeline 可补齐编排层工具阶段；内核可见性保持边界 |
| M02 上下文装配 | [DSH](../../dsh-example/M02-context-assembly-economics/README.md) | [iota](../../iota-example/M02-context-assembly-economics/README.md) | 作用域记忆等价；完整 Prompt 压缩属于内核 |
| M03 推理接入 | [DSH](../../dsh-example/M03-inference-service-access/README.md) | [iota](../../iota-example/M03-inference-service-access/README.md) | DSH 换 LLM Adapter；iota 换整个 KernelAdapter |
| M04 循环干预 | [DSH](../../dsh-example/M04-agent-loop-intervention/README.md) | [iota](../../iota-example/M04-agent-loop-intervention/README.md) | 事件和节点 hook 等价；mid-turn 状态归内核 |
| M05 会话面 | [DSH](../../dsh-example/M05-session-surface/README.md) | [iota](../../iota-example/M05-session-surface/README.md) | 存储语义可对位；日志投影不变量不同 |
| M06 人在环路 | [DSH](../../dsh-example/M06-human-in-the-loop/README.md) | [iota](../../iota-example/M06-human-in-the-loop/README.md) | permission fail-closed 等价；计划模式归宿主 |
| M07 执行后端 | [DSH](../../dsh-example/M07-execution-backends/README.md) | [iota](../../iota-example/M07-execution-backends/README.md) | DSH 在 harness 提供 seam；iota 将执行栈留给内核 |
| M08 委派 | [DSH](../../dsh-example/M08-delegation-presets/README.md) | [iota](../../iota-example/M08-delegation-presets/README.md) | SubagentProvider 与 GraphSpec DAG 语义对位 |
| M09 长任务 | [DSH](../../dsh-example/M09-long-running-orchestration/README.md) | [iota](../../iota-example/M09-long-running-orchestration/README.md) | iota 另有租约队列、checkpoint 与恢复语义 |
| M10 外部能力 | [DSH](../../dsh-example/M10-external-capabilities/README.md) | [iota](../../iota-example/M10-external-capabilities/README.md) | Skill 数据与 MCP server 均有真实路径 |
| M11 配置数据 | [DSH](../../dsh-example/M11-config-data-infrastructure/README.md) | [iota](../../iota-example/M11-config-data-infrastructure/README.md) | Profile/store 可对位；凭证附件归宿主 |
| M12 框架机制 | [DSH](../../dsh-example/M12-framework-mechanisms/README.md) | [iota](../../iota-example/M12-framework-mechanisms/README.md) | 可逆 effect 等价；不复制事件总线与 Proxy/Fiber 架构 |

## 建议阅读方法

1. 先运行同编号的两个离线模块，只记录可观察输出。
2. 再读两侧 README 的“完整链路/边界”，确认替换单元和责任归属。
3. 最后查证据表中的稳定符号锚点；不要仅凭命名相似就判断等价。

**结论：**高质量跨框架研究不是把一个框架改造成另一个，而是同时指出可迁移语义与不可越过的所有权边界。
