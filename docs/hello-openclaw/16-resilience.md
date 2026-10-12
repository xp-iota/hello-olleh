---
title: "韧性机制：failover、熔断、恢复与关机预算"
---
# 韧性机制：failover、熔断、恢复与关机预算

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。openclaw 的韧性是四层叠加：请求级 failover、循环级熔断与恢复、进程级 crash-loop 熔断，以及一条与 launcher 共享同一套算术的关机预算。

**目录**

- [1. 请求级重试与模型 failover](#1-请求级重试与模型-failover)
- [2. 溢出与压缩恢复](#2-溢出与压缩恢复)
- [3. 循环级防御：tool-loop 熔断与 turn taint](#3-循环级防御tool-loop-熔断与-turn-taint)
- [4. 进程级：crash-loop breaker 与 restart-storm](#4-进程级crash-loop-breaker-与-restart-storm)
- [5. 关机预算：supervisor、drain 与信号升级](#5-关机预算supervisordrain-与信号升级)
- [6. 通道级健康](#6-通道级健康)

---

## 1. 请求级重试与模型 failover

通用原语在 `packages/retry`：`computeBackoff`（`packages/retry/src/index.ts:109`）与可注入 runtime 的 `createRetryRunner`（`:368`，导出 `retryAsync`）。provider 侧判定在 `src/llm/utils/retry.ts:45` 的 `isRetryableAssistantError`（另有 `isTerminalAssistantError` 区分不可挽救），嵌入式层在 `src/agents/embedded-agent-runner/run/attempt-recovery.ts:326` 用它决定 attempt 的下一动作。可重试错误不是简单重发：`src/agents/failover/` 把错误归类（`classification-rules.ts` + billing / rate-limit / overflow 等成套 case 文件），结合 run 启动时解析好的 fallbacks 链（`src/agents/command/run-embedded-attempt.ts` 导入的 `resolveEffectiveModelFallbacks`）把整个 run 切到下一个模型/provider 候选，最多受 `MAX_LIVE_SWITCH_RETRIES = 5`（`run-embedded-attempt.ts:67`）约束。

## 2. 溢出与压缩恢复

`src/agents/embedded-agent-runner/run/overflow-context-recovery.ts` 是溢出恢复入口：判定复用 `@openclaw/ai` 的 `isContextOverflow`，恢复动作包括截断会话中超大 tool result（`truncateOversizedToolResultsInSessionManager`）、按 `MAX_OVERFLOW_COMPACTION_ATTEMPTS` 限制压缩重试次数，压缩本身交给 context engine（见 [03-agent-loop.md](./03-agent-loop.md) §4）并套 180 秒 safety timeout（`src/agents/embedded-agent-runner/compaction-safety-timeout.ts:19`）。一个被中断的回合不能悬空：`run/incomplete-turn-recovery.ts` 用 `resolveSettledToolBatchEvidence` 结算证据，决定哪些工具结果可以安全补交、哪些必须作废。

## 3. 循环级防御：tool-loop 熔断与 turn taint

`packages/agent-core/src/agent-loop.ts` 自带两级防御。**tool-loop 熔断**：某工具批返回 `intervention` 时置 `toolLoopRecoveryState.criticalToolLoopSeen`（`:284-286`），之后再见到关键循环则 `terminateRun`——以一条 "OpenClaw stopped this run because tool-loop recovery encountered another critical loop" 的 terminal 消息收束（`:63` 的常量与 `:362-380` 的收束路径），被挡的工具动作从未执行。**turn taint**：工具结果污染过的回合被标记（`turn-taint.ts`），该回合产出的 assistant 消息带 taint，后续会话处理不得在污染上下文上续跑；用户消息注入时清零。中止路径同样防御性：`stopIfAborted` 在每个迭代点触发时都会**补写一条 aborted assistant 消息**（`:159-187`），防止压缩或续跑把悬空的 toolUse 当合法上文。

## 4. 进程级：crash-loop breaker 与 restart-storm

常驻进程最大的风险是"坏配置 + supervisor 无脑重启"死循环。三道闸：

| 机制 | 触发 | 行为 |
| --- | --- | --- |
| crash-loop breaker（`src/infra/gateway-boot-lifecycle.ts`） | 上次关机是 unclean（24h 保留窗口，`:37`） | 拒绝自动起，要求 `openclaw doctor --fix`；恢复必须等到 cleared breaker window 并提交 recovery 记录（`src/cli/gateway-cli/crash-loop-recovery.ts:28`） |
| 启动失败保活 | `runGatewayLoop` 启动抛错 | 自动 triage 一次后**保活等手动修复**而非退出——退出会喂给 supervisor 又一次崩溃重启（`src/cli/gateway-cli/run-loop-startup.ts:27`） |
| restart-storm（`src/daemon/restart-storm.ts`） | 10 分钟窗口内外部 CLI 重启 ≥3 次（`:7-8`，`:85`） | 写警告日志并提示排查 stray launchd job |

进程内重启（SIGUSR2）由 `prepareGatewayRestartIteration`（`run-loop-startup.ts:154`）收拾残局：轮换 agent event 生命周期代、abort 旧 cron、重置 command-queue lanes——上一代中断任务的 `active` 计数若不重置，会永久堵死新代的排空。

## 5. 关机预算：supervisor、drain 与信号升级

`gateway-shutdown-budget.mjs` 是单一事实来源：drain 315s + reserve 10s = 325s shutdown 预算，再加 5s supervisor exit margin = 330s service stop（`:3-9`）；原地更新换代窗口 60s（`:2`）。运行时不盲用常量：`src/cli/gateway-cli/run-loop-shutdown-budget.ts` 的 `readNativeStopTimeout` 实际读 launchd `ExitTimeOut` / systemd 停止时限，短预算按比例份额切分 drain 与 margin，读不到时才落回策略常量。launcher 侧同一套算术：`node-runtime-recovery.mjs:47` 的 `runRespawnedChild` 在把信号转发给子进程后，按 `resolveLauncherStopTimeoutMs`（`gateway-shutdown-budget.mjs:71`）依次升级 SIGTERM → (1s) SIGKILL → (1s) 父进程 hard exit——**serving Gateway 自己从同一表达式推导父进程何时收尸**，两边永远一致。run loop 内还有一只 2 秒 hard-exit watchdog 兜底（`src/cli/gateway-cli/run-loop.ts:57`），保证清理卡死时进程仍能退出。

## 6. 通道级健康

通道连接是长期资源：`src/gateway/channel-health-monitor.ts` 按 `channel-health-policy` 周期探测，`channel-thaw-restart.ts` 在宿主从休眠/冻结恢复时重建连接；重启前还有 active-sessions shutdown tracker（`src/gateway/active-sessions-shutdown-tracker.ts`）保证 drain 期间在飞的 agent 回合被记账而非丢失（排空逻辑见 [10-session-resume.md](./10-session-resume.md)）。

## 源码锚点

- [`sources/openclaw/gateway-shutdown-budget.mjs`](../../sources/openclaw/gateway-shutdown-budget.mjs)：关机/替换预算常量与 launcher deadline 推导
- [`sources/openclaw/src/infra/gateway-boot-lifecycle.ts`](../../sources/openclaw/src/infra/gateway-boot-lifecycle.ts)：crash-loop breaker 的检查、记录与恢复
- [`sources/openclaw/src/daemon/restart-storm.ts`](../../sources/openclaw/src/daemon/restart-storm.ts)：外部重启风暴检测
- [`sources/openclaw/src/cli/gateway-cli/run-loop-shutdown-budget.ts`](../../sources/openclaw/src/cli/gateway-cli/run-loop-shutdown-budget.ts)：读真实 supervisor 时限并分配预算
- [`sources/openclaw/src/cli/gateway-cli/run-loop-startup.ts`](../../sources/openclaw/src/cli/gateway-cli/run-loop-startup.ts)：启动失败 triage 与进程内重启残局收拾
- [`sources/openclaw/packages/retry/src/index.ts`](../../sources/openclaw/packages/retry/src/index.ts)：退避与可注入 runtime 的重试 runner
- [`sources/openclaw/src/agents/embedded-agent-runner/run/attempt-recovery.ts`](../../sources/openclaw/src/agents/embedded-agent-runner/run/attempt-recovery.ts)：attempt 级可重试判定与 failover 动作
- [`sources/openclaw/src/agents/embedded-agent-runner/run/overflow-context-recovery.ts`](../../sources/openclaw/src/agents/embedded-agent-runner/run/overflow-context-recovery.ts)：溢出恢复：截断、限次压缩
- [`sources/openclaw/src/agents/embedded-agent-runner/compaction-safety-timeout.ts`](../../sources/openclaw/src/agents/embedded-agent-runner/compaction-safety-timeout.ts)：180s 压缩安全超时
- [`sources/openclaw/packages/agent-core/src/agent-loop.ts`](../../sources/openclaw/packages/agent-core/src/agent-loop.ts)：tool-loop 熔断、turn taint、abort 落消息
- [`sources/openclaw/node-runtime-recovery.mjs`](../../sources/openclaw/node-runtime-recovery.mjs)：launcher 信号升级链与子进程收尸
- [`sources/openclaw/src/gateway/channel-health-monitor.ts`](../../sources/openclaw/src/gateway/channel-health-monitor.ts)：通道健康探测
