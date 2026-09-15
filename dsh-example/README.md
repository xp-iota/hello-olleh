# DeepSeek Harness 调研

本工程直接使用发布版 `@deepseek-ai/dsh-*` **0.1.5-rc.2** 与真实 Cordis 运行时，包含 12 个能力方向模块。

![12 个方向模块的拓扑](../docs/hello-dsh/diagrams/12-example-topology.svg)

交互版：[12-example-topology.html](../docs/hello-dsh/diagrams/12-example-topology.html) · IR：[12-example-topology.architecture.json](../docs/hello-dsh/diagrams/12-example-topology.architecture.json) · 结构测量：[OKF graphify reference](../docs/okf/references/01-graphify-dsh-example.md)

工程包含 12 个模块、60 个可跑阶段（57 个场景脚本 + 3 个内联演示），通过注册、事件、服务和数据四种方式扩展 DSH。
各模块共享 `runtime/harness.ts` 的服务装配；Provider 实现推理协议适配，压缩与沙箱后端由对应模块提供。

- 图谱包含 584 个节点、744 条边、45 个社区，其中 739 条边为 `EXTRACTED`，5 条为 `INFERRED`。
- 60 个阶段包括 57 个 `scenes/` 场景脚本和 3 个内联演示，均调用模型服务。
- `createHarness` 统一装配运行时服务；Node 最低版本为 22.18，DSH 固定为 `0.1.5-rc.2`。

图谱测量方法与关系类型见 [建图结果](../docs/okf/references/01-graphify-dsh-example.md)。

## 快速开始

要求 Node >= 22.18；当前工程锁定 DSH `0.1.5-rc.2`。运行任何模块都需要 `LLM_API_KEY`。

```bash
npm install
npm run typecheck
npm run coverage:surfaces
npm test
npm run M01             # 运行一个方向模块
npm run all             # 顺序运行全部 12 个模块
npm run learn -- --list
```

### 运行模式

各模块的阶段清单位于 `run.ts`；每个阶段要么指向一个 `scenes/` 场景脚本，要么是 `run.ts` 内联的演示。

| 命令 | 行为 |
|---|---|
| `npm run MXX` | 真实推理服务请求，`provider=anthropic-compat`。需 `LLM_API_KEY`。 |
| `npm run all` | 12 个模块、60 个阶段依次运行。 |

模块运行需要连接模型服务。缺少 `LLM_API_KEY` 时会报错并提示配置来源
（工程根 `.env`，模板见 `.env.example`）。

```bash
npm run M01            # M01 的 6 个阶段，逐阶段 REAL_STAGE_OK
npm run all            # 60 个阶段，末行 REAL_ALL_OK
```

模型交互阶段直接检查调用结果；注册、回收、队列和状态机等阶段先发送一次探测请求，
检查装配链能否把模型响应写入会话日志，再运行本地机制断言。阶段结束时若没有成功调用，进程非零退出。

三个模型交互演示（模型自主调用工具 / 真实流消费 / 清单注入对照）已并入各模块的阶段清单，
在 M01/M03/M10 里各占一个内联阶段：

```bash
npm run M01   # 含 M01.d：模型自主调用 word_count
npm run M03   # 含 M03.d：同一 StreamChunk 消费循环接真实 SSE
npm run M10   # 含 M10.d：注入 SKILL.md 前后的真实作答对照
```

所有阶段都需要 `LLM_API_KEY`，会向外部服务发送教学请求；不要把内部地址、分支名或敏感数据放入请求。

## 能力索引

| 模块 | 方向 | 示例内容 | 扩展路径 |
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

| 路径 | 什么时候用 | 接入方式 |
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
  README.md       模块说明、观察点和边界
  impl/*.ts      一种能力一个实现（Provider 侧）；通常可独立 ctx.plugin()
  scenes/*.ts     对应能力的可运行观察脚本（Consumer 侧）；按"这次观察什么"命名，不与 impl 重名
  run.ts          运行入口：阶段清单；M01/M03/M10 还内联模型交互阶段
  support/assets  共享协议 helper 或数据资产（按需）
```

建议按以下顺序阅读一个模块：

1. 先读 README，明确各阶段责任边界。
2. 运行 `npm run MXX`，按 banner 观察事实。
3. 只读对应 `impl/*.ts`，看标准 Cordis 插件或数据能力形状。
4. 需要理解装配时再读 `runtime/harness.ts`；它是全工程唯一装配枢纽。
5. 最后回到 `scenes/*.ts`，看测试数据和边界场景如何驱动能力。文件名就是这个场景的名字，所以不必先比对 `impl/` 的名字。

## 架构

- 能力通过 Context 服务、事件和 effect 接入，插件卸载时统一回收资源。
- 所有模块复用 `runtime/harness.ts`，各 `impl/` 实现可单独复用。
- 场景断言失败时进程非零退出；缺少安全后端时拒绝执行。
- 事件日志保存原始记录，surface 提供模型可见的上下文投影。

## 未包含的能力

- `client` / `web` / `desktop` 与 `fileUploads` 属于 Host plane，由宿主提供。
- `typert` / `api-gateway` / Host-Remote 传输链随 UI 宿主延后。
- `e2b` / `code-runtime` 需要外部账号，本工程未集成。
- `experimental/agent-team` 接口仍处实验期；`lsp` 需要真实语言服务器，本工程未集成。
- `identity` / `guard` 不单独开模块；`feedback` 已纳入 M06。

## 检查与测试

```bash
npm run typecheck          # 所有 run/impl/scenes/support 对真实 .d.ts 编译
npm run coverage:surfaces # 核心 25 + 扩展面 34 = 59，门槛 ≥50
npm test                   # SDK 冒烟测试 + MiniMax wire 协议；缺密钥时真实用例 skip
npm run all                # 60 个阶段真实推理服务验收，末行 REAL_ALL_OK
```

服务与能力缝统一按公开扩展面计数；Provider 选择、拒绝路径和显式排除均在各模块 README 的“边界”中说明。复杂 Host plane 不进入核心 harness。
