---
title: "Hello Harness 文档导航"
---
# Hello Harness 文档导航

Hello Harness 是 `docs/hello-claude-code/`、`docs/hello-codex/`、`docs/hello-gemini-cli/` 与 `docs/hello-opencode/` 的横向综合层。它以源码证据为基础，对齐不同运行时的控制面、工具治理、上下文、记忆、扩展机制与验证模型。

## Harness 基础模型

| 文档 | 内容 |
| :--- | :--- |
| [01-framework.md](01-framework.md) | Harness 分析框架与系统边界 |
| [02-control-plane.md](02-control-plane.md) | 控制平面、策略与执行入口 |
| [03-feedforward-controls.md](03-feedforward-controls.md) | 前馈控制与请求前约束 |
| [04-feedback-controls.md](04-feedback-controls.md) | 反馈控制、观测与纠偏 |
| [05-tool-governance.md](05-tool-governance.md) | 工具注册、权限、审批与沙箱 |
| [06-context-and-memory.md](06-context-and-memory.md) | 上下文编译、压缩与记忆 |
| [07-harnessability.md](07-harnessability.md) | 可治理性与运行时接缝 |
| [08-entropy-management.md](08-entropy-management.md) | 状态熵、恢复与持久化 |
| [09-multi-agent-verification.md](09-multi-agent-verification.md) | 多 Agent 协作与独立验证 |
| [10-human-steering.md](10-human-steering.md) | 人工引导与审批边界 |
| [11-extensibility.md](11-extensibility.md) | Plugin、Skill、MCP 与 Hook 扩展面 |
| [12-synthesis.md](12-synthesis.md) | 跨运行时综合结论 |
| [13-agent-loop.md](13-agent-loop.md) | Agent loop、事件与持久化链路 |

## 跨项目对比

| 文档 | 内容 |
| :--- | :--- |
| [15-topic-alignment-matrix.md](15-topic-alignment-matrix.md) | 四项目共享主题与章节对齐 |
| [16-tool-governance-comparison.md](16-tool-governance-comparison.md) | 工具注册、权限、审批、沙箱与结果回注 |
| [17-prompt-systems-comparison.md](17-prompt-systems-comparison.md) | Prompt 注入、项目指令、工具描述与 Skill |
| [18-extension-mcp-comparison.md](18-extension-mcp-comparison.md) | Skill、Plugin、MCP、Command 与 Hook |
| [19-runtime-surface-comparison.md](19-runtime-surface-comparison.md) | 入口、传输、REPL、Bridge 与输入队列 |

## 上下文与记忆运行时设计

| 文档 | 内容 |
| :--- | :--- |
| [40-pluggable-context-memory-module.md](40-pluggable-context-memory-module.md) | OpenCode 与 Hermes Agent 的可插拔 context/memory 抽象 |
| [42-runtime-comparison.md](42-runtime-comparison.md) | OpenCode v2 与 Hermes Agent 运行时对比 |

## 阅读路径

1. 从 [01-framework.md](01-framework.md) 到 [13-agent-loop.md](13-agent-loop.md) 建立 Harness 控制模型。
2. 用 [15-topic-alignment-matrix.md](15-topic-alignment-matrix.md) 对齐四个项目的同类章节。
3. 阅读 [16-tool-governance-comparison.md](16-tool-governance-comparison.md) 到 [19-runtime-surface-comparison.md](19-runtime-surface-comparison.md) 获取专题横向结论。
4. 需要跨运行时上下文与记忆设计时，进入 [40-pluggable-context-memory-module.md](40-pluggable-context-memory-module.md) 与 [42-runtime-comparison.md](42-runtime-comparison.md)。
