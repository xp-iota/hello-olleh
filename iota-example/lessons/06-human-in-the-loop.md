# 第 06 课 · 人在环路：命令、权限与计划模式归属

> **本课任务**：看清"人在环路"在 iota 侧收缩成一条协议——权限决策必定得到答复；再用能力
> 声明与字段缺失的负证据，把命令、计划模式、todo 与消息反馈的归属逐面钉死。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M06`
> **你将看到**：`kernel_provides = [goal_commands]` 而 `command_surface = []`——命令是内核
> 声明的能力，编排层没有注册面；`answers = {reject: reject_once-option, allow: allow_once-option}`；
> 而只给放行选项时得到 `refusal = dsh-acp permission request offered no 'reject' option (kinds wanted: ['reject_once', 'reject_always'], offered: ['allow_once'])`。

前置：[第 05 课 · 会话面](05-session-surface.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见 [dsh-example/lessons/06-human-in-the-loop.md](../../dsh-example/lessons/06-human-in-the-loop.md)——那边讲六种人机协议，本课讲 iota 唯一拥有的权限决策与其余各面的归属。

---

## 1. 本课任务

DSH 把"人在环路"摊成六种显式协议，每条都有入口 seam 和应答形状。iota 的对照关系是
**语义等价 + 结构性边界**：六面里只有**权限决策**真的穿过适配器——内核回调
`session/request_permission`，适配器按部署时声明的 `permission_policy` 作答；其余各面
要么由内核用**能力声明**认领，要么根本没有对应的注册面或字段。六个阶段全是
`mechanism` 类型：先打真实内核 probe 证链路，再用本地断言把归属钉死——包括"没有"这件事本身。

| DSH 控制面 | iota 侧机制 | 归属判定 |
|---|---|---|
| 斜杠命令（`ctx.commands.execute`，不消耗模型 turn） | 内核声明 `goal_commands` 能力，命令由内核自己解析 | **结构性边界**：命令归内核 |
| 审批（`ctx.approval.request`，封闭四值） | 适配器带部署期 `permission_policy` 应答 `session/request_permission` | **语义等价**：iota 唯一拥有的权限决策 |
| 结构化问题（`ctx.userQuestions.ask`） | 没有——编排层没有问题注册面 | **结构性边界**：问人归内核或宿主 |
| 计划模式（`/plan` + `ctx.planMode.set`） | `AgentConfig` 不伪造 plan_mode 字段 | **结构性边界**：归内核或宿主 |
| Todo（`todo_write` 整表替换 + `todos` 投影） | 配置里有 `auto_kanban` 开关；工具集按 `NATIVE_KANBAN_TOOLSET` 声明 | **结构性边界**：按能力声明归属 |
| 消息反馈（`ctx.messageFeedback`，耐久列表） | 没有——`Registry` 无反馈面，`Message` 无反馈字段 | **结构性边界**：归宿主 |

本课要建立的三个直觉：

1. **权限请求必定得到答复**——没人答复会挂死整轮，所以适配器构造时就带着策略。
2. **匹配不到选项就报错**——剩下的候选可能正是放行项，fail closed 是唯一安全方向。
3. **归属靠声明，不靠猜**——能力在 `provides` 里，字段在 schema 里；没有声明就没有能力。

```bash
cd iota-example && uv run python -m runtime.runner M06
```

---

## 2. 真实输出

```text
████ M06 · 人在环路：命令、权限与计划模式归属 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M06.1 · 斜杠命令由内核自己解析 ────
   kernel_provides = [goal_commands]
   command_surface = []
   slash_commands = kernel-owned
REAL_STAGE_OK M06.1 calls=1 ms=1580 in=12239 out=10 finish=success

──── M06.2 · 权限请求必定得到答复 ────
   default_policy = reject
   answers = {reject: reject_once-option, allow: allow_once-option}
   outcome = selected
REAL_STAGE_OK M06.2 calls=1 ms=1270 in=12241 out=10 finish=success

──── M06.3 · 无匹配选项时 fail closed ────
   refusal = dsh-acp permission request offered no 'reject' option (kinds wanted: ['reject_once', 'reject_always'], offered: ['allow_once'])
   direction = fail-closed
REAL_STAGE_OK M06.3 calls=1 ms=5012 in=12240 out=10 finish=success

──── M06.4 · 计划模式归内核或宿主 ────
   faked_plan_fields = []
   plan_mode = kernel/host-owned
REAL_STAGE_OK M06.4 calls=1 ms=1482 in=12240 out=58 finish=success

──── M06.5 · todo/kanban 按能力声明归属 ────
   auto_kanban_default = enabled=True db_path=None auto_assign='iota-agent' mirror_to_redis=True include_delegated_tasks=True board_id=None task_id=None workspace=None
   kernel_declares_kanban = False
   todo_owner = kernel/host
REAL_STAGE_OK M06.5 calls=1 ms=792 in=12242 out=10 finish=success

──── M06.6 · 消息反馈不在编排层 ────
   feedback_surface = []
   message_fields = [content, metadata, role, tool_call_id]
   feedback_owner = host
REAL_STAGE_OK M06.6 calls=1 ms=1486 in=12239 out=35 finish=success

REAL_MODULE_OK M06 stages=6 calls=6 failed=0
```

**对照自己的输出**：至少要有 `REAL_MODULE_OK M06 stages=6`。六个阶段都是 `mechanism`
类型，每行 `calls=1` 是入口的一次真实 probe——权限断言是本地决策，`ms=`/`in=` 随端点浮动。

---

## 3. 命令：内核声明能力，编排层没有注册面

打开 [`scenes/01_commands_are_kernel_owned.py`](../M06-human-in-the-loop/scenes/01_commands_are_kernel_owned.py)，两条断言一正一负：

```python
provides = sorted(harness.adapter.provides)
command_surface = sorted(name for name in vars(Registry()) if "command" in name)
require(GOAL_COMMANDS in provides, "内核声明自己解析 goal 命令", provides)
require(command_surface == [], "编排层没有命令注册面", command_surface)
```

```text
kernel_provides = [goal_commands]   ← 当前内核认领了 goal_commands 这条能力
command_surface = []               ← Registry 实例上没有名字含 "command" 的属性
```

`GOAL_COMMANDS` 是一条**命名能力**：内核自己解析 `/goal` 类命令、自己拥有续跑循环，所以
iota 把 goal 命令原样转发。负证据同样具体：`vars(Registry())` 枚举的是编排层的全部注册面
（tools、mcps、skills、graphs……），没有一张是命令表——想拦 `/deploy` 或注册 `/hello`，
在这里都找不到落点。

对照 DSH：那边 M06.1 的 `/hello 张三` 由宿主的命令注册表派发，是一次**不消耗模型
turn** 的本地动作（那次 `calls=1` 只是 probe）；iota 没有这张注册表——命令要么内核
自己解析，要么宿主在自己的 UI 层处理，编排层不假装有这个面。

> **原理对照**：`iota-core/src/iota_core/capabilities.py::GOAL_COMMANDS`——能力名在类
> 定义期校验，写错导入即失败。DSH 侧等价物是 `ctx.commands.execute`（dsh 第 06 课第 3 节）。

---

## 4. 权限：iota 唯一拥有的协议，策略部署期定

六面里只有这一条真的穿过适配器。打开
[`impl/acp_permission.py`](../M06-human-in-the-loop/impl/acp_permission.py) 与
[`scenes/02_answer_with_configured_policy.py`](../M06-human-in-the-loop/scenes/02_answer_with_configured_policy.py)：

```python
def dsh_adapter(policy: str = "reject") -> DshAcpAdapter:
    return DshAcpAdapter(command=["true"], permission_policy=policy)


def permission_request(*kinds: str) -> dict[str, Any]:
    """一次权限请求：为每个 kind 提供一个可选项。"""
    return {
        "sessionId": "demo",
        "toolCall": {"toolCallId": "call-1"},
        "options": [{"optionId": f"{kind}-option", "kind": kind} for kind in kinds],
    }
```

三个设计决定都写在这几行里：

- **策略在部署时声明**。`permission_policy` 是适配器构造参数，默认 `reject`，合法值只有
  `("reject", "allow")`，传别的当场抛 `ConfigError`——"忘了配"不会悄悄变成默认放行。
- **`command=["true"]` 就够**。权限决策不需要真的拉起内核进程，素材因此能单独演这一步。
- **选项按 `kind` 匹配，不按 `optionId`**。各内核的 id 是自己的标签（DSH 发
  `allow-once`/`reject-once`，Hermes 发 `allow_once`/`deny`），按 id 匹配会在授予方向失效。

场景把两种策略都跑一遍：

```python
request = permission_request("allow_once", "reject_once")
answers: dict[str, str] = {}
for policy in ("reject", "allow"):
    decision = await dsh_adapter(policy)._handle_request(PERMISSION_METHOD, request)
    require(decision["outcome"]["outcome"] == "selected", "答复是一次明确选择", decision)
    answers[policy] = decision["outcome"]["optionId"]
```

同一个请求同时带着放行、拒绝两个选项，两种策略都返回 `selected` 加一个**明确的
optionId**（场景随后断言 `reject` 选了 `reject_once-option`、`allow` 选了 `allow_once-option`）：

```text
default_policy = reject
answers = {reject: reject_once-option, allow: allow_once-option}
outcome = selected
```

为什么"必定答复"是硬要求：内核的审批瀑布到达 ACP 通道时会**回调**
`session/request_permission`，一条没人答复的请求会把整轮挂死——所以决策不是瀑布末端的
可选插件，而是适配器构造时就带着的一份声明。

> **原理对照**：`iota-core/src/iota_core/adapters/dsh_acp.py::class DshAcpAdapter`——模块
> 文档写明"未答复的请求会挂死整轮，所以决策是这个适配器必备的一部分"。DSH 侧等价物是
> `ctx.approval.request` + 封闭四值 `ApprovalOutcome`（dsh 第 06 课第 4 节）：那边应答器
> 是宿主挂在 waterfall 上的监听者，这边是适配器的构造参数——策略部署期就已定。

---

## 5. fail closed：无匹配选项时宁可报错

打开 [`scenes/03_fail_closed_without_option.py`](../M06-human-in-the-loop/scenes/03_fail_closed_without_option.py)。这次只给放行选项，而策略是拒绝：

```python
# 只提供放行选项，而策略是拒绝：随便挑一个就会变成"授予"，所以这里必须失败。
request = permission_request("allow_once")
try:
    await dsh_adapter("reject")._handle_request(PERMISSION_METHOD, request)
except KernelError as exc:
    refusal = str(exc)
else:  # pragma: no cover
    fail("无匹配选项时拒绝作答")
require("reject" in refusal, "拒绝信息说明想要的策略", refusal)
```

```text
refusal = dsh-acp permission request offered no 'reject' option (kinds wanted: ['reject_once', 'reject_always'], offered: ['allow_once'])
direction = fail-closed
```

`kinds wanted` 是策略想要的，`offered` 是请求带来的，交集为空——剩下的候选**恰好是
放行项**，随便挑一个就变成授予，所以必须失败。策略想要什么由适配器基类的匹配表决定：
`allow` 只认 `allow_once`，`reject` 认 `reject_once`、后备 `reject_always`。这条
`KernelError` 也不会被内核当成"客户端坏了"：DSH 桥把它结算成 `unavailable`（拒绝），
Hermes 把非 `AllowedOutcome` 的回答映射成 `deny`——报错仍然是拒绝。

这就是 fail closed 的完整形状：**缺匹配 → 报错 → 内核按拒绝结算**——没有一环会"宽容地"猜一个答案。

> **原理对照**：`iota-core/src/iota_core/adapters/acp_stdio.py::_decide_permission`——
> "报错而不是发明一个答案；两个内核都把出错的权限请求当拒绝处理"。dsh 第 06 课缺应答器
> 时的 `unavailable` 是同一条直觉：缺能力时拒绝，而不是默认放行，也不是无限等待。

---

## 6. 计划模式与 todo：归属由声明决定

### 计划模式：配置不伪造字段

[`scenes/04_plan_mode_is_host_owned.py`](../M06-human-in-the-loop/scenes/04_plan_mode_is_host_owned.py)
只有一条断言，问的是编排层交给内核的配置面：

```python
faked = sorted(name for name in AgentConfig.model_fields if "plan" in name)
require(faked == [], "AgentConfig 不伪造 plan_mode 字段", faked)
```

对应 `faked_plan_fields = []` 与 `plan_mode = kernel/host-owned`。DSH 的计划模式是三件套
（`ctx.planMode.set`、日志投影、稳定退出工具 `exit_plan_mode`，dsh 第 06 课第 6 节）；
iota 编排层一件都没有，连 `AgentConfig` 里的字段都不设——**有字段没人读，比没有字段
更糟**。计划模式要么具体内核自带，要么宿主自己管理。

### todo：开关存在 ≠ 能力存在

[`scenes/05_kanban_is_declared_capability.py`](../M06-human-in-the-loop/scenes/05_kanban_is_declared_capability.py)
把"配置里有开关"和"内核有能力"拆成两条断言：

```python
config = AgentConfig(name="m06-kanban", kernel=harness.kernel)
declared = NATIVE_KANBAN_TOOLSET in harness.adapter.provides
require("auto_kanban" in AgentConfig.model_fields, "配置里有 kanban 开关")
require(declared is False, "当前内核没有声明原生 kanban 工具集", declared)
```

```text
auto_kanban_default = enabled=True db_path=None auto_assign='iota-agent' mirror_to_redis=True include_delegated_tasks=True board_id=None task_id=None workspace=None
kernel_declares_kanban = False
todo_owner = kernel/host
```

`auto_kanban` 默认全开（自动建任务、指派给 `iota-agent`、镜像到 Redis），但**开关不等于
能力**：`NATIVE_KANBAN_TOOLSET` 是一条要内核声明的能力，声明了 iota 才在自己的进程里
注册原生待办工具。当前内核没声明它，配置就不生效、也不假装生效——声明它的是 Hermes
侧的适配器；换内核 → 换声明 → 归属就变。DSH 侧的 `todo_write` 则是永远注册的工具（dsh 第 06 课第 7 节）。

> **原理对照**：`iota-core/src/iota_core/capabilities.py::NATIVE_KANBAN_TOOLSET`——能力名
> 在类定义期校验。DSH 侧的边界写在"有没有装这个插件"上，iota 写在 `provides` 声明上。

---

## 7. 消息反馈：没有注册面，也没有字段

[`scenes/06_no_message_feedback_seam.py`](../M06-human-in-the-loop/scenes/06_no_message_feedback_seam.py)
两头同时查——注册面和消息本身：

```python
feedback_surface = sorted(name for name in vars(Registry()) if "feedback" in name)
message_fields = sorted(Message.model_fields)
faked = [name for name in message_fields if "feedback" in name or "rating" in name]
require(feedback_surface == [], "编排层没有反馈注册面", feedback_surface)
require(faked == [], "Message 不伪造反馈字段", faked)
```

```text
feedback_surface = []
message_fields = [content, metadata, role, tool_call_id]
feedback_owner = host
```

`Message` 的全部字段就是这四个。`metadata` 是自由字典，但把反馈塞进去没有读取方——
没有协议。DSH 那边反馈是耐久服务：经 `ctx.sessionPersistence` 落 JSONL、跨重启存活
（dsh 第 06 课第 7 节）；iota 要做反馈，归宿主自己接存储，编排层不占位。

> **原理对照**：`iota-core/src/iota_core/types.py::class Message`——四个字段就是消息的
> 全部形状；DSH 侧等价物是 `ctx.messageFeedback` + `JsonlSessionPersistence`（dsh 第 06 课第 7 节）。

---

## 8. 排障

### 症状 A：无人值守运行整轮挂死

**症状**：部署到 CI 或无人值守环境后，一次需要审批的操作发出去，整轮停在那里——不报错、不结束、也不放行。

**定位**：
1. 看内核侧是不是发出了 `session/request_permission`——**没人答复的请求会挂死整轮**，
   这是协议语义，不是 bug。
2. 查适配器构造参数：`permission_policy` 声明了吗？没传就是默认 `reject`——默认也是答；
   传非法值会在构造期抛 `ConfigError`，同样到不了挂死。
3. 如果报的是 `KernelError: … offered no '…' option …`，那是第 5 节的局面：策略想要
   的 kind 与请求带来的选项对不上。

**原因与修改**：挂死说明"有人问、没人答"——应答链路被绕开了（最常见：自己写了适配器
却没实现内核回调的处理）。修改是**部署期把策略定死**：`reject`（默认，拒绝对模型和
运行日志都可见）或 `allow`（确信环境受控时）；不要"修"成超时后随便挑一个选项。

### 症状 B：想让编排层拦下命令

**症状**：想加一条 `/deploy` 之类的自定义命令，或想在编排层控制计划模式开关——在
`Registry` 和 `AgentConfig` 里都找不到入口。

**定位**：`vars(Registry())` 里名字含 `command` 的属性（M06.1 已证为空）；
`AgentConfig.model_fields` 里名字含 `plan` 的字段（M06.4 已证为空）。

**原因与修改**：这不是缺文档，是归属——命令由内核自己解析（声明了 `goal_commands`），
计划模式归具体内核或宿主；要加命令就在宿主的输入/UI 层做，再把结果作为普通提示词喂
给内核。负证据写法在这里就是答案：**能力声明缺失、字段缺失，本身就是"归别人"的证据**。

---

## 9. 代码在哪

```bash
cd iota-example && ls M06-human-in-the-loop/impl M06-human-in-the-loop/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/acp_permission.py`](../M06-human-in-the-loop/impl/acp_permission.py) | `dsh_adapter(policy)`（部署期策略，默认 reject）、`permission_request(*kinds)`（按 kind 造选项） |
| [`scenes/01_commands_are_kernel_owned.py`](../M06-human-in-the-loop/scenes/01_commands_are_kernel_owned.py) | `GOAL_COMMANDS in provides` 与 `command_surface = []` 一正一负 |
| [`scenes/02_answer_with_configured_policy.py`](../M06-human-in-the-loop/scenes/02_answer_with_configured_policy.py) | 两种策略都回 `selected` + 明确 optionId |
| [`scenes/03_fail_closed_without_option.py`](../M06-human-in-the-loop/scenes/03_fail_closed_without_option.py) | 只给放行选项时抛 `KernelError`；`require("reject" in refusal, …)` |
| [`scenes/04_plan_mode_is_host_owned.py`](../M06-human-in-the-loop/scenes/04_plan_mode_is_host_owned.py) | `AgentConfig.model_fields` 里没有 plan 字段 |
| [`scenes/05_kanban_is_declared_capability.py`](../M06-human-in-the-loop/scenes/05_kanban_is_declared_capability.py) | 开关存在 ≠ 能力声明存在 |
| [`scenes/06_no_message_feedback_seam.py`](../M06-human-in-the-loop/scenes/06_no_message_feedback_seam.py) | `feedback_surface = []`；`Message` 四字段 |

读法：**先读 scene 看它怎么"演"**——`require(…)` 就是这一阶段的可验证答案；权限相关的
阶段再翻 `impl/acp_permission.py` 看请求与策略怎么构造，其余断言只依赖 schema 与能力声明。

---

## 10. 动手练习

### 练习 A：把 fail closed 翻到另一个方向

把 [`scenes/02`](../M06-human-in-the-loop/scenes/02_answer_with_configured_policy.py) 里的
`permission_request("allow_once", "reject_once")` 改成 `permission_request("reject_once")`，再跑：

```bash
cd iota-example && uv run python -m runtime.runner M06 --scene 02_answer_with_configured_policy
```

**可验证答案**：`reject` 那轮照常拿到 `reject_once-option`；轮到 `allow` 时抛 `KernelError`，
进程非零退出、没有 `REAL_MODULE_OK` 行——错误消息与 M06.3 的 refusal 同构而方向相反。跑完改回去。

### 练习 B：连"没有选项"也是同一个方向

把 [`scenes/03`](../M06-human-in-the-loop/scenes/03_fail_closed_without_option.py) 里的
`permission_request("allow_once")` 改成 `permission_request()`，先预测再运行：

```bash
cd iota-example && uv run python -m runtime.runner M06 --scene 03_fail_closed_without_option
```

**可验证答案**：阶段仍然 `REAL_STAGE_OK`——`refusal` 行的结尾变成 `offered: []`，断言
`"reject" in refusal` 依旧成立——连"没有选项"也走同一条报错路径。

### 练习 C：和 dsh 同编号阶段对读

跑 `cd dsh-example && npm run M06`，看那边 M06.2 的三个局面（`unavailable` /
`allowed-once` / `rejected`），再回看本课第 4、5 节。

**可验证答案**：两边都没有"没人答就放行"的分支——dsh 缺应答器时归一成 `unavailable`，
iota 缺匹配选项时抛 `KernelError`。差别在**策略住在哪**：dsh 的应答器是运行时挂在
`approval/request` waterfall 上的宿主插件，iota 的 `permission_policy` 在适配器构造
那一刻就定死了。

---

**下一课** → [第 07 课 · 执行侧后端](07-execution-backends.md)：DSH 有五层可换执行后端，iota 一层都不拥有——副作用由内核执行，编排层只转发并观察事件。
