# dsh-agent-loop-demo：Agent 循环干预——脚本化适配器驱动的 turn/step、steer、inbox、取消

> 独立示例：本目录拷到任何位置，`npm install && npm start` 即可运行（Node ≥ 22.18；`npm run start:bun` 走 Bun）。
> 版本面：`@deepseek-ai/*` **0.2.2-rc.3**、`@deepseek-ai/cordis` **4.1.0**。全部场景离线、不需要 key。
> 本文所有运行输出均为实测粘贴（Node v26.12.1 / Bun 1.4.4，Windows）。

## 1. 问题：不写循环，怎么干预循环

dsh 的 agent 循环由 `dsh-agent-loop` 独占驱动：宿主只往 inbox 里塞消息，turn/step 的推进、工具执行、历史装配全部由 driver 负责。干预点只有四类：

- **观察**：`session/event`（turn/step 边界、工具调用、助手消息）与 `agent/status`；
- **续跑**：`agent/turn-stopping` 事件时 `steer()`，让即将结束的 turn 再走一步；
- **排队**：`send()` / `followup()` / `inject()` 三条 inbox 通道，唤醒与否可选；
- **取消**：`cancel()`，空闲幂等、在途真实中止。

难点在于：这些观察点大多只在"真的跑过一个 turn"之后才有内容，而真实 turn 需要模型。本示例的答案是**脚本化 LlmAdapter**——在 provider 缝上注册一个按剧本产出 StreamChunk 的适配器，driver 对它的驱动与真实 provider 完全一致，于是每个干预点都能离线真实触发。

## 2. 最小树：九行

与 [dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md) 完全相同的九行（timer / system-prompt / tools / tool-executor-native / session / session-projection / agent / llm / agent-loop），`cordis.patch.yml` 逐字复用。差别在模型侧：**不挂任何真实 provider 行**，脚本化适配器在进程内注册：

```ts
const releaseAdapter = ctx.llm.registerAdapter(['lab-scripted'], new ScriptedAdapter())
```

`registerAdapter()` 返回精确的解除句柄（llm/src/index.ts:416），示例结束时调用。工具侧复用 word-count 插件（`word_count`），供脚本的第一个 step 调用。

## 3. 实现代码

### 3.1 脚本化适配器 `src/plugins/scripted-adapter.ts`

`LlmAdapter` 是抽象类，唯一必须实现的方法是 `stream()`（llm/src/index.ts:317）；`providerInfo` / `resolveModel` / `prepareCall` 都有可用默认。协议是原始 StreamChunk 序列：`block-start → delta → block-end → usage → finish`。

```ts
export class ScriptedAdapter extends LlmAdapter {
  private readonly steps = new Map<string, number>()   // 按 model 路由独立计步

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const step = (this.steps.get(options.model) ?? 0) + 1
    this.steps.set(options.model, step)

    if (options.model === 'hang') {
      // 挂起路由：开一个文本块后等取消信号——演示在途取消。
      yield { type: 'block-start', index: 0, blockType: 'text' }
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) return resolve()
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      options.signal?.throwIfAborted()
      return
    }
    if (step === 1) {
      // 第一个 step：产出 word_count 工具调用，finish 原因是 { kind: 'tool-calls' }。
      const callId = ToolCallId(`scripted-call-${options.model}`)
      const args = JSON.stringify({ text: 'deepseek harness scripted turn' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: callId, name: 'word_count', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'word_count', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 1200, outputTokens: 24 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    // 后续 step：最终文本（steer 续跑也走这里），finish 原因是 { kind: 'stop' }。
    // …text-delta / block-end / usage / finish，完整文件在本目录
  }
}
```

每个场景用不同的 model id（`s1`…`s5`、`hang`），step 计数互不串扰。agent 创建时路由走 `agentOptions`：

```ts
ctx.agents.create({
  sessionId: SessionId(`agent-loop-s1-${suffix}`),
  meta: { cwd: process.cwd() },                        // root 会话 header 只接受 { cwd }
  agentOptions: { provider: 'lab-scripted', model: 's1' },
})
```

### 3.2 五个场景（`src/index.ts` 节选）

```ts
// S1 观察边界：followup 唤醒 driver，whenIdle 等收敛
agent.followup(userMsg('统计一下这段文本的词数'))
await agent.whenIdle()          // session/event 里收集 turn/step 边界

// S2 steer 续跑：turn-stopping 是 serial 事件，payload.agent 由融合分发器注入
const offStopping = ctx.on('agent/turn-stopping', (payload) => {
  if (payload.agent !== agent || steered) return
  steered = true
  agent.steer(userMsg('再补一句：这句话是 steer 注入的。'))
})

// S3 只入队不唤醒：send 的第三个参数是 wakeup
agent.send(userMsg('排队但不唤醒'), 'next-turn', false)   // status 仍 idle
agent.inject(userMsg('下一步边界再消费'))                  // = send(next-step, false)
agent.inbox.clear()

// S4 在途取消：hang 路由挂起 → 等 running 事件 → cancel → aborted 收尾
hangAgent.followup(userMsg('这个请求会一直挂起'))
await running                    // agent/status 里等到 running
hangAgent.cancel({ kind: 'user' })
await hangAgent.whenIdle()       // turn/end reason = aborted

// S5 status 事件：一个完整 turn 恰好 running → idle
```

## 4. 实测运行输出

`npm start`（Node v26.12.1）：

```text
runtime = node v26.12.1

=== S1 脚本化 turn：turn/step 边界 ===
边界事件：turn/start → step/start → step/end → step/start → step/end → turn/end
tool/call × 1，assistant/message × 2

=== S2 turn-stopping 时 steer ===
turn 1 即将结束，steer 注入续跑消息
steer 触发：true，本 turn 共 3 个 step（无 steer 时是 2 个）

=== S3 inbox 三通道：followup / steer / inject ===
初始：next-turn 0 条，next-step 0 条
send(next-turn, wakeup=false) 后：next-turn 1 条，status=idle
inject 后：next-step 1 条，status=idle
clear 后：next-turn 0 条，next-step 0 条

=== S4 取消在途工作 ===
空闲时连续 cancel 不报错，status=idle
默认 cancel 清空 inbox：剩 0 条
keepInbox cancel 保留排队：剩 1 条
turn 已在途：status=running
cancel 后：status=idle，turn/end reason=aborted

=== S5 agent/status 事件 ===
初始 status：idle
status 变化：running → idle

AGENT_LOOP_OK
```

`npm run start:bun`（Bun 1.4.4）：除首行 runtime 标识外**逐行一致**，同样以 `AGENT_LOOP_OK` 结束。`npm run typecheck`：退出码 0。

三个值得盯住的事实：

- **S1 的边界序列**是 driver 真实写进会话日志的事件，不是模拟打印——工具步与回答步各一对 step/start/end；
- **S2 的 3 个 step**：steer 不是"打断"，而是在 turn-stopping 检查点往 next-step 塞消息，循环发现 inbox 非空就继续；
- **S4 的 aborted**：取消真实穿透到适配器的 `options.signal`，hang 路由抛出后被 LlmRuntime 规范化为 aborted 终局，turn/end 如实记录。

## 5. 机制解释

### 5.1 LlmAdapter 是 provider 缝，stream 是唯一必需方法

`LlmAdapter`（llm/src/index.ts:223）把 provider 差异收敛成一个抽象类：`providerInfo` / `providerRetryPolicy` / `resolveModel` / `prepareCall` 都有默认实现，只有 `stream()` 是 abstract。`ctx.llm.registerAdapter(providers, adapter)` 把实例绑到一组路由上，返回解除句柄 + 原子换路由能力（:324-330）。agent-loop 组装好 `GenerateOptions`（完整历史、工具 schema、signal、sessionId）后调用 `llm.stream()`，对脚本化适配器与真实 provider 一视同仁——这正是"缝"的价值：**替换模型来源不需要碰循环的任何一行**。

### 5.2 turn 的形状：step 循环 + 两个 inbox 检查点

driver 的一个 turn 内（agent-loop/src/agent.ts:360-407）：每个 step 写 `step/start` → 执行模型请求与工具批 → 写 `step/end`；step 结束后若 `turnEnds && inbox.nextStep.length === 0`，先 serial 分发 `agent/turn-stopping`，**再检查一次** nextStep——steer 就是钻这个检查点的空子让 turn 续跑。turn 收尾必写 `turn/end`（含 reason：completed / max-tokens / aborted / error），然后若 inbox 还有 next-turn 待办，开下一个 turn。

### 5.3 三条通道是同一 send 的三种包装

agent.ts:171-190 一目了然：

| API | 等价形式 | 语义 |
|---|---|---|
| `followup(msg)` | `send(msg, 'next-turn', true)` | 排队一个完整 turn 并唤醒 |
| `steer(msg)` | `send(msg, 'next-step', true)` | 在当前 turn 的下一步边界插入并唤醒 |
| `inject(msg)` | `send(msg, 'next-step', false)` | 只入队，等下次自然边界消费 |

`wakeup=false` 时 driver 完全不启动（S3 实测 status 保持 idle）——inbox 是**持久化的待办**，不是即时调用。`cancel()` 默认先 `inbox.clear()` 再中止在途活动；`keepInbox: true` 保留排队工作（agent.ts:192-202）。

### 5.4 agent 事件的 payload 由融合分发器注入 agent

`agent/status`、`agent/turn-stopping` 的 emit 侧只传 `{ status }` / `{ turn, signal }`；`agentEvents()`（core/agent/src/dispatch.ts:107-148）构造融合分发器，把 agent 主体注入 payload 并绑定 scope carrier——**subject 与 scope key 不可能分叉**。所以根 ctx 上的监听器用 `payload.agent === agent` 过滤即可，类型声明里 payload 本来就带 `agent` 字段（runtime-types.ts:310、:418）。

### 5.5 适配器必须尊重 signal，失败会被规范化

StreamChunk 协议文档（types.ts:489-494）明确：适配器可以抛错，`LlmRuntime.stream()` 会把失败规范化为终局 `error` 或 `aborted` finish 再暴露给消费者。hang 路由的实现因此非常简单：等 signal abort → `throwIfAborted()`，剩下的交给运行时。cancel 的 cause（`{ kind: 'user' }`）沿 signal 传到 turn/end 的 `reason: { kind: 'aborted', reason: cause }`。

## 6. 边界与坑（全部实测踩过或源码核实）

1. **rc.3 的 FinishReason 是对象不是字符串**：`{ kind: 'tool-calls' }` / `{ kind: 'stop' }`（types.ts:163-172，merge-extensible）。旧探针里的 `reason: 'tool-calls' as never` 写法在 rc.3 上过不了 typecheck。
2. **模型路由在 agentOptions，不在 meta**：root 会话的 header 只接受 `{ cwd }`，`origin` 是子 agent 专用；provider/model 填进 meta 会被 validateSessionHeader 拒掉。
3. **turn-stopping 的 payload 没有显式 agent 传入**：emit 侧只有 `{ turn, signal }`，`agent` 是融合分发器注入的——直接读 `payload.agent` 即可，不要自己拼。
4. **steer 只在检查点生效**：turn-stopping 之后循环立刻复查 nextStep；在别的时机 steer 只是普通入队。一个 turn 里 steer 多次会续跑多步，示例用 `steered` 标志只注入一次。
5. **根 ctx 监听器不随 agent dispose 销毁**：每个场景都拿 `ctx.on` 返回的 off 句柄手动解除（沿用 tool-pipeline-demo 的教训）。
6. **step 计数要按 model 路由隔离**：同一个适配器实例服务所有场景，共用计数会让 S2 的第一个 step 直接给文本、跳过工具步。
7. **在途取消要等 running 再 cancel**：followup 之后 driver 异步启动，立刻 cancel 可能打在空闲态上（幂等但测不到在途路径）。用 agent/status 事件等到 running 是确定性做法。
8. **本示例不挂 ptc/subprocess**，Bun 无需补丁；会话日志落在本目录 `.dsh-home/`（gitignored）。

## 7. 从零复现

目录结构：

```text
dsh-agent-loop-demo/
├── package.json
├── tsconfig.json
├── .gitignore              # node_modules/ + .dsh-home/
├── cordis.yml              # []
├── cordis.patch.yml        # 九行最小树（与 tool-pipeline-demo 逐字相同）
└── src/
    ├── index.ts            # 五场景主程序
    └── plugins/
        ├── word-count.ts   # 最小工具插件（与 tool-pipeline-demo 相同）
        └── scripted-adapter.ts
```

dependencies / devDependencies / tsconfig.json 与 [dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md) 完全相同（16 个运行依赖 + typescript 5.9.3 / @types/node 22.10.2）。`cordis.patch.yml`、`word-count.ts` 直接复制该示例同名文件；`scripted-adapter.ts` 全文见 §3.1（完整文件在本目录），`index.ts` 直接复制本目录同名文件。验证步骤：

```bash
npm install          # 49 packages（含自动安装的 peer）
npm start            # 末行 AGENT_LOOP_OK
npm run start:bun    # 与 Node 逐行一致（runtime 标识除外）
npm run typecheck    # 退出码 0
```

## 8. 小结

- [x] 脚本化 LlmAdapter 让真实 turn 离线可跑：provider 缝替换模型来源不碰循环；
- [x] turn/step 边界是会话日志里的真实事件，steer 在 turn-stopping 检查点续跑；
- [x] followup / steer / inject 是同一 send 的三种包装，wakeup=false 只入队不唤醒；
- [x] cancel 空闲幂等、默认清 inbox、keepInbox 保留排队、在途真实中止（aborted 收尾）；
- [x] agent 事件 payload 的 agent 字段由融合分发器注入，subject 与 scope 不分叉；
- [x] Node 与 Bun 双运行时逐行一致。

上一篇：[dsh-context-demo](../dsh-context-demo/README.md)；下一篇：dsh-session-demo——会话日志的结构、落盘、恢复与读取面。