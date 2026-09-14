# M01 · 工具管线

工具不是孤立函数，而是从**注册与发现**、**按 Agent 披露**、**执行前裁决**到**执行后变换与审计**的完整管线。

## 学习目标

区分“模型能看见”“模型能调用”“调用结果怎样呈现”三个控制面，并理解它们为何不应写死在工具实现中。

## 运行

```bash
npm run M01            # 真实 MiniMax（默认）；需要 LLM_API_KEY，会发起网络请求
npm run M01 -- --mock  # 离线确定性机制；不联网、不需要密钥
```

## 先看文件关系：只分成“编排、场景、实现”三层

```text
dsh-example/package.json
└─ npm run M01
   └─ M01-tool-pipeline/run.ts                 # 编排：列出要运行的阶段，本身不实现工具机制
      └─ ../runtime/real.ts · runModule()       # 按 real/mock 模式逐个 import 阶段文件
         ├─ phases/01-register-and-dispose.ts  ──加载──▶ steps/01-word-count.ts
         ├─ phases/02-deny-bash-call.ts        ──加载──▶ steps/02-permission-gate.ts
         ├─ phases/03-append-model-notice.ts   ──加载──▶ steps/01-word-count.ts
         │                                             + steps/03-result-transform.ts
         ├─ phases/04-narrow-visible-set.ts    ──加载──▶ steps/04-tool-restrict.ts
         ├─ phases/05-guard-overrides-allow.ts ──加载──▶ steps/05-tool-guard.ts
         └─ real/word-count-minimax.ts         ──加载──▶ steps/01-word-count.ts
                                                    （仅真实模式，模型自主发起调用）

phases/* 和 real/*
└─ 都复用 ../runtime/harness.ts                 # 装配真实 dsh 服务，提供 loadPlugin/callTool/runTurn
```

各类文件只记住下面四句话：

| 文件 | 职责 | 是否先读 |
|---|---|---|
| `run.ts` | 总目录/播放列表：决定阶段顺序和 real/mock 分流 | 是 |
| `phases/*.ts` | 可执行的观察场景：准备条件、加载插件、触发调用、打印结果 | 是 |
| `steps/*.ts` | 真正要学习和复用的 Cordis 插件实现，不是独立主入口 | 对照对应 phase 读 |
| `real/*.ts` | 真实模型专项验收；区别是让模型自己决定并发起工具调用 | 最后读 |

实际调用顺序是：

```text
npm script → run.ts → runModule() 动态导入某个 phase
→ phase 调 createHarness() → phase 调 loadPlugin(step)
→ phase 用 callTool() 直接触发机制
→ pre-execute → guard → execute → post-execute → result 审计
```

`M01.d` 是唯一不同的一段：它用 `runTurn()` 把工具 schema 给真实 MiniMax，由模型产出 tool-call，再由同一条工具管线执行并把结果回灌给模型。

## 最短玩法

1. 先运行 `npm run M01 -- --mock`，不联网地看完 1～5 段输出。
2. 只读第一对文件：先看 `phases/01-register-and-dispose.ts` 怎么“演”，再看 `steps/01-word-count.ts` 怎么“实现”。
3. 按同样方式读 `02 phase → 02 step`，依次看到权限门、结果变换、可见性和最终守卫。
4. 配好真实模型后再运行 `npm run M01`，最后观察 `real/word-count-minimax.ts` 中模型是否自主调用 `word_count`。

只想离线跑一个场景时，可在项目根目录执行：

```bash
DSH_MOCK=1 node M01-tool-pipeline/phases/01-register-and-dispose.ts
```

## 阶段与观察点

| 阶段 | 类型 | 实现 | 观察场景 | 观察什么 |
|---|---|---|---|---|
| 1 注册 | 教学主线 | `steps/01-word-count.ts` | `phases/01-register-and-dispose.ts` | `defineTool`、结构化 value、模型可见 content、Fiber dispose 反注册 |
| 2 权限门 | 教学主线 | `steps/02-permission-gate.ts` | `phases/02-deny-bash-call.ts` | `tools/pre-execute` 的 allow/deny/ask 与 fail-closed |
| 3 结果变换 | 教学主线 | `steps/03-result-transform.ts` | `phases/03-append-model-notice.ts` | post-execute 改模型可见结果但不破坏 canonical value |
| 4 可见性 | 教学主线 | `steps/04-tool-restrict.ts` | `phases/04-narrow-visible-set.ts` | `agent.ctx.tools.restrict` 的单向收紧和 effect 归属 |
| 5 守卫 | 教学主线 | `steps/05-tool-guard.ts` | `phases/05-guard-overrides-allow.ts` | guard 在 pre-execute 之后做不可翻案的最终拒绝 |
| M01.d 专项演示 | 真实专属 | `real/word-count-minimax.ts` | — | 模型**自主决定**调用 word_count（需 `LLM_API_KEY`） |

## 完整链路

1. 注册表建立工具 schema 与执行函数，并把注册绑定到插件 Fiber。
2. Agent Context 通过 restrict 缩小可见集合，不改变全局工具定义。
3. 模型发起调用后，pre-execute 权限门先给出策略决策。
4. 单调 guard 负责不可被后续 allow 覆盖的安全底线。
5. 执行结果保留规范值，同时可改写模型可见 content 并发送审计事件。

## 边界

`run.ts` 只做教学编排；所有阶段复用 `runtime/harness.ts`，不复制运行时。

**结论：**工具能力由多个正交控制面组合，扩展它们不需要修改 AgentLoop。
