# 第 12 课 · 框架机制本体：可逆 effect、身份安全与配置叠加

> **本课任务**：最后一课掉头看框架自己——安装的副作用怎么可逆地拆掉、注册怎么按身份安全回收、
> 能力声明在什么时候被校验、配置怎么按层叠加；并确认三样东西明确不进 iota：事件总线、
> Proxy Context 与运行期热替换。
> **运行命令**：`cd iota-example && uv run python -m runtime.runner M12`
> **你将看到**：`lifo = [outer, inner]`——后装的先拆；`idempotent_dispose = True`——重复清理不
> 重复执行；`inactive_refusal = cannot push effect 'late' onto disposed stack 'm12-lifo'`
> ——已释放的栈当场拒绝新 effect；`architecture_not_imported = [event-bus, hmr, intercept]`
> ——三套 Cordis 架构明确不搬。

前置：[第 11 课 · 配置与数据设施](11-config-data-infrastructure.md)。本课所有输出都来自真实运行，不是示意。
同一编号的 DSH 侧教材见
[dsh-example/lessons/12-framework-mechanisms.md](../../dsh-example/lessons/12-framework-mechanisms.md)——那边讲 Cordis 派发语义与 Fiber 生命周期，本课讲 iota 借了哪些机制、没搬哪套架构。

---

## 1. 本课任务

前 11 课都在消费机制：注册工具、装配上下文、投影配置。最后一课掉头看**机制本体**——这些注册
与装配靠什么保证"装得上，也拆得掉"。[`M12 的 README`](../M12-framework-mechanisms/README.md)
的原话定调：DSH 展示 Cordis 的五种派发模式、Fiber 状态机、realm 隔离与 intercept 配置链；
**iota 只借可逆 effect 与注册表，不搬那套架构**。"借机制，不搬架构"就是本课的判定尺——
DSH 侧的五个控制面，iota 各给了什么：

| DSH 控制面 | iota 侧机制 | 归属判定 |
|---|---|---|
| dispatch 五种派发模式（emit/parallel/serial/bail/waterfall） | 无对位物——iota 没有事件总线，副作用只有"安装返回 disposer"一种形态 | **结构性边界**：监听器组合语义归内核/宿主 |
| timer 定时器（挂在 fiber 的 effect 上） | 无对位物——延时、轮询、节流不进编排层 | **结构性边界**：需要就调用方自己安排 |
| Fiber 状态机与 `effect()` 栈（`assertActive`） | `EffectStack`：LIFO 拆除、幂等 dispose、失效后拒绝（M12.1） | **语义等价 + 结构性边界**：借三条语义，不搬 fiber |
| `provide` / isolate realm（同名服务隔离） | 名字注册表 + 身份安全 disposer + `iota_core.providers` entry-point（M12.2、M12.4） | **语义等价 + 结构性边界**：能力错名在定义期拒绝（M12.3） |
| intercept 配置链（Proxy Context 按调用域换配置） | 配置分层：装配默认、调用点覆盖、`extra` 各层互不覆写（M12.5） | **语义等价 + 结构性边界**：不搬 Proxy |

没有对位物的三套架构，M12.2 把它们写成一条事实行留在案：
`architecture_not_imported = [event-bus, hmr, intercept]`——事件总线（派发模式的载体）、
HMR（运行期热替换）、intercept（Proxy 配置链），iota 一套都不导入；这条口径与
[`docs/dsh-vs-iota.md`](../docs/dsh-vs-iota.md) M12 行的架构边界一致。

```bash
cd iota-example && uv run python -m runtime.runner M12
```

---

## 2. 真实输出

```text
████ M12 · 框架机制本体：可逆 effect、身份安全与配置叠加 ████
provider=anthropic-compat model=fuyao-coding timeout=180000ms

──── M12.1 · effect 按 LIFO 拆除且拒绝复活 ────
   lifo = [outer, inner]
   idempotent_dispose = True
   inactive_refusal = cannot push effect 'late' onto disposed stack 'm12-lifo'
REAL_STAGE_OK M12.1 calls=1 ms=4784 in=12239 out=10 finish=success

──── M12.2 · 跨真实运行的 Provider 注册与回收 ────
   entry_point_group = iota_core.providers
   registered_then_removed = True
   architecture_not_imported = [event-bus, hmr, intercept]
REAL_STAGE_OK M12.2 calls=1 ms=1579 in=12226 out=7 finish=success "替换单元已登记。"

──── M12.3 · 错名 capability 定义期拒绝 ────
   capability_refusal = BadCapability declares unknown capabilities ['typo-capability']; known capabilities: ['filesystem_skills', 'goal_commands', 'native_goal_manager', 'native_kanba…
   rejected_at = class-definition
REAL_STAGE_OK M12.3 calls=1 ms=970 in=12240 out=10 finish=success

──── M12.4 · 同名注册的身份隔离 ────
   value = replacement
   old_disposer_removed_new_value = False
REAL_STAGE_OK M12.4 calls=1 ms=6986 in=12241 out=10 finish=success

──── M12.5 · 配置按层叠加 ────
   assembly_model = fuyao-coding
   layered_model = layer-model
   layered_extra = {memory_scope: {user_scope_id: user-a}}
REAL_STAGE_OK M12.5 calls=1 ms=847 in=12238 out=23 finish=success

REAL_MODULE_OK M12 stages=5 calls=5 failed=0
```

**对照自己的输出**：最后一行必须精确出现 `REAL_MODULE_OK M12 stages=5 calls=5 failed=0`，
五个阶段各有自己的 `REAL_STAGE_OK M12.n`。全模块只有 M12.2 是 `model` 类型——场景自己发起
真实请求，那一行末尾的 `"替换单元已登记。"` 就是内核作答；其余四个是 `mechanism` 阶段，
入口 probe 的调用折进 `calls=1`。M12.3 的 `capability_refusal` 是唯一被截断的事实行——
渲染层把长字符串截到 160 字符（[`runtime/runner.py`](../runtime/runner.py) 的 `_render`），
完整清单见第 5 节。`ms=` 与 `in=` 随端点速度浮动。

---

## 3. LIFO 与终局：后装的先拆，拆过的栈拒绝复活

打开 [`scenes/01_dispose_lifo.py`](../M12-framework-mechanisms/scenes/01_dispose_lifo.py)。
26 行演完 M12.1 的三行事实，逐字对照：

```python
order: list[str] = []
effects = EffectStack("m12-lifo")
effects.push(lambda: order.append("inner"), "inner")
effects.push(lambda: order.append("outer"), "outer")
effects.dispose()
effects.dispose()
require(order == ["outer", "inner"], "EffectStack 按 LIFO 回收", order)
```

- **后装先拆**：先 push `inner` 再 push `outer`，一次 `dispose()` 之后 `lifo = [outer, inner]`
  ——外层包装先拆掉，才轮到它包着的东西。
- **幂等**：`dispose()` 连调两次，第二次直接返回（`idempotent_dispose = True` 读的是
  `effects.disposed`）——重复清理不报错，也不重复执行。
- **拒绝复活**：`dispose()` 后再 `push(lambda: None, "late")` 抛 `EffectStackDisposedError`，
  场景在 `except EffectStackDisposedError as exc:` 里取 `str(exc)`——异常原文就是
  `inactive_refusal` 那一行。

后两条机制都写在 `iota-core/src/iota_core/effects.py::class EffectStack` 的方法开头：
`dispose()` 的开头是 `if self._disposed: return`——已释放就直接返回，这就是幂等；`push()`
的开头则给出抛错原文：

```python
if self._disposed:
    raise EffectStackDisposedError(
        f"cannot push effect {label!r} onto disposed stack {self.label!r}"
    )
```

> **原理对照**：`iota-core/src/iota_core/effects.py::class EffectStack` 的模块文档把三条性质
> 明说成 "all three copied deliberately"，逐条点名 cordis 的 `fiber.ts`：**Reverse order**
> （"Disposers run last-installed-first"）、**Idempotence**（"Disposing twice is a no-op
> rather than a double-undo"）、**Refusal after disposal**（"Pushing onto a disposed stack
> raises instead of silently accepting an effect nobody will ever clean up"，cordis 里叫
> `assertActive` / `INACTIVE_EFFECT`）。dsh 第 12 课里 fiber 卸载时挂起的定时器被拒，
> 就是同一族语义——iota 借走三条语义，不搬 fiber 状态机。

---

## 4. 可逆 Provider：登记期间照常作答，回收立刻生效

打开 [`scenes/02_dispose_provider_after_run.py`](../M12-framework-mechanisms/scenes/02_dispose_provider_after_run.py)。
这是全模块唯一的 `model` 阶段，真实调用由场景自己发起：

```python
disposer = register_adapter("m12-provider", lambda _build: harness.adapter)
registered = is_adapter_registered("m12-provider")
result = await harness.run("请只回复：替换单元已登记。", name="m12-provider")
disposer()
require(registered, "Provider 注册后在册")
require(bool((result.final_text or "").strip()), "登记期间内核照常作答", result.final_text)
require(not is_adapter_registered("m12-provider"), "回收后 Provider 不再在册")
```

四个动作连成一条线：登记 → 在册 → 真实运行（内核照常作答）→ 回收 → 立刻不在册；
`registered_then_removed = True` 是三条 `require` 的汇总。`entry_point_group = iota_core.providers`
断言第三方包登记 Provider 用的是标准 entry-point group（`iota-core/src/iota_core/providers.py`
的 `ENTRY_POINT_GROUP`）。注册的是**工厂不是实例**，内核不在时失败点落在解析处而不是
import 期，解析失败响亮列出在册项，不返回 no-op。

`register_adapter` 写的是模块级字典，登记跨真实运行存活；disposer 与注册表同一条纪律，
先比身份再删除（`is` 比较的展开见第 6 节）。这个模式的第一消费者就是装配层自己：
[`runtime/harness.py`](../runtime/harness.py) 装配时把内核的 Provider 工厂 push 进自己的
effect 栈，`harness.close()` 走 `await self.effects.adispose()`，注册随栈按 LIFO 撤销——

```python
effects.push(
    register_adapter(
        kernel,
        lambda _build: build_adapter(allow_shell=allow_shell, workspace=workspace),
    ),
    f"provider:{kernel}",
)
```

> **原理对照**：dsh 第 12 课 M12.2 演示"定时器挂在 fiber 的 effect 上、fiber 卸载时统一清理"；
> iota 同编号演示"Provider 注册挂在 EffectStack 上、close 时统一回收"。两边同构的只有一句话：
> **注册挂在可逆资源上**。差别的部分（realm 隔离、Proxy 调用域视图）留在 Cordis 侧——iota 的
> 注册表是一个普通的进程级字典，要换内核，就显式 `register_adapter()` 一个工厂，回收交给 disposer。

---

## 5. 定义期拒绝：拼错的 capability 活不到运行期

打开 [`scenes/03_reject_unknown_capability.py`](../M12-framework-mechanisms/scenes/03_reject_unknown_capability.py)
与 [`impl/capability_probe.py`](../M12-framework-mechanisms/impl/capability_probe.py)：探针只有一个类，
故意声明一个不存在的能力名：

```python
class BadCapability(KernelAdapter):
    name = "bad"
    provides = frozenset({"typo-capability"})
```

impl 的文档字符串解释了为什么这个类必须定义在函数里："它的正常结果是抛错，而不是产出一个类"
——`KernelAdapter` 在**类定义期**就校验 `provides`。校验发生在 `__init_subclass__`，
即 `class BadCapability(KernelAdapter):` 这一行执行的时候
（`iota-core/src/iota_core/adapters/base.py::class KernelAdapter`）：

```python
unknown = declared - KNOWN_KERNEL_CAPABILITIES
if unknown:
    # A misspelled capability would otherwise read as "not provided",
    # silently skipping the host-side setup the kernel needed.
    raise ConfigError(
        f"{cls.__name__} declares unknown capabilities {sorted(unknown)}; "
        f"known capabilities: {sorted(KNOWN_KERNEL_CAPABILITIES)}"
    )
```

场景把 `define_bad_capability()` 包在 `try/except ConfigError` 里取 `str(exc)`，`else` 分支
`fail("未知 capability 在类定义期被拒绝")`——`rejected_at = class-definition` 因此不是自报：
抛错发生在 class 语句上，连实例都不曾创建。`capability_refusal` 行尾的截断见第 2 节；完整的
已知能力一共 4 个（`iota-core/src/iota_core/capabilities.py`）：`filesystem_skills`、
`goal_commands`、`native_goal_manager`、`native_kanban_toolset`。

> **原理对照**：cordis 的对应物是 `provide` / `inject` 声明式依赖——依赖未满足时 fiber 停在
> `PENDING` 静静等，dsh 第 12 课 M12.3 专门演示了这种"不报错"。iota 刻意反着做：
> `capabilities.py` 的文档把这记为与 cordis 的刻意差别——iota 在装配期校验并失败，cordis 让
> fiber 挂起等待，而等待只会掩盖配置错误。这是第 01 课那条纪律在框架层的版本。

---

## 6. 身份安全：disposer 只回收自己那一笔

打开 [`scenes/04_identity_safe_disposer.py`](../M12-framework-mechanisms/scenes/04_identity_safe_disposer.py)：
先把 `original` 注册进 `code_handlers`，再 `overwrite=True` 覆盖，然后调用**旧**注册返回的
disposer：

```python
dispose_original = registry.code_handlers.register("owned", original)
registry.code_handlers.register("owned", lambda: "replacement", overwrite=True)
dispose_original()
current = registry.code_handlers.get("owned")
require(current is not original, "旧 disposer 不删除覆盖后的新值")
require(current() == "replacement", "覆盖后的值保留", current())
```

事实行给了双向答案：`value = replacement`（新值还在）、`old_disposer_removed_new_value = False`
（旧 disposer 没有把它带走）。机制在
`iota-core/src/iota_core/registry.py::class _NamedRegistry` 的 disposer 闭包里——删除前先比身份：

```python
def dispose() -> None:
    with self._lock:
        if self._items.get(name) is not entry:
            return
        del self._items[name]
```

`is not entry`——不是"删除这个名字"，是"删除我那一笔"。注册方法的文档把动机写得很直白：
中途有人覆盖了这个名字的话，按名删除就等于 "removing it would silently uninstall a
registration this caller never owned"。同一条纪律第 01 课已经演过（外部换掉 handler 后，
effect 退出按身份比较，[第 01 课](01-tool-pipeline.md)的 `replaced_handler_kept = True`）；
M12.4 是它在注册表上的版本。

> **原理对照**：dsh 第 12 课 M12.4 的 realm 隔离靠不同的存储键做到"同名服务互不串门"；iota
> 没有 realm，同名就是同一个槽，安全性改由 disposer 的身份比较提供——覆盖后旧 disposer 失效，
> 新值的生死只归覆盖方自己的 disposer。两条路线殊途同归：谁都不允许"先来的回收，把后来者的
> 注册悄悄带走"。

---

## 7. 配置分层：装配给默认，调用点覆盖，extra 各归各层

打开 [`scenes/05_layer_agent_config.py`](../M12-framework-mechanisms/scenes/05_layer_agent_config.py)。
同一个装配，两种取配置的方式：

```python
base = harness.agent(name="m12-base")
layered = harness.agent(
    name="m12-layered",
    model="layer-model",
    memory_namespace="m12-layer",
    extra={"memory_scope": {"user_scope_id": "user-a"}},
)
```

两个 agent 各自检查 `model`；"装配给默认值"的出处就在 [`runtime/harness.py`](../runtime/harness.py)：

```python
def agent(self, *, name: str, **config: Any) -> Agent:
    if self.model is not None:
        config.setdefault("model", self.model)
```

`setdefault`——调用点给了 `model` 就用调用点的，没给才落装配默认。对上三行事实：
`assembly_model = fuyao-coding`（`base` 拿装配默认）、`layered_model = layer-model`
（`layered` 覆盖成功）、`layered_extra = {memory_scope: {user_scope_id: user-a}}`（`extra`
只出现在调用点这一层）。场景末尾还有第四条 `require`，断言 `base.config.extra == {}`
——**上层多出来的键不会落进默认层**，`extra` 各层互不覆写。

> **原理对照**：dsh 第 12 课 M12.5 的 `intercept` 不重建实例、只换调用域配置——同一个服务在
> 根 ctx 与 scoped 视图读出两套配置，靠 Proxy 原型链浅合并。iota 没有这层代理：要不同的配置，
> 就显式创建一个带覆盖的 `AgentConfig`（`iota-core/src/iota_core/types.py::class AgentConfig`
> 的 `model` 与 `extra` 字段），每个 agent 拿自己那份数据；没有跨层覆写，也就不需要拦截链。

---

## 8. 排障：disposer 调了，资源却还在（或者你担心它删多了）

### 症状

调用 disposer 之后，同名注册**还在**——`registry.code_handlers.list()` 依然列出它；
或者反过来：先覆盖注册、再回收旧项，你断言（或担心）**新值被连带删掉**。

### 定位

1. 先确认手里的 disposer 是**哪一笔注册**返回的——iota 的 disposer 回收"自己那一笔"，
   按名删除的直觉在这里不成立。
2. 跑 `--scene 04_identity_safe_disposer`，对照 `value = replacement` 与
   `old_disposer_removed_new_value = False` 两行事实。
3. 到 `iota-core/src/iota_core/registry.py` 读 disposer 闭包：删除前先比 `is`，不是比名字。

### 原因与修改

这不是 bug，是身份安全：如果旧 disposer 能按名删除，覆盖注册的一方就会被先来者的回收静默
卸载——"配置在册却被悄悄删掉"正是这套机制要消灭的缺陷类。修改方向：

- **想让新值消失**，用覆盖方自己保存的 disposer（`register(..., overwrite=True)` 的返回值）；
- **想整栈终局**，用 `EffectStack`：`dispose()` 幂等，重复调用不报错、不重复执行；失效后拒绝
  新 effect，回收不了的栈宁可当场抛 `EffectStackDisposedError`，也不静默接受一个永远没人
  清理的 effect。要新的作用域就新建一个栈——已释放的栈不可复活，与 dsh 第 12 课 fiber 进入
  `DISPOSED` 后 `uid = null`、不能重新激活，是同一条单向门。

---

## 9. 代码在哪

```bash
cd iota-example && ls M12-framework-mechanisms/impl M12-framework-mechanisms/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`scenes/01_dispose_lifo.py`](../M12-framework-mechanisms/scenes/01_dispose_lifo.py) | 两次 `dispose()`；`push("late")` 抛错原文的捕获现场 |
| [`scenes/02_dispose_provider_after_run.py`](../M12-framework-mechanisms/scenes/02_dispose_provider_after_run.py) | 登记 → 真实运行 → 回收的顺序；三条 `require` |
| [`scenes/03_reject_unknown_capability.py`](../M12-framework-mechanisms/scenes/03_reject_unknown_capability.py) | 捕 `ConfigError`；`rejected_at` 为什么是 `class-definition` |
| [`scenes/04_identity_safe_disposer.py`](../M12-framework-mechanisms/scenes/04_identity_safe_disposer.py) | 覆盖注册后旧 disposer 的行为；身份断言 `is not original` |
| [`scenes/05_layer_agent_config.py`](../M12-framework-mechanisms/scenes/05_layer_agent_config.py) | `base` 与 `layered` 的配置差异；`extra` 的归属 |
| [`impl/capability_probe.py`](../M12-framework-mechanisms/impl/capability_probe.py) | 为什么"坏类"必须定义在函数里 |
| [`run.py`](../M12-framework-mechanisms/run.py) | 阶段清单：4 个 `mechanism` + 1 个 `model` |
| [`runtime/harness.py`](../runtime/harness.py) | `agent()` 的 `setdefault`；装配处 `register_adapter` 挂上 effect 栈 |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**；断言（`require(…)`）就是这一
阶段的"可验证答案"。机制本体在 editable 安装的 iota-core 里——`effects.py` 与 `registry.py`
是本课的两个源头文件。

---

## 10. 动手练习

### 练习 A：把 LIFO 倒过来

把 [`scenes/01`](../M12-framework-mechanisms/scenes/01_dispose_lifo.py) 里两个 `push` 的顺序
对调（先 `"outer"` 再 `"inner"`），重新运行：

```bash
cd iota-example && uv run python -m runtime.runner M12 --scene 01_dispose_lifo
```

**可验证答案**：`lifo = [inner, outer]`——拆除顺序永远与安装顺序相反；`inactive_refusal`
那行不变，拒绝的是"往已释放的栈 push"，与安装顺序无关。

### 练习 B：追一笔"覆盖后的回收"

在 [`scenes/04`](../M12-framework-mechanisms/scenes/04_identity_safe_disposer.py) 里把第二次
注册的返回值接住，并先把返回的事实改成下面这样（在 `dispose_original()` 之后取注册表状态）：

```python
dispose_replacement = registry.code_handlers.register(
    "owned", lambda: "replacement", overwrite=True
)
dispose_original()
return {"remaining": registry.code_handlers.list()}
```

跑一次；再在 `return` 前加一行 `dispose_replacement()` 跑第二次：

```bash
cd iota-example && uv run python -m runtime.runner M12 --scene 04_identity_safe_disposer
```

**可验证答案**：第一次 `remaining = [owned]`——旧 disposer 走掉后新值还在；第二次
`remaining = []`——新值由覆盖方自己的 disposer 回收。同一个名字的两笔注册，回收各管各的。

### 练习 C（进阶）：把错名拼对，看验收反向失败

把 [`impl/capability_probe.py`](../M12-framework-mechanisms/impl/capability_probe.py) 里的
`provides = frozenset({"typo-capability"})` 改成一个真实能力名（例如 `"goal_commands"`），
重新运行：

```bash
cd iota-example && uv run python -m runtime.runner M12 --scene 03_reject_unknown_capability
```

**可验证答案**：进程**非零退出**。类这次定义成功，`ConfigError` 没有抛出，场景里的
`fail("未知 capability 在类定义期被拒绝")` 反而把阶段拦下来（`TeachingCheckError`）——校验
确实发生在类定义期。看完记得把改动还原。

---

**课程结束** → 回到 [课程首页](../README.md) ｜ 想横向对照另一个框架，见 [dsh-example 第 12 课](../../dsh-example/lessons/12-framework-mechanisms.md)。
