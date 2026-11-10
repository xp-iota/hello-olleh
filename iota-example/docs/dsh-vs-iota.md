# DSH 与 iota：M01–M12 逐模块证据表

> 逐课自学教材见 [`lessons/`](../lessons/00-getting-started.md)（00 环境课 + 01–12 每模块一课）；
> 同编号的 DSH 侧教材是 `dsh-lab` 各模块的 `README.md`。本表是"凭什么这么说"的证据账本。

## 判定口径

- **语义等价**：两侧用不同结构实现相同可观察能力。
- **机制补齐**：示例消费 iota-core 已提供的通用机制，在编排层补出可运行路径。
- **结构性边界**：能力由具体内核或宿主提供，不属于 iota 编排层接口。
- 证据使用 ``项目/文件::符号或章节``，避免行号随排版变化而漂移。`tests/test_docs.py` 会同时验证
  `iota-core` / `iota-example` 两类证据的文件与锚点文本；`dsh-lab` 一侧的锚点不在该脚本当前的匹配
  范围内，按同一 ``文件::章节`` 格式人工核对。
- **编号对齐**：两边各 12 个模块、60 个阶段，同属一套编号；同一个编号指向同一个控制面。
  但模块内的阶段分布不逐一相等——iota 侧另有三个 `.d` 专项演示（`M01.d` / `M03.d` / `M10.d`），
  `dsh-lab` 侧的 `model` 阶段则是 `M03.3` / `M04.1` / `M04.2`。
  iota 那一侧要么给出语义等价机制，要么给出"能力归内核/宿主"的可运行证据。
  > 门禁已对齐：`tests/test_stages.py` 现按模块编号读 `dsh-lab/MXX-*/index.ts`，
  > 并把上面 6 个模块的阶段分布差异显式登记在 `KNOWN_STAGE_DIVERGENCE`——两侧总数都是 60。
- **日志对齐**：两边都打印同名的两条证据行 `REAL_STAGE_OK <阶段号>` 与 `REAL_MODULE_OK <模块号>`。
  其余是 iota 侧独有的：`████ MXX · 标题 ████` 模块 banner、`──── MXX.n · 标题 ────` 阶段分隔、
  `provider=… model=… timeout=…ms` 一行，以及 `REAL_STAGE_OK` 后面的 `calls` / `ms` / `in` / `out` /
  `finish` 字段。`dsh-lab` 的收尾行是 `全部通过：N 个阶段`，不是 `REAL_ALL_OK`。

## 对照表

| 模块 | DSH 事实 | iota 对照 | 运行示例 | 架构边界 |
|---|---|---|---|---|
| **M01 工具管线** | 注册、pre/post、restrict、guard 分层：`dsh-lab/M01-tool-pipeline/README.md::五个阶段各看什么` + `dsh-lab/M01-tool-pipeline/README.md::代码地图` | **机制补齐 + 结构性边界**：`ToolPipeline` 提供具名可逆 stage：`iota-core/src/iota_core/tool_pipeline.py::class ToolPipeline` | `iota-example/M01-tool-pipeline/run.py::STAGES` | 工具执行栈由内核负责：`iota-core/docs/develop/decisions/pluggability-cordis.md::借机制，不搬架构` |
| **M02 上下文装配与经济学** | section、assembly、compaction 连成治理链：`dsh-lab/M02-context-assembly-economics/README.md::四类贡献` + `dsh-lab/M02-context-assembly-economics/README.md::三条经济学防线` | **语义等价 + 结构性边界**：作用域记忆由 `MemoryContextService` 构建：`iota-core/src/iota_core/memory/context.py::class MemoryContextService` | `iota-example/M02-context-assembly-economics/run.py::STAGES` | 模型请求 middleware 属于内核能力：`iota-core/docs/develop/architecture/graph-node-hooks.md::节点 Hook 与模型 Middleware` |
| **M03 推理服务接入** | 适配器与路由分两层，`llm/stream` waterfall 环绕适配器：`dsh-lab/M03-inference-service-access/README.md::学习目标` + `dsh-lab/M03-inference-service-access/README.md::三个值得注意的地方` | **结构性边界**：iota 的替换单元是整个 `KernelAdapter`：`iota-core/src/iota_core/adapters/base.py::class KernelAdapter` | `iota-example/M03-inference-service-access/run.py::STAGES` | ACP 不支持的 middleware 在编译期拒绝：`iota-core/docs/develop/architecture/graph-node-hooks.md::引用语法与校验` |
| **M04 Agent 循环与干预面** | 事件订阅、回合边界与 inbox 三条通道是稳定边界：`dsh-lab/M04-agent-loop-intervention/README.md::三条 inbox 通道` + `dsh-lab/M04-agent-loop-intervention/README.md::现场事件` | **语义等价 + 结构性边界**：标准 `AgentEvent` 与节点 hook 可观察编排：`iota-core/src/iota_core/types.py::AgentEvent` | `iota-example/M04-agent-loop-intervention/run.py::STAGES` | mid-turn 状态仍由内核拥有：`iota-core/docs/develop/architecture/graph-node-hooks.md::执行顺序` |
| **M05 会话面** | 事实日志与模型 surface 分层：`dsh-lab/M05-session-surface/README.md::事件的结构` + `dsh-lab/M05-session-surface/README.md::三种读法` | **语义等价 + 结构性边界**：`ConversationStore` 保存有序消息：`iota-core/src/iota_core/storage/conversation_store.py::class ConversationStore` | `iota-example/M05-session-surface/run.py::STAGES` | 日志模型与 DSH 的 seq/surface 不同：`iota-core/docs/develop/decisions/pluggability-cordis.md::一个角色不构成 seam` |
| **M06 人在环路** | 命令与审批是显式协议：`dsh-lab/M06-human-in-the-loop/README.md::M06.1：命令与工具的区别` + `dsh-lab/M06-human-in-the-loop/README.md::M06.2：一个真实的 0.2.1 约束` | **语义等价 + 结构性边界**：ACP Adapter 必须闭合 permission：`iota-core/src/iota_core/adapters/dsh_acp.py::class DshAcpAdapter` | `iota-example/M06-human-in-the-loop/run.py::STAGES` | 未答复请求会挂死整轮：`iota-core/docs/develop/decisions/kernel-replacement.md::会挂死整轮` |
| **M07 执行侧后端** | fs、shell、sandbox 形成执行链：`dsh-lab/M07-execution-backends/README.md::三档沙箱` + `dsh-lab/M07-execution-backends/README.md::代码地图` | **结构性边界**：iota 只消费内核返回的工具事件：`iota-core/src/iota_core/types.py::class ToolCallStartEvent` | `iota-example/M07-execution-backends/run.py::STAGES` | 不在编排层重写 cordis 执行栈：`iota-core/docs/develop/decisions/kernel-replacement.md::cordis 路线` |
| **M08 委派与预设** | Provider 与模型入口显式解耦：`dsh-lab/M08-delegation-presets/README.md::spawn：独立子 agent` + `dsh-lab/M08-delegation-presets/README.md::预设` | **语义等价**：`GraphSpec` 的依赖与绑定表达节点委派：`iota-core/src/iota_core/graph/types.py::class GraphSpec` | `iota-example/M08-delegation-presets/run.py::STAGES` | 图编译保持确定拓扑：`iota-core/src/iota_core/graph/compiler.py::class GraphCompiler` |
| **M09 长任务与编排** | Job 与 Goal 分离运行和意图：`dsh-lab/M09-long-running-work/README.md::M09.1：job 的生产者契约` + `dsh-lab/M09-long-running-work/README.md::M09.2：目标` | **语义等价（iota 提供更多耐久语义）**：`GraphTask` 带租约、attempt 和状态：`iota-core/src/iota_core/graph/task_queue.py::class GraphTask` | `iota-example/M09-long-running-orchestration/run.py::STAGES` | checkpoint 显式保存恢复序列：`iota-core/src/iota_core/graph/checkpoint.py::def build_checkpoint` |
| **M10 外部能力接入** | Skill、指令文件、MCP 与网络四种形态分层：`dsh-lab/M10-external-capabilities/README.md::Skill：目录即能力` + `dsh-lab/M10-external-capabilities/README.md::MCP 的命名空间` | **语义等价**：`sync_skills` 投影知识资产：`iota-core/src/iota_core/skill_sync.py::def sync_skills` | `iota-example/M10-external-capabilities/run.py::STAGES` | MCP 用独立 server 协议：`iota-core/src/iota_core/mcp/server.py::class IotaMcpServer` |
| **M11 配置与数据设施** | storage 与 storageDomain 分层，凭据与附件各归其位：`dsh-lab/M11-config-data-durability/README.md::M11.1：两层存储` + `dsh-lab/M11-config-data-durability/README.md::M11.3：凭据` | **语义等价 + 结构性边界**：Profile 由 Adapter projector 解析：`iota-core/src/iota_core/config_profiles/manager.py::class ConfigProfileManager` | `iota-example/M11-config-data-infrastructure/run.py::STAGES` | DSH 不登记 iota-managed profile：`iota-core/docs/develop/decisions/kernel-replacement.md::不登记 dsh` |
| **M12 框架机制本体** | 可逆 effect 与 fiber 生命周期管理资源回收：`dsh-lab/M12-cordis-runtime/README.md::可逆 effect` + `dsh-lab/M12-cordis-runtime/README.md::装配树的规模` | **语义等价 + 结构性边界**：`EffectStack` 提供 LIFO 可逆回收：`iota-core/src/iota_core/effects.py::class EffectStack` | `iota-example/M12-framework-mechanisms/run.py::STAGES` | 提供 effect 与注册表，不含 Proxy/Fiber 架构：`iota-core/docs/develop/decisions/pluggability-cordis.md::借机制，不搬架构` |

### 模块名对照

同一编号在两边的**模块目录名**有三处不同：iota 侧沿用本工程的命名，DSH 侧是 `dsh-lab` 的现行命名。
下表的"iota 侧"列是 `iota-example/` 下的目录名，"DSH 侧"列是 `dsh-lab/` 下的目录名。

| 编号 | iota 侧（`iota-example/`） | DSH 侧（`dsh-lab/`） |
|---|---|---|
| M09 | `M09-long-running-orchestration` | `M09-long-running-work` |
| M11 | `M11-config-data-infrastructure` | `M11-config-data-durability` |
| M12 | `M12-framework-mechanisms` | `M12-cordis-runtime` |

其余九个模块的目录名两边一致（M01–M08、M10）。

### 阶段分布

| 编号 | iota 侧阶段 | DSH 侧（`dsh-lab`）阶段 |
|---|---|---|
| M01 | `M01.1`–`M01.5` + `M01.d` | `M01.1`–`M01.5` |
| M02 | `M02.1`–`M02.6` | `M02.1`–`M02.6` |
| M03 | `M03.1` + `M03.d` | `M03.1`–`M03.3` |
| M04 | `M04.1`–`M04.5` | `M04.1`–`M04.5` |
| M05 | `M05.1`–`M05.5` | `M05.1`–`M05.5` |
| M06 | `M06.1`–`M06.6` | `M06.1`–`M06.6` |
| M07 | `M07.1`–`M07.5` | `M07.1`–`M07.5` |
| M08 | `M08.1`–`M08.4` | `M08.1`–`M08.5` |
| M09 | `M09.1`–`M09.4` | `M09.1`–`M09.5` |
| M10 | `M10.1`–`M10.5` + `M10.d` | `M10.1`–`M10.5` |
| M11 | `M11.1`–`M11.6` | `M11.1`–`M11.5` |
| M12 | `M12.1`–`M12.5` | `M12.1`–`M12.5` |

## 可复现命令

```bash
# iota 侧
uv run python -m runtime.runner --all
uv run pytest -q
uv run ruff check .
uv run mypy

# DSH 侧（dsh-lab）
cd dsh-lab && npm run all        # 60 个阶段，需要 LLM_API_KEY（无离线回退）
cd dsh-lab && npm run M01        # 单个模块
```
