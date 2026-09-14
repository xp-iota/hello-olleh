---
title: "输入命令队列：inbox 准入、steer/queue 与 slash command"
---
# 输入命令队列：inbox 准入、steer/queue 与 slash command

> 基于 `sources/opencode/specs/v2/session.md`、`packages/core/src/session/inbox.ts` 与 `command.ts` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 输入的统一入口：inbox](#1-输入的统一入口inbox)
- [2. steer 与 queue](#2-steer-与-queue)
- [3. 控制项：compaction 与 move](#3-控制项compaction-与-move)
- [4. slash command](#4-slash-command)
- [5. 步数配额与输入的交互](#5-步数配额与输入的交互)

---

## 1. 输入的统一入口：inbox

v2 里**一切会话输入都是 inbox 项**：用户 prompt、synthetic 消息（如 shell 完成通知）、手动 compaction、move 都经 `session_inbox` 准入。准入即持久化（`session.inbox.enqueued` 事实 + `session_inbox` 行），投递才进入模型可见历史（`session.inbox.delivered` projection 消费行并原子插入消息）。

准入层的关键性质（与 [03-agent-loop.md](./03-agent-loop.md) §2 配套）：

- 幂等：同 Session 同类型复用 inbox 项 ID 时首次准入获胜，重试被忽略；跨 Session/跨类型复用失败。
- inbox 命令自带身份与类型检查，返回类型化 `SessionInbox.LifecycleConflict`；Session 操作把它翻译成各自的公共错误并决定是否 wake。
- pending 输入的修改不自己调度执行：steer 成功后 wake；queue 与 cancel 不 wake。

## 2. steer 与 queue

| 模式 | 语义 |
| --- | --- |
| `steer`（默认） | 按入队序在**下一个安全 Step 边界**投递；投递在遇到 compaction 或 move 控制项前停止 |
| `queue` | 会话可继续时保持 pending；在**空闲边界**，steer 仍优先，否则投递一条 queued 项，随后处理投递期间到达的 steer；runner 在再投一条前重新评估 continuation |

用户 shell 命令是例外路径：立即作为后台工作启动，不等模型执行或其它用户 shell，也不抑制 prompt wake；完成与启动失败通知以 `resume: false` 的 synthetic 输入准入（不唤醒执行）。

## 3. 控制项：compaction 与 move

手动 compaction 与 Session 移动复用同一 inbox 作为**控制项**：每项有自己的 inbox 身份与投递模式；控制项构成投递边界，使之后的 steer 不会越过它先投递。控制项被消费时不进入 transcript——它们改变处理路径，不成为对话内容。

## 4. slash command

- 命令的目录对象是 `packages/core/src/command.ts`（`command.updated` 事件会进事件日志）；会话侧的命令处理在 `session/command.ts`。
- 插件可贡献命令（`plugin/command.ts` + `plugin/command/`），经 catalog 变换管线生效（见 [17-settings-config.md](./17-settings-config.md) §4）。
- CLI 侧的全局命令树（`opencode run/acp/auth/mcp/plugin/...`）与会话内 slash command 是两层：前者由 `packages/cli/src/commands/` 分发，后者进入会话 inbox 语义。

## 5. 步数配额与输入的交互

提升新的用户输入会**重置所选 agent 的步数配额**；一批 steer 只重置一次。这让"用户在执行中插话"能立即接管方向，同时防止 steer 轰炸造成无限执行（见 [03-agent-loop.md](./03-agent-loop.md) §4 与 [12-multi-agent.md](./12-multi-agent.md) §2）。

## 源码锚点

- [`sources/opencode/packages/core/src/session/inbox.ts`](../../sources/opencode/packages/core/src/session/inbox.ts)：inbox 服务与命令
- [`sources/opencode/packages/core/src/command.ts`](../../sources/opencode/packages/core/src/command.ts)：命令目录对象
- [`sources/opencode/packages/core/src/session/command.ts`](../../sources/opencode/packages/core/src/session/command.ts)：会话内命令处理
- [`sources/opencode/specs/v2/session.md`](../../sources/opencode/specs/v2/session.md)：§ Prompt Admission Precedes Execution
