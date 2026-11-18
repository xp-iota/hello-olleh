# dsh-trajectory-probe-demo：Trajectory 探针——把事件流折叠成 turn 大纲、明细与模型表面

> 独立示例：本目录拷到任何位置，`npm install && npm start` 即可运行（Node ≥ 22.18；`npm run start:bun` 走 Bun）。
> 版本面：`@deepseek-ai/*` **0.2.2-rc.3**、`@deepseek-ai/cordis` **4.1.0**。全部场景离线、不需要 key。
> 本文所有运行输出均为实测粘贴（Node v26.12.1 / Bun 1.4.4，Windows）。

## 1. 问题：渲染逻辑怎么钉在真实事件上

会话日志（见 [dsh-session-demo](../dsh-session-demo/README.md)）是 append-only 事件流，但人想看的是 **trajectory**：每个 turn 干了什么、调了几次工具、花了多少 token、模型最终看到了什么。这层折叠渲染有一个测试困境：

**turn 大纲、工具行、token 用量这些代码路径，只有会话里真的跑过 turn 之后才有内容。** 播种空会话只能照出"不崩"，照不出折叠逻辑的 bug——旧教材就曾在空会话上漏掉"消息体有两种形状"的缺陷，所有 user 行渲染成空行都看不出来。

探针的答案：脚本化 LlmAdapter（见 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md)）离线播种**两个真实 turn**，然后用同一套折叠/渲染代码处理它们，并对每个数字做断言对账。

## 2. 最小树：十四行

与 dsh-session-demo 逐字相同的十四行（`cordis.patch.yml` 直接复制）：渲染需要 `sessionQuery` 的精确读/标题/表面，"从盘上渲染"需要 JSONL 落盘。模型侧同样不挂真实 provider，脚本化适配器进程内注册。

## 3. 实现代码

### 3.1 折叠器 `foldTurns()`（`src/trajectory.ts` 节选）

```ts
for (const event of events) {
  switch (event.type) {
    case 'turn/start':   // 开新 turn：编号、起始 seq
    case 'user/message': // 只取 turn 里第一条人类消息作提示词（source.kind 过滤注入块）
    case 'step/start':   // steps += 1
    case 'tool/call':    // toolCalls += 1
    case 'assistant/message': // 累加 data.usage 的 inputTokens / outputTokens
    case 'turn/end':     // 收口：endSeq + reasonOf(data.reason)（{ kind } 对象不是字符串）
  }
}
```

三个只有真实 turn 才照得出的坑，全部固化在代码里：

- **消息体两种形状**：`user/message` / `assistant/message` 的负载在 `data` 本身；`tool/result` 的负载在 `data.message`（它记录的是"一条 tool 消息"）。`messageOf()` 两种都认；
- **user/message 不全是人话**：runtime-context 等注入块也是 user/message，按 `source.kind === 'user'`（或缺席）过滤，否则大纲提示词会被注入块污染；
- **纯 tool-call 的 assistant 消息**：只取 text 会渲染成空行，`describeAssistantContent()` 把工具名标成 `→ word_count`。

### 3.2 五个场景（`src/index.ts` 节选）

```ts
// S1 播种两个 turn：同一个 model 路由，step 计数续接（1 工具步 2 回答步 3 回答步）
agent.followup(userMsg('统计一下这段文本的词数')); await agent.whenIdle()
agent.followup(userMsg('再用一句话总结'));         await agent.whenIdle()

// S2 对账：折叠结果的每个数字都断言
const turns = foldTurns(snapshot.events)
assert(turns.length === 2 && first.steps === 2 && first.toolCalls === 1, …)
assert(totalIn === 4200 && totalOut === 60, 'token 合计应当等于脚本产出的 usage 之和')

// S3/S4 渲染：概览 + turn 大纲 + 明细；surface 视图换 readSurface
await renderTrajectory(ctx, String(sessionId))
await renderTrajectory(ctx, String(sessionId), { events: false, surface: true })

// S5 从盘上渲染：flush → dispose → readSession 回落持久化语料
await ctx.sessions.flush(agent.session)
await handle.dispose()
await renderTrajectory(ctx, String(sessionId), { events: false })
```

token 对账的预算来自脚本本身：step1 usage 1200/24、step2 1500/18、step3 1500/18，合计 **4200 in / 60 out**——渲染出的数字必须与适配器产出的分毫不差。

## 4. 实测运行输出

`npm start`（Node v26.12.1，`.dsh-home` 为空的首跑）：

```text
runtime = node v26.12.1

=== S1 脚本化播种两个 turn ===
会话 traj-probe-mwkgx3ei 播种完成，status=idle

=== S2 foldTurns 折叠对账 ===
turn 1：2 步 / 1 工具 / 2700 in 42 out
turn 2：1 步 / 0 工具 / 1500 in 18 out
合计：4200 in / 60 out（脚本预算 4200 / 60）

=== S3 trajectory 渲染 ===

trajectory traj-probe-mwkgx3ei
  标题      统计一下这段文本的词数
  事件      25 条
  turn      2 个
  工具调用  1 次
  token     4200 in / 60 out

turn 大纲
  #   seq        步  工具  结局        提示词
   1     1→16     2     1  completed   统计一下这段文本的词数
   2    18→24     1     0  completed   再用一句话总结

事件明细
     1  turn 1 开始
     3  step 1 开始
     5  user      统计一下这段文本的词数
     9  assistant → word_count
    10  tool      word_count {"text":"deepseek harness scripted turn"}
    11  result   4 词 / 30 字符
    12  step 1 结束
    13  step 2 开始
    14  assistant 工具结果已经拿到了。
    15  step 2 结束
    16  turn 1 结束 (completed)
    18  turn 2 开始
    20  step 1 开始
    21  user      再用一句话总结
    22  assistant 这是续跑后的补充回答。
    23  step 1 结束
    24  turn 2 结束 (completed)

=== S4 模型表面视图 ===

trajectory traj-probe-mwkgx3ei
  标题      统计一下这段文本的词数
  事件      25 条
  turn      2 个
  工具调用  1 次
  token     4200 in / 60 out

turn 大纲
  #   seq        步  工具  结局        提示词
   1     1→16     2     1  completed   统计一下这段文本的词数
   2    18→24     1     0  completed   再用一句话总结

模型表面（readSurface）
  system/message     You are an AI agent powered by DeepSeek Harness.
  user/message       统计一下这段文本的词数
  assistant/message  → word_count
  tool/result        4 词 / 30 字符
  assistant/message  工具结果已经拿到了。
  user/message       再用一句话总结
  assistant/message  这是续跑后的补充回答。

=== S5 从盘上渲染（live agent 已销毁）===

trajectory traj-probe-mwkgx3ei
  标题      统计一下这段文本的词数
  事件      25 条
  turn      2 个
  工具调用  1 次
  token     4200 in / 60 out

turn 大纲
  #   seq        步  工具  结局        提示词
   1     1→16     2     1  completed   统计一下这段文本的词数
   2    18→24     1     0  completed   再用一句话总结

盘上读回 25 条事件（live 快照 25 条），渲染不依赖 live agent

TRAJ_PROBE_OK
```

`npm run start:bun`（Bun 1.4.4，同样清空 `.dsh-home` 后首跑）：除首行 runtime 标识与会话 id（每次运行随机）外**逐行一致**，同样以 `TRAJ_PROBE_OK` 结束。`npm run typecheck`：退出码 0。

三个值得盯住的事实：

- **25 条事件 → 大纲 2 行 → 表面 7 条**：同一份日志的三种投影，各自服务不同读者（运维看明细、人看大纲、模型看表面）；
- **seq 有空洞**（明细里 1→3→5→9…）：被跳过的是 request/header、assistant/attempt 等记账事件，默认不展开但 seq 连续——渲染过滤不等于日志缺失；
- **token 4200/60 精确对账**：usage 从适配器的 chunk 一路流到 assistant/message 事件再到折叠器，任何一环丢失都会被断言抓住。

## 5. 机制解释

### 5.1 读取面是唯一数据来源

渲染器不解析 JSONL 文件，只走 `ctx.sessionQuery.readSession()`——它做一次完整 replay 校验，读出来的序列就是被信任的那一份。`readTitle` / `readSurface` 同理。这意味着渲染器对 live 会话与盘上会话一视同仁：S5 dispose 之后 `readSession` 自动回落持久化语料（live-preferred，见 session-demo §5.4），渲染一行不改。

### 5.2 折叠是纯函数，渲染是薄壳

`foldTurns(events)` 是纯函数：输入事件序列，输出 turn 列表，不碰 ctx、不做 I/O——可以单独断言（S2 就是这么做的）。`renderTrajectory()` 只是把折叠结果与逐事件摘要排版成文本。旧教材的 traj CLI 还带 ANSI 颜色与耗时列；本示例刻意用纯文本、去掉时间列，让双运行时输出逐行可比（时间戳每次运行都不同，会污染对比）。

### 5.3 探针与真实 provider 验证的分工

脚本化适配器钉住的是**循环与渲染的机制**：事件形状、折叠逻辑、表面对账。它不替代真实 provider 验证（网络、序列化、provider 专有字段）——那是 dsh-llm-adapter-demo 的主题。两层验证各管一段，合起来才覆盖"模型回答 → 事件流 → 人可读视图"的完整链路。

## 6. 边界与坑（全部实测踩过或源码核实）

1. **空会话照不出折叠 bug**：消息体双形状、人类消息过滤、tool-call 摘要这三个缺陷都只在真实 turn 上显形。探针存在的理由就是这个。
2. **turn/end 的 reason 是对象**：`{ kind: 'completed' }`，直接 `String(reason)` 会印出 `[object Object]`；`reasonOf()` 取 kind。
3. **提示词只取 turn 内第一条人类消息**：steer 插话、注入块都不该盖掉开头那句；`current.prompt === ''` 守卫 + `isHumanMessage` 过滤缺一不可。
4. **usage 挂在 assistant/message 事件上**：不是独立的 usage 事件；折叠器从 `data.usage` 累加，脚本的 usage chunk 是它的唯一来源。
5. **step 计数跨 turn 续接**：同一个 model 路由的第二个 turn 从 step3 开始——脚本按 step 数决定行为时要把这一点算进去（本例 turn2 恰好落在"给文本"分支）。
6. **从盘上渲染前必须 flush**：dispose 不自动保证落盘完整；S5 先 `sessions.flush` 再 dispose。
7. **`ctx.sessionQuery` 的类型增补**：`import type {} from '@deepseek-ai/dsh-session-query-sqlite'` 必须出现在渲染器文件里（trajectory.ts 顶部），否则 typecheck 报 TS2339。
8. **本示例不挂 ptc/subprocess**，Bun 无需补丁。

## 7. 从零复现

目录结构：

```text
dsh-trajectory-probe-demo/
├── package.json
├── tsconfig.json
├── .gitignore              # node_modules/ + .dsh-home/
├── cordis.yml              # []
├── cordis.patch.yml        # 十四行（与 dsh-session-demo 逐字相同）
└── src/
    ├── index.ts            # 五场景主程序
    ├── trajectory.ts       # foldTurns + renderTrajectory（纯文本）
    └── plugins/
        ├── word-count.ts       # 与 tool-pipeline-demo 相同
        └── scripted-adapter.ts # 与 agent-loop-demo 相同
```

dependencies / devDependencies / tsconfig.json / cordis.patch.yml 与 [dsh-session-demo](../dsh-session-demo/README.md) 完全相同；两个插件文件复制 dsh-agent-loop-demo 同名文件；`trajectory.ts` 与 `index.ts` 直接复制本目录同名文件。验证步骤：

```bash
npm install          # 含自动安装的 peer
npm start            # 末行 TRAJ_PROBE_OK
npm run start:bun    # 与 Node 逐行一致（随机会话 id 除外）
npm run typecheck    # 退出码 0
```

## 8. 小结

- [x] 探针用脚本化适配器播种真实 turn，把折叠/渲染逻辑钉在真实事件序列上；
- [x] foldTurns 是纯函数：turn 数、步数、工具数、token 全部可断言对账（4200/60 精确）；
- [x] 消息体双形状、人类消息过滤、tool-call 摘要——三个真实 turn 才照得出的坑全部固化；
- [x] 同一份日志三种投影：明细（运维）、大纲（人）、表面（模型）；
- [x] 渲染只走 sessionQuery：flush 过的会话 dispose 后从盘上照常渲染；
- [x] Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-session-demo](../dsh-session-demo/README.md)；下一篇：dsh-hitl-demo——审批与人在回路。