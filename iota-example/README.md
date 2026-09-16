# iota-example：DSH 能力方向的 iota 对照 · 13 课自学课程

与 `dsh-example/M01–M12` 同编号、同目录名的 Python 示例工程，使用本地 editable 安装的
iota-core `2026.9.8`，对比两个框架在工具、上下文、会话和任务编排等 12 个方向上的实现。
各模块说明可复用的能力、需要补充的机制，以及由内核或宿主负责的功能。

这套工程配了 **13 课自学课程**：`lessons/00` 教你跑通环境，`lessons/01`–`lessons/12` 每个模块一课。
每课都包含**真实运行输出**、**机制原理**、**常见排障**和**动手练习**，可以脱离讲师自学；
同编号的 DSH 侧教材在 `dsh-example/lessons/`，两边可以逐课对读。

工程包含 12 个模块、60 个可跑阶段，**阶段编号与 `dsh-example` 一一对齐**（含三个 `.d` 专项演示）：同一个编号在两边指向同一个控制面，所以两边的日志可以逐行对读。
每个模块只有一个入口 `run.py`（阶段清单），每个阶段指向 `scenes/` 下的一个场景脚本，可复用
实现放在 `impl/`，编排与输出收敛在共享的 `runtime/`。

同一个编号下，iota 这边要么给出**语义等价**的机制，要么给出**结构性边界**的可运行证据
（例如"编排层没有这个注册面，能力归内核"），不会为了凑齐编号编造能力。

---

## 从哪开始

**第一次来**：按顺序读 [`lessons/00-getting-started.md`](lessons/00-getting-started.md)，
跑通 M12，再回到这份 README 挑路线。

**想建立直觉**（约 15 分钟，3 个模块）：

```bash
cd iota-example && uv sync --extra dev --extra real
uv run python -m runtime.learn --tour   # M01 工具管线 → M02 上下文装配 → M03 推理服务
```

**想按目标挑**：

| 我现在想做什么 | 学哪几课 | 直接运行 |
|---|---|---|
| 看清一层包装能做到哪、做不到哪 | [01](lessons/01-tool-pipeline.md) | `uv run python -m runtime.runner M01` |
| 管住"哪些内容进入下一轮" | [02](lessons/02-context-assembly.md) | `uv run python -m runtime.runner M02` |
| 换内核 / 看事件流协议 | [03](lessons/03-inference-service-access.md) | `uv run python -m runtime.runner M03` |
| 看懂一轮运行，在节点边界干预 | [04](lessons/04-agent-loop-intervention.md) | `uv run python -m runtime.runner M04` |
| 分清"发生过的事"与"内核看到的事" | [05](lessons/05-session-surface.md) | `uv run python -m runtime.runner M05` |
| 看清无人值守时权限如何闭合 | [06](lessons/06-human-in-the-loop.md) | `uv run python -m runtime.runner M06` |
| 确认副作用归内核，输入只有工作目录 | [07](lessons/07-execution-backends.md) | `uv run python -m runtime.runner M07` |
| 让委派顺序在编译期就确定 | [08](lessons/08-delegation-presets.md) | `uv run python -m runtime.runner M08` |
| 做幂等、可恢复的长任务 | [09](lessons/09-long-running-orchestration.md) | `uv run python -m runtime.runner M09` |
| 用数据资产和协议接入外部能力 | [10](lessons/10-external-capabilities.md) | `uv run python -m runtime.runner M10` |
| 管配置投影，不碰凭证 | [11](lessons/11-config-data-infrastructure.md) | `uv run python -m runtime.runner M11` |
| 理解 effect 栈与注册表纪律 | [12](lessons/12-framework-mechanisms.md) | `uv run python -m runtime.runner M12` |

---

## 13 课清单

每课的结构一致：**本课任务 → 真实输出 → 机制原理 → 排障 → 代码在哪 → 动手练习**。

| 课 | 模块 | 一句话任务 | 命令 | 阶段数 |
|---|---|---|---|---|
| [00 跑起来](lessons/00-getting-started.md) | — | 跑通环境，看懂验收契约 | `uv run python -m runtime.runner M12` | — |
| [01 工具管线](lessons/01-tool-pipeline.md) | M01 | 一层具名可逆包装能做什么、不能做什么 | `uv run python -m runtime.runner M01` | 6 |
| [02 上下文装配](lessons/02-context-assembly.md) | M02 | 作用域记忆代替装配治理链 | `uv run python -m runtime.runner M02` | 6 |
| [03 推理服务接入](lessons/03-inference-service-access.md) | M03 | 替换单元是整个 KernelAdapter，能力声明编译期兑现 | `uv run python -m runtime.runner M03` | 2 |
| [04 循环干预](lessons/04-agent-loop-intervention.md) | M04 | 先观察，再干预：节点边界与编译期校验 | `uv run python -m runtime.runner M04` | 5 |
| [05 会话面](lessons/05-session-surface.md) | M05 | 两条存储协议，不承诺 seq/surface | `uv run python -m runtime.runner M05` | 5 |
| [06 人在环路](lessons/06-human-in-the-loop.md) | M06 | 权限必答、fail closed，其余归内核或宿主 | `uv run python -m runtime.runner M06` | 6 |
| [07 执行侧后端](lessons/07-execution-backends.md) | M07 | 副作用归内核，工作目录是唯一输入 | `uv run python -m runtime.runner M07` | 5 |
| [08 委派与预设](lessons/08-delegation-presets.md) | M08 | 显式 DAG：roster 与模型路由都写出来 | `uv run python -m runtime.runner M08` | 4 |
| [09 长任务与编排](lessons/09-long-running-orchestration.md) | M09 | 幂等键、租约与 checkpoint 序号 | `uv run python -m runtime.runner M09` | 4 |
| [10 外部能力接入](lessons/10-external-capabilities.md) | M10 | 数据改变作答：Skill、MCP 与运行时注册 | `uv run python -m runtime.runner M10` | 6 |
| [11 配置与数据设施](lessons/11-config-data-infrastructure.md) | M11 | 配置投影成真实文件，凭证只来自环境 | `uv run python -m runtime.runner M11` | 6 |
| [12 框架机制本体](lessons/12-framework-mechanisms.md) | M12 | 可逆 effect、身份安全与配置叠加 | `uv run python -m runtime.runner M12` | 5 |

---

## 快速开始

要求 Python `>=3.11,<3.14`；iota-core `2026.9.8` 以本地 editable source 装配
（`pyproject.toml` 的 `[tool.uv.sources]` 指向 `../../../codingx/petite/sources/iota-core`）。

```bash
uv sync --extra dev --extra real
uv run python -m runtime.runner --all
```

### 运行模式

模块通过 `ClaudeAdapter` 调用 Claude Agent SDK 和 Claude Code CLI，连接 MiniMax 或 Fuyao 的 Anthropic 兼容端点。
运行需要配置凭证、安装 `claude-agent-sdk`，并确保 `claude` CLI 位于 `PATH`。

| 命令 | 行为 |
|---|---|
| `uv run python -m runtime.runner MXX` | 运行单个模块的全部阶段，成功时输出 `REAL_MODULE_OK`。 |
| `uv run python MXX-name/run.py` | 同上，按路径运行模块入口（入口会把工程根加进 `sys.path`）。 |
| `uv run python -m MXX-name.run --scene <场景>` | 只跑阶段清单里的一个场景。 |
| `uv run python -m runtime.runner --all` | 先检查运行环境，输出 `REAL_PREFLIGHT_OK`，再依次运行 12 个模块；全部成功时输出 `REAL_ALL_OK`。 |
| `uv run python -m runtime.learn --list` | 精选学习入口（带导读三段：目标、观察点、收获）。 |
| `uv run python -m runtime.learn --tour` | 路线：M01 → M02 → M03。 |

两种 `-m` 形式要求工作目录是 `iota-example/`（`-m` 从当前目录解析模块）；`uv run python MXX-name/run.py` 在任何目录下都能跑 —— 入口按文件位置解析工程根，`.env` 也一样。

配置从工程根 `.env` 读取，该文件已加入 git 忽略规则。统一配置项为
`LLM_API_KEY / LLM_VENDOR / LLM_BASE_URL / LLM_MODEL`，兼容旧 `ANTHROPIC_*` 键。
`preflight()` 检查凭证、SDK 和 CLI；缺少依赖时抛出 `KernelUnavailable` 并提示配置方法，
未知 `IOTA_PROVIDER` 也会在模块启动前报错。模块运行需要连接模型服务，不支持离线模式。

传给内核子进程的凭证、端点和模型分别使用 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL` 和
`ANTHROPIC_MODEL`；此外设置固定的安全与兼容开关。三档默认模型别名统一指向配置的模型。
Fuyao 子进程禁用 thinking，以避免工具结果之后回放无签名 reasoning。

### 日志骨架（与 dsh-example 逐行对齐）

```text
████ M01 · 工具管线：包装、拒绝与可见性归属 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M01.1 · 注册包装与 effect 回收 ────
   installed = [lookup]
   …
REAL_STAGE_OK M01.1 calls=1 ms=3820 in=12 out=9 finish=success

REAL_MODULE_OK M01 stages=6 calls=7 failed=0
```

阶段分两类，与 dsh 同一套口径：`mechanism` 阶段先用完整装配链打一次真实内核 probe（证明这条
装配链能把内核回答送回运行记录），再跑本地机制断言；`model` 阶段由场景自己调用内核。
每个阶段都必须留下真实调用证据，否则输出 `REAL_STAGE_FAIL` 并以非零状态退出；空回答最多重试
3 次，仍为空即失败，不会换用其他模型。教学正文（目标、三类边界、结论）都在各模块 README 和
`lessons/` 课件里，运行日志只留骨架。

`--all` 在独立子进程中运行各模块，隔离注册表与事件循环状态；任一模块失败即停止，全部通过时末行输出 `REAL_ALL_OK modules=12 stages=60 provider=anthropic-compat`。

⏱️ 全量真实运行会发起 60 次以上内核请求（每个 mechanism 阶段一次 probe），按当前端点通常需要几十分钟。只想看某个控制面时用 `--scene`；自学时按课节单独跑对应模块，不要用 `--all`。

### 一条不是错误的输出

```text
[claude-code:unrecognized_model] {"model":"fuyao-coding","query_source":"sdk"}
```

这行来自 Claude Code CLI：`MiniMax-M3` / `fuyao-coding` 不在它自带的模型目录里，所以它按
200k 上下文窗口保守处理。请求照常发出、照常作答，模块仍会输出 `REAL_MODULE_OK`。
想让它闭嘴要么升级 Claude Code，要么按它的提示给出真实窗口
（`CLAUDE_CODE_MAX_CONTEXT_TOKENS=<窗口>`）—— 本工程不替供应商编一个窗口值。

真正会让运行失败的是另外几种输出：缺配置抛 `KernelUnavailable`、场景断言失败抛
`TeachingCheckError`（带期望值与实际值）、内核连续 3 次返回空文本。

## 能力索引

| 模块 | 方向 | 阶段 | 对照关系 | 示例内容 |
|---|---|---|---|---|
| [M01](M01-tool-pipeline/README.md) | 工具管线 | 6 | 机制补齐 + 结构性边界 | 包装注册/回收 → 执行前拒绝 → 结果变换 → 可见性归内核 → 非单调守卫 → 内核自主调用工具 |
| [M02](M02-context-assembly-economics/README.md) | 上下文装配与经济学 | 6 | 语义等价 + 结构性边界 | 作用域记忆前缀 → 装配归内核 → 压缩归内核 → 内核报告 token → 历史开关 → 记忆写回代替 spill |
| [M03](M03-inference-service-access/README.md) | 推理服务接入 | 2 | 结构性边界 | 替换单元是 KernelAdapter + 模型 middleware 编译期拒绝 → 同一消费循环接真实事件流 |
| [M04](M04-agent-loop-intervention/README.md) | Agent 循环与干预面 | 5 | 语义等价 + 结构性边界 | 事件子序列 → 无 mid-turn 注入 → 节点 hook → 运行账本 → 未注册引用编译期拒绝 |
| [M05](M05-session-surface/README.md) | 会话面 | 5 | 语义等价 + 结构性边界 | 会话按序持久化 → 可换消息存储 → 语料检索 → 运行记录读回 → 无 seq/surface 承诺 |
| [M06](M06-human-in-the-loop/README.md) | 人在环路 | 6 | 语义等价 + 结构性边界 | 命令归内核 → 权限必答 → fail closed → 计划模式归宿主 → 待办按能力声明 → 反馈归宿主 |
| [M07](M07-execution-backends/README.md) | 执行侧后端 | 5 | 结构性边界 | 内核执行副作用 → 工具结果证据 → 沙箱归内核 → 空 shell 注册表 → 工作目录是唯一输入 |
| [M08](M08-delegation-presets/README.md) | 委派与预设 | 4 | 语义等价 | 编译拓扑顺序 → 空 roster → 上游绑定与运行 → 具名 ModelProfile 路由 |
| [M09](M09-long-running-orchestration/README.md) | 长任务与编排 | 4 | 语义等价（iota 提供更多耐久语义） | 租约 claim/ack → 幂等入队 → worker 由调用方驱动 → checkpoint 序号 |
| [M10](M10-external-capabilities/README.md) | 外部能力接入 | 6 | 语义等价 | Skill 同步 → MCP 往返 → Host plane 归宿主 → 运行时注册工具 → 默认模型路由 → 数据改变作答 |
| [M11](M11-config-data-infrastructure/README.md) | 配置与数据设施 | 6 | 语义等价 + 结构性边界 | 配置投影 → 运行存储协议 → 凭证附件归宿主 → 投影布局 → 凭证来自环境 → 拒绝不支持布局 |
| [M12](M12-framework-mechanisms/README.md) | 框架机制本体 | 5 | 语义等价 + 结构性边界 | LIFO 与终局 → 跨真实运行的可逆 Provider → 定义期能力校验 → 身份安全 disposer → 配置分层 |

### 三种对照关系怎么判定

按可观察能力、实现方式和责任归属区分以下三类关系，一个模块可以同时涉及多类。

| 关系 | 什么时候用 | 示例 |
|---|---|---|
| **语义等价** | 两侧用不同结构实现相同可观察能力 | 作用域记忆、会话存储、节点委派等 |
| **机制补齐** | iota-core 已提供通用机制，编排层补出可运行路径 | M01 使用公开的 `ToolPipeline` 扩展编排层工具槽 |
| **结构性边界** | 能力属于具体内核或宿主 | 模型请求中间件、历史压缩、计划模式等；责任归属见对照表中的架构决策引用 |

## 统一阅读方法

12 个模块结构相同，与 `dsh-example` 一一对应：

```text
iota-example/
  README.md       本页（课程首页：路线、13 课清单、能力索引）
  lessons/        13 课自学教材（00 环境 + 01–12 每模块一课）
  docs/           DSH 与 iota 的逐模块证据表（dsh-vs-iota.md）
  MXX-name/
    README.md     对照关系、目标、文件关系、阶段表、完整链路与边界
    run.py        运行入口：阶段清单（编号、标题、场景脚本名）
    scenes/*.py   一个阶段一个场景脚本：async def run(harness) 返回观察到的事实
    impl/*.py     该模块可复用的实现（网关、图、任务素材……）
  runtime/
    harness.py    配置、内核装配、模块元数据与断言
    runner.py     编排入口：读阶段清单、内核证据、逐阶段输出；--all 用 12 个隔离子进程
    learn.py      精选学习入口：--list / --tour / --module
    typecheck.sh  共享层一次 + 12 个模块各一次的类型检查
```

模块目录名带连字符（与 `dsh-example` 同名），不是合法 Python 包名，所以模块内部统一用顶层
`impl.*` / `scenes.*` 导入：`runtime/runner.py` 把模块目录设为导入根，和直接运行 `run.py`
时的形状一致。

建议按以下顺序阅读一个模块：

1. 先读对应课件 `lessons/NN-*.md`：本课任务、真实输出、机制原理、排障与动手练习。
2. 运行 `uv run python -m runtime.runner MXX`，按 banner 与 `REAL_STAGE_OK` 逐阶段核对事实，
   再打开 `dsh-example` 同编号阶段的输出对读。
3. 只读对应的 `scenes/*.py`，文件名就是这个阶段的名字。
4. 需要理解可复用部分时读 `impl/*.py`，需要理解装配时读 `runtime/harness.py`。
5. 最后回到 [`docs/dsh-vs-iota.md`](docs/dsh-vs-iota.md) 的同编号行，看 DSH 事实与 iota 证据逐条对位。

## 架构与能力边界

- **内核替换**：`KernelAdapter` 是替换单元。ACP 不支持的模型 middleware 在编译期被拒绝。
- **共享运行时**：12 个模块复用 `runtime/harness.py`。断言失败时抛出包含期望值和实际值的 `TeachingCheckError`。
- **事件顺序**：按子序列校验标准事件，允许不同内核在其间插入自有事件。
- **内核能力**：工具可见性与执行前政策（M01）、完整 Prompt 装配与历史压缩（M02）、单次模型调用 middleware（M03）、mid-turn 注入（M04）由具体内核负责。
- **会话与宿主**：iota 的日志模型与 DSH seq/surface 不同（M05）；计划模式（M06）、fs/shell/sandbox（M07）、凭证与附件（M11）由内核或宿主管理。
- **框架机制**：M12 使用 effect 和注册表；Cordis 的事件总线、Proxy Context 与运行期热替换不在示例范围内。
- **工具权限**：默认使用空工具表及显式 `disallowed_tools`。M07 开启 `Bash`，在一次性临时工作目录中演示内核执行命令。
- **输出脱敏**：响应与事件中的密钥、端点和本地路径会被过滤。

## 检查与测试

```bash
uv run ruff check .                          # E/F/I/UP/B，行宽 100
./runtime/typecheck.sh                       # 共享层 + 12 个模块，末行 IOTA_TYPECHECK_OK
uv run python -m runtime.surface_coverage    # 覆盖面统计，门槛 45
uv run pytest -q                             # 阶段清单门禁、启动错误、文档引用与输出脱敏
uv run python -m runtime.runner --all       # 末行 REAL_ALL_OK
```

pytest 不调用模型：它检查**阶段编号与 dsh 的 `run.ts` 逐一相等**、阶段与 `scenes/` 文件一一
对应、只有执行侧演示能打开内核 shell、模块目录与 DSH 同名、README 覆盖每个编号、对照表锚点
真实存在，以及缺少内核或配置时会失败。`runtime.runner --all` 连接模型服务，检查全部 12 个
模块、60 个阶段的运行结果。

## 常见误解对照表

写这套对照的过程本身是一次**保真度审计**。以下是读 iota 时最容易搞错的直觉，每条都有
可运行证据（场景断言或真实运行输出），详见对应课节：

| 直觉 | 真实情况 | 详见 |
|---|---|---|
| 给工具装一层"守卫" stage 就能拦住危险调用 | 通用包装不是单调守卫：外层包装能把内层拒绝改写成成功（`rescued = audit:rescued`） | [第 01 课](lessons/01-tool-pipeline.md) |
| `AgentConfig.tools` 是编排层的授权清单 | 它只是给内核的**请求**清单；编排层注册面为空，披露由内核裁定 | [第 01 课](lessons/01-tool-pipeline.md) |
| 想压缩历史/裁剪结果，在编排层配一下就行 | `AgentConfig` 里没有这些字段；装配与压缩归内核，iota 治理的是"哪些内容进入下一轮" | [第 02 课](lessons/02-context-assembly.md) |
| 给节点配了模型 middleware 就能生效 | ACP 内核不声明的能力，图编译期就抛 `GraphValidationError`，不进运行 | [第 03 课](lessons/03-inference-service-access.md) |
| 往进行中的一轮里插一条消息，像 DSH 那样有 inbox | iota 的干预面只在节点边界；进行中的一轮属于内核 | [第 04 课](lessons/04-agent-loop-intervention.md) |
| 在 iota 事件里能找到 `seq`/`surface` 字段 | `TextDeltaEvent` / `FinalEvent` 没有这些字段；iota 不承诺 DSH 的投影语义 | [第 05 课](lessons/05-session-surface.md) |
| 权限请求没人应答，先放行或先跳过 | 匹配不到选项时抛 `KernelError`——fail closed；策略在部署期声明 | [第 06 课](lessons/06-human-in-the-loop.md) |
| 在编排层加一道 shell 黑名单更安全 | fs/shell/sandbox 一层都不属于 iota：工具注册表为空，副作用归内核 | [第 07 课](lessons/07-execution-backends.md) |
| 委派交给模型自由发挥 | 顺序来自 `depends_on`，拓扑序在编译期冻结；roster 与模型路由都显式注册 | [第 08 课](lessons/08-delegation-presets.md) |
| 任务入队了就会有人来跑 | 队列不自带 worker：没人 claim 就一直 pending，worker 由调用方驱动 | [第 09 课](lessons/09-long-running-orchestration.md) |
| 编排层挂一个 webhook/上传入口 | Host plane 归宿主；Registry 注册面里没有这类能力 | [第 10 课](lessons/10-external-capabilities.md) |
| `AgentConfig` 直接带上凭证更方便 | `AgentConfig` 不伪造 credential/attachment 字段；凭证只来自环境 | [第 11 课](lessons/11-config-data-infrastructure.md) |
| iota 是 Cordis 的 Python 移植 | 只借可逆 effect 与注册表；事件总线、Proxy Context 与运行期热替换不在范围 | [第 12 课](lessons/12-framework-mechanisms.md) |

## 与其他文档集的分工

| 位置 | 回答的问题 | 形态 |
|---|---|---|
| [`docs/hello-dsh/`](../docs/hello-dsh/README.md) | DSH 源码怎么实现、在哪一行 | 按章节编排的长文 |
| [`dsh-example/`](../dsh-example/README.md) | 同编号方向在 DSH 怎么亲手跑一遍 | 13 课自学教材 + 可执行示例 |
| **`iota-example/`（本目录）** | 同编号方向在 iota 怎么对位、边界在哪 | 13 课自学教材 + 可执行对照 |
| [`docs/dsh-vs-iota.md`](docs/dsh-vs-iota.md) | 每个编号两侧的证据逐条对位 | 带源码锚点的对照表 |
| [`docs/hello-dsh/12-iota-cross-framework-comparison.md`](../docs/hello-dsh/12-iota-cross-framework-comparison.md) | 两个框架的架构级对照 | 分析长文 |

---

**开始** → [第 00 课 · 跑起来](lessons/00-getting-started.md) ｜ **最短路线** → `uv run python -m runtime.learn --tour`
