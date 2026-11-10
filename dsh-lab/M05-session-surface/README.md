# M05 · 会话表面与持久化

会话日志（session log）是 dsh 的**唯一事实来源**。turn、消息、工具调用与结果、审批审计、命令生命周期——全部是同一个 append-only 事件流里的记录。这一章看它长什么样、怎么落盘、怎么读回来。

本工程的 `dsh-lab traj` 子命令就是这一章的产品化形态。

## 学习目标

- 认识 `SessionEvent` 的封装结构（`type` / `seq` / `time` / `data` / `surfaceOp`）；
- 理解 `seq` 连续性为什么是不变量，而不是巧合；
- 分清 `sessionQuery` 的三种读法：精确读、表面折叠、投影读；
- 知道 `resume` 是怎么从日志重建 agent 的。

## 运行

```bash
npm run M05
dsh-lab sessions                    # 列出已落盘会话
dsh-lab traj <sessionId>            # 查看某条会话的 trajectory
dsh-lab traj <sessionId> --surface  # 加上模型表面折叠结果
```

## 代码地图

```text
M05-session-surface/index.ts
├─ M05.1 inspectLog          # 事件类型分布 + seq 连续性校验
├─ M05.2 jsonlPersistence    # flush 后出现在持久化列表里
├─ M05.3 listLivePreferred   # live / persisted 的优先级
├─ M05.4 resumeFromLog       # 从日志恢复出同身份的 agent
└─ M05.5 projectTitle        # 标题投影

src/cli/traj.ts               # 读取与展示（折叠 turn、逐事件明细、模型表面）
```

## 事件的结构

```ts
{
  type: 'tool/call',        // 判别式联合的判别字段
  seq: 42,                  // 从 0 开始，连续递增
  time: 1730000000000,      // 毫秒时间戳
  data: { turn, step, callId, name, arguments },   // 负载统一在 data 里
  surfaceOp?: ...,          // 这条事件如何影响模型可见历史
  ignorable?: true,         // 可跳过（不影响重放正确性）
}
```

两个容易踩的点：

1. **负载在 `data` 里**，不是摊平在事件上。直接 `event.turn` 会得到 `undefined`。
2. **`surfaceOp` 决定模型看得见看不见**。日志里有不等于模型看到。

### seq 连续性

`seq` 从 0 开始连续递增，没有空洞。M05.1 显式断言这一点，因为整条日志的重放、增量读、崩溃恢复都依赖它：

- 有空洞 → 说明丢了事件，重放结果不可信；
- `seq` 与下标不相等 → 说明有并行写入，append-only 被破坏。

0.2.x（0.2.1 起）在构造期就校验（`seed event at index N has seq M (expected N)`），所以损坏的日志进不来。

## 三种读法

| 读法 | API | 用途 |
|---|---|---|
| 精确读 | `sessionQuery.readSession(id)` | 完整事件序列 + 继承前缀长度 |
| 表面折叠 | `sessionQuery.readSurface(id)` | 模型实际看到的历史 |
| 投影读 | `sessionQuery.readTitle(id)` 等 | 派生视图（标题、统计、大纲） |

投影不是"缓存了另一份真相"，而是"从日志算出来的视图"。所以它可以随时丢弃重建——`session-projection-cache` 只是让这件事变快。

### 为什么不能用 `snapshotEvents()`

0.2.x（0.2.1 起）把 `snapshotEvents()` / `eventAt()` / `ownEvents()` 标记为**弃用**，措辞是"new calls are prohibited"。原因是同步快照读会鼓励调用方在事件提交中途读，读到不一致的中间状态。

新代码一律异步：`await ctx.sessionQuery.readSession(id)`。本工程全部按新接口写，M05.1 的注释里也点明了这一点。

## 持久化与恢复

`session-persistence-jsonl` 把事件写成 JSONL，落在 `<DSH_HOME>/sessions/`。M05.2 验证的是"flush 之后出现在 `listSessions()` 里"——注意 `persisted: true` 这个字段，它和 `live: true` 是两件事：

- `live`：当前进程里还有这个 agent 在跑；
- `persisted`：磁盘上有它的日志。

`listSessions()` 是 live-preferred：同一个 id 在两边都有时，返回 live 的那个（因为它有内存里更新的状态）。

M05.4 演示恢复：`ctx.agents.resume({resumeSessionId})` 从日志重建，恢复出的 agent **身份不变**（还是同一个 session id）。这是"日志是事实来源"的直接后果——状态不在内存里，在日志里。

## 排错

| 现象 | 原因 |
|---|---|
| `Property 'turn' does not exist` | 负载在 `event.data.turn` |
| `snapshotEvents` 报弃用 | 改用 `ctx.sessionQuery` 异步读 |
| 会话不在列表里 | 没 flush，或 `persisted: false` |
| 恢复后事件数变了 | 恢复会追加 `session/resumed` 一类事件，属正常 |
| 渲染出来全是空行 | 见下：两种 `data` 形状要分别认 |

### 一个真实踩到的坑：`data` 有两种形状

写 `traj` 时我一度只按 `data.message.content` 取消息体，结果所有 `user` 行和
`result` 行都是空的。原因是 0.2.x 里这两种事件的负载位置**不一样**：

| 事件 | 负载位置 | 为什么 |
|---|---|---|
| `user/message`、`assistant/message` | `data` 本身（`data.content`、`data.role`） | 它记录的就是这条消息 |
| `tool/result` | `data.message` | 它记录的是一条 **tool 消息**，外面还包了 `turn`/`step` |

另一个同源的坑：`turn/end` 的 `reason` 是 `{kind:'completed'}` 这样的对象，
直接插值会印出 `[object Object]`。

这两个 bug 都**不报错**——只是安静地显示空行或乱码。它们只有在会话里真的跑过
一个 turn 之后才看得见，空会话是照不出来的。`scripts/probe-trajectory.ts` 就是
为此存在的：它注入一个脚本化适配器把 turn 跑完，再断言渲染结果。回归测试在
`src/cli/traj.test.ts`。

## 练习

1. 手工在 JSONL 里删掉中间一行，然后 `dsh-lab traj` 它——观察报错。这是 seq 不变量在起作用。
2. 比较 `dsh-lab traj <id>` 和 `--surface` 的输出，找出哪些事件没进模型历史。
3. 跑两次 M05.4，看恢复出的会话事件数怎么增长。
4. 跑 `node scripts/probe-trajectory.ts`，看一个真实 turn 被折成什么形状。
