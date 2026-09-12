---
layout: content
title: "18 - 扩展与 MCP 横向对比"
---
<!-- markdownlint-disable MD060, MD024 -->

# 扩展与 MCP 横向对比

对应项目章节：

- `docs/hello-claude-code/06-extension-mcp.md`, `13-skill-system.md`, `14-plugin-system.md`, `24-mcp-system.md`
- `docs/hello-codex/06-extension-mcp.md`, `13-skill-system.md`, `14-plugin-system.md`, `24-mcp-system.md`
- `docs/hello-gemini-cli/06-extension-mcp.md`, `13-skill-system.md`, `14-plugin-system.md`, `24-mcp-system.md`
- `docs/hello-opencode/06-extension-mcp.md`, `13-skill-system.md`, `14-plugin-system.md`, `24-mcp-system.md`, `33-mcp-details.md`

## 1. 扩展面分层

| 层级 | 作用 | 典型对象 |
| --- | --- | --- |
| 指令层 | 改变模型行为，但不直接执行代码 | AGENTS.md、CLAUDE.md、GEMINI.md、skill markdown |
| 命令层 | 把用户动作编译成 prompt 或工作流 | slash command、custom command |
| 工具层 | 给模型可调用的本地/远程能力 | built-in tool、MCP tool、plugin tool |
| 生命周期层 | 在事件前后插入控制逻辑 | hooks、plugin hook、session hook |
| 传输层 | 连接外部服务或远程宿主 | MCP stdio/http/sse、websocket、server API |

## 2. 项目差异

| 项目 | 主要扩展入口 | 设计特征 |
| --- | --- | --- |
| Claude Code | Skill、plugin、MCP、hooks | 扩展面丰富，但反编译快照需要区分真实链路和残留 |
| Codex | MCP、AGENTS.md、skills、hooks | 以 Rust runtime 为核心，扩展要进入统一 approval/sandbox 体系 |
| Gemini CLI | MCP、PromptProvider、tool registry | TypeScript monorepo 可读性好，扩展路径较直接 |
| OpenCode | Plugin、MCP、Command、Skill、custom tool | 扩展最终落到 durable session 和 server contract |

## 3. 代表源码证据

| 项目 | 配置 / 入口 | 连接 / 发现 | Tool / Resource 调用 |
| --- | --- | --- | --- |
| Claude Code | `sources/claude-code/src/services/mcp/config.ts`, `sources/claude-code/src/services/mcp/client.ts` | `sources/claude-code/src/services/mcp/mcpHub.ts`, `sources/claude-code/src/services/mcp/auth.ts:847` | `sources/claude-code/src/services/mcp/mcpHub.ts` |
| Codex | `sources/codex/codex-rs/config/src/mcp_types.rs:118` | `sources/codex/codex-rs/codex-mcp/src/connection_manager.rs:107`, `sources/codex/codex-rs/codex-mcp/src/connection_manager.rs:448` | `sources/codex/codex-rs/core/src/mcp_tool_call.rs`, `sources/codex/codex-rs/core/src/tools/handlers/mcp.rs` |
| Gemini CLI | `sources/gemini-cli/packages/core/src/tools/mcp-client-manager.ts`, `sources/gemini-cli/packages/core/src/tools/mcp-client.ts` | `sources/gemini-cli/packages/core/src/mcp/auth-provider.ts`, `sources/gemini-cli/packages/core/src/mcp/oauth-provider.ts` | `sources/gemini-cli/packages/core/src/tools/mcp-client.ts`, `sources/gemini-cli/packages/core/src/tools/tool-registry.ts` |
| OpenCode | `sources/opencode/packages/opencode/src/mcp/index.ts:28`, `sources/opencode/packages/opencode/src/config/config.ts:565` | `sources/opencode/packages/opencode/src/cli/cmd/mcp.ts:55`, `sources/opencode/packages/opencode/src/cli/cmd/mcp.ts:140` | `sources/opencode/packages/opencode/src/tool/registry.ts:155`, `sources/opencode/packages/opencode/src/command/index.ts:117` |

## 4. 合并策略

`06-extension-mcp.md` 应作为扩展总览；`13` 写 skill；`14` 写 plugin；`24` 写 MCP 细节。不要在四篇里反复解释同一套概念，而是让每篇只回答一个问题：

| 章节 | 应回答的问题 |
| --- | --- |
| 06 | 这个项目有哪些扩展入口，谁是主入口 |
| 13 | skill 如何发现、注入、激活、失效 |
| 14 | plugin 如何加载、注册 hook/tool/command |
| 24 | MCP server 如何连接、发现 tool/resource/prompt、执行和回收 |

## 5. 文档缺口

Claude Code 需要把 `24b-mcp-deep.md` 中 OAuth/XAA 和权限细节回链到 `24`。Codex 需要补 MCP 与 sandbox approval 的交叉点。Gemini CLI 需要补 MCP 生命周期和错误恢复。OpenCode 需要把 `33-mcp-details.md` 的深挖定位为 `24` 的附录，避免双主线。

## 6. 扩展能力闭环

扩展能力应按“发现 -> 注册 -> 暴露 -> 执行 -> 失效/清理”五步比较。

| 阶段 | Claude Code | Codex | Gemini CLI | OpenCode |
| --- | --- | --- | --- | --- |
| 发现 | settings、plugin manifest、skill dir、MCP config | config.toml、AGENTS.md、skill dependency、MCP config | extension loader、SkillManager、MCP client manager | Config directories、plugin files、MCP config、command/skill dir |
| 注册 | hooks、commands、MCP server、skills 混合进入运行时 | Rust config + services 装配进 Session/TurnContext | extension start 时启动 MCP、注册 policy/checker、刷新 tools | plugin list、tool registry、MCP client state、server route |
| 暴露 | 通过 prompt、slash command、tool list、MCP tool 显示给模型/用户 | 通过 typed tool spec、base instructions、thread protocol 暴露 | PromptProvider 列 skill，ToolRegistry 暴露工具，commands 暴露用户入口 | server contract、ToolRegistry、command prompt、durable history |
| 执行 | tool/hook/command 各自回到 query 或 UI 路径 | tool handler 回到 unified runtime 和 approval/sandbox | Scheduler/MessageBus/HookSystem 闭合 | AI SDK tool execute、Plugin.trigger、Permission.ask、Bus/SSE |
| 清理 | 依赖 settings/session lifecycle，反编译快照需谨慎 | session/thread 结束时释放 runtime 状态 | extension stop 会停 MCP、移除 policy/checker 并重新初始化 hooks | MCP stop/status、plugin scope、server instance 生命周期 |

这能避免把“扩展”写成平铺清单。真正有价值的分析是说明第三方能力如何进入模型可调用面，以及失败、撤销、权限变化时如何退出。

## 7. MCP 专项对齐

`24-mcp-system.md` 应固定回答：

| 问题 | 最低证据 |
| --- | --- |
| server 配置从哪里来 | 配置 schema 或 loader 路径 |
| transport 如何建立 | stdio/http/sse/websocket 连接代码 |
| auth 如何处理 | OAuth/token/allowlist/needs_auth 状态路径 |
| tool/resource/prompt 如何 discovery | list tools/resources/prompts 的 client 调用 |
| MCP tool 如何变成本地 tool | registry/schema wrapping 位置 |
| 调用结果如何回注 | tool result -> history/message/part/thread item |
| 失败如何暴露 | status event、UI toast、error part、retry/disable 路径 |

## 8. 当前修复优先级

| 优先级 | 动作 |
| --- | --- |
| P0 | Codex `24` 补 sandbox/approval 交叉点，说明 MCP tool 并不绕过统一工具治理 |
| P0 | Gemini `24` 补 MCP status、auth、extension reload 和 ToolRegistry 刷新链路 |
| P1 | OpenCode `24` 与 `33` 分工：`24` 讲闭环，`33` 只保留连接和 schema 深挖 |
| P1 | Claude `24` 回链 `24b` 的 OAuth/XAA，但所有反编译推断显式标级 |
