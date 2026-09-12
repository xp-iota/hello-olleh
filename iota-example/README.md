# iota-example

与 `dsh-example/M01–M12` 同编号、同模块名的 Python 教学工程。它不把 iota 伪装成 DSH：每个模块用类 A/B/C 徽标区分“已有等价能力”“经 ToolPipeline 补齐”“结构性边界”。详细逐条证据见 [`docs/dsh-vs-iota.md`](docs/dsh-vs-iota.md)。

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
| [M01 工具管线](M01-tool-pipeline/) | B + C | ToolPipeline 补齐；不接管内核工具可见性 |
| [M02 上下文装配与经济学](M02-context-assembly-economics/) | A + C | MemoryContext 等价；压缩留在内核 |
| [M03 推理服务接入](M03-inference-service-access/) | C | iota 换整个 KernelAdapter，ACP 拒绝模型 middleware |
| [M04 Agent 循环与干预面](M04-agent-loop-intervention/) | A + C | AgentEvent/node hook 等价；不补运行中 inbox |
| [M05 会话面](M05-session-surface/) | A + C | ConversationStore/RunStore 等价；不补 DSH 日志不变量 |
| [M06 人在环路](M06-human-in-the-loop/) | A + C | ACP permission 等价；planMode 留给 harness |
| [M07 执行侧后端](M07-execution-backends/) | C | fs/shell/sandbox 由内核执行侧拥有 |
| [M08 委派与预设](M08-delegation-presets/) | A | GraphSpec 节点委派对位 SubagentProvider |
| [M09 长任务与编排](M09-long-running-orchestration/) | A（反向） | iota 另有 queue/checkpoint/recovery |
| [M10 外部能力接入](M10-external-capabilities/) | A | Skill 数据 + MCP server |
| [M11 配置与数据设施](M11-config-data-infrastructure/) | A + C | profile/store/gateway 等价；凭证附件属宿主 |
| [M12 框架机制本体](M12-framework-mechanisms/) | A + C | 可逆 effect 等价；不搬事件总线/HMR/intercept |

## 单模块运行

每个目录都有独立 `run.py`，例如：

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M03-inference-service-access/run.py
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M12-framework-mechanisms/run.py
```

成功时输出结构化 JSON 与 `IOTA_MODULE_OK <目录名>`。任何出网尝试会抛出 `OfflineViolation`。

## 质量闸门

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/ruff check .
env -u PYTHONHOME -u PYTHONPATH .venv/bin/mypy
env -u PYTHONHOME -u PYTHONPATH .venv/bin/pytest -q
```
