---
title: "调试指南：命令阶梯、诊断 flags、审计与本地抓包代理"
---
# 调试指南：命令阶梯、诊断 flags、审计与本地抓包代理

> 基于 `sources/openclaw/`（openclaw `v2026.10.2`，OpenClaw Foundation）源码校对。OpenClaw 是开源个人 AI 助理网关：Gateway 常驻本机作为控制面，把 agent 桥接到 20+ 消息通道，模型 provider 与插件均可替换。

**目录**

- [1. 调试面总览与命令阶梯](#1-调试面总览与命令阶梯)
- [2. 日志系统：滚动文件、脱敏与 CLI tail](#2-日志系统滚动文件脱敏与-cli-tail)
- [3. 诊断 flags 与 timeline](#3-诊断-flags-与-timeline)
- [4. Doctor：结构化体检与修复](#4-doctor结构化体检与修复)
- [5. status 探针与通道健康](#5-status-探针与通道健康)
- [6. 本地抓包代理与 operator proxy 校验](#6-本地抓包代理与-operator-proxy-校验)
- [7. 审计账本](#7-审计账本)
- [8. Docker 部署调试](#8-docker-部署调试)
- [9. 常见问题定位路径](#9-常见问题定位路径)

---

## 1. 调试面总览与命令阶梯

OpenClaw 是常驻 Gateway 而非一次性 CLI，调试面围绕"远程问询一个活着的进程"组织。上游排障 runbook（`docs/gateway/troubleshooting.md`）给出固定命令阶梯：

```bash
openclaw status            # 通道 + 会话诊断快照
openclaw gateway status    # Runtime: running / Connectivity probe / Capability
openclaw logs --follow     # tail 网关 JSONL 文件日志
openclaw doctor            # 体检 + 引导式修复
openclaw channels status --probe   # 每账号实时传输探测
```

会话与运行状态本体在每 agent 的 SQLite（`~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite`），不像 pi 那样是可直接打开的 JSONL（对照见 [docs/hello-pi/25-debugging.md](../hello-pi/25-debugging.md)），所以排障主要靠上面这组结构化查询命令而不是读文件。

## 2. 日志系统：滚动文件、脱敏与 CLI tail

Gateway 写两类日志面：按日滚动的 JSONL 文件 + 终端 console（`docs/logging.md`）。默认路径 `/tmp/openclaw/openclaw-YYYY-MM-DD.log`（命名 profile 变成 `openclaw-<profile>-YYYY-MM-DD.log`，profile 名经可逆 dash 转义防碰撞）；单文件写满 `logging.maxFileBytes`（默认 100 MB）轮转，保留 5 个编号归档；按日文件 24 小时清理；`/tmp/openclaw` 不可靠或 Windows 上退回用户级临时目录。实现层 `src/logging/`（`logger.ts`、`logger-file-transport.ts`、`log-file-path.ts`）。整条管道强制**脱敏**：`redact.ts` + `redacting-stream.ts` 配合 secret-redaction-registry，把 token / PEM / 凭据模式从落盘前抹掉，tailing 输出同样过一遍（`log-tail-redaction.test.ts` 钉住该行为）。CLI `openclaw logs`（`src/cli/logs-cli.ts`）经 Gateway RPC tail 文件：`--follow` 断线带 backoff 重连、`--limit` / `--max-bytes` / `--interval` / `--json` / `--utc`；Control UI 的 Logs 页 tail 的也是同一文件。

## 3. 诊断 flags 与 timeline

不想全局拉高 `logging.level` 时，用**子系统级诊断 flags**（`docs/diagnostics/flags.md`）：`diagnostics.flags` 配置 + `OPENCLAW_DIAGNOSTICS` 环境变量覆盖，`name.*` 前缀匹配、`*`/`all` 全开、`none` 全关（含配置）。知名 flag 如 `telegram.http`、`brave.http`、`health`、`ingress.timing`、`plugin.load-profile`，以及三档 profiler：慢 reply 阶段默认 5 s / 累计 10 s 才告警，`profiler` flag 把阈值降到 500 ms / 1 s。`timeline` flag 打开 `src/infra/diagnostics-timeline.ts` 的结构化 JSONL 时间线：以 `AsyncLocalStorage` 传递 span 上下文，记录 `span.start/end/error`、`provider.request`、`childProcess.exit`、`eventLoop.sample`（schema `openclaw.diagnostics.v1`，未决事件上限 64 KB）——这是排查"回复慢卡在哪一段"的一手材料。

## 4. Doctor：结构化体检与修复

`openclaw doctor`（`docs/cli/doctor.md`，实现 `src/commands/doctor.ts`）是带契约的体检 + 修复引擎，上游文档按读者任务拆成 7 页（running / recovery / lint / health-contract / state-migrations / sqlite-maintenance / checks）。要点：

- **posture**：`--fix` 走引导式修复（每步前重查请求者权限），`--lint` 只读出报告供 CI 门禁，post-upgrade 模式探测升级后插件兼容性；
- **有阻断性迁移**：发现 legacy JSONL 会话存储时 Gateway **拒绝就绪**，必须跑 doctor 的 session-SQLite 迁移；
- **聚合下游事实**：SecretRef 降级 owner、通道 dead-letter（点名受影响账号并指向 `openclaw channels dead-letters list`）、插件/技能/模型路由/浅克隆检查各成一块；
- **插件可扩展**：每个通道插件带自己的 `doctor-contract-api`（如 Telegram 的 update-offsets、ingress spool 状态迁移），核心按 health contract 收编（见 [21-bridge-system.md](./21-bridge-system.md) §2）。

## 5. status 探针与通道健康

`openclaw status`（`docs/cli/status.md`，实现 `src/commands/`）是只读诊断快照：`--all` 输出可粘贴全量（含安全审计、插件兼容、内存向量探测），`--deep` 触发通道实时探测，`--usage` 打印 provider 用量窗口。整个命令共享**单调递减的探测预算**：Gateway 尚在启动时报告 `still starting` 与 `startupPhase` 而非 unreachable（`--json` 里保留 `gateway.readiness`）。通道侧 `openclaw channels status --probe`（`src/cli/channels-cli.ts`）报每账号 live transport；没有探测能力的通道（如 WhatsApp）报告 lifecycle 健康度，lifecycle `OK` 不等于真探测过；插件加载失败时账号报 `lifecycle: "blocked"` 而不是残留的旧探测成功。

## 6. 本地抓包代理与 operator proxy 校验

`openclaw proxy`（`docs/cli/proxy.md`，实现 `src/proxy-capture/`）是内置的 **MITM 抓包代理**：`proxy start`/`proxy run -- <cmd>` 拉起本地捕获代理并让子命令走它，自签 CA（`ca.ts`）解密 TLS；请求/响应只保留 8 KB body 预览（`proxy-server.ts` 的 `CAPTURE_BODY_PREVIEW_BYTES`），头部经 `header-redaction.ts` 脱敏后落进本地 capture store；`proxy sessions` / `proxy query --preset` / `proxy blob` 检索，`proxy purge` 清库。`proxy validate` 则是另一件事：预检 operator 管理的 forward proxy（`proxy.proxyUrl` / `OPENCLAW_PROXY_URL`）——allowed/denied 目标各探一遍，denied 语义 fail-closed，必要时加验 APNs HTTP/2 CONNECT 隧道可达性（无效 provider token 收到 403 即算成功信号）。

## 7. 审计账本

`openclaw audit`（`docs/cli/audit.md`，实现 `src/audit/`）回答"谁在何时跑了什么、结果如何"：metadata-only 的活动账本，run/tool 记录默认开启，**execution identity 默认关闭**（需显式 `logging.audit.executionIdentity`），消息记录默认关闭、`direct`/`all` 分级；记录 30 天过期，导出有界且脱敏。这层与通道审批（pairing、exec approvals）互为证据链：审批决定谁可以触发，audit 记录实际发生了什么（见 [21-bridge-system.md](./21-bridge-system.md) §5）。

## 8. Docker 部署调试

`Dockerfile:461-462` 定义 `HEALTHCHECK`（3 m 间隔 / 10 s 超时 / 15 s start-period / 3 次重试）执行 `node dist/docker-healthcheck.js`；`docker-compose.yml:84` 复用同一脚本。实现 `src/docker-healthcheck.ts` 先读 Gateway 活锁里记录的端口（CLI `--port` 为权威），锁读不到才退回 config/env 推导，然后 GET `http://127.0.0.1:<port>/healthz`；`/healthz` / `/readyz` / `/startupz` 三个探针端点由 `src/gateway/local-http-probe.ts` 提供。compose 文件还把容器内 `OPENCLAW_STATE_DIR` 等路径钉死，防止宿主 `.env` 的 macOS 路径漏进 Linux 容器（上游注释记录了 #77436 的 `mkdir '/Users'` EACCES 教训）。

## 9. 常见问题定位路径

| 症状 | 首选路径 |
| --- | --- |
| Gateway 起不来 / 不就绪 | `openclaw gateway status`；legacy 会话存储会阻断就绪，按提示跑 `openclaw doctor --fix` |
| 通道不回消息 | `openclaw channels status --probe` 看 live transport；无探测通道看 lifecycle；`openclaw channels dead-letters list` 查死信 |
| 回复慢 | `OPENCLAW_DIAGNOSTICS=profiler` 或 `timeline` 拿 reply 阶段 span |
| 请求/网络异常 | `openclaw proxy run -- openclaw ...` 本地抓包；`proxy validate` 预检 forward proxy |
| 怀疑凭据泄漏进日志 | `openclaw logs --json` 查脱敏后事件；secret-redaction-registry 注册的模式即覆盖面 |
| 谁动了系统 | `openclaw audit` 查 run/tool 活动与 execution identity |
| 容器反复重启 | `docker inspect` 看 healthcheck 输出；确认 `healthz` 端口来自活锁而非猜测 |
| 插件行为怪异 | `openclaw plugins inspect <id>`（unsupported LSP/传输等能力也在此可见）；`plugin.load-profile` flag 看同步加载耗时 |

## 源码锚点

- [`sources/openclaw/docs/logging.md`](../../sources/openclaw/docs/logging.md)：日志路径/轮转/CLI tail 上游文档
- [`sources/openclaw/src/logging/logger.ts`](../../sources/openclaw/src/logging/logger.ts)：文件/console 双通道 logger
- [`sources/openclaw/src/logging/redact.ts`](../../sources/openclaw/src/logging/redact.ts)：脱敏模式库（配合 `redacting-stream.ts`）
- [`sources/openclaw/src/cli/logs-cli.ts`](../../sources/openclaw/src/cli/logs-cli.ts)：`openclaw logs` RPC tail 实现
- [`sources/openclaw/docs/diagnostics/flags.md`](../../sources/openclaw/docs/diagnostics/flags.md)：诊断 flags 与 profiler 阈值
- [`sources/openclaw/src/infra/diagnostics-timeline.ts`](../../sources/openclaw/src/infra/diagnostics-timeline.ts)：JSONL timeline span 事件
- [`sources/openclaw/src/commands/doctor.ts`](../../sources/openclaw/src/commands/doctor.ts)：doctor 命令编排
- [`sources/openclaw/src/proxy-capture/proxy-server.ts`](../../sources/openclaw/src/proxy-capture/proxy-server.ts)：本地抓包代理（8 KB body 预览 + 头部脱敏）
- [`sources/openclaw/src/docker-healthcheck.ts`](../../sources/openclaw/src/docker-healthcheck.ts)：Docker HEALTHCHECK 探针（活锁端口优先）
- [`sources/openclaw/src/gateway/local-http-probe.ts`](../../sources/openclaw/src/gateway/local-http-probe.ts)：`/healthz` `/readyz` `/startupz` 端点
- [`sources/openclaw/src/audit/audit-event-writer.ts`](../../sources/openclaw/src/audit/audit-event-writer.ts)：审计事件写入
- [`sources/openclaw/docs/gateway/troubleshooting.md`](../../sources/openclaw/docs/gateway/troubleshooting.md)：命令阶梯与症状索引 runbook
