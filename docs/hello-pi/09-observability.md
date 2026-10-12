---
title: "可观测性：telemetry 契约、crash-log 与 usage 统计"
---
# 可观测性：telemetry 契约、crash-log 与 usage 统计

> 基于 `sources/pi/` 快照（pi v1.1.0），对照 `packages/telemetry/` 与 coding-agent 的 crash/bug/usage 模块校对。

**目录**

- [1. pi-telemetry：厂商中立契约](#1-pi-telemetry厂商中立契约)
- [2. crash-log 与 /bug](#2-crash-log-与-bug)
- [3. usage-totals](#3-usage-totals)
- [4. debug 日志与环境变量开关](#4-debug-日志与环境变量开关)

---

## 1. pi-telemetry：厂商中立契约

`@earendil-works/pi-telemetry` 只有 357 行，卖的是**契约**而非后端：

- 核心面 `TelemetryContext.startSpan(options, callback)` / `TelemetrySpan`（`addEvent` / `setAttributes` / `setStatus`）；上下文**显式传参**，没有环境隐式的 "current span"——例如 pi-ai 把 `telemetryContext` 挂在 `ProviderRequestOptions` 上沿请求链下传。这避免了 async-local-storage 式的隐式全局，代价是调用链上人人显式；
- 实现谱系：`NOOP_TELEMETRY_CONTEXT`（默认，零开销）、`InMemoryTelemetryContext`（测试/内省）、以及 `src/testing/conformance.ts` 的**适配器一致性套件**——套件覆盖同步/异步回调成功、回调抛错（包括 reject `undefined`、不可序列化的 Error 等边角），任何第三方后端（OpenTelemetry、Sentry、日志）跑过该套件即可宣称兼容；
- `defineTelemetrySchema()`（`index.ts:72`）定义类型化的 span schema：每个属性带 description、`sensitive` 标记与基数（cardinality）声明，TypeScript 推断出必填/可选的 start/event 属性集合。敏感属性必须在 schema 层声明，而不是事后靠后端脱敏；
- 编码路径示例：`index.ts:327` 附近的 typed `startSpan` 包装器把 schema 直接收紧成类型安全的调用面，pi 各包的领域 schema（provider 请求、agent 回合等）独立定义，后端可插拔。

## 2. crash-log 与 /bug

- `src/core/crash-log.ts`：进程崩溃时 `recordCrash()` 以 best-effort 把 `CrashRecord`（kind、错误、session 文件、cwd）追加到 `~/.pi/agent/crashes.json`；`findExtensionStackMatches()` 能把堆栈归因到具体扩展——扩展作者的栈不会静默丢失（见 [07-error-security.md](./07-error-security.md)）；
- `src/core/bug-report.ts` + `bug-report-upload.ts`：`/bug` 命令收集环境诊断（`collectBugReportMetadata` / `collectBugReportDiagnostics`）、生成摘要，打包成归档文件或直接上传；隐私处理在源头完成——`redactUrl()` / `redactJsonValue()` 先脱敏再入包，且只挑选 `PI_` 前缀的环境变量进入报告。上传网关可用 `PI_RADIUS_GATEWAY` 覆盖；
- 崩溃兜底与报告是两个层次：前者保证"崩了之后现场还在"，后者把现场变成可递交的工单，`packages/coding-agent/src/core/` 下两者相邻实现，由交互模式的 `/bug` 命令串起（见 `src/modes/interactive/bug-report.ts`）。

## 3. usage-totals

`src/core/usage-totals.ts` 是会话级 token/成本台账：`UsageTotals` 累加 input/output/cacheRead/cacheWrite 与 `usage.cost.total`（`addUsageToTotals`），`combineUsage()` 在求和时保留可选的 token 拆分（如 `cacheWrite1h`）。数据源是 pi-ai 在每条 `AssistantMessage.usage` 里内嵌的用量与成本（`calculateCost` 按 per-million 费率与请求级定价档计算，见内核章节），所以会话统计不需要事后重放 JSONL——每条消息自带账单，`get_session_stats` 等 RPC 命令直接读累加结果。experimental 的 durable 包把同一件事做成可复制的 `UsageDoc`（`pi.usage`，`packages/durable/src/harness/usage.ts`），经 `recordUsage` 进事务化存储，供崩溃恢复后对账。

## 4. debug 日志与环境变量开关

pi 没有常开的日志流；观测开关全部是**环境变量**，默认关闭。这与 pi 的"最小核心"哲学一致：默认路径上没有后台采集进程，出问题时再显式打开对应开关：

| 句柄 | 位置 | 作用 |
| --- | --- | --- |
| debug log | `~/.pi/agent/pi-debug.log`（`getDebugLogPath()`，`src/config.ts:654`） | 按 debug 键一次性导出调试快照（`interactive-mode.ts` 写入），路径打印给用户 |
| `PI_TIMING=1` | `src/core/timings.ts` | 启用内部计时打点 |
| `PI_TELEMETRY` | `src/core/telemetry.ts` | 覆盖安装/更新遥测与 provider attribution 头（`1`/`true`/`yes` 或 `0`/`false`/`no`） |
| `PI_OFFLINE` | `docs/environment-variables.md` | 关闭一切自动网络活动（含模型目录刷新） |
| `PI_SKIP_VERSION_CHECK` | 同上 | 跳过 pi.dev 最新版本探测 |
| `PI_SESSION_ID` / `PI_MODEL` 等 | 同上 | 传给 LLM 调起的子 shell，让被调用方可自省所处会话与模型 |

子 shell 侧的 `PI_*` 变量在每条命令启动时解析：切换模型或推理档位会体现在**下一条** shell 命令的环境里，无需重启——这使"模型驱动的脚本感知自身上下文"成为可观测性的一部分，而不只是宿主的开关。

对照 nanobot 的结构化日志/OpenTelemetry 直连：pi 的立场是"观测是宿主环境的事，CLI 只提供契约、崩溃兜底与显式开关"。因此取舍也很清楚——pi 自身不采集任何默认遥测（`PI_TELEMETRY` 管的是安装/更新归因与 attribution 头，且可一键关闭），诊断数据只在用户按下 `/bug` 或 debug 键时才离机，且离机前先经 `redactUrl` / `redactJsonValue` 脱敏、只带 `PI_` 前缀的环境变量。可观测性在这里是**按需取用**的契约，而不是常驻开销。

## 源码锚点

- [`sources/pi/packages/telemetry/src/index.ts`](../../sources/pi/packages/telemetry/src/index.ts)：TelemetryContext 契约与 `defineTelemetrySchema`
- [`sources/pi/packages/telemetry/src/testing/conformance.ts`](../../sources/pi/packages/telemetry/src/testing/conformance.ts)：适配器一致性套件
- [`sources/pi/packages/coding-agent/src/core/crash-log.ts`](../../sources/pi/packages/coding-agent/src/core/crash-log.ts)：崩溃记录与扩展栈归因
- [`sources/pi/packages/coding-agent/src/core/bug-report.ts`](../../sources/pi/packages/coding-agent/src/core/bug-report.ts)：/bug 打包与脱敏
- [`sources/pi/packages/coding-agent/src/core/usage-totals.ts`](../../sources/pi/packages/coding-agent/src/core/usage-totals.ts)：会话用量台账
- [`sources/pi/packages/coding-agent/docs/environment-variables.md`](../../sources/pi/packages/coding-agent/docs/environment-variables.md)：`PI_*` 开关全表
