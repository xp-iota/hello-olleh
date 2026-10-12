---
title: "可观测性：双日志面、脱敏引擎与元数据审计账本"
---
# 可观测性：双日志面、脱敏引擎与元数据审计账本

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。OpenClaw 是开源个人 AI 助理网关：Gateway 常驻本机作为控制面，默认不回传任何遥测。

**目录**

- [1. 日志布局：文件日志与控制台双面](#1-日志布局文件日志与控制台双面)
- [2. 脱敏引擎](#2-脱敏引擎)
- [3. 元数据审计账本](#3-元数据审计账本)
- [4. 会话轨迹、转录与抓包代理](#4-会话轨迹转录与抓包代理)
- [5. 诊断开关与遥测出口](#5-诊断开关与遥测出口)

---

## 1. 日志布局：文件日志与控制台双面

日志面在 `src/logging/`（`src/logging.ts` 是 10 行的门面 re-export，真正的旧 API 在 `src/logger.ts`）：

- **文件日志**：Gateway 按天写 JSON lines 到 `/tmp/openclaw/openclaw-YYYY-MM-DD.log`（named profile 用转义过的 profile 段；`/tmp/openclaw` 不可用或 Windows 时退到 OS temp 下用户作用域目录）；单文件超 `logging.maxFileBytes`（默认 100 MB）轮转，最多保留 5 个编号归档，过 24 小时清理（`docs/logging.md`）；
- **控制台**：`SubsystemLogger`（`src/logging/subsystem.ts`）是子系统命名 logger，trace→fatal 分级、console/file 双目标独立判级；`src/logger.ts` 的 `logInfo/logWarn/logError` 兼容旧调用面，消息前缀 `subsystem:` 自动改道到子系统 logger。Control UI 的 Logs 页直接 tail 文件日志。

## 2. 脱敏引擎

可观测性先过脱敏，再落盘。`src/logging/redact.ts` 是核心：模式库（AWS key、Bearer/Basic 头、PEM 块、form-aware 凭证、结构化 auth 参数等）+ `secret-redaction-registry.ts`（运行时注册的秘密值，如 channel 凭证）组合成 edit 流水线，再按 config 的 redact patterns 扩展。同一个策略被三处复用：

| 消费者 | 文件 | 脱敏点 |
| --- | --- | --- |
| 抓包代理 | `src/proxy-capture/header-redaction.ts` | `cookie`/`set-cookie`/含 `session` 的头名整值替换 `[REDACTED]`；普通头名仍做注册秘密值替换 |
| 会话轨迹 | `src/trajectory/runtime.ts` | `sanitizeDiagnosticPayload` + `redactSecrets`，并记录 redaction registry revision 供对账 |
| 转录 | `src/transcripts/capture.ts` | channel/accountId 定长截断后再入 store |

## 3. 元数据审计账本

`src/audit/` 是 Gateway 的持久审计层，定位是 **metadata-only**：只存身份、顺序、来源、动作、状态与规范化 outcome code，"never stores prompts, message bodies, tool arguments, tool results, attachments..."（`docs/gateway/audit.md`）。关键实现：

- `audit-event-writer.ts` 是**非阻塞进程内队列**：`record()` 只报告入队是否成功，持久化在后台异步完成；队列上限 4 096 条，SQLite 写走独立 worker（busy timeout + 锁重试上限 + 竞争报告），shutdown 有专门超时；
- `audit-event-types.ts` 定义 schema v1 的事件类型（`agent_run` / `tool_action` / `message`）与枚举化 reason code（入站消息完成的 `fast_abort`、`before_dispatch_handled`…，出站被抑制的 `cancelled_by_message_sending_hook`、`no_visible_payload`…）——失败语义是数据，不是自由文本；
- 审批链路单独记账：operator 终态审批被适配成 decision receipts（`execution-decision-receipts.ts`），审计账本不制造审批证据，也不把 approval 复制进 ledger。相关传输见 [15-sdk-transport.md](./15-sdk-transport.md)。

## 4. 会话轨迹、转录与抓包代理

- **trajectory**（`src/trajectory/runtime.ts`）：把有界的会话事件写进 SQLite 轨迹存储，事件负载限 32 768 字符、数组 64 项、对象 64 键、深度 6；超限事件先丢 `messagesSnapshot`/`systemPrompt` 等冗余键，再进 compact 兜底——"保留 schema-v1 外壳、丢内容"；
- **transcripts**（`src/transcripts/`）：会话转录库，capture 启动、summary 更新、SQLite store（读写走 worker）与 JSONL 导出俱全，是 Control UI 会话页的数据源；
- **proxy-capture**（`src/proxy-capture/`）：诊断用 HTTP(S) 抓包代理，自带 CA（`ca.ts`）做 MITM，body 预览只取 8 192 字节；托管代理模式激活时禁止直连上游（`OPENCLAW_PROXY_ACTIVE`，显式 override 才放行）。

## 5. 诊断开关与遥测出口

- **诊断旗标**（`docs/diagnostics/flags.md`）：`diagnostics.flags` 配置 + `OPENCLAW_DIAGNOSTICS` 环境变量，按子系统开日志（`telegram.*` 前缀匹配、`*` 全开），不抬全局日志级别；Gateway 内部诊断（CPU/heap profile、run activity、stuck session recovery 等）在 `src/logging/diagnostic-*.ts`，可打成 support bundle；
- **导出**：OpenTelemetry 与 Prometheus 都是官方插件（`diagnostics-otel` 走 OTLP/HTTP protobuf，`diagnostics-prometheus` 暴露 `/api/diagnostics/prometheus`），插件与诊断面同时启用才 attach，默认近零开销（`docs/gateway/opentelemetry.md`）；
- **遥测政策**是这套系统的立场声明：默认**只有每日版本检查**（`GET telemetry.openclaw.ai/api/latest-version`，User-Agent 只带版本/OS/Node/架构/请求面，无任何机器或安装标识），匿名特性统计 opt-in 且搭同一次请求的便车；`openclaw telemetry show` 可打印实际 payload，`OPENCLAW_TELEMETRY_ENDPOINT` 可自托管接收端，`update.checkOnStart: false` 一键全关（`docs/gateway/telemetry.md`）。本地可观测是强默认，离机遥测是弱默认——与安全边界的取舍一致（[07-error-security.md](./07-error-security.md)）。

## 源码锚点

- [`sources/openclaw/src/logging/subsystem.ts`](../../sources/openclaw/src/logging/subsystem.ts)：子系统 logger 与双面判级
- [`sources/openclaw/src/logging/redact.ts`](../../sources/openclaw/src/logging/redact.ts)：脱敏模式引擎
- [`sources/openclaw/src/audit/audit-event-writer.ts`](../../sources/openclaw/src/audit/audit-event-writer.ts)：非阻塞审计队列
- [`sources/openclaw/src/audit/audit-event-types.ts`](../../sources/openclaw/src/audit/audit-event-types.ts)：审计事件契约与 reason code
- [`sources/openclaw/src/trajectory/runtime.ts`](../../sources/openclaw/src/trajectory/runtime.ts)：有界会话轨迹
- [`sources/openclaw/src/proxy-capture/header-redaction.ts`](../../sources/openclaw/src/proxy-capture/header-redaction.ts)：抓包头脱敏
- [`sources/openclaw/docs/gateway/telemetry.md`](../../sources/openclaw/docs/gateway/telemetry.md)：遥测政策全文
