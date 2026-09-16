# 第 07 课 · 执行侧后端：副作用归内核，编排层只转发

> **本课任务**：用一条**不可猜测的证据**确认执行归内核——token 是本次运行才生成的，只有真的
> 执行过一次命令才读得到；再数清楚编排层在执行侧剩下的两件事：往内核工作目录放输入、
> 读内核回传的工具事件。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M07`
> **你将看到**：`kernel_tool_calls = [Bash]`，而 `orchestrator_shell_registry = []`——Bash 是
> 内核自带的，不在编排层注册表里；`execution_proof = token read by kernel`；装配面的全部
> 开关只有 `assembly_knobs = [allow_shell, timeout, workspace]`。

前置：[第 06 课 · 人在环路](06-human-in-the-loop.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见 [dsh-example/lessons/07-execution-backends.md](../../dsh-example/lessons/07-execution-backends.md)——那边讲 fs/shell/sandbox 五层可换后端，本课讲 iota 为什么一层都不拥有、剩下的两件事是什么。

---

## 1. 本课任务

DSH 把执行侧拆成 fs、subprocess、shell、terminal 与 sandbox **五层可换后端**：工具表达 I/O 意图，
执行 seam 选后端，沙箱把策略落到进程边界（dsh 第 07 课）。iota 这边的对照答案是**结构性边界**——
一层都不拥有：副作用由内核执行，编排层只转发提示词、观察工具事件。于是本课要回答两个问题：
怎么**证明**执行真的归内核（不是编排层替它做的），以及编排层在执行侧还剩下什么。

| DSH 控制面 | iota 侧机制 | 归属判定 |
|---|---|---|
| `ctx.fs`：文件读写后端 | 编排层只能往内核 cwd 写普通文件（M07.5：`input_channel = kernel cwd`） | **结构性边界**：fs 执行栈归内核 |
| `ctx.subprocess` / `ctx.shell`：进程与命令后端 | 没有——命令由内核自带 `Bash` 执行（M07.1/M07.2：`kernel_tool_calls = [Bash]`） | **结构性边界**：执行归内核 |
| `ctx.sandbox`：策略→可强制 argv，fail-closed | 装配面只有 `allow_shell` 一格开关；没有沙箱/策略注册面（M07.3：`sandbox_surface = []`） | **结构性边界**：许可是内核侧配置 |
| `ctx.terminals`：owner-scoped PTY 注册表 | 没有对位物 | **结构性边界** |
| 注册边界：一个 context 只留一个实现 | `registry.tools.list()` 为空（M07.4）——注册面压根没用上 | 边界的**负证据** |

数下来，编排层在执行侧剩下的只有**两件事**：往内核工作目录**放输入**（M07.5），
读内核回传的**工具事件**（M07.1/M07.2）。其余全部归内核。另外注意阶段类型：M07.1/M07.2 是
`model` 阶段（场景自己发起真实请求）；M07.3–M07.5 是 `mechanism` 阶段（本地断言之前先打一次
probe，见[第 00 课](00-getting-started.md)第 5 节），所以它们也各有 `calls=1`。

```bash
cd iota-example && uv run python -m runtime.runner M07
```

---

## 2. 真实输出

```text
████ M07 · 执行侧后端：副作用归内核，编排层只转发 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M07.1 · 内核执行副作用 ────
   kernel = claude
   kernel_tool_calls = [Bash]
   route = prompt -> KernelAdapter -> kernel tool events
REAL_STAGE_OK M07.1 calls=1 ms=7703 in=27961 out=188 finish=success tools=Bash "kernel-shell-995cb74c8d"

──── M07.2 · 消费工具结果与执行证据 ────
   tool_results = [True]
   execution_proof = token read by kernel
REAL_STAGE_OK M07.2 calls=1 ms=7716 in=27961 out=237 finish=success tools=Bash "kernel-shell-0366080a5b"

──── M07.3 · 沙箱策略是内核侧配置 ────
   assembly_knobs = [allow_shell, timeout, workspace]
   sandbox_surface = []
   policy_owner = kernel adapter configuration
REAL_STAGE_OK M07.3 calls=1 ms=1919 in=12240 out=133 finish=success

──── M07.4 · 编排层不注册 shell 工具 ────
   orchestrator_shell_registry = []
   execution_stack = kernel-owned
REAL_STAGE_OK M07.4 calls=1 ms=1724 in=12241 out=10 finish=success

──── M07.5 · 工作目录是唯一输入通道 ────
   workspace_file = m07-input.txt
   workspace_is_temporary = True
   input_channel = kernel cwd
REAL_STAGE_OK M07.5 calls=1 ms=1990 in=12240 out=10 finish=success

REAL_MODULE_OK M07 stages=5 calls=5 failed=0
```

**对照自己的输出**：末行必须精确是 `REAL_MODULE_OK M07 stages=5 calls=5 failed=0`。再核四处
关键信号：M07.1/M07.2 的 `REAL_STAGE_OK` 行都带 `tools=Bash`，行尾引号里是本次运行生成的
token（形如 `kernel-shell-` 加 10 位十六进制，每次都不同）；M07.3 的
`assembly_knobs = [allow_shell, timeout, workspace]` 与 `sandbox_surface = []` 成对出现；
M07.4 的 `orchestrator_shell_registry = []`。`ms=` / `in=` / `out=` 的数字随端点浮动，不影响
结论；但 M07.1 若丢了 `tools=Bash`，阶段会在场景断言处失败（第 3 节），不会静默通过。
（`[claude-code:unrecognized_model]` 行已略去——它是什么，见[第 00 课](00-getting-started.md)第 7 节。）

---

## 3. M07.1：token 不可猜测，Bash 是内核自带的

打开 [`impl/kernel_shell_task.py`](../M07-execution-backends/impl/kernel_shell_task.py) 与
[`scenes/01_kernel_runs_bash.py`](../M07-execution-backends/scenes/01_kernel_runs_bash.py)。
任务素材的设计目标写在 impl 的 docstring 里：**token 是本次运行才生成的，只有真的执行过一次
命令才读得到**。整条链三步，全部在编排层，没有一步在执行命令：

```python
def plant_token(workspace: Path) -> str:
    """在内核工作目录里放一个本次运行独有的 token。"""
    token = f"kernel-shell-{uuid.uuid4().hex[:10]}"
    (workspace / PROOF_FILE).write_text(f"{token}\n", encoding="utf-8")
    return token


async def run_shell_task(harness: WorkshopHarness) -> tuple[str, list[AgentEvent]]:
    """放 token → 让内核去读 → 返回 token 与这轮的事件。"""
    workspace = require_not_none(harness.workspace, "内核有自己的工作目录")
    token = plant_token(workspace)
    return token, await harness.stream(task_prompt())
```

提示词只说"当前目录下"，把"怎么读"整个留给内核：

```python
def task_prompt() -> str:
    return (
        f"当前目录下有一个 {PROOF_FILE}。请用 Bash 工具读出它的内容，"
        "然后只回复文件里那一行，不要解释、不要加引号。"
    )
```

场景只数事件，不执行、不代答：

```python
    starts = [event for event in events if isinstance(event, ToolCallStartEvent)]
    require(len(starts) >= 1, "内核发出至少一次工具调用 start（执行归内核）", starts)
```

对上第 2 节 M07.1 的三行事实：`kernel = claude`、`kernel_tool_calls = [Bash]`、
`route = prompt -> KernelAdapter -> kernel tool events`。`ToolCallStartEvent`
（`iota-core/src/iota_core/types.py::class ToolCallStartEvent`）记录的这一次工具调用**来自内核
进程内部**——编排层没有 Bash 可调（M07.4 会把这一点单独钉死），`REAL_STAGE_OK` 行尾引号里的
`"kernel-shell-995cb74c8d"` 就是内核读进回答里的 token。

那内核的 Bash 哪来的？看 [`run.py`](../M07-execution-backends/run.py) 的阶段清单——M07.1/M07.2
是 `model` 阶段，且带 `shell=True`：

```python
    Stage("M07.1", "内核执行副作用", "model", "01_kernel_runs_bash", shell=True),
    Stage("M07.2", "消费工具结果与执行证据", "model", "02_kernel_reports_tool_results", shell=True),
```

`shell=True` 在 [`runtime/harness.py`](../runtime/harness.py) 的 `build_adapter` 里落成三行
**装配期**配置——工具白名单与许可模式都是内核适配器的构造参数：

```python
        allowed_tools=["Bash"] if allow_shell else [],
        disallowed_tools=[] if allow_shell else ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permission_mode="bypassPermissions" if allow_shell else "default",
```

> **原理对照**：`bypassPermissions` 是**内核侧**的许可模式。dsh 的 sandbox 在编排层把策略
> （`read-only` / `workspace-write`）包装成可强制的 argv、强制不了就 fail-closed（dsh 第 07 课
> 第 6 节）；iota 这边连"这条命令能不能跑"都看不见——编排层只在装配期决定"给不给内核这只手"，
> 给了之后执行与许可都发生在内核进程内部。策略位到底存不存在，M07.3 会用负证据量出来。

---

## 4. M07.2：结果事件是收口，token 是指纹

[`scenes/02_kernel_reports_tool_results.py`](../M07-execution-backends/scenes/02_kernel_reports_tool_results.py)
在同一条链上加两道收口断言：

```python
    results = [event for event in events if isinstance(event, ToolCallResultEvent)]
    require(
        any(result.ok for result in results),
        "内核发出至少一次成功的工具结果",
        [(result.id, result.ok) for result in results],
    )
    seen = "\n".join(str(getattr(event, "output", "")) for event in results)
    answered = token in seen or token in "".join(
        str(getattr(event, "text", "")) for event in events
    )
    require(answered, "内核真的读到了本次生成的 token（凭猜测答不出来）", token)
```

对应日志两行：`tool_results = [True]`（场景打印的就是每个结果的 `ok` 位）与
`execution_proof = token read by kernel`。再注意一个细节：M07.1 与 M07.2 的 `REAL_STAGE_OK`
行尾是**两个不同的 token**（`kernel-shell-995cb74c8d` 与 `kernel-shell-0366080a5b`）——
`run_shell_task` 每次都重新 `plant_token`，每个阶段各有一条自己的指纹，谁也冒充不了谁。

> **原理对照**：`ToolCallResultEvent`（`iota-core/src/iota_core/types.py::class ToolCallResultEvent`）
> 除类型判别字段外只带 `id` / `ok` / `output` 三个字段。iota 只消费内核回传的结果事件——没有
> canonical/content 双通道（[第 01 课](01-tool-pipeline.md)第 5 节），也没有 dsh 那种把退出码、
> 超时、信号结构化展开的 `ShellRunResult`（dsh 第 07 课第 5 节）；执行的事实细节留在内核里，
> 到编排层只剩"这次调用成功与否，以及输出"。

---

## 5. M07.3：装配面只有一格开关，编排层没有沙箱面

[`scenes/03_sandbox_is_kernel_owned.py`](../M07-execution-backends/scenes/03_sandbox_is_kernel_owned.py)
用两条"负证据"量沙箱归属——不是证明有什么，而是证明**没什么**：

```python
    signature = inspect.signature(build_adapter)
    kernel_knobs = sorted(signature.parameters)
    sandbox_surface = sorted(
        name for name in vars(Registry()) if "sandbox" in name or "policy" in name
    )
    require("allow_shell" in kernel_knobs, "装配层只有一个开关：要不要给内核 shell", kernel_knobs)
    require(sandbox_surface == [], "编排层没有沙箱/策略注册面", sandbox_surface)
```

第一条用 `inspect.signature` 数 `build_adapter` 的参数面：日志里的
`assembly_knobs = [allow_shell, timeout, workspace]`——三格里没有一格叫 sandbox 或 policy。
第二条翻 `Registry()` 的属性表：`sandbox_surface = []`——注册面上不存在任何沙箱/策略注册点。
`policy_owner = kernel adapter configuration` 就是结论：策略的 owner 是**内核适配器的构造参数**，
不是编排层的 seam。

和 dsh 的差距在这一节看得最清楚：dsh 第 07 课里，策略可以按调用合成（`sandboxPolicy.resolve`，
部署默认 `read-only`、会话覆盖 `workspace-write`），沙箱后端要么给出可强制的 argv、要么
fail-closed；iota 唯一的"策略动作"是装配期问一句 `allow_shell`——`True` 就是白名单开 `Bash` 加
`bypassPermissions`，`False` 就是 `disallowed_tools` 全关。想在这两档之间加第三档？装配面里
没有位置。

---

## 6. M07.4：空注册表就是边界证据

[`scenes/04_empty_shell_registry.py`](../M07-execution-backends/scenes/04_empty_shell_registry.py)
是全工程最短的场景之一，但它是本课的题眼：

```python
    tools = harness.registry.tools.list()
    require(tools == [], "编排层不注册 shell 工具", tools)
    return {"orchestrator_shell_registry": tools, "execution_stack": "kernel-owned"}
```

`orchestrator_shell_registry = []`——不是"忘了注册"，而是**本来就不归它注册**。对照第 1 节的
表：dsh 的 `ctx.fs` / `ctx.subprocess` 是编排层挂上去的服务，工具调用经 seam 执行；iota 的注册表
干脆是空的，`Bash` 出现在内核回传的事件里（M07.1 的 `kernel_tool_calls = [Bash]`）。
`execution_stack = kernel-owned` 是场景给这条事实的判词。第 01 课的 `ToolPipeline` 只能包
**注册进编排层**的工具——注册表为空，那整条包装管线在执行侧就没有着力点。

---

## 7. M07.5：工作目录是唯一输入通道

[`scenes/05_workspace_is_the_only_input.py`](../M07-execution-backends/scenes/05_workspace_is_the_only_input.py)
演示编排层剩下的另一件事——往内核 cwd 放输入，且写入没有任何工具参与：

```python
    workspace = require_not_none(harness.workspace, "内核有自己的工作目录")
    probe = workspace / "m07-input.txt"
    probe.write_text("orchestrator wrote this\n", encoding="utf-8")
    require(probe.is_file(), "编排层只能往工作目录里放文件", probe.name)
    require(
        harness.registry.tools.list() == [],
        "没有任何编排层工具参与这次写入",
        harness.registry.tools.list(),
    )
```

工作目录从哪来：[`runtime/harness.py`](../runtime/harness.py) 装配时用 `create_workspace()`
造一个一次性目录，`build_adapter(..., workspace=root)` 把它作为 `cwd=str(root)` 交给内核子进程：

```python
def create_workspace() -> Path:
    """Create a throwaway directory for the real kernel process."""
    return Path(tempfile.mkdtemp(prefix="iota-real-"))
```

对应日志三行：`workspace_file = m07-input.txt`（写进去了）、`workspace_is_temporary = True`
（`mkdtemp` 的一次性目录）、`input_channel = kernel cwd`。除了提示词本身，这是编排层给内核
"喂"输入的唯一通道：想传文件，写进 `harness.workspace`，内核在自己的 cwd 里看得见它，在别处
看不见。M07.1 的 `plant_token(workspace)` 走的就是同一条通道。

---

## 8. 排障：内核读不到文件，编排层挂不上沙箱

### 症状 A：内核读不到我给它的文件

**症状**：你把要内核处理的文件放在自己的项目目录（或在提示词里写了绝对路径），让内核去读；
内核回答"找不到文件"，或干脆编了一个答案。

**定位**：内核子进程的 cwd 不是你的项目根，而是 `create_workspace()` 造的一次性 `iota-real-*`
目录。M07.1 的提示词刻意只说"**当前目录下**有一个 kernel-proof.txt"；M07.5 的
`input_channel = kernel cwd` 就是这条通道的名字；`plant_token(workspace)` 写的也是
`harness.workspace`，不是别的目录。

**原因与修改**：这是装配规则，不是内核不听话。`build_adapter(..., workspace=root)` 把
`cwd=str(root)` 交给内核进程，内核只在自己的 cwd 里"活动"。修改方向：把输入写进
`harness.workspace`（唯一输入通道），提示词里用"当前目录下"这类相对表述；不要指望内核去读
你机器上的任意绝对路径——而且证据日志会把绝对路径脱敏成 `<path>`（[第 00 课](00-getting-started.md)
第 5 节），排障时连看都看不到。

### 症状 B：想在编排层加一道命令黑名单 / 沙箱

**症状**：你看到 `bypassPermissions` 觉得太宽，想给内核的 Bash 加一层"命令黑名单"包装或沙箱，
却在编排层找不到挂载点。

**定位**：三条负证据叠在一起。M07.3 的 `assembly_knobs = [allow_shell, timeout, workspace]`
——装配面只有三格，没有策略位；`sandbox_surface = []`——`Registry` 上没有沙箱/策略注册面。
M07.4 的 `orchestrator_shell_registry = []`——Bash 根本不在编排层注册表里，第 01 课的
`ToolPipeline` 只能包注册进编排层的工具，包不到内核自带的 Bash。

**原因与修改**：这不是缺陷，是边界。包装要起作用，前提是调用**经过你**；内核自带的 Bash 不
经过编排层。修改方向只有两个，而且都尊重边界：**收紧内核侧配置**——`allow_shell=False`，此时
`disallowed_tools` 把 `Read` / `Write` / `Edit` / `Bash` / `Glob` / `Grep` 全关、
`permission_mode="default"`，代价是 M07.1 这类阶段直接失败；或者**换内核/适配器**——选一个
提供策略协议的内核，策略写在它的装配参数里。想在每次调用前问人，走第 06 课内核的 permission
通道，那是内核的协议，不是编排层的 seam。

---

## 9. 代码在哪

```bash
cd iota-example && ls M07-execution-backends/impl M07-execution-backends/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/kernel_shell_task.py`](../M07-execution-backends/impl/kernel_shell_task.py) | `plant_token`（uuid token）、`task_prompt`、`run_shell_task` 三步链 |
| [`scenes/01_kernel_runs_bash.py`](../M07-execution-backends/scenes/01_kernel_runs_bash.py) | `ToolCallStartEvent` 过滤；`len(starts) >= 1` 断言 |
| [`scenes/02_kernel_reports_tool_results.py`](../M07-execution-backends/scenes/02_kernel_reports_tool_results.py) | `result.ok`；token 出现在结果或回答里的双重检查 |
| [`scenes/03_sandbox_is_kernel_owned.py`](../M07-execution-backends/scenes/03_sandbox_is_kernel_owned.py) | `inspect.signature(build_adapter)`；`vars(Registry())` 负证据 |
| [`scenes/04_empty_shell_registry.py`](../M07-execution-backends/scenes/04_empty_shell_registry.py) | `registry.tools.list()` 为空——边界证据本体 |
| [`scenes/05_workspace_is_the_only_input.py`](../M07-execution-backends/scenes/05_workspace_is_the_only_input.py) | 往 `harness.workspace` 写文件；"没有工具参与"断言 |
| [`run.py`](../M07-execution-backends/run.py) | `STAGES`：M07.1/M07.2 是 `model` + `shell=True`，其余 `mechanism` |
| [`runtime/harness.py`](../runtime/harness.py) | `build_adapter` 的三格开关与 `bypassPermissions`；`create_workspace` |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**；断言（`require(…)`）就是这一阶段的
"可验证答案"。

---

## 10. 动手练习

### 练习 A：跑两次，看 token 每次都不同

```bash
cd iota-example && uv run python -m runtime.runner M07 --scene 01_kernel_runs_bash
uv run python -m runtime.runner M07 --scene 01_kernel_runs_bash
```

**可验证答案**：两次的 `REAL_STAGE_OK M07.1` 行尾引号里是**两个不同的** token，末行都是
`REAL_MODULE_OK M07 stages=1 calls=1 failed=0`（`--scene` 只跑该阶段）。`uuid.uuid4().hex[:10]`
每次运行重新生成——内核不可能"背"出上一次的答案。这正是 M07.2 那条
`execution_proof = token read by kernel` 能当证据的原因。

### 练习 B：把 `shell=True` 去掉，看阶段怎么失败

把 [`run.py`](../M07-execution-backends/run.py) 里 M07.1 那行的 `shell=True` 删掉，再跑：

```bash
cd iota-example && uv run python -m runtime.runner M07 --scene 01_kernel_runs_bash
```

**可验证答案**：进程非零退出，抛 `TeachingCheckError`，期望文本是
`内核发出至少一次工具调用 start（执行归内核）`——`allow_shell=False` 时装配给内核的是
`disallowed_tools=["Read", "Write", "Edit", "Bash", "Glob", "Grep"]`，内核没有 Bash 可调，
start 事件一个都不会有。恢复 `shell=True` 重跑，阶段恢复 OK。这条反向证据说明：`allow_shell`
给的不是"编排层执行命令"的能力，而是"内核执行命令的手"——手砍掉，编排层也补不上。

### 练习 C（进阶）：核对装配面确实没有策略位

```bash
cd iota-example && uv run python -c "import inspect; from runtime.harness import build_adapter; print(sorted(inspect.signature(build_adapter).parameters))"
```

**可验证答案**：输出 `['allow_shell', 'timeout', 'workspace']`，与 M07.3 的
`assembly_knobs = [allow_shell, timeout, workspace]` 逐字相等。三个名字里没有 sandbox、没有
policy、没有 deny——想约束执行，只能动内核侧配置，装配面里加不出一道策略。

---

**下一课** → [第 08 课 · 委派与预设](08-delegation-presets.md)：执行归内核之后，"派活"在 iota 是一张显式 DAG——顺序来自 `depends_on`，谁出场、用哪个模型，都得按名字写出来。
