# iota-example

与 `dsh-example/M01–M12` 同编号、同模块名的 Python 教学工程。它不把 iota 伪装成 DSH：每个模块直接标注“语义等价”“教学补齐”或“结构性边界”，不使用过程批次号。详细逐条证据见 [`docs/dsh-vs-iota.md`](docs/dsh-vs-iota.md)。

## 运行基线

- Python `>=3.11,<3.14`
- iota-core `2026.9.8`，本地 editable source：`../../../codingx/petite/sources/iota-core`
- 默认全离线；模块进程安装 socket connect fail-closed guard
- 唯一装配枢纽：`runtime/harness.py`
- 离线内核：`runtime/kernel_echo.py` 中真实 `KernelAdapter` 子类

```bash
env -u PYTHONHOME -u PYTHONPATH uv venv --python 3.13
env -u PYTHONHOME -u PYTHONPATH uv sync --extra dev --offline
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.run_all
```

## M01–M12

| 模块 | 对齐 | 一句话观察 |
|---|---|---|
| [M01 工具管线](M01-tool-pipeline/) | 教学补齐 + 结构性边界 | ToolPipeline 补齐；不接管内核工具可见性 |
| [M02 上下文装配与经济学](M02-context-assembly-economics/) | 语义等价 + 结构性边界 | MemoryContext 等价；压缩留在内核 |
| [M03 推理服务接入](M03-inference-service-access/) | 结构性边界 | iota 换整个 KernelAdapter，ACP 拒绝模型 middleware |
| [M04 Agent 循环与干预面](M04-agent-loop-intervention/) | 语义等价 + 结构性边界 | AgentEvent/node hook 等价；不补运行中 inbox |
| [M05 会话面](M05-session-surface/) | 语义等价 + 结构性边界 | ConversationStore/RunStore 等价；不补 DSH 日志不变量 |
| [M06 人在环路](M06-human-in-the-loop/) | 语义等价 + 结构性边界 | ACP permission 等价；planMode 留给 harness |
| [M07 执行侧后端](M07-execution-backends/) | 结构性边界 | fs/shell/sandbox 由内核执行侧拥有 |
| [M08 委派与预设](M08-delegation-presets/) | 语义等价 | GraphSpec 节点委派对位 SubagentProvider |
| [M09 长任务与编排](M09-long-running-orchestration/) | 语义等价（iota 提供更多耐久语义） | iota 另有 queue/checkpoint/recovery |
| [M10 外部能力接入](M10-external-capabilities/) | 语义等价 | Skill 数据 + MCP server |
| [M11 配置与数据设施](M11-config-data-infrastructure/) | 语义等价 + 结构性边界 | profile/store/gateway 等价；凭证附件属宿主 |
| [M12 框架机制本体](M12-framework-mechanisms/) | 语义等价 + 结构性边界 | 可逆 effect 等价；不搬事件总线/HMR/intercept |

## 单模块运行

所有模块通过同一个教学运行器启动，例如：

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M03
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M12
```

运行时先输出学习目标、观察点和结论，随后输出结构化 JSON 与 `IOTA_MODULE_OK <目录名>`。任何出网尝试会抛出 `OfflineViolation`。

## 质量闸门

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/ruff check .
env -u PYTHONHOME -u PYTHONPATH .venv/bin/mypy
env -u PYTHONHOME -u PYTHONPATH .venv/bin/pytest -q
```
