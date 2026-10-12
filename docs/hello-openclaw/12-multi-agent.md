---
title: "多代理：agent 即边界、bindings 路由与持久化 subagent registry"
---
# 多代理：agent 即边界、bindings 路由与持久化 subagent registry

> 基于 `sources/openclaw/`（openclaw v2026.10.2，OpenClaw Foundation）源码校对。openclaw 把多代理做成三个正交层次：一个 Gateway 进程内的多个 persona agent、agent 运行中 spawn 的 subagent、以及组织级的 delegate/fleet 扩展。

**目录**

- [1. agent 即边界：workspace、agentDir 与 per-agent SQLite](#1-agent-即边界workspaceagentdir-与-per-agent-sqlite)
- [2. bindings：确定性路由](#2-bindings确定性路由)
- [3. team preset 与 specialist lanes](#3-team-preset-与-specialist-lanes)
- [4. subagent：sessions_spawn 与 announce](#4-subagentsessions_spawn-与-announce)
- [5. 跨代理协作与系统层代理](#5-跨代理协作与系统层代理)
- [6. 并发与容量：队列与 lane 契约](#6-并发与容量队列与-lane-契约)

---

## 1. agent 即边界：workspace、agentDir 与 per-agent SQLite

一个 **agent** 是完整的人格边界（`docs/concepts/multi-agent.md`）：自己的 workspace 文件（`AGENTS.md`/`SOUL.md`/`USER.md`）、自己的 `agentDir` 状态目录、自己的 `openclaw-agent.sqlite`（会话历史、auth profile、模型注册）。`agents.entries.<id>` 声明 roster，`openclaw agents add`（`src/agents/agent-create.ts`）创建；每个 agent 的创建出处被记录为 `operator` / `agent` / `claw`，agent 经 `openclaw` 工具请求创建另一个 agent 时需 system agent 转呈并经 operator 审批（`src/system-agent/assistant.ts:1` 的职责注释即"把模糊用户文本转成一条安全命令"）。警告级别的一条铁律：**绝不跨 agent 复用 agentDir**——否则 auth 与会话状态互相碰撞。默认单 agent 模式下 `agentId` 为 `main`，主会话 key 为 `agent:main:main`。

## 2. bindings：确定性路由

入站消息如何落到 agent 由 `bindings` 决定，匹配逻辑在 `src/routing/bindings.ts`：按 `(channel, accountId, peer, guildId, teamId)` 匹配，**最具体者胜**，同层第一个命中者胜；省略 `accountId` 的 binding 只匹配默认账号，`accountId: "*"` 才是通配。这让"一个 WhatsApp 号、多个人"成为纯配置问题——按 E.164 peer 把不同 DM 路由给不同 agent；一个通道的多个账号（多个 Discord bot、多个 Telegram bot）也可各绑一个 agent。per-agent 还可以独立收紧 sandbox 与工具面（`tools.allow`/`deny`、`sandbox.mode: "all"`），Gateway 层的工具闸门独立于人格文件——即使提示词被注入，越权工具调用也会被拒。

## 3. team preset 与 specialist lanes

`openclaw agents team create` 一键生成四角色小队：coordinator（chief of staff）、researcher、writer、reviewer——每个都是独立 workspace + 独立身份的 agent，角色契约写在其 `AGENTS.md` 中（角色模板是可移植的 Claw 包）。委派配置是纯 prompt 引导而非调度器：coordinator 配 `subagents: { allowAgents: [...], delegationMode: "prefer" }`，specialist 的 `allowAgents: []` 则禁止再委派。配套方法论是 parallel specialist lanes（`docs/concepts/parallel-specialist-lanes.md`）：把并行当**稀缺资源设计**问题——真正的瓶颈是会话锁（每会话同时只有一个 run）、全局模型配额、工具容量与上下文预算，所以先用 lane 契约（owns / does not own / chat budget / handoff / tool posture）减少争用，再调并发，最后才考虑加 coordinator。

## 4. subagent：sessions_spawn 与 announce

与 pi"核心刻意不做 sub-agent"相反，subagent 是 openclaw 的一等能力（`docs/tools/subagents.md`）：`sessions_spawn` 从当前 run 派生后台子代理，子代理在自己的会话（`agent:<agentId>:subagent:<uuid>`）中运行，默认**异步 announce**结果回请求者而非阻塞返回。要点：

- **会话隔离**：子代理有自己的上下文与 token 开销；`context: "fork"` 可带走请求者当前 transcript（thread-bound 子会话默认 fork）。
- **工具面收紧**：子代理默认拿不到 session/message 工具，防止委派链变成权限放大器；嵌套深度由 `src/agents/subagents/spawn/subagent-depth-policy.ts` 封顶。
- **registry 持久化**：子代理运行记录在**共享 state 库**（`src/agents/subagents/registry/subagent-registry.ts` 及 store sqlite 实现），因此跨进程存活——重启后由父代理对账收尾（见 [10-session-resume.md](./10-session-resume.md) §5）；`sessions_yield` 让父代理挂起等一批子运行完成再被唤醒。
- **人类可介入**：Control UI 中子代理 run 的 transcript 只读，经 "Open parent session" 回到父会话继续；`visible: true` 的持久子会话则是普通会话，可随时接手 steering。spawn 管线在 `src/agents/subagents/spawn/subagent-spawn.ts`，父系血缘、worktree 绑定、审批面各有专门模块。

## 5. 跨代理协作与系统层代理

- **agent-to-agent**：默认开启，受 `tools.agentToAgent`（enabled/allow 对）与 `tools.sessions.visibility` 管控；`sessions_send` 可以向其他代理的会话投递消息并 `watch: true` 注册状态关注——后者挂接 [04-state-session-memory.md](./04-state-session-memory.md) §3 的信号日志与 watcher 游标。
- **system agent**（`src/system-agent/`）：Gateway 的"custodian"助理，负责把模糊的用户意图规划为一条安全命令、处理审批意图、问候与配置写入，全程带 inference 路由校验与超时。
- **Claws**（`src/claws/`、`docs/cli/claws.md`）：实验性的**可移植 agent 包**——一个版本化 `CLAW.md` manifest 描述某 agent 的身份、workspace 文件、skills、插件与 cron；`claws add` 从包创建独立 agent。
- **fleet**（`src/fleet/`）：把 Gateway 实例本身做成 fleet cell（`FleetCellRecord`：tenantId、image、docker/podman runtime、hostPort、containerName），create/start/stop/upgrade/backup/restore 全生命周期注册在共享 state 库——多租户/多实例部署的底座。
- **meeting-bot**（`src/meeting-bot/`）：实时语音/会议参与者（audio transport、browser capture、realtime engine），可经 `agent-consult.ts` 咨询其他 agent；**delegate architecture**（`docs/concepts/delegate-architecture.md`）则把多代理推向组织：以自己身份"on behalf of"行事的命名代理，按只读起草 → 代发 → 主动三类能力分层，配 per-agent 工具黑名单与审计。

## 6. 并发与容量：队列与 lane 契约

并发控制全部落在 Gateway：`agents.defaults.maxConcurrent` 封顶共享主 lane，`subagents.maxConcurrent` 给每个 spawn 会话独立的子执行预算；入站消息经 collect 队列（`messages.queue` 的 mode/cap/drop）合并转向（queue-steering，`docs/concepts/queue.md`）。运行按会话序列化、按全局并行度封顶，审批与 elevated 命令另有全局 + per-agent 双重闸门。这套容量模型与多代理 roster 的关系是显式的：加 agent 不增加模型配额，specialist lane 之所以有效，是因为它减少了对同一会话锁与同一工具面的争用，而不是凭空创造吞吐。

## 源码锚点

- [`sources/openclaw/src/agents/agent-create.ts`](../../sources/openclaw/src/agents/agent-create.ts)：agent 创建与集成
- [`sources/openclaw/src/routing/bindings.ts`](../../sources/openclaw/src/routing/bindings.ts)：确定性 binding 路由
- [`sources/openclaw/src/agents/subagents/spawn/subagent-spawn.ts`](../../sources/openclaw/src/agents/subagents/spawn/subagent-spawn.ts)：sessions_spawn 管线
- [`sources/openclaw/src/agents/subagents/spawn/subagent-depth-policy.ts`](../../sources/openclaw/src/agents/subagents/spawn/subagent-depth-policy.ts)：嵌套深度策略
- [`sources/openclaw/src/agents/subagents/registry/subagent-registry.ts`](../../sources/openclaw/src/agents/subagents/registry/subagent-registry.ts)：持久化 subagent registry
- [`sources/openclaw/src/system-agent/assistant.ts`](../../sources/openclaw/src/system-agent/assistant.ts)：system agent 意图规划（`:1`）
- [`sources/openclaw/src/fleet/registry.ts`](../../sources/openclaw/src/fleet/registry.ts)：fleet cell 注册表
- [`sources/openclaw/src/meeting-bot/agent-consult.ts`](../../sources/openclaw/src/meeting-bot/agent-consult.ts)：meeting bot 向 agent 咨询
- [`sources/openclaw/docs/concepts/multi-agent.md`](../../sources/openclaw/docs/concepts/multi-agent.md)：多代理路由权威文档
- [`sources/openclaw/docs/tools/subagents.md`](../../sources/openclaw/docs/tools/subagents.md)：subagent 文档索引（七页分主题）
- [`sources/openclaw/docs/concepts/parallel-specialist-lanes.md`](../../sources/openclaw/docs/concepts/parallel-specialist-lanes.md)：specialist lanes 方法论
- [`sources/openclaw/docs/concepts/delegate-architecture.md`](../../sources/openclaw/docs/concepts/delegate-architecture.md)：组织级 delegate 架构
- [`sources/openclaw/docs/cli/claws.md`](../../sources/openclaw/docs/cli/claws.md)：可移植 Claw agent 包
