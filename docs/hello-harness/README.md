# Hello Harness

`docs/hello-harness/` 是跨 AI Coding CLI 的综合分析层。它不绑定某一个上游工程，而是把 Claude Code、Codex、Gemini CLI、OpenCode 等实现抽象成 Harness Engineering 的控制系统：控制平面、前馈控制、反馈控制、工具治理、上下文与记忆、可驾驭性、熵管理、多代理验证、人类导向和扩展性。

## 阅读入口

- 网页索引：[index.md](./index.md)
- 框架总览：[01-framework.md](./01-framework.md)
- Context/Memory 对比：[06-context-and-memory.md](./06-context-and-memory.md)
- Agent Loop 对比：[13-agent-loop.md](./13-agent-loop.md)
- 源码分析质量评估：[14-source-analysis-quality.md](./14-source-analysis-quality.md)
- 篇章主题对齐矩阵：[15-topic-alignment-matrix.md](./15-topic-alignment-matrix.md)
- 文档合并执行计划：[20-doc-merge-plan.md](./20-doc-merge-plan.md)
- 最终验收与维护索引：[21-final-audit.md](./21-final-audit.md)
- 可插拔模块设计：[40-pluggable-context-memory-module.md](./40-pluggable-context-memory-module.md)
- Runtime 对比：[42-runtime-comparison.md](./42-runtime-comparison.md)

## 推荐阅读顺序

1. [01-framework.md](./01-framework.md)：先建立 Harness Engineering 的概念边界。
2. [02-control-plane.md](./02-control-plane.md)：理解 agent 行为由哪些控制面约束。
3. [03-feedforward-controls.md](./03-feedforward-controls.md)：看规则、上下文、提示词如何在执行前塑形。
4. [04-feedback-controls.md](./04-feedback-controls.md)：看错误、验证、回滚、审查如何在执行后修正。
5. [05-tool-governance.md](./05-tool-governance.md)：比较四类工具权限与审批模型。
6. [06-context-and-memory.md](./06-context-and-memory.md)：深入比较 state/session/memory/context compaction。
7. [13-agent-loop.md](./13-agent-loop.md)：用闭环拓扑横向比较各工具的主循环。
8. [14-source-analysis-quality.md](./14-source-analysis-quality.md) 和 [15-topic-alignment-matrix.md](./15-topic-alignment-matrix.md)：校准源码证据标准与 `01-25` 共享主干。
9. [16-tool-governance-comparison.md](./16-tool-governance-comparison.md) 到 [19-runtime-surface-comparison.md](./19-runtime-surface-comparison.md)：阅读工具、Prompt、扩展和入口传输的横向合并结论。
10. [20-doc-merge-plan.md](./20-doc-merge-plan.md)：按主题确认哪些内容留在项目章，哪些内容并入 Harness。
11. [21-final-audit.md](./21-final-audit.md)：查看最终验收、证据密度、术语表和维护风险。
12. [12-synthesis.md](./12-synthesis.md)：最后读综合结论。

## 章节索引

| 文件 | 主题 | 阅读目的 |
| --- | --- | --- |
| [00-index.md](./00-index.md) | 目录总索引 | 快速定位主题和章节关系 |
| [01-framework.md](./01-framework.md) | Harness Framework | 定义控制系统视角和评价维度 |
| [02-control-plane.md](./02-control-plane.md) | 控制平面 | 分析规则、配置、策略、运行时约束 |
| [03-feedforward-controls.md](./03-feedforward-controls.md) | 前馈控制 | 比较 prompt、memory、policy 的预注入机制 |
| [04-feedback-controls.md](./04-feedback-controls.md) | 反馈控制 | 比较错误恢复、验证、审查和回滚 |
| [05-tool-governance.md](./05-tool-governance.md) | 工具治理 | 权限、审批、沙箱、allowlist/denylist |
| [06-context-and-memory.md](./06-context-and-memory.md) | 上下文与记忆 | state/session/memory/compaction 横向对比 |
| [07-harnessability.md](./07-harnessability.md) | 可驾驭性 | 代码结构是否利于 agent 与工程师共同维护 |
| [08-entropy-management.md](./08-entropy-management.md) | 熵管理 | 知识腐烂、规则漂移、记忆 GC |
| [09-multi-agent-verification.md](./09-multi-agent-verification.md) | 多代理验证 | 执行者/验证者分离和确认偏差治理 |
| [10-human-steering.md](./10-human-steering.md) | 人类导向 | 人类审批、干预、可解释性和转向能力 |
| [11-extensibility.md](./11-extensibility.md) | 扩展性 | MCP、Plugin、Skill、Command 接入模型 |
| [12-synthesis.md](./12-synthesis.md) | 综合 | 综合评分、差异归纳和工程建议 |
| [13-agent-loop.md](./13-agent-loop.md) | Agent Loop | 四类 runtime 的闭环拓扑对比 |
| [14-source-analysis-quality.md](./14-source-analysis-quality.md) | 源码分析质量 | 评估四套 `hello-*` 文档的覆盖、证据和维护性 |
| [15-topic-alignment-matrix.md](./15-topic-alignment-matrix.md) | 篇章主题对齐 | 定义四项目 `01-25` 共享主干和项目附录规则 |
| [16-tool-governance-comparison.md](./16-tool-governance-comparison.md) | 工具治理对比 | 工具注册、权限、审批、沙箱、结果回注 |
| [17-prompt-systems-comparison.md](./17-prompt-systems-comparison.md) | Prompt 系统对比 | system prompt、项目指令、工具 prompt、skill 注入 |
| [18-extension-mcp-comparison.md](./18-extension-mcp-comparison.md) | 扩展与 MCP 对比 | Skill、Plugin、MCP、Command、Hook 的分层关系 |
| [19-runtime-surface-comparison.md](./19-runtime-surface-comparison.md) | 入口与传输对比 | CLI/TUI/SDK/Bridge/Input Queue 的横向合并视角 |
| [20-doc-merge-plan.md](./20-doc-merge-plan.md) | 文档合并计划 | 把主题对齐原则落成逐主题合并动作 |
| [21-final-audit.md](./21-final-audit.md) | 最终验收 | 五目录主题验收、证据等级、术语表和维护风险 |
| [40-pluggable-context-memory-module.md](./40-pluggable-context-memory-module.md) | 可插拔模块 | 跨 OpenCode/Hermes 的 context/memory 抽象设计 |
| [42-runtime-comparison.md](./42-runtime-comparison.md) | Runtime 对比 | OpenCode 与 Hermes Agent 的消息、上下文、存储对比 |

## 维护注意

- 本目录的判断必须回链到 `hello-*` 或上游源码证据，避免只写抽象结论。
- 四个项目目录的 `01-25` 视为共享主干；项目特有深挖统一作为附录，并在 [15-topic-alignment-matrix.md](./15-topic-alignment-matrix.md) 登记。
- `37-durable-state-comparison.md` 的旧 OpenCode 对比内容已迁移到 [06-context-and-memory.md](./06-context-and-memory.md)。
- 新增跨工具对比章节时同步更新本 README 和 [index.md](./index.md)。
