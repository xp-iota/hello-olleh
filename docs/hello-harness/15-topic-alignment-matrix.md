---
title: "篇章主题对齐矩阵"
---
<!-- markdownlint-disable MD060, MD024 -->

# 篇章主题对齐矩阵

本章定义七个项目 `hello-*` 目录的统一篇章骨架，并说明 `docs/hello-harness/` 如何承担横向验收目录。目标是让横向阅读时，读者可以用相同编号比较相同主题，再用 Harness 页确认结论是否收敛。

## 1. 对齐规则

| 范围 | 规则 |
| --- | --- |
| `01-25` | 七个项目共享主干，编号和主题应保持一致 |
| `26-39` | 项目特有附录，必须在 README 中标注“为什么只有该项目有” |
| `40+` | 跨运行时设计、迁移方案或非单项目对比，优先放入 `docs/hello-harness/` |

## 2. 共享主干

| 编号 | 统一主题 | Claude | Codex | Gemini | OpenCode | Nanobot | Pi | OpenClaw |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | 架构全景 | `01-architecture` | `01-architecture` | `01-architecture` | `01-architecture` | `01-architecture` | `01-architecture` | 同左 |
| 02 | 启动链路 | `02-startup-flow` | `02-startup-flow` | `02-startup-flow` | `02-startup-flow` | `02-startup-flow` | `02-startup-flow` | 同左 |
| 03 | Agent Loop | `03-agent-loop` | `03-agent-loop` | `03-agent-loop` | `03-agent-loop` | `03-agent-loop` | `03-agent-loop` | 同左 |
| 04 | 状态、会话、记忆 | `04-state-session-memory` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 05 | 工具系统 | `05-tool-system` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 06 | 扩展与 MCP | `06-extension-mcp` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 07 | 错误与安全 | `07-error-security` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 08 | 性能 | `08-performance` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 09 | 可观测性 | `09-observability` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 10 | 会话恢复 | `10-session-resume` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 11 | Prompt 系统 | `11-prompt-system` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 12 | 多代理 | `12-multi-agent` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 13 | Skill 系统 | `13-skill-system` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 14 | Plugin 系统 | `14-plugin-system` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 15 | SDK 与传输 | `15-sdk-transport` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 16 | 韧性机制 | `16-resilience` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 17 | 设置与配置 | `17-settings-config` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 18 | LSP 集成 | `18-lsp-integration` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 19 | Hooks 生命周期 | `19-hooks-lifecycle` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 20 | REPL 与状态 | `20-repl-and-state` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 21 | Bridge / 外部集成 | `21-bridge-system` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 22 | 项目初始化报告 | `22-project-init-analysis` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 23 | 输入命令队列 | `23-input-command-queue` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 24 | MCP 系统深挖 | `24-mcp-system` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 25 | 调试指南 | `25-debugging` | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |

## 3. 项目特有附录

| 项目 | 附录 | 定位 |
| --- | --- | --- |
| Claude Code | `24b-mcp-deep`, `25b-growthbook` | 反编译快照中额外可见的 MCP/OAuth 与 feature flag 机制 |
| Codex | 暂无 | 保持 `01-25` 共享主干 |
| Gemini CLI | 暂无 | 保持 `01-25` 共享主干 |
| OpenCode | 暂无 | v2 重建后保持 `01-25` 共享主干；v1 时代的 `26-38` 深挖已按主题并入主干各章 |
| Nanobot | 暂无 | 保持 `01-25` 共享主干 |
| Pi | 暂无 | 保持 `01-25` 共享主干 |
| OpenClaw | 暂无 | 保持 `01-25` 共享主干 |

## 4. 合并原则

项目目录保留“源码阅读笔记”，`docs/hello-harness/` 承担“横向结论”。当一个主题在多个项目中都存在，不再新增第五份项目摘要，而是新增或更新 Harness 对比章。

## 5. 八目录验收关系

| 目录 | 角色 | 验收重点 |
| --- | --- | --- |
| `docs/hello-claude-code/` | Claude Code 单项目源码笔记 | 反编译快照下的入口、Prompt、MCP、TUI、恢复边界 |
| `docs/hello-codex/` | Codex 单项目源码笔记 | Rust runtime、thread/turn、tools、sandbox、Skill、MCP、transport |
| `docs/hello-gemini-cli/` | Gemini CLI 单项目源码笔记 | Ink TUI、GeminiClient、ToolRegistry/Scheduler、extensions、checkpoint |
| `docs/hello-opencode/` | OpenCode 单项目源码笔记 | v2 多包分层、durable event log、Scope 注册、provider policy、SSE 馈送 |
| `docs/hello-nanobot/` | Nanobot 单项目源码笔记 | 渠道包、MessageBus、AgentLoop/AgentRunner 两层循环、JSONL 会话、Dream 记忆 |
| `docs/hello-pi/` | Pi 单项目源码笔记 | minimal harness 哲学、14 包分层、pi-agent-core 双层循环、扩展第一公民、pi-durable 未来形态 |
| `docs/hello-openclaw/` | OpenClaw 单项目源码笔记 | 单 Gateway 控制面、通道即插件、双 SQLite 状态、pairing 安全模型、常驻韧性 |
| `docs/hello-harness/` | 横向验收与综合层 | 主题对齐、术语统一、证据等级、维护风险 |
