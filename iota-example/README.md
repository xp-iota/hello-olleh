# iota-example：DSH 能力方向的 iota 对照

与 `dsh-example/M01–M12` 同编号、同目录名的 Python 对照工程：直接消费本地 editable 的
iota-core `2026.9.8`，在"整内核替换"路线下逐模块复核 DSH 的 12 个能力方向。它不把 iota
伪装成 DSH —— 每个模块直接标注**语义等价**、**机制补齐**或**结构性边界**，不使用过程
批次号；逐条 `项目/文件::锚点` 证据见 [`docs/dsh-vs-iota.md`](docs/dsh-vs-iota.md)。

## 数字证据：全部由 pytest 钉死

本 README 的模块数量、对照行数、边界行数与输出契约都由离线测试强制成立，不靠正文手算：

| 断言 | 校验位置 |
|---|---|
| 12 个模块，目录名与 `dsh-example` 逐一相同 | `tests/test_modules.py::test_exactly_twelve_modules_match_dsh_names` |
| 对照表 12 行，每行 ≥3 条 `项目/文件::锚点` 证据 | `tests/test_docs.py::test_comparison_has_twelve_evidenced_rows` |
| 每条证据的文件与锚点文本同时真实存在 | `tests/test_docs.py::test_every_evidence_file_and_anchor_exist` |
| 结构性边界恰好 9 行，每行必须引用 `iota-core/docs/architecture/` 决策 | `tests/test_docs.py::test_every_structural_boundary_cites_architecture_decision` |
| 12 个模块 README 都声明对照关系，不回退过程批次号 | `tests/test_docs.py::test_every_module_readme_has_semantic_relationship` |
| 每个模块离线独立 exit 0，输出目标/观察/结论三段与 `IOTA_MODULE_OK` | `tests/test_modules.py::test_module_exits_zero` |
| 离线模式 socket 出网即抛 `OfflineViolation` | `tests/test_offline.py` |
| 未知 provider 被拒、缺凭证 fail loud、`minimax` 不退化 `echo`、证据不含密钥 | `tests/test_real.py` |

## 快速开始

要求 Python `>=3.11,<3.14`；iota-core `2026.9.8` 以本地 editable source 装配
（`pyproject.toml` 的 `[tool.uv.sources]` 指向 `../../../codingx/petite/sources/iota-core`）。

```bash
env -u PYTHONHOME -u PYTHONPATH uv venv --python 3.13
env -u PYTHONHOME -u PYTHONPATH uv sync --extra dev --offline
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner --all
```

### 三种运行模式

| 模式 | 命令 | 是什么 |
|---|---|---|
| **offline**（默认） | `python -m runtime.runner MXX` / `python -m runtime.runner --all` | 确定性机制断言。`EchoKernelAdapter`（真实 `KernelAdapter` 子类，确定性事件、零 I/O）+ 进程内 socket 断网守卫。末行 `IOTA_MODULE_OK` / `IOTA_ALL_OK`。 |
| **real** | `python -m runtime.runner MXX --real` | 单模块接 MiniMax/Fuyao Anthropic-compatible 内核，末行 `IOTA_REAL_MODULE_OK`。 |
| **all:real** | `python -m runtime.runner --all --real` | 12 个模块全部真实验收；preflight 先行并打印 `IOTA_REAL_PREFLIGHT_OK`，末行 `IOTA_REAL_ALL_OK`。 |

默认就是离线，离线**不会**悄悄升级；`--real` 也**不会**静默退回 `echo` ——
`preflight()` 在任何场景启动前检查凭证、`claude-agent-sdk` 与 `claude` CLI，缺任何
一项立即抛出 `KernelUnavailable`，写明配置来源（工程根 `.env`，已被 git 忽略）与
补齐方法；`IOTA_PROVIDER` 拼错同样当场报错。

真实模式的替换单位是**整个内核**：复用 `iota_core.adapters.claude.ClaudeAdapter`，把它
驱动的 Claude Code CLI 指向 MiniMax 或 Fuyao 的 Anthropic 兼容端点。编排层代码与模型无关，进入
内核子进程的凭证、端点和模型只通过三个变量（`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` /
`ANTHROPIC_MODEL`）传递；其余仅有固定安全/兼容开关。三档默认模型别名被钉到同一模型，
内核无法静默退回内置默认模型。
项目配置统一使用 `LLM_API_KEY / LLM_VENDOR / LLM_BASE_URL / LLM_MODEL`，同时兼容旧
`ANTHROPIC_*` 键。Fuyao 子进程显式禁用 thinking，避免工具结果之后回放无签名 reasoning。

```bash
# 真实模式依赖（Claude Agent SDK + PATH 上的 claude CLI）
env -u PYTHONHOME -u PYTHONPATH uv sync --extra dev --extra real

env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M07 --real
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner --all --real
```

真实模式下每个模块先在场景入口用完整装配链打一次真实 probe：打印真实模型、真实内核
（SDK + CLI）、脱敏后的真实响应与事件序列。空文本最多重试 3 次，仍为空则非零退出
——重试同一个真实内核不是降级，静默接受空答或退回 `echo` 才是。probe 通过后同一套
编排层断言照跑，末尾打印三类边界：Anthropic-compatible kernel 行为 / iota 编排层本地机制
断言 / 明确不属于 iota 的内核能力。

`run_all` 把 12 个模块跑成 12 个独立子进程：注册与事件循环状态不跨模块泄漏，任一
模块非零退出即整体失败。

## 能力索引

| 模块 | 方向 | 对照关系 | 完整发生了什么 |
|---|---|---|---|
| [M01](M01-tool-pipeline/README.md) | 工具管线 | 机制补齐 + 结构性边界 | `guard`/`audit` 具名 stage 嵌套 → 重复安装幂等 → 错名 stage 抛 `UnknownStageError` → effect 回收恢复原 handler |
| [M02](M02-context-assembly-economics/README.md) | 上下文装配与经济学 | 语义等价 + 结构性边界 | user/project/session 作用域记忆 → `MemoryContextService` 注入 Prompt 前缀 → 默认开关 → 不伪造 compression seam |
| [M03](M03-inference-service-access/README.md) | 推理服务接入 | 结构性边界 | Provider 注册粒度 → ACP capability 声明 → 不支持的模型 middleware 编译期拒绝 |
| [M04](M04-agent-loop-intervention/README.md) | Agent 循环与干预面 | 语义等价 + 结构性边界 | `AgentEvent` 子序列顺序 → `after_node_result` hook → mid-turn 注入排除在编排契约外 |
| [M05](M05-session-surface/README.md) | 会话面 | 语义等价 + 结构性边界 | `ConversationStore` 有序消息 → `RunStore` 状态与事件 → 不承诺 DSH seq/surface 不变量 |
| [M06](M06-human-in-the-loop/README.md) | 人在环路 | 语义等价 + 结构性边界 | 无匹配策略 fail closed → permission 必定答复 → plan mode 归宿主 |
| [M07](M07-execution-backends/README.md) | 执行侧后端 | 结构性边界 | `kernel.shell` 事件 → 工具结果事件 → 编排层 shell registry 为空即边界证据 |
| [M08](M08-delegation-presets/README.md) | 委派与预设 | 语义等价 | `GraphSpec` 依赖与绑定 → 确定拓扑顺序 → 图运行结果 |
| [M09](M09-long-running-orchestration/README.md) | 长任务与编排 | 语义等价（iota 提供更多耐久语义） | 幂等入队 → 租约 claim/ack → checkpoint sequence |
| [M10](M10-external-capabilities/README.md) | 外部能力接入 | 语义等价 | `SKILL.md` 同步 → 进程内 MCP `tools/list` → `tools/call` 往返 |
| [M11](M11-config-data-infrastructure/README.md) | 配置与数据设施 | 语义等价 + 结构性边界 | profile 真实投影 → 不支持布局拒绝 → 存储协议可替换 |
| [M12](M12-framework-mechanisms/README.md) | 框架机制本体 | 语义等价 + 结构性边界 | effect LIFO 拆除 → 幂等 dispose → 身份安全 disposer → entry-point Provider 发现 |

### 三种对照关系怎么判定

这三类是对"同一能力方向两侧是什么关系"的判定，不是过程批次号；一个模块可以同时带两类。

| 关系 | 什么时候用 | 本工程里的判定信号 |
|---|---|---|
| **语义等价** | 两侧用不同结构实现相同可观察能力 | 同一套断言在 echo 与 MiniMax/Fuyao 内核下都成立 |
| **机制补齐** | iota-core 已提供通用机制，编排层补出可运行路径 | 只消费公开机制，不冒充内核内部能力（M01 的 `ToolPipeline`） |
| **结构性边界** | 能力属于具体内核或宿主 | 明确拒绝伪装成 iota 拥有；必须引用 `iota-core/docs/architecture/` 决策原文（pytest 强制 9 行） |

实操顺序：先判定可观察能力是否一致；不一致再区分是"实现路径不同"（机制补齐）还是
"所有权在内核/宿主"（结构性边界）；结构性边界必须能落到架构决策文档的具体章节，
否则不成立。

## 统一阅读方法

每个模块同一结构，全工程共享一个 `runtime/`：

```text
MXX-name/
  README.md       对照关系、目标、观察点、边界与结论
  lesson_mXX.py   唯一场景文件：async def run(harness) 返回机器可读事实
runtime/
  harness.py  唯一装配枢纽：环境、双内核、断网守卫、模块元数据与 fail-loud 断言
  runner.py   单模块/--all 入口：场景 → 断言 → 证据；全量时用 12 个隔离子进程
```

建议按以下顺序阅读一个模块：

1. 先读 README，明确对照关系与能力边界。
2. 运行 `python -m runtime.runner MXX`，按"目标 → 运行时观察 → 验证结果 → 结论"四段输出核对事实。
3. 只读 `lesson_mXX.py`，看 `require` 如何把期望钉在真实 API 上。
4. 需要理解装配时再读 `runtime/harness.py`；它是全工程唯一装配枢纽，echo 与 MiniMax/Fuyao 共用一条链。
5. 最后回到 [`docs/dsh-vs-iota.md`](docs/dsh-vs-iota.md) 的同编号行，看 DSH 事实与 iota 证据逐条对位。

## 架构纪律

- **整内核替换而非 middleware**：换模型 = 换整个 `KernelAdapter`，编排层一行不改；ACP 不支持的模型 middleware 在编译期拒绝，不仿造 DSH 的 LLM middleware。
- **一个装配枢纽**：12 个模块复用 `runtime/harness.py`，不复制 runtime；两个 provider 只差 adapter 构建参数。
- **进程隔离**：`run_all` 逐模块起子进程，注册与事件循环状态不跨模块泄漏，任一非零即停。
- **离线与真实路径分离**：默认离线且断网守卫 fail closed；真实模式必须显式 `--real` 或 `IOTA_PROVIDER=anthropic-compat`，拼错 provider 当场失败。
- **fail loud / fail closed**：事实不符抛带"期望/实际"的 `TeachingCheckError`；缺凭证、缺 SDK、缺 CLI 在场景启动前失败；probe 空文本重试有界，仍空非零退出；任何路径都不静默退回 `echo`。
- **事件断言按子序列**：不同内核会在标准事件之间插入自己的事件，顺序断言写成子序列包含，避免场景只在 echo 内核下成立。
- **证据脱敏**：真实模式打印的响应与事件不含密钥、端点或本地路径，由 `tests/test_real.py` 钉死。

## 边界与显式排除

- 内核内部工具可见性收窄与执行前策略（M01）、Prompt 完整装配与历史压缩（M02）、单次模型调用 middleware（M03）、进行中循环的 mid-turn 注入（M04）属于具体内核，iota 不伪造对应 seam。
- DSH 的 seq/surface 日志不变量（M05）、计划模式（M06）、fs/shell/sandbox 执行栈（M07）属于内核或宿主；不为不同日志模型硬造 seam。
- 凭证与附件归宿主，不塞进 `AgentConfig`（M11）。
- Cordis 的事件总线、Proxy Context 与运行期热替换不搬（M12）——借机制，不搬架构。
- 真实模式默认以空工具表 + 显式 `disallowed_tools` 启动内核，内核摸不到文件系统与 shell；只有 M07 为证明"shell 由内核拥有"而打开 `Bash`，且限制在一次性临时工作目录。
- 每条真实 probe 短而确定（回答 ≤40 字），结论不寄托在模型创造力上。

## 验证门禁

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/ruff check .   # E/F/I/UP/B，行宽 100
env -u PYTHONHOME -u PYTHONPATH .venv/bin/mypy           # 显式文件清单，disallow_untyped_defs
env -u PYTHONHOME -u PYTHONPATH .venv/bin/pytest -q      # 模块逐个可跑、断网守卫、文档锚点、真实模式纪律
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner --all         # offline，末行 IOTA_ALL_OK
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner --all --real  # all:real，末行 IOTA_REAL_ALL_OK
```

`tests/test_real.py` 全程离线，它验证的是真实模式的纪律而不是模型输出：未知 provider
被拒绝、缺凭证时报错并指出配置来源、`minimax` 不退化成 `echo`、只有三个配置变量进入
内核、脱敏后不含密钥。`tests/test_docs.py` 逐条解析对照表锚点并验证文件与锚点文本
同时存在——文档漂移会红灯，而不是悄悄过时。
