---
title: "服务注册与依赖解析"
---
# 服务注册与依赖解析

> **本篇回答**：`provide` → `notify` → `_checkImpl` → `_refresh` 这条级联链怎么跑，以及四种插件形态、`inject` 的三种写法、`registry.replace()` 热换实现、`Service` 基类的八个可覆写符号。
> **路径缩写**：`C/` = `packages/core/src/`。行号对应快照 `bc9fae7`（v4.0.0-rc.13）。
>
> 🧭 **本篇导览**：5.1–5.2 四种插件形态与注册流程（含 `registry.replace()` 热换实现）→ 5.3–5.4 `inject` 归一化与 `provide()` → 5.5–5.6 `notify()` 级联引擎与完整示例 → 5.7 `Service` 基类。
>

## 5.1 四种插件形态

> 📐 **配套可跑示例**：[`M03 · 推理服务接入`](../../dsh-lab/examples/dsh-llm-adapter-demo/README.md) 覆盖 Provider 注册与流消费：`src/plugins/anthropic-compat/index.ts` 的 `AnthropicCompatAdapter` 实现 `LlmAdapter`，由插件的 `apply()` 经 `ctx.llm.registerAdapter()` 注册成 `anthropic-compat` 路由；M03.1 列出已注册路由与模型目录，M03.2 观察环绕 `llm/stream` 的 waterfall 如何挂载与卸载，M03.3 用一次真实请求验证适配器端到端（需 `LLM_API_KEY`）。其中 `ctx.llm` 是 DSH 建在 Cordis Service 机制上的领域服务。

`Component` 类型（`C/registry.ts:63-66`）是三者联合（命名空间 `Component` 定义于 `:68-100`；rc.10 时代它叫 `Plugin`，core 中已零残留）：

![Component 的三种形态与共同元数据](diagrams/05-plugin-forms.svg)

**Component 的三种形态与共同元数据** — [交互版](diagrams/05-plugin-forms.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-plugin-forms.architecture.json)

- **三种形态最终都变成 callback**：Component 类型是三者的联合（registry.ts:63-66） · resolve 负责抹平差异 · 下游只面对一个函数
- **元数据是可选的但很关键**：Config 决定配置是否被校验 · inject 决定 epoch 怎么算 · provide 与 intercept 影响服务可见性
- **为什么留 Object 形态**：ctx.inject() 需要一个匿名的可注册单元 · 用带 apply 的对象最省包装 · name 若为 apply 会被主动置空

💡 **`resolve()` 返回的 callback 是 Runtime 的键**（`C/registry.ts:245`：`this._internal.get(callback)`），且查找前先经 `_forward()`（`:155-163`）沿 `_aliases` 别名链解析。所以 `{ apply: f }` 和 `f` 本身被视为同一个组件——因为都解析到 `f`；而一个被 `registry.replace()` 换掉的旧组件，也能沿别名链解析到新 Runtime（见下节）。

💡 **`isConstructor()`（`C/utils.ts:92-102`）的判定很讲究**：
- 无 `prototype` → 不是（箭头函数、async 函数）
- 是 `GeneratorFunction` 的实例 → 不是
- 是 `AsyncGeneratorFunction` 的实例 → 不是（但要先判断 `AsyncGeneratorFunction !== Function`，因为 polyfill 环境下两者可能相等）
- 注释里明确说**不能**用 `func.prototype.constructor !== func` 判断，因为 `mock.fn()` 是被代理的

## 5.2 `RegistryService.use()`：注册的完整流程

`C/registry.ts:238-252`（旧名 `plugin()` 保留为 `@deprecated` 转发，`:233-236`）：

![registry.use() 内部流程](diagrams/05-registry-plugin.svg)

**registry.use() 内部流程** — [交互版](diagrams/05-registry-plugin.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-registry-plugin.sequence.json)

- **Runtime 按 callback 去重**：同一个组件函数多次注册共享一个 Component.Runtime · Runtime 上的 fibers 是 DisposableList，记录全部实例 · 热重载删组件/热换实现时靠它找到所有目标 Fiber
- **返回值刻意是 thenable**：wrapped 用 Object.create(fiber) 继承 Fiber 全部能力 · 额外挂 then 让调用方可以 await 到组件就绪 · 而 ctx 自身把 then 列为保留字，避免被 await 吞掉
- **长堆栈的起点**：getOuterStack 用默认参数在调用处求值 · 捕获的是用户代码的真实调用位置 · 之后异步错误会把这段栈拼上去

💡 **非法组件的报错文本也换成了新术语**：`invalid component, expect function or object with an "apply" method, received z`（`:241`，另见 `:189`、`:191`）。

💡 **`name === 'apply'` 要清掉**（`:166-167`，在 `_create()` 里）。因为 `{ apply(ctx) {...} }` 里方法名就是 `apply`，直接当组件名会显示成 `<apply>`，没有信息量。

💡 **返回值是 `Object.create(fiber)`**（`:247`）而不是 fiber 本身。原因：要挂一个 `then` 属性但不污染真正的 Fiber 对象（否则 Fiber 就变成 thenable，会被 `await` 意外触发）。

💡 **`await ctx.use(p)` 等的是 `fiber.await()`**（`C/fiber.ts:520-526`）——等 `inertia` 清空，若有 `_error` 则抛出。所以 `await ctx.use(p)` 会把组件初始化时的错误抛给调用方，而不 await 就只会打日志（deprecated 的 `ctx.plugin(p)` 同样返回 thenable，行为一致）。

### `registry.replace()`：热换实现（rc.13 新增）

`C/registry.ts:187-211`，HMR 原位替换的公开入口：

- **先校验双方**：旧组件与新组件都要能 `resolve()` 出 callback，否则抛 `invalid component, ...`（`:189`、`:191`）。
- **登记别名链**：`_aliases` 把旧 callback 映射到新组件（`:194-201`），旧组件被 replace 后仍可 `get`/`has` 到新 Runtime——这正是 § 5.1 `_forward()` 的用途。
- **复用或创建目标 Runtime**：新组件若已注册则复用（`:197`），否则 `_create()`（`:205`）。
- **对每个现存 Fiber 调 `fiber._replace(target, Inject.resolve(newComponent.inject))`**（`:207-209`）。

`fiber._replace()`（`C/fiber.ts:401-416`）是"引用不失效"的关键：**同一个 Fiber 对象保留**，只换 runtime 与 inject，emit `internal/replace`（:408），重算 `_store`（:409-412），清 `_error`（:413），**`_revision++` 再 `_refresh()`**（:414-415）——级联重载由 `_revision` 变化驱动，fiber 身份与 config 保持不变，`ctx.use()` 返回的引用持续有效。机制细节见 [03 § 3.4](03-fiber-model.md)（epoch 与 `_revision`），HMR 侧的用法见 [08 § 8.8](08-hmr.md)。

💡 **顺带的新公开面**：`registry` 新增 `get/has/keys/values/entries/forEach`（`C/registry.ts:173-227`）；`ctx.inject(deps, callback)` 现在直接委托 `ctx.use({ inject, apply: callback, name: callback.name })`（`:229-231`）——Object 形态留给 `ctx.inject()` 的叙述有了直接源码佐证。

![registry.replace：原位热换（rc.13）](diagrams/05-registry-replace.svg)

**registry.replace：原位热换（rc.13）** — [交互版](diagrams/05-registry-replace.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-registry-replace.architecture.json)

- **四步**：校验新旧组件并登记别名 · 复用或创建目标 Runtime · 对每个 fiber 调 _replace() · 重算 epoch 并通知
- **与 HMR 的关系**：HMR 的 Stage 2 就调用 registry.replace() · 不再"先 delete 再注册" · ctx.use() 的返回引用持续有效
- **与旧实现的差异**：rc.10 换代必然新 Fiber 新 uid · rc.13 靠 _revision 变化驱动重载 · 依赖者数量多时批量处理

## 5.3 `inject` 的三种写法与归一化

`Inject.resolve()`（`C/registry.ts:42-61`）把三种写法归一成 `Dict<config | null>`：

| 写法 | 归一化结果 | 语义 |
|---|---|---|
| `inject: ['db', 'cache']` | `{ db: null, cache: null }` | 纯依赖，无配置 |
| `inject: { db: { pool: 5 } }` | `{ db: { pool: 5 } }` | 依赖 + intercept 配置 |
| 类上用 `@Inject('db', cfg)` | 沿原型链合并（见下） | 支持继承 |

![Inject.resolve 的四条分支](diagrams/05-inject-resolve.svg)

**Inject.resolve 的四条分支** — [交互版](diagrams/05-inject-resolve.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-inject-resolve.architecture.json)

- **四种写法等价**：数组写法只声明依赖名，配置为空 · 对象写法可同时给出 intercept 配置 · 带 checkProto 的对象来自类装饰器
- **递归是为了类继承**：子类的 inject 用 Object.create(父类.inject) 建立 · 递归解析原型后再覆盖自己的键 · 于是父类声明的依赖不会丢
- **结果直接决定 epoch**：Object.keys(inject) 就是 _refresh 的遍历范围 · 值为 null 表示只依赖存在性 · 值非空则同时注入 intercept 配置

💡 **`symbols.checkProto` 标记是 `@Inject()` 装饰器打上的**（`C/registry.ts:22`）。只有装饰器产生的 inject 对象才走原型链合并——手写的普通对象不走，避免意外继承 `Object.prototype` 上的东西。

### `@Inject()` 装饰器

`C/registry.ts:17-40` 支持两种目标：

![@Inject 装饰器的两种目标](diagrams/05-inject-decorator.svg)

**@Inject 装饰器的两种目标** — [交互版](diagrams/05-inject-decorator.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-inject-decorator.architecture.json)

- **类装饰器影响整个插件**：写进类的 inject 静态属性 · 参与 Fiber 的 epoch 计算 · 因此依赖不满足时整个插件不激活
- **方法装饰器粒度更细**：只有那个方法体变成子插件 · 其余方法照常可用 · 依赖不满足时仅该方法不执行
- **继承靠原型链累加**：子类的 inject 以父类 inject 为原型 · checkProto 标记提示 resolve 需要递归 · 于是父子声明的依赖自动合并

💡 **方法装饰器是很有意思的能力**：整个类只需 `ctx`，而某个方法额外依赖 `db`——那个方法会在 `db` 就绪时自动运行、`db` 消失时自动清理。方法装饰器的元数据键是 **`symbols.decorator`**（`C/registry.ts:26`；rc.10 时代这个键叫 `symbols.metadata`，是一次交叉换名——现在的 `symbols.metadata` 是 Service 的类型槽），经 `decorator.addInitializer` 挂钩（`:28-35`），`symbols.initHooks` 由 `C/fiber.ts:161-163` 在构造实例后遍历执行。

💡 **实际用例的迁移**：rc.10 的 Hmr 用两个类装饰器 `@Inject('loader') @Inject('timer')` 声明依赖；rc.13 的 Hmr **没有任何 `@Inject` 装饰器**，依赖改经构造函数内的 `ctx.inject(['fs'], ctx => this._watch(ctx))`（`packages/hmr/src/index.ts:184`），timer 依赖已移除（去抖改用原生 `setTimeout`）。类装饰器形式仍在，但 core 仓库内已无现成例证。

## 5.4 `provide()`：注册一个服务

`C/reflect.ts:213-249`，整体是一个 `fiber.effect()`（新增第三参数 `check`，impl 带 `uid`/`dependents`/`isolate`）：

![provide 的 setup 与撤销](diagrams/05-provide-effect.svg)

**provide 的 setup 与撤销** — [交互版](diagrams/05-provide-effect.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-provide-effect.architecture.json)

- **默认 Symbol 登记在根上**：根 ctx 的 isolate 映射是所有视图的原型 · 首次 provide 才写入，之后复用 · 这样未 isolate 的组件天然共享同一实现
- **两处抛错的区别**：props 冲突表示名字被非服务占用 · store 冲突表示同一 realm 重复注册 · 后者的报错会带上原注册位置
- **provide 本身就是一个 effect**：setup 写两张表，disposer 删两张表 · 登记与撤销天然对称 · 卸载后再 notify，依赖方随之回落

💡 **disposer 的顺序很关键，rc.13 把"等依赖方卸载完"做成了显式协议**：先删全局 `store[impl.isolate]`（`:234`，新的查找立即失败），再 notify 让依赖者卸载（`:235`），然后 **显式 `await new Promise` 等 `impl.dependents` 清空**（`:240-243`——`impl.release` 就是那个 resolve，消费方的 `_unload()` 清空依赖者集合后调 `impl.release?.()`，`C/fiber.ts:504-508`），最后才 `provisions.delete(impl)`（`:246`）。这样依赖者在卸载过程中仍能访问到即将消失的服务（做最后的清理工作）。注释写得很明确：`ensure self access before dependencies cleanup`（`:245`）。rc.10 里这只是 `fiber.store` 删除时机的隐式副产品；现在它是一条 provider/consumer 双方都要遵守的握手协议，配合 `Fiber._unload()` 里"等 provisions 无依赖者才执行自身 disposer"的对称半边（`C/fiber.ts:485-487`），完整机制见 [03 篇](03-fiber-model.md)。

## 5.5 `notify()`：级联的引擎

`C/reflect.ts:251-270` 是整个依赖系统的传播中心：

![notify 是依赖系统的传播中心](diagrams/05-notify-propagation.svg)

**notify 是依赖系统的传播中心** — [交互版](diagrams/05-notify-propagation.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-notify-propagation.architecture.json)

- **filter 决定传播边界**：默认只通知 isolate 键相同的 Fiber · 不同 realm 的同名服务互不影响 · 派发事件时把 filter 挂在 this 上一起传下去
- **扫描是全量但过滤很快**：遍历所有 runtime 与 fiber · 第一道就用 name in fiber.inject 排除大多数 · 没有依赖图，所以也不需要维护它
- **级联是递归的**：被唤醒的 Fiber 若也 provide 服务会再触发 notify · 用 allSettled 等待，单个失败不阻断其余 · 收敛后整棵依赖子树状态一致

💡 **这是一次全量扫描（O(总 Fiber 数)）**，不是索引查找。cordis 没有维护"服务名 → 依赖者列表"的反向索引。对插件数量在数百量级的应用，这个成本可以接受；对上万插件会成为瓶颈。**这是明确的规模取舍**。

💡 **`filter` 参数支持定制**。loader 的 isolate 切换逻辑传了一个自定义 filter（`L/config/isolate.ts:127-132`），只通知那些"跨越了 realm 边界"的 Fiber，避免误伤（见 [07 § 7.7](07-loader-and-configuration-tree.md)）。

## 5.6 完整级联示例

![服务卸载引发的级联](diagrams/05-cascade-unload.svg)

**服务卸载引发的级联** — [交互版](diagrams/05-cascade-unload.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-cascade-unload.sequence.json)

- **一个依赖缺失就整体回落**：C 声明了 db 与 api 两个依赖 · 只要 db 消失，epoch 就变成 INACTIVE · cordis 不做部分降级，只做全有或全无
- **卸载是并发的**：B 与 C 的卸载同时进行 · 跨 Fiber 用 Promise.all 并发，每个 disposer 自己捕获错误，单个失败不阻断 · 各自内部的 disposer 逆注册序并发执行
- **递归终止于叶子**：每层卸载都可能触发下一层 notify · 直到没有 Fiber 的 epoch 再变化 · provider 的 store 条目先删（notify 前），provisions 记录等全部依赖者卸载完才摘

💡 **rc.13 的新协议：provider 的清理会等全部 consumer 卸载完**。B、C 作为 A 的依赖者可以并发卸载（跨 Fiber 互不等待，`C/fiber.ts:492` 的 `Promise.all`），但 A 自己的 disposer 要先等 `provisions` 里每个 impl 的 `dependents` 清空（`C/fiber.ts:485-487`，经 `_release` promise）；provide 的 disposer 也对称地等 `impl.release`（`C/reflect.ts:240-243`）。即**依赖者之间并发、依赖者与提供者之间有序**——rc.10 里这只是隐式时序，现在是被显式实现的握手协议（详见 [03 篇](03-fiber-model.md)）。

💡 **级联是递归的**：B 卸载时若它也 provide 了服务，`_updateState`（`C/fiber.ts:372-385`）会在跨 ACTIVE 边界时对 B 提供的每个服务再 `notify` 一次（现按 impl 的实际 isolate 精确通知，`:381-384`）。卸载从被卸载的 provider 出发，沿依赖链逐层传导到全部传递依赖方，每一层都是有序清理（各自走 disposer）而非失控扩散——**全程没有一行图遍历代码**。

## 5.7 `Service` 基类

`C/service.ts`（83 行）提供八个可覆写的符号（rc.10 是七个：`symbols.config` 与 `symbols.resolveConfig` 已删除，代之以 `symbols.metadata` 与一对 `mergeIntercept`/`resolveIntercept`）：

| 符号 | 静态名 | 行号 | 作用 |
|---|---|---|---|
| `symbols.init` | `Service.init` | 7 | 初始化方法；常写成 async generator |
| `symbols.check` | `Service.check` | 8 | 返回 false 表示"我暂不可用" |
| `symbols.invoke` | `Service.invoke` | 9 | 让服务**可被调用**（`ctx.foo()`） |
| `symbols.metadata` | `Service.metadata` | 10 | 配置类型的类型槽（`declare`，:16） |
| `symbols.extend` | `Service.extend` | 11 | 派生带额外属性的服务视图 |
| `symbols.tracker` | `Service.tracker` | 12 | traceable 配置（见 [04 § 4.6](04-context-and-reflect-proxy.md)） |
| `symbols.mergeIntercept` | `Service.mergeIntercept` | 13 | 拦截配置的合并函数；默认 `Object.assign` |
| `symbols.resolveIntercept` | `Service.resolveIntercept` | 14 | 沿 intercept 原型链收集配置 + 回查调用方 inject |

### 构造函数做的事（`C/service.ts:20-37`）

![Service 构造函数做的六件事](diagrams/05-service-ctor.svg)

**Service 构造函数做的六件事** — [交互版](diagrams/05-service-ctor.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/05-service-ctor.architecture.json)

- **构造函数返回值被替换**：第三步判定 symbols.invoke，存在则走 createCallable，否则 self 即 this · JavaScript 允许构造函数返回另一个对象 · Service 借此把自己换成可调用版本 · 调用方拿到的不是 this 而是 self
- **tracker 决定 this.ctx 的含义**：property 为 ctx 表示拦截 this.ctx · associate 为服务名，用于转发 db.xxx 形式的属性 · 详见 04 篇 § 4.6
- **注册发生在构造末尾**：此时字段都已挂好，实现是完整的 · provide 走的仍是 fiber.effect，因此可逆 · check 由子类通过 symbols.check 提供

💡 **`Service` 的构造函数里就完成了 provide**。所以 `class Foo extends Service` 只要被 `ctx.use(Foo)` 实例化，服务就注册好了——不需要手写 `ctx.provide`。

💡 **`createCallable`（`C/utils.ts:239-246`）让服务可调用**。典型例子是 `LoggerService`：`ctx.logger('name')` 返回一个 Logger，同时 `ctx.logger.info(...)` 也能用。实现上 `createCallable` 造一个函数（rc.13 新增 `name` 参数），把服务原型 join 到 `Function.prototype` 上，调用时走 `createTraceable` + `applyTraceable`（`C/utils.ts:234-237`，最终调 `value[symbols.invoke]`）。

### `[symbols.resolveIntercept]`：沿原型链收集配置 + 回查调用方

rc.10 的 `[symbols.resolveConfig](base, head)` 已拆成一对：可覆写的 `[symbols.mergeIntercept]`（合并函数）与 `[symbols.resolveIntercept]`（收集逻辑）。后者 `C/service.ts:57-70`：

```ts
[symbols.resolveIntercept](): T {
  const values: T[] = []
  let intercept = this.ctx[Context.intercept]
  while (this.name in intercept) {
    if (Object.hasOwn(intercept, this.name)) {
      values.unshift(intercept[this.name])     // ← unshift：越靠近根的越靠前
    }
    intercept = Object.getPrototypeOf(intercept)
  }
  const value = locate((this as any)[symbols.caller] ?? this.ctx, this.name)?.fiber?.inject[this.name]
  if (!isNullable(value)) values.unshift(value)   // ← 调用方 inject 的配置并入最高优先级
  const merge = this[symbols.mergeIntercept] ?? Service.prototype[symbols.mergeIntercept]
  return merge.apply(this, values)
}
```

💡 **这解释了 `ctx.intercept()` 的叠加语义**：多层 `intercept` 会沿原型链全部被收集，越外层（越靠近根）的优先级越低。合并走可覆写的 `[symbols.mergeIntercept]`（`:53-55`，默认 `Object.assign({}, ...values)` 浅合并）——**`Config.merge` 钩子已删除**。

💡 **rc.13 最重要的语义变化：inject 配置不再经由 `ctx[Context.intercept]` 链传播**。rc.10 的 Fiber 构造器会把 inject 的配置复制进 intercept 链，服务解析时自然读到；rc.13 删掉了那条复制路径，改为**服务取配置时用 `locate()` 回查注入方**（`:66-67`）：`locate(caller ?? ctx, this.name)?.fiber?.inject[this.name]` 取"调用方 fiber 自己 inject 时声明的配置"，unshift 到最高优先级。`locate()`（`C/reflect.ts:83-101`）沿 fiber 链向上查 provisions/committed/inject，是 04 篇服务解析的同一套查找。`LoggerService` 已整体切换到这对新符号（`ctx.intercept(name, config)` 的类型键也随之从 `symbols.config` 改为 `symbols.metadata`，`C/context.ts:71-77`）。

💡 **`[Service.check]` 的实际用法**：`L/index.ts:179-183`：

```ts
[Service.check]() {
  const config: Loader.Intercept = Service.prototype[Service.resolveIntercept].call(this)
  if (config.await && this.getTasks().length) return false
  return true
}
```

即：如果用户对 loader 设了 `intercept: { loader: { await: true } }`，且还有未完成的加载任务，loader 就"报告自己不可用"，让依赖它的插件等着。

### `[Symbol.hasInstance]` 的特殊实现

`C/service.ts:72-82`：

```ts
static [Symbol.hasInstance](instance: any) {
  if (!instance) return false
  let constructor = instance.constructor
  while (constructor) {
    // constructor may be a proxy
    constructor = constructor.prototype?.constructor
    if (constructor === this) return true
    constructor &&= Object.getPrototypeOf(constructor)
  }
  return false
}
```

💡 **为什么要自定义 `instanceof`？** 因为服务实例可能被 traceable 代理包过一层，原生 `instanceof` 会失效。这里手动沿 `prototype.constructor` 链回溯，绕过代理。

---

**上一篇** ← [04 Context 与 Reflect 代理](04-context-and-reflect-proxy.md) ｜ **下一篇** → [06 事件系统与 Waterfall](06-event-system-and-waterfall.md)：5 种派发模式、11 个 internal 事件、以及 waterfall 中间件链。
