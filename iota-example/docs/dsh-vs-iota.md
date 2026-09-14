# DSH 与 iota：M01–M12 逐模块证据表

## 判定口径

- **语义等价**：两侧用不同结构实现相同可观察能力。
- **机制补齐**：示例消费 iota-core 已提供的通用机制，在编排层补出可运行路径。
- **结构性边界**：能力属于具体内核或宿主；iota 明确拒绝伪装成自己拥有。
- 证据使用 ``项目/文件::符号或章节``，避免行号随排版变化而漂移。校验脚本会同时验证文件和锚点文本。

## 对照表

| 模块 | DSH 事实 | iota 对照 | 可运行证明 | 架构边界 |
|---|---|---|---|---|
| **M01 工具管线** | 注册、pre/post、restrict、guard 分层：`dsh-example/M01-tool-pipeline/README.md::阶段与观察点` | **机制补齐 + 结构性边界**：`ToolPipeline` 提供具名可逆 stage：`iota-core/src/iota_core/tool_pipeline.py::class ToolPipeline` | `iota-example/M01-tool-pipeline/lesson_m01.py::async def run` | 只借机制，不搬内核工具栈：`iota-core/docs/architecture/pluggability-cordis-alignment.md::借机制，不搬架构` |
| **M02 上下文装配与经济学** | section、assembly、compaction 连成治理链：`dsh-example/M02-context-assembly-economics/README.md::完整链路` | **语义等价 + 结构性边界**：作用域记忆由 `MemoryContextService` 构建：`iota-core/src/iota_core/memory/context.py::class MemoryContextService` | `iota-example/M02-context-assembly-economics/lesson_m02.py::async def run` | 模型请求 middleware 属于内核能力：`iota-core/docs/architecture/node-hooks.md::节点 Hook 与模型 Middleware` |
| **M03 推理服务接入** | Adapter 与流中间件正交：`dsh-example/M03-inference-service-access/README.md::完整链路` | **结构性边界**：iota 的替换单元是整个 `KernelAdapter`：`iota-core/src/iota_core/adapters/base.py::class KernelAdapter` | `iota-example/M03-inference-service-access/lesson_m03.py::async def run` | ACP 不支持的 middleware 在编译期拒绝：`iota-core/docs/architecture/node-hooks.md::引用语法与校验` |
| **M04 Agent 循环与干预面** | 事件、hook、inbox 是稳定边界：`dsh-example/M04-agent-loop-intervention/README.md::完整链路` | **语义等价 + 结构性边界**：标准 `AgentEvent` 与节点 hook 可观察编排：`iota-core/src/iota_core/types.py::AgentEvent` | `iota-example/M04-agent-loop-intervention/lesson_m04.py::async def run` | mid-turn 状态仍由内核拥有：`iota-core/docs/architecture/node-hooks.md::执行顺序` |
| **M05 会话面** | 事实日志与模型 surface 分层：`dsh-example/M05-session-surface/README.md::完整链路` | **语义等价 + 结构性边界**：`ConversationStore` 保存有序消息：`iota-core/src/iota_core/storage/conversation_store.py::class ConversationStore` | `iota-example/M05-session-surface/lesson_m05.py::async def run` | 不为不同日志模型硬造 seam：`iota-core/docs/architecture/pluggability-cordis-alignment.md::一个角色不构成 seam` |
| **M06 人在环路** | 命令与审批是显式协议：`dsh-example/M06-human-in-the-loop/README.md::完整链路` | **语义等价 + 结构性边界**：ACP Adapter 必须闭合 permission：`iota-core/src/iota_core/adapters/dsh_acp.py::class DshAcpAdapter` | `iota-example/M06-human-in-the-loop/lesson_m06.py::async def run` | 未答复请求会挂死整轮：`iota-core/docs/architecture/kernel-replacement.md::会挂死整轮` |
| **M07 执行侧后端** | fs、shell、sandbox 形成执行链：`dsh-example/M07-execution-backends/README.md::完整链路` | **结构性边界**：iota 只消费内核返回的工具事件：`iota-core/src/iota_core/types.py::class ToolCallStartEvent` | `iota-example/M07-execution-backends/lesson_m07.py::async def run` | 不在编排层重写 cordis 执行栈：`iota-core/docs/architecture/kernel-replacement.md::cordis 路线` |
| **M08 委派与预设** | Provider 与模型入口显式解耦：`dsh-example/M08-delegation-presets/README.md::完整链路` | **语义等价**：`GraphSpec` 的依赖与绑定表达节点委派：`iota-core/src/iota_core/graph/types.py::class GraphSpec` | `iota-example/M08-delegation-presets/lesson_m08.py::async def run` | 图编译保持确定拓扑：`iota-core/src/iota_core/graph/compiler.py::class GraphCompiler` |
| **M09 长任务与编排** | Job 与 Goal 分离运行和意图：`dsh-example/M09-long-running-orchestration/README.md::完整链路` | **语义等价（iota 提供更多耐久语义）**：`GraphTask` 带租约、attempt 和状态：`iota-core/src/iota_core/graph/task_queue.py::class GraphTask` | `iota-example/M09-long-running-orchestration/lesson_m09.py::async def run` | checkpoint 显式保存恢复序列：`iota-core/src/iota_core/graph/checkpoint.py::def build_checkpoint` |
| **M10 外部能力接入** | Skill 与 Host 协议分层：`dsh-example/M10-external-capabilities/README.md::完整链路` | **语义等价**：`sync_skills` 投影知识资产：`iota-core/src/iota_core/skill_sync.py::def sync_skills` | `iota-example/M10-external-capabilities/lesson_m10.py::async def run` | MCP 用独立 server 协议：`iota-core/src/iota_core/mcp/server.py::class IotaMcpServer` |
| **M11 配置与数据设施** | schema、storage、credential、workspace 分层：`dsh-example/M11-config-data-infrastructure/README.md::完整链路` | **语义等价 + 结构性边界**：Profile 由 Adapter projector 解析：`iota-core/src/iota_core/config_profiles/manager.py::class ConfigProfileManager` | `iota-example/M11-config-data-infrastructure/lesson_m11.py::async def run` | DSH 不登记 iota-managed profile：`iota-core/docs/architecture/kernel-replacement.md::不登记 dsh` |
| **M12 框架机制本体** | dispatch 与 Fiber 定义组合纪律：`dsh-example/M12-framework-mechanisms/README.md::完整链路` | **语义等价 + 结构性边界**：`EffectStack` 提供 LIFO 可逆回收：`iota-core/src/iota_core/effects.py::class EffectStack` | `iota-example/M12-framework-mechanisms/lesson_m12.py::async def run` | 借机制但不复制 Proxy/Fiber 架构：`iota-core/docs/architecture/pluggability-cordis-alignment.md::借机制，不搬架构` |

## 可复现命令

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner --all
env -u PYTHONHOME -u PYTHONPATH .venv/bin/pytest -q
env -u PYTHONHOME -u PYTHONPATH .venv/bin/ruff check .
env -u PYTHONHOME -u PYTHONPATH .venv/bin/mypy
```
