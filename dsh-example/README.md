# DeepSeek Harness 调研

本工程直接使用发布版 `@deepseek-ai/dsh-*` **0.1.5-rc.2** 与真实 Cordis 运行时，包含 12 个能力方向模块。

![12 个方向模块的真实拓扑](../docs/hello-dsh/diagrams/12-example-topology.svg)

交互版：[12-example-topology.html](../docs/hello-dsh/diagrams/12-example-topology.html) · IR：[12-example-topology.architecture.json](../docs/hello-dsh/diagrams/12-example-topology.architecture.json) · 结构测量：[OKF graphify reference](../docs/okf/references/01-graphify-dsh-example.md)

## 数字证据：全部从 IR 复算

本 README 的工程数量、覆盖门槛、图谱数字与版本门槛都固化在 topology IR，不靠正文手算。JSON Pointer 以 IR 根对象为起点：

| 断言 | IR JSON Pointer |
|---|---|
| 13 个扫描根、169 文件、584 节点、744 边、45 社区 | `/cards/0/items/0`、`/cards/0/items/1` |
| 739 条 `EXTRACTED`、5 条 `INFERRED` | `/cards/0/items/2` |
| 12 个模块；58 steps + 58 phases | `/cards/1/items/0` |
| 3 条真实 Provider 路径；默认 12 个模块全部离线 | `/cards/1/items/1` |
| 覆盖 59，门槛 ≥ 50 | `/cards/1/items/2` |
| `createHarness` 匹配 1 个；度数 66 = 入 62 + 出 4 | `/cards/2/items/0` |
| 4 条扩展路径：按注册、按事件、按服务、按数据 | `/cards/2/items/1` |
| Node ≥ 22.18；DSH 精确锁定 `0.1.5-rc.2` | `/cards/2/items/2` |

IR 的四个左侧组件分别承载四条扩展路径；`hub`、`runtime`、`providers`、`openSeams` 组件承载唯一枢纽、真实服务、Provider 分路与留空 seam。图谱数字的关系类型、可信度和复现命令见 OKF reference。

## 快速开始

要求 Node >= 22.18；当前工程锁定 DSH `0.1.5-rc.2`。

```bash
npm install
npm run typecheck
npm run coverage:surfaces
npm test
npm run M01       # 运行一个方向模块
npm run all       # 顺序运行全部 12 个离线模块
npm run learn -- --list
```

### 三种运行模式

| 模式 | 命令 | 是什么 |
|---|---|---|
| **offline** | `npm run all` / `npm run MXX` | 确定性机制测试。全部走 `runtime/llm-mock.ts`，不联网、不需要密钥。 |
| **real** | `npm run MXX:real` | 单模块真实 MiniMax 请求。`DSH_REAL=1` 固定 `provider=minimax-m3`。 |
| **all:real** | `npm run real:all`（同 `npm run all:real`） | 完整真实验收：12 个模块、58 个阶段全部输出 `REAL_STAGE_OK`。 |

`npm run all` 不会隐式发起真实请求，真实模式也不会静默退回 mock —— 缺 `MINIMAX_API_KEY`
时立即失败并说明配置来源（工程根 `.env`，模板见 `.env.example`）。

```bash
npm run M01:real   # M01 的 5 个阶段，逐阶段 REAL_STAGE_OK
npm run real:all   # 58 个阶段 + 3 个专项演示，末行 REAL_ALL_OK
```

真实模式下每个阶段都必须留下真实调用证据：模型-facing 阶段由 MiniMax 驱动；纯注册、回收、
队列、状态机阶段保留本地机制断言，并在**阶段入口**用完整装配链打一次真实 probe，证明这条链
真的能把模型响应送回会话日志。阶段结束时若没有成功调用，进程非零退出。

三个专项真实演示（模型自主调用工具 / 真实流消费 / 清单注入对照）：

```bash
npm run M01:real-demo  # 模型自主调用 word_count
npm run M03:real-demo  # 同一 StreamChunk 消费循环接真实 SSE
npm run M10:real-demo  # 注入 SKILL.md 前后的真实作答对照
```

三条真实路径都需要 `MINIMAX_API_KEY`，会向外部服务发送教学请求；不要把内部地址、分支名或敏感数据放入请求。

## 能力索引

| 模块 | 方向 | 完整发生了什么 | 扩展路径 |
|---|---|---|---|
| [M01](M01-tool-pipeline/README.md) | 工具管线 | 注册/回收 → 披露收紧 → pre 权限 → 单调 guard → post 变换 | 注册、事件 |
| [M02](M02-context-assembly-economics/README.md) | 上下文装配与经济学 | section/variable → compaction → token meter → pruner → spill | 注册、服务 |
| [M03](M03-inference-service-access/README.md) | 推理服务接入 | Adapter 路由 → StreamChunk 消费 → `llm/stream` 包装 | 服务、事件 |
| [M04](M04-agent-loop-intervention/README.md) | Agent 循环与干预面 | 生命周期遥测 → steering → inbox → session telemetry/invariants | 事件、服务 |
| [M05](M05-session-surface/README.md) | 会话面 | 日志/surface → persistence/query/projection/cache/title | 服务、事件 |
| [M06](M06-human-in-the-loop/README.md) | 人在环路 | command/approval → questions/plan/todo/feedback | 注册、事件、服务 |
| [M07](M07-execution-backends/README.md) | 执行侧后端 | fs/subprocess → shell/terminal → sandbox/provider policy | 服务、事件 |
| [M08](M08-delegation-presets/README.md) | 委派与预设 | subagent Provider → agent/permission preset → 模型选择 | 服务、注册 |
| [M09](M09-long-running-orchestration/README.md) | 长任务与编排 | Job/Goal → workflowEngine → schedule | 注册、服务、事件 |
| [M10](M10-external-capabilities/README.md) | 外部能力接入 | Skill → MCP → Webhook Host 边界 → Cordis extensions/default model | 数据、注册、服务 |
| [M11](M11-config-data-infrastructure/README.md) | 配置与数据设施 | settings → storage/domain → attachment/reference → credential/auth/workspace | 注册、服务 |
| [M12](M12-framework-mechanisms/README.md) | 框架机制本体 | dispatch/timer → Fiber 状态机 → isolate realm → intercept 配置链 | 事件、服务 |

### 四条扩展路径怎么选

这四类来自 DSH 官方“新行为放哪”的定位方式，不是按目录互斥分组；一个模块可以同时走多条路径。

| 路径 | 什么时候用 | 本工程里的判定信号 |
|---|---|---|
| **按注册** | 向已有 registry 增加工具、命令、任务、preset 或配置项 | 调用 `register()`，并把 disposer 交给 Cordis effect 回收 |
| **按事件** | 在请求、step、turn、工具、会话或文件行为发生时观测/拦截 | 使用 `ctx.on`、`ctx.before` 或 waterfall；不 fork 主循环 |
| **按服务** | 增加或替换一条能力 seam | Definition、Provider、Consumer 三角色完整；Provider 与 Consumer 只依赖 Definition |
| **按数据** | 给模型增加可发现、可渲染的能力说明 | `SKILL.md` 作为数据资产被发现/注册/渲染/注入，内容变化不改主循环 |

实操顺序：先判断只是内容还是机制；机制扩展再判断已有 registry/event 是否足够；只有需要可替换后端时才新建 service seam，并同时设计 Definition、Provider、Consumer。

## 统一阅读方法

每个模块都采用同一结构：

```text
MXX-name/
  README.md       一条完整方向叙事、观察点和结论
  index.ts        按命名空间聚合，避免插件导出名冲突
  steps/*.ts      一种能力一个实现；通常可独立 ctx.plugin()
  phases/*.ts     对应能力的可运行观察场景
  run.ts          只负责分阶段 banner 与顺序编排
  real/           可选真实 provider 路径，不进离线 all
  support/assets  共享协议 helper 或数据资产（按需）
```

建议按以下顺序阅读一个模块：

1. 先读 README，明确各阶段责任边界。
2. 运行 `npm run MXX`，按 banner 观察事实。
3. 只读对应 `steps/*.ts`，看标准 Cordis 插件或数据能力形状。
4. 需要理解装配时再读 `runtime/harness.ts`；它是全工程唯一装配枢纽。
5. 最后回到 `phases/*.ts`，看测试数据和边界场景如何驱动能力。

## 架构纪律

- **插件而非 fork 主循环**：能力通过 Context 服务、事件和 effect 接入。
- **一个装配枢纽**：所有模块复用 `runtime/harness.ts`，不复制 runtime。
- **目录整合、文件保粒度**：模块讲完整方向，step 仍可独立复制。
- **离线与真实路径分离**：默认全跑不需要密钥、不发网络请求。
- **fail loud / fail closed**：教学断言失败时直接非零退出；安全 seam 缺失时不静默降级。
- **日志与 surface 分离**：事件保存事实，模型上下文使用可治理投影。

## 边界与显式排除

- `client` / `web` / `desktop` 与 `fileUploads` 属于 Host plane，不塞进核心 harness。
- `typert` / `api-gateway` / Host-Remote 传输链随 UI 宿主延后。
- `e2b` / `code-runtime` 需要外部账号，不满足默认离线门禁。
- `experimental/agent-team` 接口仍处实验期；`lsp` 需要真实语言服务器，装配成本高于教学收益。
- `identity` / `guard` 不单独开模块；`feedback` 已纳入 M06。

## 验证门禁

```bash
npm run typecheck          # 所有 steps/phases/real/support 对真实 .d.ts 编译
npm run coverage:surfaces # 核心 25 + 扩展面 34 = 59，门槛 ≥50
npm test                   # runtime 离线回归
npm run all                # 12 个模块逐个 exit 0（离线 mock）
npm run test               # 离线单测，含 MiniMax wire 协议与真实模式纪律
npm run real:all           # 58 个阶段真实 MiniMax 验收，末行 REAL_ALL_OK
```

服务与能力缝统一按公开扩展面计数；Provider 选择、拒绝路径和显式排除均在各模块 README 的“边界”中说明。默认 `all` 保持离线，复杂 Host plane 不进入核心 harness。
