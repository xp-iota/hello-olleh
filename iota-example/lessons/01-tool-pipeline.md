# 第 01 课 · 工具管线：一层具名可逆包装

> **本课任务**：看清 `ToolPipeline` 能做到哪一步——具名 stage、幂等安装、按身份回收；
> 再确认三件事必须由内核提供：三态审批协议、per-Agent 可见集合、不可翻案的单调守卫。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M01`
> **你将看到**：`composed = audit(guard(raw:x))` 里两层包装各执行一次；外层包装却能把内层
> 拒绝改写成 `audit:rescued`；而 M01.d 里内核自己发起 `Bash` 调用——编排层工具注册表始终为空。

前置：[第 00 课 · 跑起来](00-getting-started.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见
[`dsh-example/lessons/01-tool-pipeline.md`](../../dsh-example/lessons/01-tool-pipeline.md)——那边讲"五个正交控制面"，本课讲**其中哪些属于编排层，哪些必须归内核**。

---

## 1. 本课任务

DSH 把工具管线拆成注册、pre 裁决、post 变换、按 Agent 收紧、单调守卫五个控制面
（对照关系：**机制补齐 + 结构性边界**）。iota 这边只有一层**具名可逆包装**，其余归内核：

| DSH 控制面 | iota 侧 | 归属 |
|---|---|---|
| 注册 + Fiber 回收 | `ToolPipeline.install()` + `EffectStack` 回收 | **机制补齐**：iota 有 |
| pre-execute 权限门（allow/deny/ask） | 一层包装能在执行前抛错 | **结构性边界**：三态协议归内核 |
| post-execute 结果变换（canonical/content 双通道） | 包装改写返回值，只有一个通道 | 包装能做一半；双通道归内核 |
| 按 Agent 收紧可见工具 | 没有——注册面是进程级的 | **结构性边界**：披露由内核裁定 |
| 单调守卫（拒绝不可翻案） | 没有——外层能吞掉内层拒绝 | **结构性边界**：必须由具体机制提供 |

```bash
cd iota-example && uv run python -m runtime.runner M01
```

---

## 2. 真实输出

```text
████ M01 · 工具管线：包装、拒绝与可见性归属 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M01.1 · 注册包装与 effect 回收 ────
   installed = [lookup]
   missing = [missing]
   already = [lookup]
   composed = audit(guard(raw:x))
   restored = True
REAL_STAGE_OK M01.1 calls=1 ms=1888 in=12241 out=10 finish=success

──── M01.2 · pre-execute 权限门 ────
   refusal = m01 禁止 lookup
   approval_surface = []
   three_state_protocol = kernel-owned
REAL_STAGE_OK M01.2 calls=1 ms=2685 in=12240 out=10 finish=success

──── M01.3 · post-execute 结果变换 ────
   guard_then_audit = audit(guard(raw:x))
   audit_then_guard = guard(audit(raw:x))
   canonical_content_split = False
REAL_STAGE_OK M01.3 calls=1 ms=2662 in=12240 out=139 finish=success

──── M01.4 · 按 Agent 收紧可见工具 ────
   requested_tools = [lookup]
   orchestrator_tools = []
   per_agent_surface = []
   visibility_owner = kernel
REAL_STAGE_OK M01.4 calls=1 ms=2316 in=12240 out=180 finish=success

──── M01.5 · 单调守卫：只能拒绝，不能放行 ────
   rescued = audit:rescued
   monotonic_guard = False
   unknown_stage_refusal = unknown stage 'typo' on pipeline 'tool_pipeline'; declared stages: audit, guard
   replaced_handler_kept = True
REAL_STAGE_OK M01.5 calls=1 ms=1120 in=12239 out=10 finish=success

──── M01.d · 专项真实演示：内核自主决定调用工具 ────
   kernel_tool_calls = [Bash]
   answer = 7 词 / 49 字符
   orchestrator_tools = []
REAL_STAGE_OK M01.d calls=1 ms=3376 in=28000 out=245 finish=success tools=Bash "7 词 / 49 字符"

REAL_MODULE_OK M01 stages=6 calls=6 failed=0
```

**对照自己的输出**：至少要有 `REAL_MODULE_OK M01 stages=6`。`M01.d` 那行带
`tools=Bash`——编排层没有注册任何工具，这个调用是**内核自己决定发起的**。
`ms=` 与 `in=` 的数字随端点速度浮动，不影响结论。

---

## 3. 注册：具名 stage 与幂等安装

打开 [`impl/tool_pipeline.py`](../M01-tool-pipeline/impl/tool_pipeline.py) 与
[`scenes/01_register_and_dispose.py`](../M01-tool-pipeline/scenes/01_register_and_dispose.py)。
这是一对最短的 scene/impl，适合先读。

```python
with EffectStack("m01-register") as effects:
    pipeline = ToolPipeline(backend, effects, stages=("audit", "guard"))
    report = pipeline.install("guard", tagged("guard"), tools=["lookup", "missing"])
    require(report.installed == ("lookup",), "为 lookup 安装包装", report)
    require(report.missing == ("missing",), "报告缺失工具", report)
```

三个性质直接对应第 2 节 M01.1 的三行事实：

- **具名**：`stages=("audit", "guard")` 是管道的"宪法"——能装哪些 stage 在构造时就定了，
  装一个没声明的 stage 会在安装期抛 `UnknownStageError`（M01.5 的
  `unknown_stage_refusal` 就是它的原文）。
- **幂等**：`report.installed` 只含第一次装的 `lookup`，重复安装同一 stage 返回 `already`，
  **不叠包装**——`composed = audit(guard(raw:x))` 里每个 stage 只执行一次。
- **可逆**：`install()` 把 disposer 登记进 `EffectStack`。`with` 退出时按 LIFO 回收，
  `restored = True` 表示原 handler 回来了，而且**工具注册本身保留**
  （回收包装不等于注销工具）。

> **原理对照**：`iota-core/src/iota_core/tool_pipeline.py::class ToolPipeline`。
> DSH 侧等价物是 `ctx.tools.register()` + Fiber 回收（见 dsh 第 01 课第 3 节）——
> 两边都是"注册挂在可逆资源上"，差别在 Cordis 用插件 fiber，iota 用显式 effect 栈。

---

## 4. 执行前拒绝：有"门"，没有"协议"

打开 [`scenes/02_deny_before_execute.py`](../M01-tool-pipeline/scenes/02_deny_before_execute.py)。
`blocking(reason)` 是一层执行前拒绝的包装：调用根本到不了内层 handler。

```python
pipeline.install("guard", blocking("m01 禁止 lookup"), tools=["lookup"])
try:
    backend.tools["lookup"].handler("x")
except PermissionError as exc:
    refusal = str(exc)          # → refusal = m01 禁止 lookup
```

但注意它**只能**拒绝——要么放行要么抛错。DSH 的 `pre-execute` 是三态协议
（`allow` / `deny` / `ask`，ask 交给审批面问人）；iota 编排层没有这个协议，场景用一条
"负证据"断言了它的不存在：

```python
approval_surface = sorted(
    name for name in vars(Registry()) if "approv" in name or "permission" in name
)
require(approval_surface == [], "编排层没有审批注册面", approval_surface)
```

`approval_surface = []` 就是边界证据：**`Registry` 上不存在任何审批注册面**。
想问人？要么内核自己有审批协议（M06 会看到内核的 permission 通道），要么宿主自己定义。

---

## 5. 结果变换：顺序即语义，但只有一个通道

打开 [`scenes/03_transform_after_execute.py`](../M01-tool-pipeline/scenes/03_transform_after_execute.py)。
同一个管道里，安装顺序决定组合方向：

```text
guard_then_audit = audit(guard(raw:x))   # 先装 guard 再装 audit → audit 在外层
audit_then_guard = guard(audit(raw:x))   # 先装 audit 再装 guard → guard 在外层
```

**后装的 stage 位于外层，`stages` 声明顺序不自动重排**。这既是灵活（执行顺序就是组合语义），
也是负担（安全性质不能靠"声明一个 guard stage"获得，见第 6 节）。

第三行 `canonical_content_split = False` 是与 DSH 的另一个结构差异：DSH 的工具契约分开
返回 **canonical value**（进审计的事实）与 **render 后的模型可见 content**；iota 的包装只有
一个返回值通道——改了它，"事实"和"呈现"就一起变了。

---

## 6. 可见性与单调性：两条"必须由别人提供"的性质

### 可见性：注册面是进程级的

[`scenes/04_no_per_agent_visibility.py`](../M01-tool-pipeline/scenes/04_no_per_agent_visibility.py)
先确认 `AgentConfig.tools` 只是**请求清单**：

```python
config = AgentConfig(name="m01-visibility", kernel=harness.kernel, tools=["lookup"])
require(config.tools == requested, "AgentConfig 只记录请求的工具清单", config.tools)
require(harness.registry.tools.list() == [], "编排层注册面为空", harness.registry.tools.list())
per_agent_surface = sorted(
    name for name in dir(harness.registry.tools) if "agent" in name or "scope" in name
)
require(per_agent_surface == [], "工具注册面没有 per-agent 视图", per_agent_surface)
```

输出 `visibility_owner = kernel`：注册面按名字**全局**登记，没有 per-Agent 视图。
模型最终看见哪些工具，由内核按它自己的披露规则裁定（`AgentConfig.tools` 是给内核的
**请求**，不是编排层的**授权**）。DSH 的 `tools.restrict()` 那条收紧面在 iota 没有对位物。

### 单调守卫：包装顺序给不了"拒绝不可翻案"

[`scenes/05_stages_are_not_monotonic.py`](../M01-tool-pipeline/scenes/05_stages_are_not_monotonic.py)
用一层 `rescuing` 包装制造翻案：

```python
pipeline.install("guard", blocking("m01 禁止 lookup"), tools=["lookup"])   # 内层：拒绝
pipeline.install("audit", rescuing("audit"), tools=["lookup"])              # 外层：吞掉拒绝
rescued = backend.tools["lookup"].handler("x")
require(rescued == "audit:rescued", "外层把内层拒绝改写成成功", rescued)
```

`rescued = audit:rescued`——**内层明明拒绝了，外层把拒绝改写成成功**。这就是本课的核心
结论：通用包装的组合**不是**单调守卫。"拒绝不可被覆盖"这条语义必须由一个**返回类型上
没有"放行"**的机制提供（DSH 的 `ToolGuard` 就是这样设计的）；在 iota，硬红线要放在
内核侧或宿主侧，不能指望 stage 顺序。

同一个场景还断言了两条纪律：

- **错名拒绝**：`pipeline.install("typo", …)` 抛
  `unknown stage 'typo' on pipeline 'tool_pipeline'; declared stages: audit, guard`，
  且**不留 disposer**（`len(effects)` 不变）——失败的安装不产生半成品资源。
- **身份安全回收**：外部把 handler 换成自己的函数后，effect 退出时**按身份比较**，
  不会把别人的新函数覆盖回旧值（`replaced_handler_kept = True`）。

---

## 7. M01.d：内核自主决定调用工具

[`scenes/06_kernel_chooses_tool.py`](../M01-tool-pipeline/scenes/06_kernel_chooses_tool.py)
给内核一个**不能凭猜测完成**的任务：数词数和字符数。

```python
PROMPT = (
    f'请用 Bash 工具（例如 wc）统计这句话的词数和字符数，不要自己数："{SENTENCE}"。'
    "最后只回复一行：N 词 / M 字符。"
)
```

要求非常具体（"用 Bash、不要自己数"），但**编排层既没有注册这个工具，也没有干预它的选择**：

```text
kernel_tool_calls = [Bash]        ← 调用由内核发起，事件从内核回传
answer = 7 词 / 49 字符           ← 内核用 wc 算出来的答案
orchestrator_tools = []           ← 全程为空
```

与 dsh 同编号阶段的差别一图流：dsh 的 `M01.d` 里 `word_count` 是**编排层注册**、模型看见
schema 后调用的；iota 的 `M01.d` 里 `Bash` 是**内核自带**、编排层只转发了提示词。
`tools=` 字段在两边都出现在 `REAL_STAGE_OK` 行上，但归属已经换了——这就是
"结构性边界"在日志里的样子。

场景里还有一条值得记住的实现纪律：

```python
final = next(event for event in events if event.type == "final")
answer = str(getattr(final, "text", ""))
```

`final` 是内核裁定的答案，`text_delta` 是过程叙述，**两者不能拼在一起**（会重复一遍）。

---

## 8. 排障：包装装了，"策略"却没生效

### 症状

给管道加了一层拒绝包装，但希望它表现为"先问人再决定"，或者希望它只对某一个 agent 生效，
怎么都做不到。

### 定位

1. 先看 `stages=` 声明里有没有这个 stage 名——没有就在安装期抛 `UnknownStageError`
   （这不是运行期问题，是构造期就把口子收窄了）。
2. 再看需求属于哪一类：**问人**是三态协议（M01.2 的 `approval_surface = []` 证明编排层没有）；
   **按 agent 收紧**是 per-Agent 可见面（M01.4 的 `per_agent_surface = []` 证明没有）。

### 原因与修改

这不是 bug，是边界。包装链能给你"执行前拒绝"和"结果改写"，**给不了审批语义和披露语义**。
修改方向只有两个：把策略放进内核侧配置（换一个提供该协议的内核），或者在宿主层自己实现
审批回路，再把结论写回给内核。iota 编排层不假装有这个面。

---

## 9. 代码在哪

```bash
cd iota-example && ls M01-tool-pipeline/impl M01-tool-pipeline/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/tool_pipeline.py`](../M01-tool-pipeline/impl/tool_pipeline.py) | `tagged`（变换）、`blocking`（拒绝）、`rescuing`（翻案）三种 `WrapFn` |
| [`scenes/01_register_and_dispose.py`](../M01-tool-pipeline/scenes/01_register_and_dispose.py) | `installed/missing/already` 报告与 effect 回收 |
| [`scenes/02_deny_before_execute.py`](../M01-tool-pipeline/scenes/02_deny_before_execute.py) | 执行前拒绝 + `approval_surface` 负证据 |
| [`scenes/03_transform_after_execute.py`](../M01-tool-pipeline/scenes/03_transform_after_execute.py) | 安装顺序 = 组合方向 |
| [`scenes/04_no_per_agent_visibility.py`](../M01-tool-pipeline/scenes/04_no_per_agent_visibility.py) | `AgentConfig.tools` 是请求清单不是授权 |
| [`scenes/05_stages_are_not_monotonic.py`](../M01-tool-pipeline/scenes/05_stages_are_not_monotonic.py) | `rescued` 翻案、错名拒绝、身份安全回收 |
| [`scenes/06_kernel_chooses_tool.py`](../M01-tool-pipeline/scenes/06_kernel_chooses_tool.py) | 内核自主调用；`final` 与 `text_delta` 不拼接 |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**；断言
（`require(…)`）就是这一阶段的"可验证答案"。

---

## 10. 动手练习

### 练习 A：换一个组合方向

把 [`scenes/03`](../M01-tool-pipeline/scenes/03_transform_after_execute.py) 里第一轮的安装顺序
反过来（先 `audit` 再 `guard`），重新运行：

```bash
cd iota-example && uv run python -m runtime.runner M01 --scene 03_transform_after_execute
```

**可验证答案**：`guard_then_audit` 与 `audit_then_guard` 的值互换——外层永远是后装的那个。
顺序变了，语义就变了；这就是"声明顺序不自动重排"的含义。

### 练习 B：验证幂等安装

在 [`scenes/01`](../M01-tool-pipeline/scenes/01_register_and_dispose.py) 里再调一次
`pipeline.install("guard", tagged("again"), tools=["lookup"])`，然后看
`composed` 的值：

**可验证答案**：`composed` 仍是 `audit(guard(raw:x))`——第二次安装返回 `already`，
包装没有叠加，`again` 没有出现。

### 练习 C（进阶）：给管道加一个新 stage

在 `ToolPipeline(backend, effects, stages=…)` 的声明里加一个 `"policy"` stage，并给它
装一个 `blocking` 包装。

**可验证答案**：不改动 `stages` 声明时安装它抛 `UnknownStageError`；声明之后安装成功，
且 effect 退出后 handler 恢复原值。`stages` 声明就是管道的能力清单——
**能在构造期拒绝的，不要拖到运行期**。

---

**下一课** → [第 02 课 · 上下文装配与经济学](02-context-assembly.md)：哪些内容进入下一轮，由作用域记忆回答。
