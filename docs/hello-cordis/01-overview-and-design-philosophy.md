---
title: "项目概览与设计哲学"
---
# 项目概览与设计哲学

> **本篇回答**：cordis 解决什么问题、"时空可组合性"具体指什么、为什么一个核心 2057 行、全家实现 1.1 万行的框架值得单独一套分析。
> **路径缩写**：`C/` = `packages/core/src/`，`L/` = `packages/loader/src/`，`I/` = `packages/include/src/`。行号对应快照 `bc9fae7`（v4.0.0-rc.13）。
>
> 🧭 **本篇导览**：1.1–1.2 定位与规模 → 1.3–1.4 时空可组合性与四个核心抽象 → 1.5–1.6 最小可运行示例与横向对比 → 1.7–1.8 阅读顺序与读源码前必知的六件事。
>

## 1.1 一句话定位

cordis 是一个 **元框架（meta-framework）**：它本身不提供任何业务能力，只提供"如何把能力组装起来、并且能安全拆掉"的机制。

![元框架与普通框架的分工差异](diagrams/01-meta-framework.svg)

**元框架与普通框架的分工差异** — [交互版](diagrams/01-meta-framework.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-meta-framework.architecture.json)

- **普通框架给的是槽位**：预置路由、ORM、模板引擎等具体能力 · 你的代码填进它规定的位置 · 能力集合由框架决定，扩展受限于预留的钩子
- **cordis 只给四件东西**：Context 是能力的视图，Fiber 是生命周期的单元 · Service 是跨组件共享的能力，Event 是解耦通道 · 四者合计 2057 行，不含任何业务逻辑
- **差异的落点是可拆卸**：普通框架关心「如何把能力用起来」 · cordis 关心「如何把能力组装起来并安全拆掉」 · 因此每个副作用都必须可逆

它最知名的下游是 **[DeepSeek Harness](../hello-dsh/README.md)**（`dsh`）——DSH 的口号"Everything is a Plugin"直接来自 cordis 的能力，连模型适配器、工具注册表、会话日志、agent 主循环本身都是插件。

## 1.2 版本与规模

版本号、快照 commit、许可证、运行时依赖与工具链等元信息统一维护在 [索引 § 一](README.md)，不在此重复；本篇只保留与设计判断直接相关的规模数据。

**规模小得惊人**（对一个元框架而言）：

| 指标 | 数值 |
|---|---|
| TS 文件 / 总行数 | 144 / **28283**（含仓库根 `vitest.config.ts` 10 行） |
| 其中 **实现**（`*/src/*`） | 63 文件 / **11470 行** |
| 其中 **测试**（`*/tests/*`） | 80 文件 / **16803 行** |
| 核心包 `cordis` 实现 | **2057 行**（9 个文件） |

各包实现行数（rc.10 时只有 9 个包；rc.13 已达 **16 个**，包名全部去掉了 `plugin-` 前缀）：

| 包 | npm 名 | 版本 | 行数 |
|---|---|---|---|
| `core` | `cordis` | 4.0.0-rc.13 | **2057** |
| `hmr` | `@cordisjs/hmr` | 2.0.0-rc.0 | 1946 |
| `package-manager` | `@cordisjs/package-manager` | 0.1.0 | 1860 |
| `loader` | `@cordisjs/loader` | 1.0.0-rc.10 | 1465 |
| `include` | `@cordisjs/include` | 2.0.0-rc.0 | 1212 |
| `cli` | `@cordisjs/cli` | 4.0.0 | 949 |
| `http` | `@cordisjs/http` | 1.6.0 | 483 |
| `create` | `create-cordis` | 0.3.2 | 402 |
| `fs` | `@cordisjs/fs` | 2.0.0-rc.0 | 308 |
| `cli-cordis` | `@cordisjs/cli-cordis` | 2.0.0-rc.0 | 241 |
| `timer` | `@cordisjs/timer` | 1.1.5 | 148 |
| `logger-console` | `@cordisjs/logger-console` | 1.0.1 | 137 |
| `fs-node` | `@cordisjs/fs-node` | 0.1.0 | 128 |
| `http-socks` | `@cordisjs/http-socks` | 1.0.1 | 85 |
| `env` | `@cordisjs/env` | 1.0.2 | 46 |
| `group` | `@cordisjs/group` | 1.0.1 | **3** |

💡 **测试行数（16803）超过实现行数（11470）**，而核心 `fiber.ts` 一个文件（557 行）就对应 `dispose.spec.ts` + `fiber.spec.ts` + `component.spec.ts`（原 `plugin.spec.ts`）共 949 行测试。对一个生命周期框架，这个比例是合理的——**状态机的正确性只能靠穷举验证**。

💡 **`group` 包只有 3 行**：`export default Group`，把 loader 里的 `Group` 再导出一次。这是为了让配置文件能写 `name: '@cordisjs/group'` 而不必依赖 loader 的内部路径。

💡 **rc.11–rc.13 把新语义压进了 core 的旧行数里**：配置/注入的自换代计数 `_revision`（`C/fiber.ts:131`）与依赖方卸载握手 `dependents` / `release`（提供者要等全部依赖者卸载完才清理，`C/fiber.ts:121`）都进了 fiber.ts。「无依赖组件装上就立即运行」如今由 `_getState()`（`C/fiber.ts:365-370`）给出判定，结论不变。

## 1.3 "时空可组合性"到底指什么

论文标题里的 spatiotemporal composability 是 cordis 的核心主张。拆开看（下例中的 `db` 是本系列统一的示例服务名——一个虚构的数据库服务，cordis 源码里并不存在，可替换为任意服务名；见[索引术语约定](README.md)）：

![时空可组合性与共同前提](diagrams/01-spatiotemporal.svg)

**时空可组合性与共同前提** — [交互版](diagrams/01-spatiotemporal.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-spatiotemporal.architecture.json)

- **空间维度解决可见性**：isolate 生成新 Symbol 当存储键 · 同名服务在不同 realm 是彼此无关的实体 · 谁能看到哪个实现由 realm 决定
- **时间维度解决可替换**：依赖身份编码进 epoch 字符串 · epoch 变化即触发 unload 再 reload · 插件无需自己写重连逻辑
- **两者共享同一前提**：ctx.effect(() => { setup(); return teardown }) · 注册服务、监听事件、开定时器都要登记 disposer · 没有可逆效应，隔离与替换都无法安全回收

一句话总结：**cordis 把"插件的生命周期"和"服务的可见范围"都做成了一等公民**。

## 1.4 四个核心抽象

整个框架只有四个概念，全部在 `C/` 的 2057 行里：

![框架的四个概念与用户视角](diagrams/01-four-concepts.svg)

**框架的四个概念与用户视角** — [交互版](diagrams/01-four-concepts.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-four-concepts.architecture.json)

- **Context 与 Fiber**：ctx 是 Proxy，ctx.db 是动态解析而非普通属性 · extend / isolate / intercept 派生新视图（04 篇） · 每次 ctx.use(p) 产生一个 Fiber，effect() 是唯一副作用入口（03 篇）
- **Service 与 Event**：provide 注册、inject 声明依赖，get trap 沿 fiber 链向上查找（05 篇） · isolate realm 决定服务可见性 · 事件有 emit / parallel / serial / bail / waterfall 五种派发（06 篇）
- **四者合计 2057 行**：全部集中在 core 包的 C/ 目录 · fiber.ts 557 行是全框架最核心的文件 · 用户只需面对 ctx 一个入口

## 1.5 最小可运行示例（对照源码理解）

```ts
import { Context, Service } from 'cordis'

// ① 一个服务组件：provide 'greeter'
class Greeter extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter')   // → C/service.ts 里调 ctx.reflect.provide('greeter', self, ...)
  }
  hello(name: string) { return `hello ${name}` }
}

// ② 一个消费组件：inject 'greeter'
const consumer = {
  inject: ['greeter'],                       // → C/registry.ts:43 Inject.resolve
  apply(ctx: Context) {
    ctx.logger.info(ctx.greeter.hello('cordis'))   // → Proxy get trap 解析
    // 登记一个可逆效应
    ctx.effect(() => {                       // → C/fiber.ts:294
      const timer = setInterval(() => {}, 1000)
      return () => clearInterval(timer)      // ← 卸载时自动调用
    })
  },
}

const ctx = new Context()                    // → C/context.ts 构造，返回 Proxy
ctx.use(Greeter)
ctx.use(consumer)                            // greeter 已就绪 → consumer 立即 ACTIVE
```

> 💡 `ctx.use()` 是 rc.13 的注册 API；旧名 `ctx.plugin()` 仍可用但已标注 `@deprecated`（`C/registry.ts:122-123`，内部只是转发到 `use()`）。

发生了什么：

![ctx.use() 从注册到服务就绪](diagrams/01-plugin-lifecycle.svg)

**ctx.use() 从注册到服务就绪** — [交互版](diagrams/01-plugin-lifecycle.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-plugin-lifecycle.sequence.json)

- **主链路**：RegistryService 把组件解析成 Component.Runtime（`C/registry.ts:94-99`） · 每次 ctx.use() 产生一个独立 Fiber（`C/registry.ts:246`） · 真正执行组件函数的是 Fiber 的 _reload()（`C/fiber.ts:450`）
- **epoch 依赖追踪**：无依赖组件 epoch 为 `'0'`（`_revision` 初始 0），立即激活 · 依赖命中后 epoch 变为 `'0:1'` · 依赖身份或自身 revision 变化即触发 unload 再 reload
- **可逆效应**：provide 经 fiber.effect() 登记，卸载时自动撤销 · disposer 挂在所属 Fiber 的 _disposables 上 · 同一 effect 内的 disposer 严格逆序执行

💡 **注意 epoch 是 `'0:1'` 而不是布尔值**。`1` 是 greeter 实现实例（`Impl`）的 `uid`——由 `C/reflect.ts:224` 的 `_implCounter` 自增，与 Fiber 的 uid（registry.counter）是**两个独立计数器**。如果 greeter 被卸载重装，新 Impl 的 uid 变成 `2`，consumer 的 epoch 变成 `'0:2'` ≠ `'0:1'` → **自动重载**。这就是"时间可组合性"的实现（[03 § 3.4](03-fiber-model.md)）。

## 1.6 与其它插件系统的对比

| 维度 | cordis | Node 传统（require + 事件） | VS Code 扩展 | Webpack / Vite 插件 |
|---|---|---|---|---|
| 卸载能力 | **一等公民**（effect 强制返回 disposer） | 基本不支持 | 有 `deactivate` 但需手写清理 | 通常不卸载 |
| 依赖变化时 | **自动 unload + reload** | 无感知 | 需重启窗口 | 需重启 dev server |
| 服务可见性 | **isolate realm 隔离** | 全局单例 | 全局 API | 全局 |
| 配置热更新 | **改 yml 即生效**（loader + include；include 需显式 `watch: true`，`I/index.ts:115`） | 需重启 | 部分 | 部分 |
| 代码热更新 | **HMR（Hot Module Replacement，模块热替换）到插件粒度** | 无 | 无 | 有（模块粒度） |
| 中间件链 | waterfall（`next()`） | 需自己实现 | 无统一机制 | 有（钩子） |

💡 **cordis 最独特的是"依赖变化触发重载"**。多数插件系统里，依赖注入是启动期一次性的；cordis 把它做成了运行期持续追踪的关系。代价是复杂度——`fiber.ts` 那 557 行几乎全在处理这件事。

## 1.7 阅读顺序建议

推荐路线与「按身份选路」表统一维护在 [索引 § 三 阅读路线](README.md)，不在此重复。

## 1.8 读源码前必须知道的六件事

![读源码前必须知道的六件事](diagrams/01-six-pitfalls.svg)

**读源码前必须知道的六件事** — [交互版](diagrams/01-six-pitfalls.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/01-six-pitfalls.architecture.json)

- **Proxy 带来的调试陷阱**：C/context.ts 构造函数末尾 return self · self = new Proxy(this, ReflectService.handler) · ctx.foo 可能抛错而不是返回空值
- **两处刻意的不对称**：ctx 把 then 列为保留字，避免被 await 吞掉 · 但 ctx.use() 的返回值刻意是 thenable（registry.ts:247-250） · 错误堆栈把注册处调用栈拼到异步错误上（utils.ts:280 / :295）
- **没有显式作用域表**：extend / isolate / intercept 全靠 Object.create · loader 运行时还会 Object.setPrototypeOf（`L/config/isolate.ts:110-111` 与 `L/config/entry.ts:183`） · 谁能看到什么由原型链决定，详见 04 篇 § 4.2

---

**返回** ← [索引](README.md) ｜ **下一篇** → [02 代码结构与包边界](02-code-structure-and-package-boundaries.md)：16 个包的职责划分、依赖方向、以及为什么核心只有 2057 行。
