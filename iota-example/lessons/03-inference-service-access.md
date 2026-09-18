# 第 03 课 · 推理服务接入：替换单元与能力声明

> **本课任务**：看清推理服务接入层的替换单元与拒绝时机——换内核换的是整个 `KernelAdapter`；
> 节点要求的能力内核声明不了时，图在运行之前就被拒绝；而同一个事件消费循环接真实内核，
> 协议不变量原样成立，消费循环不认供应商。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M03`
> **你将看到**：`replaceable_unit = KernelAdapter`、`registered_adapters = [dsh, hermes, hermes_direct, m03-kernel, nanobot]`；M03.1 的拒绝原文
> `acp_refusal = node 'infer': kernel 'acp' cannot activate per-node model middleware/hooks ['llm_execution']; remove them or use a kernel that advertises per_session_middleware`；
> M03.d 的 `event_counts = {step_start: 1, text_delta: 1, final: 1, step_end: 1}`（Hermes 内核）。

前置：[第 02 课 · 上下文装配与经济学](02-context-assembly.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见 [dsh-example/lessons/03-inference-service-access.md](../../dsh-example/lessons/03-inference-service-access.md)——那边讲 Provider 路由与流中间件 waterfall，本课讲 iota 的替换单元为什么是整个适配器、能力声明为什么在编译期兑现。

---

## 1. 本课任务

DSH 在这一层有两个可替换单元：**Provider 路由**（这次请求发给哪个适配器，由请求参数的
`provider`/`model` 决定）与**流中间件**（`llm/stream` waterfall 逐条包装/接管一次模型调用的
chunk 流）。iota 的替换单元只有一个，而且是**整个 `KernelAdapter`**：登记按适配器整体进行，
能力按适配器声明兑现——节点想要"包装单次模型调用"这种能力而内核没声明时，`GraphCompiler`
在**运行之前**就把图拒绝了。

M03 两边都只有两个阶段，编号逐一对齐（[`run.py`](../M03-inference-service-access/run.py)）：
**M03.1** 对位流中间件控制面——dsh 用 waterfall 造出这个能力，iota 给出结构性边界的答案
（同一个诉求在图声明里提出，内核没声明这项能力，编译期直接拒绝）；**M03.d** 两边都是
专项真实演示：同一个消费循环接真实服务，核对协议不变量。

| DSH 控制面 | iota 侧机制 | 归属判定 |
|---|---|---|
| Provider 路由：请求参数把这次调用发给某个适配器 | `register_adapter()` 以**整个 `KernelAdapter`** 为单位登记，返回 disposer | **结构性边界**：替换粒度是整个内核，不是单次调用 |
| 流中间件：`llm/stream` waterfall 逐条包装/接管 chunk 流 | 图节点可用 `middleware_refs` 声明同样的诉求；内核声明里没有时 `GraphCompiler` 抛 `GraphValidationError` | **结构性边界**：单次模型调用的 middleware 属于内核 |
| 流协议：`StreamChunk` 序列的不变量在真实 SSE 上核对 | 同一个事件消费循环核对 `text_delta → final` 子序列、`final` 唯一、step 包裹 | **语义等价**：消费循环只认事件协议，不认供应商 |

```bash
cd iota-example && uv run python -m runtime.runner M03
```

两个阶段都免不了真实调用：M03.1 是 `mechanism` 阶段（入口先跑一次 probe），M03.d 是
`model` 阶段（场景自己发起调用）。密钥与装配见[第 00 课](00-getting-started.md)。

---

## 2. 真实输出

```text
████ M03 · 推理服务接入：替换单元与能力声明 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M03.1 · 包装单次模型调用被编译期拒绝 ────
   replaceable_unit = KernelAdapter
   registered_adapters = [dsh, hermes, hermes_direct, m03-kernel, nanobot]
   per_session_middleware = False
   acp_refusal = node 'infer': kernel 'acp' cannot activate per-node model middleware/hooks ['llm_execution']; remove them or use a kernel that advertises per_session_middleware
   rejected_at = compile-time
REAL_STAGE_OK M03.1 calls=1 ms=1646 in=12239 out=10 finish=success

──── M03.d · 专项真实演示：同一事件消费循环接真实内核 ────
   event_counts = {step_start: 1, thinking: 1, text_delta: 1, final: 1, step_end: 1}
   text_sample = 事件协议已核对。
   finish = success
   usage = {input_tokens: 12237, output_tokens: 38}
REAL_STAGE_OK M03.d calls=1 ms=14265 in=12237 out=38 finish=success "事件协议已核对。"

REAL_MODULE_OK M03 stages=2 calls=2 failed=0
```

**对照自己的输出**：最后一行必须是 `REAL_MODULE_OK M03 stages=2 calls=2 failed=0`。
M03.1 的 `calls=1` 是入口 probe 的那次真实内核调用——本地断言本身不调用内核；M03.d 的
`"事件协议已核对。"` 是 `final` 文本的样本，按 runner 的规则附在 `model` 阶段的
`REAL_STAGE_OK` 行尾。`ms=`、`in=`、`usage` 的数字随端点与模型行为浮动；`event_counts` 的
**键集**也随内核行为浮动——本次运行内核发了一个 `thinking` 事件，下次可能没有，受检的是
协议不变量（第 6 节），不是键集本身。你的终端里还可能出现 `[claude-code:unrecognized_model]`
行——[第 00 课](00-getting-started.md)讲过它不是错误，此处省略。

---

## 3. 替换单元：整个 `KernelAdapter`

打开 [`scenes/01_reject_model_middleware.py`](../M03-inference-service-access/scenes/01_reject_model_middleware.py)
与 [`impl/acp_boundary.py`](../M03-inference-service-access/impl/acp_boundary.py)。场景第一件事是登记：

```python
    # ① 替换单元：换名字登记同一个适配器，粒度是整个内核，不是某次调用。
    harness.effects.push(
        register_adapter("m03-kernel", lambda _build: harness.adapter),
        "provider:m03-kernel",
    )
    require(is_adapter_registered("m03-kernel"), "新名字登记的仍是同一个 KernelAdapter")
```

factory 返回的是 `harness.adapter`——**换一个名字，登记的仍是同一个适配器实例**。Provider
注册表里没有"某次调用的中间件"这种条目，最小的替换单位就是整个内核，正对应日志前两行：

```text
   replaceable_unit = KernelAdapter
   registered_adapters = [dsh, hermes, hermes_direct, m03-kernel, nanobot]
```

五个名字里，`dsh`、`hermes`、`hermes_direct`、`nanobot` 是 iota-core 的内建登记
（`iota-core/src/iota_core/adapter_providers.py::register_builtin_providers`），`m03-kernel`
是场景刚登记的。`register_adapter()` 的实现在 `iota-core/src/iota_core/providers.py`：

```python
def register_adapter(name: str, factory: AdapterFactory) -> Callable[[], None]:
    """Register an adapter factory under *name*, returning its disposer.

    The disposer exists for the same reason registry disposers do (see
    :mod:`iota_core.effects`): a test or an embedding host that registers a
    kernel must be able to take it back out without leaving the process in a
    state nobody can describe.
    """
    _ADAPTERS[name] = factory
    logger.debug("registered adapter provider: %s", name)

    def dispose() -> None:
        if _ADAPTERS.get(name) is factory:
            del _ADAPTERS[name]

    return dispose
```

两个性质值得各记一遍：

- **同名覆盖**：`_ADAPTERS[name] = factory` 是字典赋值——再登记同名就是换 factory，没有
  "已存在"的拒绝。对比第 01 课 `ToolPipeline.install()` 的幂等（重复安装返回 `already`）：
  适配器登记这边是**最后一个说了算**。
- **按身份回收**：disposer 只在"登记的还是我这份 factory"时才移除——与第 01 课
  `replaced_handler_kept = True` 同一条身份纪律：覆盖之后，旧登记的 disposer 变成空操作。

顺带解释一个你一定注意到的细节：**列表里为什么没有 `claude`？**本模块的内核就是
ClaudeAdapter，名字理应在。原因是每个 `mechanism` 阶段的入口 probe 都自建一个 harness
（[`runtime/runner.py`](../runtime/runner.py) 的 `probe_assembly()`），装配时会再次
`register_adapter("claude", …)` 覆盖登记；probe 结束 `close()` 时，它的 disposer 按身份把
这一条移除。场景打印列表时 probe 已结束，你看到的是 probe 之后的注册表面——练习 C
会让你亲手验证。

> **原理对照**：`iota-core/src/iota_core/adapters/base.py::class KernelAdapter`——内核接入的
> 全部抽象面（`start()`、`capabilities()`、`create_session()`、`stream()`、`close()`）都定义在
> 这一个基类上。DSH 侧等价物是 `ctx.llm` 的 Provider 路由 + 流中间件（dsh 第 03 课第 3 节）：
> 那边"路由发生在每次请求"，iota"替换发生在整个内核"。

---

## 4. 能力声明：`KernelCapabilities.from_adapter_payload()`

场景第二步把"适配器声明"投影成"编译器读得懂的能力"：

```python
    # ② 能力声明：ACP 内核不声明按会话生效的模型 middleware。
    capabilities = KernelCapabilities.from_adapter_payload(await acp_adapter().capabilities())
    require(
        capabilities.per_session_middleware is False,
        "ACP 不声明按会话生效的模型 middleware",
        capabilities.per_session_middleware,
    )
```

`acp_adapter()` 来自 [`impl/acp_boundary.py`](../M03-inference-service-access/impl/acp_boundary.py)：

```python
def acp_adapter() -> HermesAcpAdapter:
    return HermesAcpAdapter(command=["true"])
```

`command=["true"]`——这个适配器根本不启动进程。`capabilities()` 读的是**适配器自己的
声明**，不是实测，所以这条边界可以离线观察（impl 文件头的注释说的就是这一点）。投影结果
对应日志：

```text
   per_session_middleware = False
```

为什么是 False？`iota-core/src/iota_core/adapters/hermes_acp.py` 的 `capabilities()` 把理由
写在了声明旁边：

```python
            # The subprocess is not known to activate per-session middleware for
            # the node scope we pass in _meta. Until that is verified end to end
            # (and possibly changed inside hermes-agent), nodes that declare model
            # middleware/hooks must fail at compile time rather than run without
            # them. See docs/develop/architecture/graph-node-hooks.md.
            "per_session_middleware": False,
```

也就是说：ACP 适配器确实会把节点作用域的引用转发给子进程，但**没人验证过子进程真的消费
了它们**——于是声明保持 False。这是"跨进程内核只声明验证过的能力"的原文注脚（详见
`iota-core/docs/develop/architecture/graph-node-hooks.md::Hermes 侧的落地方式`）。

投影的两端都在 `iota-core/src/iota_core/graph/types.py`。接收端把能力声明当硬契约：

```python
class KernelCapabilities(BaseModel):
    """What a kernel adapter can actually honour, per session.

    The graph compiler consults this before a run starts. Anything a node asks
    for that the kernel cannot honour is a ``ConfigError`` at compile time —
    never a silent downgrade.
    """
```

投影端 `from_adapter_payload()` 把适配器的松散 dict 收紧成能力模型，docstring 的关键一句是
"Unknown keys are ignored and unreported capabilities default to ``False``, which makes
the compiler reject node features the adapter has not explicitly claimed"——**未声明即拒绝**。
`per_session_middleware = False` 因此不是"暂不支持"的软提示，而是编译器眼中的硬边界。

> **原理对照**：`iota-core/docs/develop/architecture/graph-node-hooks.md` 的边界原话——
> "模型调用发生在内核内部（同进程 Hermes 的线程里，或 ACP 子进程里），iota-core 无法替
> 内核承诺什么。" DSH 的 `llm/stream` waterfall 之所以存在，是因为 DSH 的适配器就住在宿主
> 进程里，chunk 流必然流经宿主；iota 的 ACP 内核在子进程里，单次模型调用根本不经过编排层。

---

## 5. 编译期拒绝：运行之前就说不

第三步是本课的核心负证据：一张引用了模型 middleware 的图，交给声明里没有这项能力的内核——

```python
    # ③ 因此，引用了模型 middleware 的图在运行之前就被拒绝。
    compiler = GraphCompiler(registry_with_middleware(), capabilities={"acp": capabilities})
    try:
        compiler.compile(middleware_graph(), default_kernel="acp", default_model="m03-model")
    except GraphValidationError as exc:
        refusal = "; ".join(exc.problems)
    else:  # pragma: no cover
        fail("ACP 模型 middleware 在编译期被拒绝")
    require("middleware/hooks" in refusal, "拒绝信息指出 middleware/hooks 边界", refusal)
```

图声明在 [`impl/acp_boundary.py`](../M03-inference-service-access/impl/acp_boundary.py)，节点用
`"<point>:<name>"` 语法引用注册表里的 middleware：

```python
            NodeSpec(
                node_id="infer",
                executor_type="react",
                prompt_template="m03-inference",
                middleware_refs=[f"llm_execution:{MIDDLEWARE}"],
            )
```

`compile()` 的第一步就是 validate（`iota-core/src/iota_core/graph/compiler.py` 里，
`self._validator.validate(spec, default_kernel=…, default_model=…)` 排在任何节点编译、
任何拓扑计算之前）。拒绝原文在 `iota-core/src/iota_core/graph/validator.py` 里逐字拼出来。
能力开关、点名的能力点、两条出路，全在一条 problem 里：

```python
        if (node.middleware_refs or node.hook_refs) and not caps.per_session_middleware:
            model_points = {
                "llm_request",
                "llm_execution",
                "pre_api_request",
                "post_api_request",
            }
            requested = {
                split_ref(ref)[0]
                for ref in (*node.middleware_refs, *node.hook_refs)
                if split_ref(ref)[0] in model_points
            }
            if requested:
                problems.append(
                    f"{where}: kernel '{kernel}' cannot activate per-node model "
                    f"middleware/hooks {sorted(requested)}; remove them or use a kernel "
                    "that advertises per_session_middleware"
                )
```

渲染到日志就是这两行：

```text
   acp_refusal = node 'infer': kernel 'acp' cannot activate per-node model middleware/hooks ['llm_execution']; remove them or use a kernel that advertises per_session_middleware
   rejected_at = compile-time
```

三个读法：

- **`node 'infer'` 是 `where`**——validator 检查每个节点时构造 `where = f"node '{node.node_id}'"`，
  拒绝信息从节点出发，不从内核出发：**是节点要求的能力兑现不了**。
- **`['llm_execution']` 是排序去重后的集合**——节点引用了哪些模型级能力点，拒绝信息就点名
  哪些；引用的名字（`trace`）与条数都不出现。
- **两条出路都在原文里**：`remove them`（把引用从节点上拿掉）或 `use a kernel that
  advertises per_session_middleware`（换声明了这项能力的内核）。

`GraphValidationError` 一次校验收集**全部** problem（docstring："Raised with every problem
found in one graph spec."）；场景里 `"; ".join(exc.problems)` 就是为多 problem 准备的，本次
只有一个 problem，所以分号没出现。

**拒绝发生在图运行之前**：没有一次内核调用被浪费在一张注定兑现不了声明语义的图上，也
不会出现"字段转发过去了、子进程实际没执行"的静默降级——那份架构文档的原话是"不存在
静默降级路径"。

> **原理对照**：`iota-core/src/iota_core/graph/compiler.py::class GraphCompiler`。同一个
> 诉求——"我想包装一次模型调用"——在 DSH 那里做成 `llm/stream` waterfall（dsh 第 03 课
> 第 3 节），在 iota 这里被能力声明打发回编译期；ACP 侧的这份拒绝见
> `iota-core/docs/develop/architecture/graph-node-hooks.md::引用语法与校验`。

---

## 6. M03.d：同一个事件消费循环接真实内核

[`scenes/02_consume_kernel_stream.py`](../M03-inference-service-access/scenes/02_consume_kernel_stream.py)
的文件头把协议说得很清楚：

```python
"""专项真实演示：用同一个事件消费循环接真实内核，核对事件协议不变量。

对位 DSH 的"同一 StreamChunk 消费循环接真实 SSE"：消费循环不认供应商，只认事件协议。
iota 这边的协议是"编排层的 step 包裹内核事件"——`step_start` 开头、`step_end` 收尾，
中间按子序列出现 `text_delta → final`，而且 `final` 只出现一次。
"""
```

场景给内核的提问是复述型指令，事件经 `harness.stream(...)` 全量收集后逐条核对：

```python
    # 提问故意是确定性的：这一阶段要核对的是事件协议，不是模型的创造力。
    events = await harness.stream(
        "请把下面这句话原样复述一遍，不要加别的内容：事件协议已核对。", name="m03-stream"
    )
```

```python
    require(kinds[0] == "step_start", "编排层的 step 包在最外侧", kinds)
    require(kinds[-1] == "step_end", "step_end 收尾", kinds)
    require(counts["final"] == 1, "终止事件只出现一次", counts)
    require_event_order(kinds, STANDARD)
    require(bool((final.text or text).strip()), "真实事件流里有非空文本")
```

前四条是协议不变量，对上日志的这行事实：

```text
   event_counts = {step_start: 1, thinking: 1, text_delta: 1, final: 1, step_end: 1}
```

- **step 包最外侧**：`step_start` 开头、`step_end` 收尾——编排层的 step 包裹内核事件；
- **`final` 恰好一次**：终止事件不重复，下游可以放心"见到 final 就收尾"；
- **`text_delta → final` 按序出现**：标准事件只取**内核无关**的那些。`system_init`
  （`iota-core/src/iota_core/types.py::class SystemInitEvent`）虽然确实存在，但它是
  Claude 适配器特有的启动握手快照，Hermes 不产出——所以它**不进标准子序列**。

### `thinking: 1` 是这份日志的隐藏考点

在 claude 内核下，事件流里还会插入 `system_init`、`thinking` 这类**内核自有事件**——
它们不影响标准子序列的成立。这正是"按子序列校验"的意义：`events` 因内核而异，
契约不绑死在某一家的序列上。原因写在 [`runtime/harness.py`](../runtime/harness.py) 的 `require_event_order`
注释里：

```python
def require_event_order(observed: Sequence[str], expected: tuple[str, ...]) -> None:
    """按**子序列**校验事件顺序。

    不同内核会在标准事件之间插入自己的事件（step、thinking、工具调用…），
    所以"顺序正确"应表述为"这几个标准事件按序出现"，而不是"事件列表完全等于某个字面量"。
    写成相等会让示例只在某一个内核的事件序列下成立，那正是本工程要避免的假象。
    """
```

注释举的例子（thinking）在这份日志里成了事实：如果把断言写成"事件列表等于某个字面量"，
换一个内核、甚至同一内核的下一轮（thinking 不出现）都会破坏它。**按子序列核对，协议
检查才对供应商与轮次稳定。**

思考事件也不进文本面：`ClaudeAdapter` 把内核的 `ThinkingBlock` 忠实翻译成
`ThinkingDeltaEvent`（`type="thinking"`）单独成面（`iota-core/src/iota_core/adapters/claude.py`），
而场景里 `text` 只累加 `text_delta`、`final.text` 是内核裁定的答案——所以 `thinking` 出现与否，
`text_sample` 都是 `事件协议已核对。`。这与 dsh 第 03 课第 6 节"thinking 块映射成
reasoning-delta、单独成面"是同一条纪律，只是事件名不同。

### finish 与 usage：从 `final` 读，不从 delta 拼

场景从唯一的 `final` 事件读终态，再镜像成事实：

```python
    return {
        "event_counts": dict(counts),
        "text_sample": sample(final.text or text, 60),
        "finish": "error" if final.is_error else (final.subtype or "stop"),
        "usage": {key: reported.get(key, 0) for key in ("input_tokens", "output_tokens")},
    }
```

`finish = success` 读的是 `final.subtype`，`usage` 读的是 `final.usage`——两者都是内核权威
结果镜像到 `FinalEvent` 上的元数据（"结果是数据，不是控制流"）。`text_sample` 优先取
`final.text`、不与 `text_delta` 拼接——与第 01 课"final 是内核裁定的答案、text_delta 是
过程叙述，两者不能拼在一起"是同一条纪律，对应日志的三行事实：`text_sample = 事件协议已核对。`、
`finish = success`、`usage = {input_tokens: 12237, output_tokens: 38}`。

### 消费循环不认供应商

场景脚本里没有出现任何供应商名字：MiniMax 还是 Fuyao 只由 `.env` 的 `LLM_VENDOR` /
`LLM_BASE_URL` / `LLM_MODEL` 决定（[第 00 课](00-getting-started.md)），换供应商只换内核配置
这一个替换单元，消费循环与断言一行不改。对位 dsh 的 M03.d：那边四行
`协议检查: … = true` 核对 StreamChunk 协议，这边四条不变量核对 AgentEvent 协议——协议名
不同，思想相同：**下游只认协议，就能放心收尾**。

---

## 7. 排障：给内核节点配了模型 middleware，图编译总在失败

### 症状

你在 `GraphSpec` 的节点上写了 `middleware_refs=["llm_execution:trace"]`（`hook_refs`
同理），middleware 名字也用 `registry.node_middlewares.register(...)` 注册了，但
`GraphCompiler.compile()` 总是抛 `GraphValidationError`，运行还没开始就失败。你反复检查
注册代码，看不出问题。

### 定位

1. 先读错误原文——拒绝信息点名的是**内核的能力声明**，不是注册表：`kernel 'acp' cannot
   activate per-node model middleware/hooks ['llm_execution']`。注册没有问题：M03.1 的图里
   `trace` 就是注册过的，照样被拒。
2. 核对这个内核的声明：`KernelCapabilities.from_adapter_payload(await adapter.capabilities())`
   之后，`per_session_middleware` 是不是 `False`——日志里的 `per_session_middleware = False`
   就是这么读出来的。
3. 确认节点跑在哪个内核上（`default_kernel="acp"`，或节点自己的 kernel 字段）——能力检查
   按节点实际使用的内核逐个进行。

### 原因与修改

这不是注册问题，是边界：**单次模型调用的 middleware 属于内核能力**，跨进程内核只声明
验证过的能力（ACP 把节点作用域转发给子进程，但没验证子进程消费，所以声明 False）。两条
出路都在错误原文里：`remove them`——把模型级引用从节点上拿掉，内核侧的等价观测走内核
自己的机制；`use a kernel that advertises per_session_middleware`——换声明了这项能力的
内核（如同进程的 Hermes Direct）。

不要去改 ACP 适配器把声明改成 True——那是把"没验证"说成"已支持"，把一次拒绝变成一次
静默忽略，正是这套机制存在要消灭的 bug 类。编译期失败就是这条边界的正确行为。

---

## 8. 代码在哪

```bash
cd iota-example && ls M03-inference-service-access/impl M03-inference-service-access/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/acp_boundary.py`](../M03-inference-service-access/impl/acp_boundary.py) | `acp_adapter()`（`command=["true"]`，声明可离线读）；`middleware_graph()`（`llm_execution:trace` 引用） |
| [`scenes/01_reject_model_middleware.py`](../M03-inference-service-access/scenes/01_reject_model_middleware.py) | ①登记 ②能力投影 ③编译期拒绝，三步对应日志三组事实 |
| [`scenes/02_consume_kernel_stream.py`](../M03-inference-service-access/scenes/02_consume_kernel_stream.py) | 事件协议四条不变量；`thinking` 不进文本面；finish/usage 取自 `final` |
| [`run.py`](../M03-inference-service-access/run.py) | 阶段清单：M03.1 与 M03.d，编号与 dsh 逐一对齐 |
| [`runtime/runner.py`](../runtime/runner.py) | `probe_assembly()`（mechanism 阶段的入口 probe 与 `close()`） |
| [`runtime/harness.py`](../runtime/harness.py) | `require_event_order()` 的子序列语义；`create_harness()` 的 `register_adapter` 登记 |

iota-core 侧的关键实现按 `项目/文件::符号` 引用（editable source 在仓库外，`pyproject.toml`
的 `[tool.uv.sources]` 指向它）：`register_adapter` 与按身份回收的 disposer 在
`iota-core/src/iota_core/providers.py`；`iota-core/src/iota_core/adapters/base.py::class KernelAdapter`、
`iota-core/src/iota_core/graph/types.py::class KernelCapabilities`、
`iota-core/src/iota_core/graph/compiler.py::class GraphCompiler` 分别定义替换单元、能力模型
与编译器；拒绝原文的拼接处是 `iota-core/src/iota_core/graph/validator.py`。逐模块对照与
证据锚点见 [`docs/dsh-vs-iota.md`](../docs/dsh-vs-iota.md)。

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**；断言（`require(…)`）就是
这一阶段的"可验证答案"。

---

## 9. 动手练习

### 练习 A：让拒绝信息点名两个能力点

在 [`impl/acp_boundary.py`](../M03-inference-service-access/impl/acp_boundary.py) 的
`middleware_graph()` 里，把 `middleware_refs` 改成同时引用两个合法的模型 middleware 点：

```python
                middleware_refs=[f"llm_execution:{MIDDLEWARE}", f"llm_request:{MIDDLEWARE}"],
```

**验证命令**

```bash
cd iota-example && uv run python -m runtime.runner M03 --scene 01_reject_model_middleware
```

**可验证答案**：`acp_refusal` 里的能力点列表从 `['llm_execution']` 变成
`['llm_execution', 'llm_request']`（`sorted(requested)`，集合去重），`rejected_at =
compile-time` 不变。两个引用用的是同一个已注册名字 `trace`——拒绝信息点名的是**能力点**，
不是 middleware 名字。改完把引用改回去。

### 练习 B：把 middleware 引用整个删掉，看场景怎么"反向"失败

把 `middleware_graph()` 里 `middleware_refs=[…]` 这一行删掉（节点不引用任何
middleware），再跑同一个场景。

**验证命令**

```bash
cd iota-example && uv run python -m runtime.runner M03 --scene 01_reject_model_middleware
```

**可验证答案**：进程非零退出，报 `检查失败：期望 ACP 模型 middleware 在编译期被拒绝`——
编译**成功**了，场景把"编译成功"本身当成 bug（`else: fail(...)`）。这个反向失败证明
被拒绝的是**节点要求的能力**，不是内核本身：同一个 ACP 内核、同一张图，节点不引用模型
middleware 就能通过编译。改完把引用加回去。

### 练习 C（进阶）：列表里为什么没有 `claude`

先在全新进程里看一眼注册表面：

**验证命令**

```bash
cd iota-example && uv run python -c "from iota_core.providers import available_adapters; print(available_adapters())"
```

**可验证答案**：打印 `('claude', 'dsh', 'hermes', 'hermes_direct', 'nanobot')`——全新进程里
`claude` 在（stderr 上可能另有一行 `Failed to import Hermes kanban tools` 的装配告警，与
本练习无关）。对照第 2 节 M03.1 的 `registered_adapters`（没有 `claude`）：差额来自
`probe_assembly()`——probe 自建 harness 时 `register_adapter("claude", …)` 覆盖登记，
结束时 `close()` 让它的 disposer 按身份把这一条移除，而场景打印列表发生在 probe 之后。
**disposer 只回收"还是自己的那份登记"**——这正是第 3 节身份纪律的运行期体现。

---

**下一课** → [第 04 课 · Agent 循环与干预面](04-agent-loop-intervention.md)：内核接上了、协议也核对了，下一课看一轮 Agent 循环由哪些事件与 hook 构成——哪些干预面归编排层，哪些状态始终在内核手里。
