# 第 02 课 · 上下文装配与经济学：作用域记忆与内核边界

> **本课任务**：分清 iota 治理的是"哪些内容进入下一轮"，而不是"请求怎么被拼出来"——作用域
> 记忆可召回、可写回；装配、压缩、计量、裁剪与溢出注册面都归内核。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M02`
> **你将看到**：`scopes = [user-a, project-a, session-a]`——三个作用域一路传到召回网关，命中的
> 记忆正文 `回答保持简洁` 出现在前缀里；`AgentConfig` 字段表里搜不出压缩开关
> （`faked_compression_fields = []`）；M02.4 的 `input_tokens = 12226` 与同一行 `REAL_STAGE_OK`
> 的 `in=12226` 同源——token 数字是内核报告的，不是编排层数的。

前置：[第 01 课 · 工具管线](01-tool-pipeline.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见
[dsh-example/lessons/02-context-assembly.md](../../dsh-example/lessons/02-context-assembly.md)——那边讲 section/variable/assemble/compaction 治理链，本课讲 iota 侧哪些环节有等价机制、哪些归内核。

---

## 1. 本课任务

DSH 把 Prompt section、变量装配、装配改写、token 计量、历史压缩、结果裁剪与 spill 连成一条
治理链（对照关系：**语义等价 + 结构性边界**）。iota 治理的对象换了一层：**不治理"请求怎么
被拼出来"，只治理"哪些内容进入下一轮"**——DSH 的链作用在请求形成的每一步，iota 能控制的
只有进出记忆系统的内容，请求本身由内核装配：

| DSH 控制面 | iota 侧机制 | 归属 |
|---|---|---|
| Prompt section（按 `order` 贡献片段） | `MemoryContextService.build_prompt_prefix()` 按作用域召回并渲染前缀 | **语义等价**：作用域记忆前缀 |
| variable 装配 + assemble waterfall（整体改写） | 没有——`Registry` 上搜不出装配注册面 | **结构性边界**：装配归内核 |
| token 计量（tokenMeter 回放估算） | 读 `FinalEvent.usage`；没有计量注册面 | **语义等价**：读数方向相反 |
| 历史压缩（compaction 折叠 surface） | 没有——`AgentConfig` 无压缩字段 | **结构性边界**：压缩归内核 |
| 结果裁剪（pruner 确定性裁剪） | 只有 `disable_conversation_history` 整体开关 | **结构性边界**：裁剪归内核 |
| spill（超长结果落文件带 locator） | 作用域记忆写回（`MemoryScopeResolver` + `MemoryWriteRequest`） | **语义等价**：写回代替外溢 |

```bash
cd iota-example && uv run python -m runtime.runner M02
```

---

## 2. 真实输出

```text
████ M02 · 上下文装配与经济学：作用域记忆与内核边界 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M02.1 · 按作用域贡献 Prompt 前缀 ────
   included_count = 1
   scopes = [user-a, project-a, session-a]
   prefix_contains = 回答保持简洁
REAL_STAGE_OK M02.1 calls=1 ms=1743 in=12239 out=99 finish=success

──── M02.2 · 装配改写属于内核 ────
   assembly_surface = []
   enable_memory_prompt = False
   system_prompt_field = plain config value
   assembly_owner = kernel
REAL_STAGE_OK M02.2 calls=1 ms=1231 in=12241 out=52 finish=success

──── M02.3 · 压缩历史属于内核 ────
   faked_compression_fields = []
   compression_seam = kernel-owned
REAL_STAGE_OK M02.3 calls=1 ms=4565 in=12239 out=10 finish=success

──── M02.4 · 从真实运行读 token 用量 ────
   input_tokens = 12226
   output_tokens = 6
   usage_reported_by = kernel
   meter_surface = []
REAL_STAGE_OK M02.4 calls=1 ms=2042 in=12226 out=6 finish=success "用量已计量。"

──── M02.5 · 历史开关而不是结果裁剪 ────
   history_default = False
   history_switchable = True
   pruner_surface = []
   truncation_owner = kernel
REAL_STAGE_OK M02.5 calls=1 ms=1004 in=12239 out=10 finish=success

──── M02.6 · 作用域记忆写回代替 spill ────
   scopes = [user-a, project-a, m02-session]
   written = 1
   spill_equivalent = scoped memory write-back
REAL_STAGE_OK M02.6 calls=1 ms=1073 in=12240 out=55 finish=success

REAL_MODULE_OK M02 stages=6 calls=6 failed=0
```

**对照自己的输出**：至少要有 `REAL_MODULE_OK M02 stages=6`。最值得先看的三组：M02.1 的
`scopes = [user-a, project-a, session-a]`（作用域一路传到网关）、M02.3 的 `faked_compression_fields = []`
与 M02.5 的 `pruner_surface = []`（两条负证据）、M02.4 事实行 `input_tokens = 12226` 与同一行
`REAL_STAGE_OK` 的 `in=12226`（同一份内核报告）。`ms=` 与 `in=` 随请求浮动，不影响结论。

---

## 3. 作用域召回：三个作用域一路传到网关

打开 [`scenes/01_recall_scoped_memory.py`](../M02-context-assembly-economics/scenes/01_recall_scoped_memory.py)
与 [`impl/memory_gateway.py`](../M02-context-assembly-economics/impl/memory_gateway.py)。
`MemoryContextService` 只依赖 `MemoryGateway` 协议，示例因此用**可观察的教学网关**替换真实存储：每次召回查询都留在 `gateway.queries` 里。

```python
gateway = Gateway()
context = await MemoryContextService(memory_gateway=gateway).build_prompt_prefix(
    user_scope_id="user-a",
    project_scope_id="project-a",
    session_scope_id="session-a",
)
query = gateway.queries[0]
```

`build_prompt_prefix()` 只做三步：把三个 scope id 原样装进 `MemoryRecallQuery` 发给网关，把返回
记录按 type/facet 分桶（semantic 按 facet 进桶，procedural / episodic 各自成桶），再把每个非空桶
渲染成 `<memory type="…">` 包着的正文，每放入一条 `included_count` 加一。教学网关返回一条固定的
偏好记忆（`facet="preference"`），三行事实各对应一条断言：

- `scopes = [user-a, project-a, session-a]`——三个 scope id 原封不动进了 `MemoryRecallQuery`。
- `prefix_contains = 回答保持简洁`——被渲染进 `<iota-memory>` 前缀的是记忆**正文**，不是 id。
- `included_count = 1`——计数的是**渲染进前缀的记录数**，不是桶数、不是字符数。

> **原理对照**：`iota-core/src/iota_core/memory/context.py::class MemoryContextService`。
> DSH 侧等价物是 `ctx.systemPrompt.section()`（见 dsh 第 02 课第 3 节）——那边按 `order` 贡献
> **静态片段**，这边按作用域召回**动态内容**；dsh 的段落注册即生效，iota 的前缀默认不注入。

---

## 4. 装配归内核：没有注册面，注入默认关闭

打开 [`scenes/02_no_prompt_assembly_seam.py`](../M02-context-assembly-economics/scenes/02_no_prompt_assembly_seam.py)。
第一组证据是"负证据"写法——不是"文档说没有"，是**运行时枚举出来就是没有**：

```python
config = AgentConfig(name="m02", kernel=harness.kernel)
surface = sorted(
    name for name in vars(Registry()) if "prompt" in name or "assembly" in name
)
require(surface == [], "编排层没有 Prompt 装配/改写注册面", surface)
```

`Registry` 上真实的注册面是 `tools` / `mcps` / `skills` / `model_profiles` 和图运行时那组
（`code_handlers`、`node_hooks`、`node_middlewares`…）——没有一个管"请求长什么样"；在实例
属性表里搜 `prompt` / `assembly`，得到空列表 `assembly_surface = []`。另一半证据来自两个真实字段：

- `enable_memory_prompt = False`——场景断言 `config.enable_memory_prompt is False`：第 3 节渲染
  出的前缀**默认不注入**，要用必须显式 `AgentConfig(enable_memory_prompt=True)`。
- `system_prompt_field = plain config value`——场景还断言 `"system_prompt" in
  AgentConfig.model_fields`：系统提示只是普通可选字符串字段，是**交给内核的值**，不是编排层上
  的结构——没有 section、没有变量插值、没有 waterfall。

边界判定：DSH 把"贡献片段、延迟插值、整体改写"三个钩子全开在编排层（见 dsh 第 02 课第 4、5
节）；iota 编排层没有这三张注册面，请求由内核自己装配——`assembly_owner = kernel` 就是这个
判定在日志里的形式。

---

## 5. 压缩归内核：字段表里搜不出压缩开关

打开 [`scenes/03_no_compression_seam.py`](../M02-context-assembly-economics/scenes/03_no_compression_seam.py)——
本模块最短的场景，整段就是一条负证据：

```python
fields = set(AgentConfig.model_fields)
faked = sorted(name for name in fields if "compress" in name or "compact" in name)
require(faked == [], "AgentConfig 不伪造压缩 seam", faked)
```

`AgentConfig.model_fields` 是 pydantic 模型的**全量字段清单**（运行时枚举，不是手抄）。搜
`compress` / `compact` 两个词根，结果为空——`faked_compression_fields = []`。真实的字段表
（`iota-core/src/iota_core/types.py::AgentConfig`）里与上下文有关的只有四个：`system_prompt`、
`memory_namespace`、`enable_memory_prompt`、`disable_conversation_history`——没有一个管"历史怎么变短"。

对比 dsh：那边 M02.3 的压缩引擎把 12 条模型可见面折成 4 条、会话日志仍 13 条（见 dsh 第 02 课
第 6 节）。那条 seam 在 iota 编排层没有对位物，`compression_seam = kernel-owned` 的含义不是
"压缩不可用"，而是"**编排层不伪造接不上任何东西的开关**"。

---

## 6. token 用量：读内核的报告，不自己数

M02.4 是本模块唯一的 `model` 阶段——场景自己发起真实请求，而不是先跑 probe。打开
[`scenes/04_measure_token_usage.py`](../M02-context-assembly-economics/scenes/04_measure_token_usage.py)：

```python
result = await harness.run("请只回复：用量已计量。", name="m02-usage")
require(bool((result.final_text or "").strip()), "真实运行返回非空文本", result.final_text)
usage = result.usage
reported = usage.to_dict() if isinstance(usage, TokenUsage) else dict(usage or {})
meter_surface = sorted(name for name in vars(Registry()) if "token" in name or "meter" in name)
require(meter_surface == [], "编排层没有 token 计量注册面", meter_surface)
```

数字的链路：内核在 `FinalEvent.usage` 里报用量 → 适配器把它聚合进 `AgentResult.usage`（结构化
`TokenUsage`）→ 场景 `to_dict()` 取出 `input_tokens` / `output_tokens`。事实行的
`input_tokens = 12226` 与同一行 `REAL_STAGE_OK` 上的 `in=12226` **相等不是巧合**：后者由证据账本
从同一个 `FinalEvent.usage` 记下（[`runtime/harness.py`](../runtime/harness.py) 里的
`record.input_tokens = int(data.get("input_tokens", 0))`），场景断言读的是同一份报告。

还有一组数字值得连起来看：mechanism 阶段（M02.1/2/3/5/6）的 `in=` 都在 12239–12241 一带——
它们跑的是同一条复述型 probe 指令；M02.4 没有 probe，`in=12226` 来自场景自己那句话。但无论
哪一类，**编排层送出的都只有一句短指令**——多出来的一万二千 token 是内核自己装配的系统
提示、工具目录与上下文。装配发生在内核，这就是它在数字上的样子（`usage_reported_by = kernel`）。

`meter_surface = []` 是负证据，与 dsh 的方向差正好互补：那边的 tokenMeter **回放会话日志估算**
压力（`baseline: 'estimated'`），作为压缩触发器的输入（见 dsh 第 02 课第 6.7 节）；iota 没有
"要不要压"的决策点，也就不需要估算器——**用量是事后从内核读的事实，不是事前算出的预算**。

---

## 7. 历史开关：有"这轮不带"，没有"带多少"

打开 [`scenes/05_history_switch_not_pruner.py`](../M02-context-assembly-economics/scenes/05_history_switch_not_pruner.py)：

```python
default = AgentConfig(name="m02-history", kernel=harness.kernel)
without = AgentConfig(
    name="m02-history", kernel=harness.kernel, disable_conversation_history=True
)
require(default.disable_conversation_history is False, "默认带上会话历史")
require(without.disable_conversation_history is True, "可以显式关掉历史")
pruner_surface = sorted(name for name in vars(Registry()) if "prun" in name or "spill" in name)
require(pruner_surface == [], "编排层没有裁剪/溢出注册面", pruner_surface)
```

三行事实读作：`history_default = False`（默认带上历史）、`history_switchable = True`（真实
开关，可以显式关）、`pruner_surface = []`（负证据——`prun` 和 `spill` 两个词根都搜不到）。

`disable_conversation_history` 的语义（iota-core 源码注释）：置 True 时 runtime 不再通过
ConversationStore 为该 agent 读/写短期 transcript，历史连续性完全交给 adapter 的 session_store。
**它是"这轮带不带"的整体开关，不是"带多少"的裁剪器**：粒度只有全有/全无。

对比 dsh 的 pruner：确定性裁剪超长工具结果，`before: 112 → after: 55`、带 `PRUNE_MARKER`
（见 dsh 第 02 课第 6.7 节）。iota 编排层没有这张注册面，`truncation_owner = kernel`：想裁剪，
要么内核自己裁，要么这一轮就别把内容送进去。

---

## 8. 写回代替 spill：放不进这一轮的进作用域记忆

打开 [`scenes/06_persist_memory_writeback.py`](../M02-context-assembly-economics/scenes/06_persist_memory_writeback.py)。
第一步解析作用域：场景构造的 `AgentConfig` 带 `memory_namespace="m02-session"`，并在
`extra["memory_scope"]` 里显式给出 user / project 两个 scope id，交给 `MemoryScopeResolver`：

```python
scopes = MemoryScopeResolver().resolve(
    memory_namespace=config.memory_namespace or "m02-session",
    cwd="/workspace",
    agent_config=config,
)
```

解析规则对着日志 `scopes = [user-a, project-a, m02-session]` 逐项看（缺省在右侧）：

| 作用域 | 取值来源 | 缺省 |
|---|---|---|
| user | `extra["memory_scope"]["user_scope_id"]` | `local-user` |
| project | `extra["memory_scope"]["project_scope_id"]` | `cwd` |
| session | `extra["memory_scope"]["session_scope_id"]` | `memory_namespace` |

第二步把"放不进这一轮"的内容写进 session 作用域：

```python
written = await gateway.write_memories(
    [
        MemoryWriteRequest(
            scope_id=scopes.session_scope_id,
            scope="session",
            # episodic 记忆按协议不带 facet：写回的是"发生过什么"，不是一条画像。
            type="episodic",
            content="上一轮的长输出已写回记忆",
            source="m02",
        )
    ]
)
```

`written = 1`：网关接收写回。下一轮 `build_prompt_prefix()` 按同一套 scope 召回——第 3 节与
这一节是**同一条链路的两端**：一端召回、一端写回，作用域是两端共用的键。

`spill_equivalent = scoped memory write-back` 的语义对照：DSH 的 spill 是"完整结果落本地文件，
模型只看预览 + locator"（见 dsh 第 02 课第 6.7 节）；iota 的等价物是"内容写进作用域记忆，
下一轮按 scope 召回"。**外溢的介质从文件系统换成记忆系统，语义相同：这一轮放不下的内容，
换个地方存，之后还能取回。** 差别在时机：spill 的 locator 当轮可见，写回的记忆要等下一轮。

> **原理对照**：`iota-core/src/iota_core/memory/scope.py::class MemoryScopeResolver`、
> `iota_core.memory.gateway` 的 `MemoryWriteRequest`（规范定义在 iota-memory-protocol）。
> 逐模块判定见 [docs/dsh-vs-iota.md](../docs/dsh-vs-iota.md) 的 M02 行。

---

## 9. 排障：想让 iota 帮我裁剪历史/压缩上下文

### 症状

会话越聊越长，成本与延迟跟着涨；你在 `AgentConfig` 里翻"压缩历史""裁剪结果"的开关，在
`Registry` 上找 pruner / compaction 注册面——都找不到，于是想在编排层自己拼一个。

### 定位

1. 先跑本模块，看三条负证据：M02.3 的 `faked_compression_fields = []`（配置层没有压缩字段）、
   M02.5 的 `pruner_surface = []`（没有裁剪/溢出注册面）、M02.2 的 `assembly_surface = []`
   （没有装配面）——空列表是运行时枚举的结果，不是文档口径。
2. 再把想要的东西拆成三种语义：**这一轮什么都不带**——有开关；**这一轮少带一点**——没有；
   **放不下的内容之后还能取回**——有路径。

### 原因与修改

这不是 bug，是边界：装配、压缩、确定性裁剪都不在 iota 编排层，`AgentConfig` 刻意不伪造这些
字段。合法的修改方向只有三个：

1. **整体开关**：`AgentConfig(disable_conversation_history=True)`——这一轮不带历史。它是
   全有/全无，别指望"保留最近 N 条"。
2. **写回 + 召回**：把放不进这一轮的事实按第 8 节的路径写进作用域记忆，下一轮
   `build_prompt_prefix()` 按 scope 召回——这就是 iota 版的 spill。
3. **换内核**：真正需要"折叠历史、确定性裁剪"时，选择提供该能力的内核——在 iota 的接口里，
   这类能力的替换单元是整个 `KernelAdapter`（第 03 课的主题），不是一个可以单独挂上来的插件。

不要在编排层造 `pruner` / `compaction` 注册面——那是在给不存在的接口写代码。

---

## 10. 代码在哪

```bash
cd iota-example && ls M02-context-assembly-economics/impl M02-context-assembly-economics/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/memory_gateway.py`](../M02-context-assembly-economics/impl/memory_gateway.py) | `Gateway` 把每次 `recall_memories` 查询留在 `queries` 里；`PREFERENCE` 是被渲染进前缀的正文；`write_memories` 原样接收请求 |
| [`scenes/01_recall_scoped_memory.py`](../M02-context-assembly-economics/scenes/01_recall_scoped_memory.py) | 三个 scope id 传入 `build_prompt_prefix()`；`included_count` 与正文的三条断言 |
| [`scenes/02_no_prompt_assembly_seam.py`](../M02-context-assembly-economics/scenes/02_no_prompt_assembly_seam.py) | `vars(Registry())` 负证据；`enable_memory_prompt` 默认关闭 |
| [`scenes/03_no_compression_seam.py`](../M02-context-assembly-economics/scenes/03_no_compression_seam.py) | `AgentConfig.model_fields` 里搜不出压缩字段 |
| [`scenes/04_measure_token_usage.py`](../M02-context-assembly-economics/scenes/04_measure_token_usage.py) | `FinalEvent.usage` → `AgentResult.usage` → `to_dict()`；`meter_surface` 负证据 |
| [`scenes/05_history_switch_not_pruner.py`](../M02-context-assembly-economics/scenes/05_history_switch_not_pruner.py) | `disable_conversation_history` 两态；`pruner_surface` 负证据 |
| [`scenes/06_persist_memory_writeback.py`](../M02-context-assembly-economics/scenes/06_persist_memory_writeback.py) | `MemoryScopeResolver().resolve(...)` 的三个来源；`MemoryWriteRequest` 带 session scope 与 episodic 注释 |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**；断言（`require(…)`）就是这一
阶段的"可验证答案"；机制的另一半在 iota-core（各节"原理对照"给了符号路径）。

---

## 11. 动手练习

### 练习 A：改 session scope 的缺省来源

把 [`scenes/06`](../M02-context-assembly-economics/scenes/06_persist_memory_writeback.py) 里
`memory_namespace="m02-session"` 改成 `"my-session"`，并把场景里
`require(scopes.session_scope_id == "m02-session", ...)` 的期望同步改掉（改了机制就同步改
断言）。然后：

```bash
cd iota-example && uv run python -m runtime.runner M02 --scene 06_persist_memory_writeback
```

**可验证答案**：`scopes = [user-a, project-a, my-session]`——session scope 跟着 namespace 走，
user / project 两项不变（来自 `extra["memory_scope"]` 的显式值）。这验证了 `MemoryScopeResolver`
的优先级：**extra 显式给出的值优先，namespace 只是 session 的缺省**。

### 练习 B：让前缀带上两条记忆

在 [`impl/memory_gateway.py`](../M02-context-assembly-economics/impl/memory_gateway.py) 的
`recall_memories` 返回里再加一条 `MemoryRecallItem`（换 `id` 与 `content`，其余字段照抄），并把
[`scenes/01`](../M02-context-assembly-economics/scenes/01_recall_scoped_memory.py) 里 `require(context.included_count == 1, ...)` 的期望改成 2。然后：

```bash
cd iota-example && uv run python -m runtime.runner M02 --scene 01_recall_scoped_memory
```

**可验证答案**：`included_count = 2`。两条记忆同是 `facet="preference"`，渲染在**同一个**
`<memory type="preference">` 桶里，每条各计一次数；`prefix_contains = 回答保持简洁` 不变——
它断言的是"渲染的是记忆正文"，新加的那条只是让桶里多一行。

### 练习 C：验证 token 数字同源

单独跑两次 M02.4，每次对照事实行与结论行：

```bash
cd iota-example && uv run python -m runtime.runner M02 --scene 04_measure_token_usage
```

**可验证答案**：每次运行里 `REAL_STAGE_OK M02.4` 行的 `in=` / `out=` 与事实行
`input_tokens` / `output_tokens` 相等——两个读者读的是同一个 `FinalEvent.usage`；但**两次
运行之间**数字会浮动——那是内核对两次不同请求的报告。相等关系稳定、数值浮动，这就是
"证据账本与场景断言共享同一份内核报告"的直接验证。

---

**下一课** → [第 03 课 · 推理服务接入](03-inference-service-access.md)：本课每个 `AgentConfig` 都带着 `kernel=harness.kernel` 这个字符串——下一课讲它背后是什么：在 iota，可替换的单元不是一层中间件，而是整个 `KernelAdapter`。
