---
title: "Hooks 与生命周期：typed hooks、internal hooks 与 Gateway 常驻"
---
# Hooks 与生命周期：typed hooks、internal hooks 与 Gateway 常驻

> 基于 sources/openclaw/（openclaw v2026.10.2，OpenClaw Foundation）源码校对。OpenClaw 把"hooks"拆成三个互不重叠的系统：插件 typed hooks（`api.on(...)`）、operator 安装的 internal hooks（`HOOK.md`），以及 Gateway 生命周期与 daemon 服务面。

**目录**

- [1. 三个 hook 系统的分工](#1-三个-hook-系统的分工)
- [2. Typed plugin hooks：类型与执行契约](#2-typed-plugin-hooks类型与执行契约)
- [3. 权限门与预算](#3-权限门与预算)
- [4. Internal hooks：HOOK.md 与冒号事件](#4-internal-hookshookmd-与冒号事件)
- [5. Gateway/daemon 生命周期](#5-gatewaydaemon-生命周期)
- [6. 与 Claude Code / pi 的对照](#6-与-claude-code--pi-的对照)

---

## 1. 三个 hook 系统的分工

`docs/plugins/hooks.md` 开篇就给了一张选择表：要改 prompt/拦工具/控回复，用 typed plugin hooks（`api.on("before_tool_call", ...)`）；要给 `/new`、`/reset` 或 bootstrap 事件跑 operator 安装的脚本，用 internal hooks（`HOOK.md` + 冒号事件名如 `command:new`）；要让外部服务经 HTTP 触发 agent，用 webhooks。三者刻意不可互换：internal 事件名 `message:received` **不是** typed 名 `message_received`；在 `api.registerHook(...)`（internal 注册面）里注册下划线名只会得到一条 warning，typed runner 永远不会调它。插件也可以经 `api.registerHook(...)` 注册 internal hook（`src/hooks/plugin-hooks.ts`），复用同一条 internal 分发管线。注意 `git-hooks/pre-commit` 只是仓库开发工具链（`guard-staged-content.mjs`），与运行时 hooks 无关。

## 2. Typed plugin hooks：类型与执行契约

typed hooks 按执行契约分六种 kind（`docs/plugins/hooks/reference.md`）：**Modify**（顺序执行、按各自 merge 规则合并）、**Claim**（首个 `{ handled: true }` 胜出并跳过其余）、**Gate**（block 即停）、**Observe**（并发执行、忽略返回值）、**Sync modify/gate**（`tool_result_persist` / `before_message_write`，同步、Promise 被忽略）、**Evaluate**（Skill Workshop 评估器并发产出归因结果）。目录覆盖 agent 回合链（`before_model_resolve` → `agent_turn_prepare` → `before_prompt_build` → `before_agent_run` → `before_agent_reply` → `before_agent_finalize` → `agent_end`）、工具面（`before_tool_call` 可改参/拦截/要求审批，`resolve_exec_env` 注入 exec 环境）、消息面（`inbound_claim` 只发给**拥有该 conversation binding 的插件**、`message_sending`/`reply_payload_sending` 可改写或取消外发）、会话面（`session_start/end`、`before/after_compaction`、`before_reset`）、subagent 事件，以及 lifecycle（`gateway_start`/`gateway_stop`、`cron_reconciled`、`before_install`、`skill_changed` 等）。`api.on(name, handler, opts)` 支持 `matcher`（canonical 工具 id 列表）、`priority`、`timeoutMs`、`eligibleTriggers`（cron/heartbeat/user）、`requiresToolAuthority`。

## 3. 权限门与预算

与 pi 的"扩展事件即 hooks"不同（见 `docs/hello-pi/19-hooks-lifecycle.md`），OpenClaw 给 hooks 加了**注册前权限门**：非内建插件要订阅能读会话的 hook（`llm_input`、`before_agent_reply`、`agent_end` 等），必须在配置里显式 `plugins.entries.<id>.hooks.allowConversationAccess: true`；prompt 注入类 hook 另有 `allowPromptInjection`。incognito session 不派发 `llm_input`/`llm_output`，其 `agent_end` 只拿运行身份与时长。超时预算分三档写入 runner 默认值：门类 hook（`before_agent_run`/`before_tool_call`/`before_install`）15 秒且**fail closed**——超时即拦截运行/工具调用/安装；观察类 30 秒（`skill_proposal_evaluate` 120 秒），`channel_pairing_requested` 2 秒，`gateway_stop` 5 秒。operator 可经 `plugins.entries.<id>.hooks.timeoutMs` / `timeouts.<hook>` 覆盖（上限 600 000 ms）。超时只结束宿主的 await，不取消插件工作——文档反复强调这是 registration gate 而非沙箱：装插件靠信任与 capability consent（见 [14-plugin-system.md](./14-plugin-system.md) §4）。

## 4. Internal hooks：HOOK.md 与冒号事件

internal hook 是**受信代码**（`docs/automation/hooks.md` 的 Warning：与 Gateway 进程同文件系统/网络/环境权限），形态是一个目录：`HOOK.md`（frontmatter 声明 `name`、`description`、`events: string[]`、可选 `install` 规格，见 `src/hooks/types.ts` 的 `OpenClawHookMetadata`）加一个 handler 模块。hook 的 eligibility 检查（OS、二进制、环境变量、配置要求）与 enablement（`hooks.internal.entries` 策略）是两道独立的门：前者在执行检查的宿主上评估，后者是 per-hook/per-source 的配置策略。事件词汇是冒号命名（`src/hooks/internal-hook-types.ts`）：`agent:bootstrap`、`command:new|reset|stop`、`gateway:startup|pre-restart|shutdown`、`message:preprocessed|received|sent|transcribed`、`session:auto-reset|patch|compact:before|after`。hook 有四种来源：`openclaw-bundled` / `openclaw-managed` / `openclaw-workspace` / `openclaw-plugin`；`src/hooks/loader.ts` 发现并加载，`src/hooks/install.ts` / `installs.ts` 处理 npm/git/bundled 三类安装与记录事务。事件负载是富类型 context（`src/hooks/internal-hooks.ts`：`MessageReceivedHookContext` 带 media staging 事实、`AgentBootstrapHookContext` 带 workspace bootstrap 文件清单）。热路径上的 hook 走 `src/hooks/fire-and-forget.ts` 的**有界队列**：默认 16 并发、256 排队、2 秒超时。内建示例：`src/hooks/bundled/command-logger`（把 `/new` `/reset` `/stop` 写成 JSONL 审计日志）、`session-memory`（`/new` `/reset` 与 `session:auto-reset` 时把会话上下文存入记忆）、`boot-md`（`gateway:startup` 时执行工作区 `BOOT.md`），以及 Gmail watcher（`src/hooks/gmail-watcher.ts`，Gateway 启动时按配置拉起 `gog gmail watch serve` 子进程，把外部收件箱事件流接入 agent）。

## 5. Gateway/daemon 生命周期

Gateway 是常驻控制面，其生命周期把上面两套 hooks 串了起来。**插件服务**随 `gateway_start`/`gateway_stop` 启停；shutdown 给所有活跃 session 的 `session_end` 一个**全局共 2 秒**的 drain 预算（超时仅告警并继续关闭），插件替换给在途工作 60 秒预算（见 [06-extension-mcp.md](./06-extension-mcp.md) §3）。配置热重载默认 `hybrid` 模式：hook/plugin 配置变更不重启进程即生效；`gateway:pre-restart` / `gateway:startup` internal hooks 分别挂在重启两侧。插件生命周期用 **process-bound lease** 协调多进程：被强停后，下一个进程可凭 same-host 进程身份认领已死持有者的租约；ClawHub 包安装租约因安装子进程可能比父进程活得久而保留过期保护。Gateway 向插件的广播事件带作用域（`src/plugins/gateway-events.ts` 的 `operator.read | operator.write | operator.admin`），`onSessionsChanged` 仅供避免轮询、不放宽会话访问。**daemon 面**由 `src/daemon/` 承担：macOS launchd、Linux systemd、Windows schtasks 三套服务管理器（安装/回滚/审计/重启风暴防护/restart handoff），让 Gateway 以系统服务方式常驻——这是"个人助理网关"与一次性 CLI 进程最本质的生命周期差异。

## 6. 与 Claude Code / pi 的对照

| 维度 | Claude Code | pi | OpenClaw |
| --- | --- | --- | --- |
| 形态 | settings.json 声明式配置（`PreToolUse` 等）+ 外部 shell 命令 | 进程内扩展事件 `pi.on(...)`，typed result | typed plugin hooks（`api.on`）+ operator 安装的 internal hooks（`HOOK.md`），双轨 |
| 审批 | exit code / JSON `permissionDecision` | `ToolCallEventResult` 直接对象返回 | `before_tool_call` 返回 typed resolution（`allow-once`/`allow-always`/`deny` union），另有 `hooks.allowConversationAccess` 注册前门 |
| 载体信任 | 每次触发起子进程，天然隔离 | 扩展与宿主同进程 | **全部受信代码**：插件与 hook 都在 Gateway 进程内，明言"不是沙箱"，靠 consent/allowlist 管信任 |
| 生命周期 | CLI 会话随启随停 | 会话级 runner | 常驻 Gateway + daemon：`gateway_start/stop`、60 秒替换预算、2 秒 session_end drain、跨进程 lifecycle lease |

最值得注意的取舍：Claude Code 用子进程边界换取安全表达力（只有二值/JSON 审批），OpenClaw 反向选择——把一切放进进程内拿到 typed、可改写、有预算的完整 hook 面，然后把信任问题前移到**安装与注册**（capability consent、conversation access 门、allow/deny），并用 doctor/诊断面兜底。

## 源码锚点

- [`sources/openclaw/src/hooks/internal-hook-types.ts`](../../sources/openclaw/src/hooks/internal-hook-types.ts)：冒号事件词汇表
- [`sources/openclaw/src/hooks/internal-hooks.ts`](../../sources/openclaw/src/hooks/internal-hooks.ts)：事件 context 类型与分发
- [`sources/openclaw/src/hooks/types.ts`](../../sources/openclaw/src/hooks/types.ts)：HOOK.md 元数据与来源类型
- [`sources/openclaw/src/hooks/loader.ts`](../../sources/openclaw/src/hooks/loader.ts)：hook 发现与加载
- [`sources/openclaw/src/hooks/fire-and-forget.ts`](../../sources/openclaw/src/hooks/fire-and-forget.ts)：有界 fire-and-forget 队列
- [`sources/openclaw/src/hooks/bundled/command-logger/HOOK.md`](../../sources/openclaw/src/hooks/bundled/command-logger/HOOK.md)：内建审计 hook 实例
- [`sources/openclaw/src/plugins/gateway-events.ts`](../../sources/openclaw/src/plugins/gateway-events.ts)：插件 Gateway 事件广播（作用域门）
- [`sources/openclaw/docs/plugins/hooks.md`](../../sources/openclaw/docs/plugins/hooks.md)：typed hooks 指南
- [`sources/openclaw/docs/plugins/hooks/reference.md`](../../sources/openclaw/docs/plugins/hooks/reference.md)：hook 目录与预算表
- [`sources/openclaw/docs/automation/hooks.md`](../../sources/openclaw/docs/automation/hooks.md)：internal hooks 文档
- [`sources/openclaw/src/daemon/gateway-entrypoint.ts`](../../sources/openclaw/src/daemon/gateway-entrypoint.ts)：daemon 服务入口
- [`sources/openclaw/src/daemon/systemd-install.ts`](../../sources/openclaw/src/daemon/systemd-install.ts)：systemd 服务安装
