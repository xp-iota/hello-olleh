# M08 · 委派与预设

一个 agent 可以创建子 agent。两条委派通道差别很大，这是本章的核心：

| 通道 | 子会话起点 | 适合 |
|---|---|---|
| `spawn`（`subagent`） | 空白，独立上下文 | 分头查资料、并行改文件 |
| `fork`（`subagent_fork`） | 继承父会话**完整前缀** | 接着当前线索往下做 |

## 学习目标

- 说清 spawn 与 fork 的语义差别，以及它如何体现在会话日志上；
- 理解 `parentAgent` 建立的运行期归属（子 agent 不是 root）；
- 知道 `isSeeded` 与 `seed` 必须同时给出，以及为什么；
- 认识委派深度预算。

## 运行

```bash
npm run M08
```

不需要 key：本章只创建 agent 结构，不发模型请求。

## 代码地图

```text
M08-delegation-presets/index.ts
├─ M08.1 listProviders      # subagent 服务与三个委派工具
├─ M08.2 spawnChild         # parentAgent 归属；子 agent 不出现在 roots()
├─ M08.3 forkChild          # seed 前缀 + inheritedEventCount
├─ M08.4 presetRegistry     # 预设注册表在位情况
└─ M08.5 delegationBudget   # delegationDepth 与 maxDepth
```

## spawn：独立子 agent

```ts
const child = await ctx.agents.create({
  sessionId: SessionId('...-child'),
  parentAgent: handle.agent,      // ← 运行期归属
  meta: { cwd, origin: 'subagent', delegationDepth: 1 },
})
```

`parentAgent` 是这个子 agent 的**生命周期父级**：父 agent 销毁时子 agent 会被连带取消（`cancel({kind:'parent'})`）。`ctx.agents.roots()` 只列根 agent，所以子 agent 不在里面——这条断言验证的正是归属关系。

子会话从零开始，看不到父会话的任何内容。这就是"分头干活"的语义。

## fork：继承前缀

```ts
const parentSnapshot = await ctx.sessionQuery.readSession(parent.id)
const forked = await ctx.agents.create({
  sessionId: SessionId('...-fork'),
  parentAgent: parent,
  meta: { parentSession: parent.id, isSeeded: true, origin: 'subagent', delegationDepth: 1 },
  seed: parentSnapshot.events,                       // ← 显式前缀
  inheritedEventCount: parentSnapshot.events.length,
})
```

`seed` 是必需参数，不是可选项。设了 `isSeeded: true` 却不给 seed，session 构造函数直接失败：

```text
seeded session requires an explicit constructor seed
```

这个严格性是对的：一个自称"继承了前缀"却拿不出前缀的会话，在重放时无法定位自己的历史边界。`inheritedEventCount` 就是那条边界——它告诉读取方"前 N 条是继承来的，不算这条会话自己的产出"。

`dsh-lab traj <forkId>` 会显示：

```text
继承前缀  3 条（fork 自父会话）
```

## 为什么两种都要有

不是"fork 更强大所以更好"。它们的成本结构不同：

- **spawn** 便宜：子会话只有自己的事件，日志小、可并行、失败隔离。
- **fork** 贵：每个 fork 都复制一份前缀，N 个子 agent 就有 N 份前缀。

所以正确用法是：**需要共享推理上下文时 fork，只需要并行执行时 spawn**。把 fork 当默认选项会让日志迅速膨胀。

## 预设

`agent-preset` / `agent-preset-registry` 把"模型路由 + 工具集合 + 提示词片段"打包成可复用的 agent 模板，运行时按名字选取。

本工程没挂这两行（示例工程不需要），M08.4 会如实报告"未装配"并说明它是什么。这比假装演示更诚实——**没装配就说没装配**。

## 排错

| 现象 | 原因 |
|---|---|
| `seeded session requires an explicit constructor seed` | `isSeeded: true` 但没给 `seed` |
| 继承前缀长度不对 | `inheritedEventCount` 与 `seed.length` 不一致 |
| 子 agent 出现在 `roots()` 里 | 没传 `parentAgent`，它就成了根 |
| fork 日志暴涨 | 每个 fork 复制前缀；改用 spawn |

## 练习

1. 把 M08.3 的 `seed` 去掉，观察报错——这就是契约在起作用。
2. fork 一个已有 fork，看 `inheritedEventCount` 是累加还是重置。
3. 给 M08.5 的 `delegationDepth` 设成 `maxDepth + 1`，观察哪一步拒绝。
