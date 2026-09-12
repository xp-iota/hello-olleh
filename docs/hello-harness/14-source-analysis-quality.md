---
layout: content
title: "14 - 源码分析质量横向评估"
---
<!-- markdownlint-disable MD060, MD024 -->

# 源码分析质量横向评估

本章评估 `docs/hello-claude-code/`、`docs/hello-codex/`、`docs/hello-gemini-cli/`、`docs/hello-opencode/` 对各自上游源码的分析质量。结论只用于完善文档结构，不替代单项目章节的源码细读。

## 1. 评价维度

| 维度 | 含义 | 合格标准 |
| --- | --- | --- |
| 覆盖度 | 是否覆盖启动、loop、工具、状态、Prompt、扩展、安全、UI/传输 | `01-25` 主题齐全 |
| 证据密度 | 关键判断是否能回链源码或单项目章节 | 每个核心结论至少有文件/函数/章节依据 |
| 链路完整性 | 是否能从用户输入追到模型、工具、状态和 UI 回传 | 有生命周期图和关键函数表 |
| 差异表达 | 是否说清“它和其他工具不同在哪里” | 有横向矩阵，而不是孤立项目摘要 |
| 维护性 | 后续版本升级时是否容易校验 | 使用稳定路径、少依赖漂移行号 |

## 1.1 新增门槛：源码锚点密度

后续主干章节按以下锚点标准维护：

| 章节类型 | 最低锚点要求 |
| --- | --- |
| `03` Agent loop | 至少覆盖 loop 入口、模型请求、工具回注、退出/继续判断 |
| `05` 工具系统 | 至少覆盖 registry、permission、execution、result 回注 |
| `11` Prompt 系统 | 至少覆盖 prompt 构造入口、项目指令、工具描述、模型请求注入点 |
| `15/20/21/23` 入口与传输 | 至少覆盖 UI/API route、event stream、外部协议入口 |
| `24` MCP | 至少覆盖 server config、连接/认证、tool discovery、tool call |
| `25` 调试 | 至少覆盖按症状定位的源码入口 |

锚点格式统一使用 repo-root 路径，例如 `sources/opencode/packages/opencode/src/session/prompt.ts:162` 或 `sources/claude-code/src/query.ts:241`。

## 2. 横向判断

| 项目 | 当前定位 | 强项 | 需要修正 |
| --- | --- | --- | --- |
| Claude Code | 深读型分析 | Prompt、memory、MCP、React TUI 与反编译风险意识强 | 主要风险转为证据等级维护：反编译推断、源码确认、设计解读要继续分开 |
| Codex | 工程均衡型分析 | Rust runtime、turn loop、sandbox、ghost snapshot 证据扎实 | `11-21` 已补字段级链路；后续重点是保持 line anchor 随 upstream 漂移可校验 |
| Gemini CLI | 可追溯型分析 | 行号和函数锚点密，工具调度、extension、MCP、skill 链路清楚 | 扩展、多代理、Bridge 生命周期已补；后续重点是把“无 LSP/工具化补偿”边界持续写清 |
| OpenCode | 体系化深挖型分析 | Durable state、session loop、processor、Effect-ts 深挖充分 | durable/resume/processor 已补强；后续重点是控制 `03` 与 `27-29` 的重复 |

## 2.1 质量评分矩阵

评分含义：`5` 表示该维度已可作为样板；`4` 表示主干达标但仍有局部补强点；`3` 表示可读但证据或链路不够稳定。

| 项目 | 覆盖度 | 证据密度 | 链路完整性 | 差异表达 | 维护性 | 综合判断 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | 5 | 4 | 4 | 4 | 3 | 深读充分，但反编译快照需要持续标注证据等级 |
| Codex | 5 | 4 | 5 | 4 | 4 | Runtime 主线清楚，prompt/multi-agent/bridge/resilience 已补字段级链路 |
| Gemini CLI | 5 | 5 | 4 | 4 | 4 | 源码锚点密，extension、skill、MCP、多代理、Bridge 已补生命周期链路 |
| OpenCode | 5 | 4 | 5 | 5 | 4 | 深挖最强，但需要控制 `03` 与 `27-29` 的重复 |

## 2.2 代表证据链

| 项目 | 代表章节 | 代表源码锚点 | 说明 |
| --- | --- | --- | --- |
| Claude Code | `docs/hello-claude-code/03-agent-loop.md`, `05-tool-system.md`, `11-prompt-system.md` | `sources/claude-code/src/query.ts:241`, `sources/claude-code/src/Tool.ts:123`, `sources/claude-code/src/constants/prompts.ts` | 覆盖 query 主链、工具上下文和 prompt 资产 |
| Codex | `docs/hello-codex/03-agent-loop.md`, `05-tool-system.md`, `24-mcp-system.md` | `sources/codex/codex-rs/core/src/session/handlers.rs:698`, `sources/codex/codex-rs/core/src/tools/orchestrator.rs:111`, `sources/codex/codex-rs/codex-mcp/src/connection_manager.rs:107` | 覆盖 submission loop、工具治理和 MCP 连接 |
| Gemini CLI | `docs/hello-gemini-cli/03-agent-loop.md`, `05-tool-system.md`, `11-prompt-system.md` | `sources/gemini-cli/packages/core/src/core/client.ts:868`, `sources/gemini-cli/packages/core/src/tools/tool-registry.ts:352`, `sources/gemini-cli/packages/core/src/prompts/promptProvider.ts` | 覆盖 core turn、工具注册和 PromptProvider |
| OpenCode | `docs/hello-opencode/03-agent-loop.md`, `11-prompt-system.md`, `27-session-loop.md` | `sources/opencode/packages/opencode/src/session/prompt.ts:162`, `sources/opencode/packages/opencode/src/session/prompt.ts:278`, `sources/opencode/packages/opencode/src/session/processor.ts:46` | 覆盖 durable prompt、loop 和 stream processor |

## 2.3 本轮补强状态

| 项目 | 已补强范围 | 剩余风险 |
| --- | --- | --- |
| Claude Code | `08/12/15-21/23-25` 已补源码链路、状态表和 transport/MCP 分层 | 反编译快照仍需标注证据等级 |
| Codex | `05/09-13/16/18-21/23-25` 已补工具治理、prompt 字段、multi-agent、resume、MCP 与调试链路 | line anchor 漂移需要定期校验 |
| Gemini CLI | `06/12-14/16-17/19/21/23-25` 已补 extension、skill、multi-agent、MCP、checkpoint 与输入队列链路 | LSP 缺口应持续写成能力边界，而不是误写成已实现 |
| OpenCode | `05/08-10/12-13/15-16/18/20/24-25` 已补 durable、Bus/SSE、MCP、skill、LSP、debugging 边界 | 继续避免 `03` 与 `27-29` 重复叙述 |

## 3. 证据等级

后续新增或重写章节时，建议在关键判断附近显式标注证据等级：

| 等级 | 用法 |
| --- | --- |
| 源码确认 | 有明确源码路径、函数、调用点或现有章节证据 |
| 运行链路推断 | 由多个调用点组合推出，正文说明推导路径 |
| 反编译风险 | 只适用于 Claude Code 反编译快照，需说明 stub、命名漂移或行号漂移 |
| 设计解读 | 对工程取舍的分析，不等同于源码事实 |

## 4. 目录级修正策略

| 目录 | 修正动作 |
| --- | --- |
| `docs/hello-claude-code/` | 保留深读文字，补“关键源码锚点”表；反编译推断统一标注 |
| `docs/hello-codex/` | 以 `03-agent-loop.md` 的证据密度为样板，保持 `11-21` 的字段级链路可校验 |
| `docs/hello-gemini-cli/` | 保持短章节优势，但每章至少补“生命周期位置”和“关键函数清单” |
| `docs/hello-opencode/` | `03` 保持总览，`27-29` 保持深挖，`36` 只做导航 |

## 5. 质量门禁

新增或合并文档后至少执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_doc_refs.ps1 -DocDirs hello-claude-code,hello-codex,hello-gemini-cli,hello-opencode,hello-harness
cd pages
npm run build
```

允许 `openclaw/docs/start/showcase.md` 的 Liquid warning 保持为既有噪声；如果新增章节引入新的 broken link 或 Liquid error，需要先修复再合并。
