---
layout: content
title: "09 宿主与运行面：Web、网关、编排、存储、类型"
parent_url: /docs/hello-deepseek-harness/
---

# 09 宿主与运行面：Web、网关、编排、存储、类型

> **本篇回答**：把内核包起来交付给人和程序的那一层。137889 行的前端（8 个基础设施包 + 31 个 `ui-*` 插件、`ConversationNodeDefinition` 的事件投影、"前端也是 cordis 插件树"）→ host 与 API 网关（webserver 325 行 vs apiproxy 8571 行、`seq` 断点续传）→ 五种"多步推进"机制（Jobs / Schedule / Workflow / Goal / Plan 的 turn 内外之分）→ 四条存储路径 → 撑起这一切的类型系统（TypeRT 的 `@Remote()`、schemastery 一份 schema 三用、品牌类型）。
> **路径缩写**：`P/` = `packages/`，`CL/` = `packages/client/`，`TP/` = `packages/typert/protocol/src/`。行号对应快照 `47f94385`。
>
> 🧭 **本篇导览**：9.1–9.8 Web 前端 → 9.9–9.16 Host 与 API 网关 → 9.17–9.26 Settings 与多步编排 → 9.27–9.35 持久化 → 9.36–9.43 TypeRT 与 Schema。
>

## 9.1 前端占全仓代码的 24%

| 项 | 数值 |
|---|---|
| `client` 组总行数（`.ts` + `.tsx`） | **137889** |
| 占全仓代码（564122 行） | **24%** |
| 是 `core` 组（40745）的 | **3.4 倍** |
| 子包数 | 8 个基础设施 + **31 个 `ui-*`** |
| 另有 | `apps/web`（Vite + React 壳） |

## 9.2 8 个基础设施包

| 包 | 行数 | 职责 |
|---|---|---|
| **`client-runtime`** | **8989** | **前端运行时**（最大） |
| **`client-connection`** | **4693** | 与 host 的连接（HTTP/WS） |
| `client-web-react` | 1224 | React 绑定 |
| `client-modules` | 972 | 模块注册 |
| `client-locale` | 674 | i18n |
| `client-web` | 642 | Web 壳 |
| `client-hmr` | 447 | **前端热重载** |
| `client-schema-form` | 195 | 由 schema 生成表单 |

💡 **`client-runtime`（8989 行）是前端的核心**——它承担了"把 session 事件流投影成 UI 状态"的全部逻辑（§ 9.3）。

💡 **`client-schema-form` 只有 195 行**却很关键：DSH 的插件配置都有 schemastery schema（[09 篇](09-宿主与运行面-Web网关编排存储类型.md)），前端**自动生成配置表单**。所以加一个插件不需要写设置界面。

💡 **`client-hmr` 与 cordis 的 hmr 是两套**：前者是浏览器侧（Vite HMR 集成），后者是 Node 侧模块热替换（[cordis 08](../hello-cordis/08-HMR热重载.md)）。`web-app` bundle 里把 cordis 的 hmr 关掉了（`disabled: true`，[05 § 5.3](05-启动与Cordis落地.md)）。

## 9.3 `ConversationNodeDefinition`：事件 → UI 节点的投影

`CL/runtime/src/client/contract/conversation.ts:171`。这是前端最重要的扩展点，`docs/architecture.md` 列在映射表里：

> Add a Web Client Chat node → register a `ConversationNodeDefinition` + keyed renderer

![会话节点定义如何消费事件流](diagrams/09-conversation-nodes.svg)

**会话节点定义如何消费事件流** — [交互版](diagrams/09-conversation-nodes.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-conversation-nodes.architecture.json)

- **加一种界面节点的成本**：只需实现一个 ConversationNodeDefinition · 不改 session 也不改 agent-loop · 注册后自动参与事件路由
- **match 决定归属**：同一事件可以属于某个已有节点 · 也可以开启一个新节点 · 还要说明这条事件在节点里的角色
- **state 由增量累积**：start 建立初始 state · update 用后续事件推进它 · 流式 chunk 因此能逐步显示

### 一个真实例子：`deliverablesDefinition`

`CL/ui-deliverables/src/client/turn-deliverables.ts:98`。注释说明它的特殊性：

> Turn-local successful mutation accumulator; **it publishes no view Node**.

```ts
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => { /* 用 turn/start 建初始 state */ },
  update: (context, match) => { /* 累积 tool/call 与 tool/result */ },
}
```

💡 **`match` 返回 `{ id, role }`**：
- `id` = 节点标识（这里用 `turn` 号 → **一个 turn 一个节点**）
- `role` = `'start'`（创建）或 `'update'`（更新）
- 返回 `null` = 不关心这个事件

💡 **`isAppendSurfaceEvent(event)` 的使用**：只处理 `surfaceOp: 'append'` 的 `tool/result`，**跳过压缩产生的 `replace` 节点**（[06 § 6.15](06-Agent循环与会话日志.md)）。前端与后端共享同一套表面语义。

💡 **"publishes no view Node"** —— 这个定义只做**状态累积**（收集本 turn 产出了哪些文件），不渲染自己。累积结果被别的 UI 组件消费。**投影机制与渲染解耦。**

## 9.4 31 个 `ui-*` 包（按行数）

| 包 | 行数 | 说明 |
|---|---|---|
| **`ui-conversation`** | **11310** | **对话主体**（最大） |
| **`ui-trajectory`** | **7900** | **轨迹视图**（agent 行为可视化） |
| **`ui-primitives`** | **6727** | 基础组件库 |
| `ui-settings-models` | 3341 | 模型设置 |
| `ui-workspace` | 2973 | 工作区 |
| `ui-tool` | 2300 | 工具调用展示 |
| `ui-agent-preset` | 2067 | agent 预设编辑 |
| `ui-slots` | 1563 | **插槽机制** |
| `ui-settings-plugins` | 1541 | 插件设置 |
| `ui-input-trigger` | 1356 | 输入触发（`/` 命令、`@` 引用） |
| `ui-commands` | 1329 | 命令面板 |
| `ui-directory-picker-browse` | 1224 | 目录选择 |

其余：`ui-layout`、`ui-theme`、`ui-sidebar`、`ui-settings`、`ui-settings-general`、`ui-settings-plugin-inventory`、`ui-model-selection`、`ui-permission-presets`、`ui-plan`、`ui-goal`、`ui-jobs`、`ui-workflow-run`、`ui-subagent`、`ui-skill`、`ui-deliverables`、`ui-attachment`、`ui-message-feedback`、`ui-user-questions`、`ui-directory-picker-native`。

💡 **`ui-trajectory`（7900 行）值得注意**：它是"agent 做了什么"的可视化。这类视图对调试 agent 行为很关键——比读日志直观。

💡 **`ui-slots`（1563 行）是前端的扩展点机制**：其它 `ui-*` 包往命名插槽里塞组件，而不是硬编码组合。这与 cordis 的服务注册是同一思路。

💡 **`ui-primitives`（6727 行）是自建组件库**，不依赖第三方 UI 框架（否则不需要这么多行）。

## 9.5 前端也是 cordis 插件树

`packages/extensions/cordis-client-runner`（5080 行，[04 § 4.4](04-扩展与生态.md)）。

![浏览器里也跑一棵 cordis 树](diagrams/09-client-runner.svg)

**浏览器里也跑一棵 cordis 树** — [交互版](diagrams/09-client-runner.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-client-runner.architecture.json)

- **两个 runner 的差异来源**：host 版可以直接用 node 的模块系统 · client 版必须自己解析与加载模块 · 这部分逻辑就是多出的 1700 行
- **前端也获得可组合性**：界面组件以插件形式注册 · 不同 profile 可以给出不同界面 · 与后端能力组合方式一致
- **代价是启动更慢**：浏览器侧要先建立插件树 · 首屏需要等树就绪 · web-app bundle 因此关掉了 hmr

## 9.6 host 与 client 的分离

![Host 与 Client 的分离](diagrams/09-host-client-split.svg)

**Host 与 Client 的分离** — [交互版](diagrams/09-host-client-split.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-host-client-split.architecture.json)

- **Host 侧四个包各司其职**：webserver 只负责监听与挂载 · apiproxy 负责鉴权与请求映射 · frontend-static 只服务静态文件
- **Client 侧是完整的插件树**：不只是一个 React 应用 · ui 包以 cordis 插件形式注册 · 于是界面能力也可按 profile 组合
- **分离带来的好处**：headless bundle 直接不起 server · CLI 与 Web 共用同一套后端能力 · 前端可以独立部署

💡 **`web-app` bundle 的 patch 有 424 行**（[05 § 5.3](05-启动与Cordis落地.md)），大部分是配置这些前端相关的行。

## 9.7 前端相关的工程约束

`scripts/` 里有专门的前端校验（[02 § 2.8](02-代码结构地图.md)）：

| 脚本 | 作用 |
|---|---|
| `client-bundle-css.spec.ts` | CSS 打包校验 |
| **`client-bundle-purity.spec.ts`** | **打包纯净性**（大概检查前端 bundle 里没混入 Node 代码） |
| `client-tsconfig.spec.ts` | tsconfig 一致性 |
| `gen-client-catalog.ts`（+ `.spec.ts`） | 生成前端目录 |
| `dev-web.ts`（+ `.spec.ts`） | 开发服务器 |

💡 **`client-bundle-purity.spec.ts` 是个好实践**：在 219 包的 monorepo 里，很容易不小心让前端 import 到 Node-only 的包。用测试锁住。

## 9.8 `docs/web-styling.md`

上游有专门的样式文档（`docs/web-styling.md` + `.zh.md` + `.i18n.yaml`）。

💡 **31 个 `ui-*` 包要保持视觉一致**，靠 `ui-primitives`（6727 行）+ `ui-theme` + 一份样式规范文档。

---

> 📎 **以下承接原「19 Host 与 API 网关」。**
> 本篇讲 host 侧的对外接口层：`webserver`（325 行）为什么这么小、`apiproxy`（8571 行）为什么这么大、以及 `api/gateway` 与 TypeRT 的关系。
> 路径缩写：`P/` = `packages/`。行号对应快照 `47f94385`。

## 9.9 host 组的 8 个包

| 包 | 行数 | 职责 |
|---|---|---|
| **`apiproxy`** | **8571** | API 代理（占全组 78%） |
| `directory-picker-native` | 737 | 目录选择（原生） |
| `directory-picker-browse` | 349 | 目录选择（浏览式） |
| **`webserver`** | **325** | HTTP / WebSocket 服务器 |
| `directory-picker-auto` | 220 | 自动择一 |
| `directory-picker` | 168 | 目录选择 Definition |
| `frontend-static` | 144 | 静态资源服务 |
| `plugin-inventory` | 120 | 插件清单 |

💡 **`apiproxy` 是 `webserver` 的 26 倍**。这个比例本身就说明问题：**"起一个 HTTP 服务"是简单的，"把 agent 能力安全地代理出去"是复杂的**。

## 9.10 为什么 `webserver` 只有 325 行

![webserver 为什么只有 325 行](diagrams/09-webserver-minimal.svg)

**webserver 为什么只有 325 行** — [交互版](diagrams/09-webserver-minimal.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-webserver-minimal.architecture.json)

- **职责单一到极致**：它是一个纯粹的传输层挂载点 · 任何业务判断都不在这里 · 因此行数极少且几乎不变
- **路由交给别人**：apiproxy 处理 API 请求与鉴权 · frontend-static 处理静态资源 · gateway 按类型注册表生成端点
- **可插拔的直接证据**：web-app bundle 加载它 · headless bundle 不加载 · 同一套后端能力两种形态

⚠️ **默认绑定 `127.0.0.1`**（README：`http://127.0.0.1:3080`）——只监听本机回环，不暴露到网络。这是安全默认值。如果改成 `0.0.0.0` 对外提供，**必须自己加鉴权**——DSH 的 Web UI 默认没有登录机制（它假设是单用户本地工具）。

## 9.11 `apiproxy`（8571 行）在做什么

从行数与命名推断（这个包没有导出符号可直接列举），它承担的是"把 host 侧能力映射成 HTTP/WS API"的全部复杂度：

![apiproxy 的 8571 行构成](diagrams/09-apiproxy-composition.svg)

**apiproxy 的 8571 行构成** — [交互版](diagrams/09-apiproxy-composition.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-apiproxy-composition.architecture.json)

- **为什么流式转发最难**：事件产生速度可能超过客户端消费速度 · 断线后要能从正确的 seq 续传 · 还要避免内存无界增长
- **鉴权在这一层**：webserver 不做鉴权 · gateway 只管端点生成 · 准入判断集中在 apiproxy
- **结论的可信度**：构成是从行数与命名推断的 · 没有导出符号可以直接印证 · 要确认请读该包源码

💡 **`seq` 是断点续传的关键**：session 事件的 `seq` 就是日志数组下标（[06 § 6.14](06-Agent循环与会话日志.md) ⑥）。客户端重连时报"我看到 seq N"，服务端从 N+1 继续推。**这是 append-only 设计的又一处红利。**

## 9.12 `api/gateway` 与 TypeRT

`packages/api/`（1807 行 src）：`gateway`（1358）+ `remotes`（449）。

💡 **`dsh-base` patch 里这一行**（[05 § 5.11](05-启动与Cordis落地.md)）：

```yaml
- id: typert-gateway
  name: '@deepseek-ai/dsh-api-gateway'
```

**id 叫 `typert-gateway` 但包名是 `dsh-api-gateway`** —— 说明网关的接口是**由 TypeRT 的类型注册表驱动的**（[09 篇](09-宿主与运行面-Web网关编排存储类型.md)）。

![TypeRT 到 API 端点的三行相邻](diagrams/09-typert-gateway.svg)

**TypeRT 到 API 端点的三行相邻** — [交互版](diagrams/09-typert-gateway.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-typert-gateway.architecture.json)

- **三行相邻不是偶然**：dsh-base patch 里 typert、typert-loader、typert-gateway 相邻 · 前者提供类型信息，后者消费它 · 顺序即依赖顺序
- **端点是生成的**：不手写路由表 · 服务方法上标注装饰器即可暴露 · 于是新增远端方法不必改 gateway
- **包 id 与包名不一致**：配置里的 id 是 typert-gateway · 实际包名是 api/gateway · 按 id 覆盖时要用配置里的 id

## 9.13 `directory-picker`：四包 seam

| 包 | 行数 | 角色 |
|---|---|---|
| `directory-picker` | 168 | Definition |
| `directory-picker-native` | 737 | Provider（**原生对话框**） |
| `directory-picker-browse` | 349 | Provider（**浏览式**，Web 里手动导航） |
| `directory-picker-auto` | 220 | Provider（**自动择一**） |

前端对偶：`client/ui-directory-picker-native`（—）与 `ui-directory-picker-browse`（1224 行）。

💡 **"选一个目录"这种小事也做成 seam**，因为环境差异大：
- 桌面 Electron / 原生壳 → 系统文件对话框（`native`，737 行）
- 纯浏览器 → 只能列目录让用户点（`browse`，349 行）
- `auto` → 探测环境后择一（220 行）

💡 **`native` 比 `browse` 大 2 倍**：调用系统对话框要处理多平台差异（macOS/Windows/Linux 的不同机制）。

## 9.14 `frontend-static`（144 行）

💡 **只有 144 行**——服务 `apps/web` 构建出的静态文件。之所以要单独一个包（而不是直接在 webserver 里）：**它是一个可选的 cordis 插件**。headless 模式不加载它，就不服务前端资源。

## 9.15 `plugin-inventory`（120 行）

配合 `client/ui-settings-plugin-inventory` 与 `dsh plugin` 命令（[04 § 4.5](04-扩展与生态.md)）。

💡 **120 行**说明它只做"列出可用/已装插件"，安装靠 pnpm（profile 目录本身是 workspace）。

## 9.16 三条对外通道的对照

| 通道 | 实现 | 面向 | 特点 |
|---|---|---|---|
| **Web UI** | `webserver` + `apiproxy` + `frontend-static` + `api/gateway` | **人** | 默认 `127.0.0.1:3080`，无鉴权 |
| **ACP** | `acp`（532 行） | **自动化** | "automation-only"，权限是机器策略通道（[04 § 4.13](04-扩展与生态.md)） |
| **DSH SDK** | `sdk/{client,protocol,server}`（4471 行） | **DSH↔DSH / 多语言** | 含 Python SDK（[04 篇](04-扩展与生态.md)） |

💡 **三者都可以驱动同一个 agent**，因为它们都最终调 `ctx.agents`（[06 § 6.10](06-Agent循环与会话日志.md)）。这是"everything is a plugin"在接口层的体现——**接入方式也是插件**。

## 9.17 `settings` 组

> 📐 **配套可跑示例**：[`M11.1 · settings-namespaces`](../../dsh-example/M11-config-data-infrastructure/phases/01-settings-namespaces.ts) 走完
> 默认值 → `update` 合并 → 过期 `expectedRevision` 冲突 → `mutate` 路径编辑 → `replace({})` 重置 → 重复注册抛错。
> 命名空间不是自由字符串，要用 `settingsNamespace('demo')` 铸一个 branded 值。


`packages/settings/`（3897 行）：`settings` + `settings-file`。

💡 **settings 与配置（cordis config）是两回事**：
- **cordis config**：启动时由 profile/bundle patch 决定，改了要重载插件
- **settings**：运行时用户可改的偏好，存在文件里

💡 **两者会交叉**：[06 § 6.11](06-Agent循环与会话日志.md) 提到 `maxParallelToolCalls` 同时出现在插件 Config 与 Settings 里，且有 `source().maxParallelToolCalls`（`AL/index.ts:332`）——**settings 可覆盖启动配置**。前端有 `ui-settings` 系列 5 个包。

---

> 📎 **以下承接原「20 任务编排 Jobs / Schedule / Workflow」。**
> 本篇梳理 DSH 里**五种"多步推进"机制**：Jobs（后台任务）、Schedule（定时）、Workflow（流程）、Goal（同会话目标）、Plan/Todo（计划与清单）。它们容易混淆，但职责清晰不同。
> 路径缩写：`P/` = `packages/`。行号对应快照 `47f94385`。

## 9.18 五种机制的定位

![运行面五种机制的定位](diagrams/09-five-mechanisms.svg)

**运行面五种机制的定位** — [交互版](diagrams/09-five-mechanisms.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-five-mechanisms.architecture.json)

- **按触发者分**：Jobs 与 Schedule 由系统触发 · Commands 由人触发 · Goals 与 Skills 由模型或策略触发
- **按位置分**：Jobs 与 Schedule 在 turn 之外 · Goals 与 Skills 在 turn 之内 · 这是选型时最关键的区别
- **官方文档的说法**：加后台工作就注册到 ctx.jobs · 模型用 job 系列工具收集或停止它 · 见 docs/architecture.md 的映射表

## 9.19 关键区分：在 turn 内还是 turn 外

![在 turn 内还是 turn 外](diagrams/09-in-turn-vs-out.svg)

**在 turn 内还是 turn 外** — [交互版](diagrams/09-in-turn-vs-out.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-in-turn-vs-out.architecture.json)

- **turn 内的三种介入**：Goal 通过塞 inbox 让 turn 继续 · Plan mode 改写模型看到的提示与消息 · Todo 只记录状态，不影响推进
- **turn 外的特点**：不阻塞当前 turn 的结束 · 结果需要显式收取 · 适合耗时长的工作
- **为什么要分清**：turn 内介入会影响延迟与 token 消耗 · turn 外介入需要额外的结果汇入设计 · 选错会导致行为不符预期

## 9.20 Jobs：`ctx.jobs`

> 📐 **配套可跑示例**：[`M09.1 · jobs-background`](../../dsh-example/M09-long-running-orchestration/phases/01-jobs-background.ts) 覆盖 JobHooks 拉模型、增量读、
> `wait` 结算、属主栅栏、`kill`，以及**没有 controller 时 start 被拒**的准入。
> 注意 `JobKind` 是封闭词表（`'bash' | 'subagent'`），`label` 必填。


| 包 | 行数 | 角色 |
|---|---|---|
| `jobs-local` | 567 | Provider |
| `tool-jobs` | 432 | Consumer |
| `jobs` | 424 | Definition |

💡 **`dsh-base` patch 里 jobs 那行直接用 `jobs-local`**（[05 § 5.11](05-启动与Cordis落地.md)）：

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'
```

**id 是 `jobs` 但 name 是 provider 包** —— 这样上层 patch 可以按 `id: jobs` 换成别的 provider（如远端 job 队列）。

💡 **`job_*` 工具（复数）**：`docs/architecture.md` 说 "`job_*` tools collect or stop it"，说明 `tool-jobs`（432 行）注册了多个工具（列出、查询、停止）。

## 9.21 Schedule：2003 行的单包

`packages/schedule/schedule`（2003 行）—— **没有 provider/consumer 拆分**，是个自包含的包。

💡 **它有组级 `AGENTS.md`**（`packages/schedule/AGENTS.md`）——全仓只有少数几个组有（`client`、`web`、`schedule`）。说明这个包的开发规则比较特殊，需要单独给 agent 说明。

💡 **2003 行的量级**对应定时任务的固有复杂度：cron 表达式解析、时区、错过的触发（misfire）处理、持久化（重启后恢复）。

## 9.22 Workflow：含 worker thread

| 包 | 行数 | 说明 |
|---|---|---|
| `workflow-worker-thread` | **1987** | 在 Node worker thread 里跑流程 |
| `tool-workflow` | 566 | Consumer |
| **`tool-ralph`** | **509** | **另一个 Consumer** |
| `workflow` | 519 | Definition |

💡 **`workflow-worker-thread` 比 definition 大 3.8 倍**：worker thread 的通信（序列化、生命周期、错误传播）是主要复杂度。与 `code-runtime-worker-thread`（[08 § 8.15](08-执行侧服务-文件Shell沙箱子代理压缩.md)）同一思路。

💡 **`tool-ralph`（509 行）**：名字来自 agent 圈里的 "Ralph Wiggum" 模式——**反复重跑同一个提示直到任务完成**（源自《辛普森一家》角色，取"傻但坚持"之意）。它是 `workflow` 的一个 consumer，说明 DSH 把这种"暴力循环"也做成了受管的工作流。

## 9.23 Goal：同会话目标

> 📐 **配套可跑示例**：[`M09.2 · goal-lifecycle`](../../dsh-example/M09-long-running-orchestration/phases/02-goal-lifecycle.ts) 走完
> create → pause → resume → block → complete → clear，中间演示一次过期 `GoalRef` 的 CAS 冲突；
> 最后用会话日志里的 `goal/change` 事件数说明"状态完全折叠自日志"。


| 包 | 行数 | 角色 |
|---|---|---|
| `goal` | 1288 | Definition（`ctx.goals`） |
| `goal-round-driver` | 555 | **推进器** |
| `tool-goal` | 517 | Consumer |
| `command-goal` | 200 | 人类命令 |

![goal-round-driver 如何把 turn 续下去](diagrams/09-goal-driver.svg)

**goal-round-driver 如何把 turn 续下去** — [交互版](diagrams/09-goal-driver.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-goal-driver.sequence.json)

- **为什么挂在 turn-stopping**：这是 turn 收尾前最后一个可干预点 · serial 派发让监听器能按序阻塞式表态 · 此时塞 inbox 还来得及被同一个 turn 消费
- **续跑的机制是二次检查**：turn 循环在收尾后会再查一次 nextStep · inbox 有新消息则 nextStep 非空，循环继续 · 因此不需要新开 turn，多轮推进在同一 turn 内完成
- **目标态由独立服务持有**：ctx.goals 与 Agent 解耦，命令层只管写 · driver 只管读并决定是否续跑 · 换掉判定策略不影响 Agent 主循环

💡 **`goal-round-driver` 是 `agent/turn-stopping` 最典型的用户**。[06 § 6.4](06-Agent循环与会话日志.md) 提到 turn 里有**两次** `turnEnds && nextStep.length === 0` 检查（`AL/agent.ts:295` 与 `:299`），中间夹着 serial 派发——这个窗口就是给 goal 这类推进器用的。

💡 **与 subagent 的区别**（[08 § 8.31](08-执行侧服务-文件Shell沙箱子代理压缩.md)）：goal 在**同一会话**里推进（历史连续），subagent 派生**新会话**（上下文隔离）。

## 9.24 Plan mode 与 Todo

| 包 | 行数 | 机制 |
|---|---|---|
| `plan-mode` | 563 | 拦 `agent/pre-step`，先让模型出计划 |
| `tool-todo` | 326 | 写 `todo/write` session 事件 |

💡 **`todo/write` 是 13 个核心 session 事件之一**（`S/types.ts:299`，[06 § 6.13](06-Agent循环与会话日志.md)）。它**不上表面**（不是 `SurfaceEventType`），所以：
- 不直接进模型历史
- 但持久、可回放、UI 能渲染

**待办清单的状态由日志投影而来**，与 `deriveMessages` 是并行的两种投影。

💡 **前端有 `ui-plan`（—）**，但没有 `ui-todo` 独立包——todo 大概在 `ui-conversation` 里渲染。

## 9.25 `deliverables`：产出物追踪

`client/ui-deliverables`（[09 § 9.3](09-宿主与运行面-Web网关编排存储类型.md)）的 `deliverablesDefinition` 累积"本 turn 产出了哪些文件"。

💡 **这是第六种"推进感知"**，但纯前端：从 `tool/call` + `tool/result` 事件推断产出物，不需要后端支持。**投影机制的灵活性在这里体现**——加一种视图不需要加事件类型。

## 9.26 五种机制的选择表

| 需求 | 用什么 | 为什么 |
|---|---|---|
| 跑一个长命令不阻塞对话 | **Jobs** | turn 外执行，`job_*` 工具收结果 |
| 每天早上跑一次检查 | **Schedule** | 定时触发 |
| 固定的多步流程（步骤明确） | **Workflow** | 无需模型决策每步 |
| "反复试直到成功" | **`tool-ralph`**（Workflow 的 consumer） | 受管的重试循环 |
| 让模型持续朝一个目标推进 | **Goal** | 同会话延续 turn |
| 把子任务交给独立的 agent | **Subagent** | 新会话/fork，上下文隔离 |
| 只记录进度给人看 | **Todo** | session 事件，不驱动执行 |
| 先规划再执行 | **Plan mode** | 拦 `agent/pre-step` |

---

> 📎 **以下承接原「21 存储与持久化」。**
> 本篇梳理 DSH 的四条存储路径：`ctx.storage`（通用键值）、`spill`（大内容外溢）、`session-persistence`（会话日志落盘）、`session-query`（历史检索）。以及它们为什么不能合并成一个。
> 路径缩写：`P/` = `packages/`。行号对应快照 `47f94385`。

## 9.27 四条路径的分工

![存储的四条路径](diagrams/09-storage-paths.svg)

**存储的四条路径** — [交互版](diagrams/09-storage-paths.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-storage-paths.architecture.json)

- **四条路径的取舍**：通用键值适合小而频繁的状态 · spill 适合大块只读内容 · session 持久化要求严格顺序与可恢复
- **spill 是最小的一组**：三个包合计只有 664 行 · 因为它只做搬运与引用，不做解释 · 策略包决定何时触发外溢
- **凭据单独隔离**：敏感级别最高，不与普通状态混放 · 便于施加额外的访问控制 · 也便于整体清除

## 9.28 `ctx.storage`：四个包

| 包 | 行数 | 角色 |
|---|---|---|
| **`storage-domain`** | **857** | **域隔离**（最大） |
| `storage-sqlite` | 476 | Provider |
| `storage-json` | 424 | Provider |
| `storage` | 331 | Definition |

💡 **`storage-domain`（857 行）比两个 provider 都大**。"domain" 指的应该是**命名空间隔离**：每个插件有自己的存储域，互不干扰。这类似 cordis 的 isolate realm（[cordis 04 § 4.5](../hello-cordis/04-Context与Reflect代理.md)），但作用于持久数据。

💡 **JSON 与 SQLite 两个 provider**：
- `storage-json`（424）：小量数据、人可读、易调试
- `storage-sqlite`（476）：大量数据、需要查询

## 9.29 `spill`：最小的一组（664 行）

| 包 | 行数 | 角色 |
|---|---|---|
| `spill-policy` | 288 | **策略**（何时该 spill） |
| `spill-local` | 215 | Provider |
| `spill` | 161 | Definition |

💡 **policy 比 provider 还大**（288 vs 215）。因为"什么时候该把内容挪出去"是判断题（大小阈值、内容类型、是否会被再读），而"挪出去"本身很简单（写文件）。

💡 **与 compaction 的分工**（[08 § 8.37](08-执行侧服务-文件Shell沙箱子代理压缩.md)）：
- **spill**：内容还在，只是不在上下文里（可按需取回）
- **compaction**：内容被摘要替代（原文在日志里但不再进模型）

💡 **与 `util/output-retention`（[04 § 4.9](04-扩展与生态.md)）的关系**：后者决定"截断多少"，spill 决定"截断掉的放哪"。

## 9.30 `session-persistence`：JSONL 为主

| 包 | 行数 | 说明 |
|---|---|---|
| **`session-persistence`** | **2159** | Definition + 通用逻辑 |
| **`session-persistence-jsonl`** | **1939** | JSONL provider |
| `session-persistence-sqlite` | 714 | SQLite provider |
| `session-checkpoint-policy` | 113 | 落盘时机策略 |

![JSONL 为何契合又为何有 1939 行](diagrams/09-jsonl-persistence.svg)

**JSONL 为何契合又为何有 1939 行** — [交互版](diagrams/09-jsonl-persistence.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-jsonl-persistence.architecture.json)

- **格式选择的匹配度**：append-only 语义与 JSONL 完全一致 · 不需要事务也不需要重写 · 崩溃恢复只需处理尾部一行
- **复杂度不在写，在读与运维**：长会话需要按文件轮转 · 要能快速定位某个 seq，因此需要索引 · 损坏文件要能尽量修复而不是整份作废
- **原子写是必要的**：索引与元数据不能写坏 · 用 util/atomic-write 保证替换的原子性 · 否则崩溃会留下半个索引

💡 **`session-checkpoint-policy` 只有 113 行**但很关键：决定"什么时候 flush"。压缩后是好时机（[08 § 8.39](08-执行侧服务-文件Shell沙箱子代理压缩.md)），turn 结束也是。

## 9.31 `session-query`：检索与导出

| 包 | 行数 | 角色 |
|---|---|---|
| **`session-query-sqlite`** | **1783** | Provider（SQLite 全文索引） |
| **`session-query`** | **1718** | Definition |
| **`tool-session-query`** | **1444** | Consumer（**模型可查历史**） |
| `session-log-export` | 270 | 导出 |

💡 **`web-app` bundle 里默认关闭**（[05 § 5.3](05-启动与Cordis落地.md)）：

```yaml
- id: session-query-sqlite
  config:
    path: ':memory:'
    openAt: never
```

patch 注释解释了三层考虑：

> Full-text session search is opt-in (the base row's `openAt: never`). This restatement keeps the Web values on one ephemeral in-memory index; a deployment enabling content search overrides `openAt` to `first-search` in a later patch layer, which **defers the `node:sqlite` import and in-memory handle to the first search so Node 22 startup stays quiet**.

| 设置 | 含义 |
|---|---|
| `path: ':memory:'` | 内存索引，不落盘（临时） |
| `openAt: 'never'` | **不打开** → 全文搜索禁用 |
| `openAt: 'first-search'` | 首次搜索时才 import `node:sqlite` |

💡 **"so Node 22 startup stays quiet"** —— `node:sqlite` 在 Node 22 上是实验性 API，import 它会打印警告。延迟到首次使用就避免了启动噪音。**这是对用户体验的细致考虑。**

💡 **`tool-session-query`（1444 行）让模型能查自己的历史会话**——这是 agent 长期记忆的一种实现方式（检索式而非全量加载）。

## 9.32 `typert`：类型运行时

`packages/typert/`（4 个包）：

| 包 | 行数 | 角色 |
|---|---|---|
| **`generator`** | **6245** | **代码生成器**（最大） |
| `registry` | 909 | 运行时类型注册表 |
| `protocol` | 801 | 协议定义 |
| `loader` | 472 | 加载器 |

💡 **`dsh-base` patch 里三行相邻**（[05 § 5.11](05-启动与Cordis落地.md)）：`typert`（= `dsh-typert-registry`）→ `typert-loader` → `typert-gateway`（= `dsh-api-gateway`）。

### `typert/protocol` 的关键符号

| 符号 | 行号 | 说明 |
|---|---|---|
| `isTypertRemoteSegment()` | 17 | 路径段判定 |
| `TypertLookupFailure` | 25 | 查找失败错误 |
| `TypertGatewayBindingOptions` | 83 | 网关绑定选项 |
| `TypertGatewayBinding<Service>` | 89 | 网关绑定 |
| `RemoteInvocationMarker` | 96 | 远端调用标记 |
| `RemoteMethodMarker` | 101 | 远端方法标记 |
| **`bindTypertRemote<Service>()`** | **135** | 绑定远端服务 |
| **`abstract class TypertRemoteService<T> extends Service<T>`** | **147** | **远端服务基类** |
| **`@Remote(exportName)` 装饰器** | **168 / 177 / 178** | **标记远端方法** |

![@Remote 装饰器的三段链路](diagrams/09-remote-decorator.svg)

**@Remote 装饰器的三段链路** — [交互版](diagrams/09-remote-decorator.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-remote-decorator.architecture.json)

- **一次声明，两处消费**：同一份类型信息既生成端点也生成客户端 · 于是前后端类型天然一致 · 不需要手工同步接口定义
- **generator 是最大的一块**：6245 行，负责产出存根与 .d.ts · 要处理泛型、联合类型与可选参数 · 因此体量远超 registry 与 gateway
- **装饰器有三个重载**：可以只标记，也可以指定导出名 · 导出名用于控制生成的客户端方法名 · 默认取方法自身名字

💡 **`@Remote` 有三个重载签名**（`:168`、`:177`、`:178`）——支持带/不带 `exportName` 参数的形式，与 cordis 的 `@Inject()`（[cordis 05 § 5.3](../hello-cordis/05-服务注册与依赖解析.md)）是同一风格。

## 9.33 `schemastery`：配置 schema

`vendor/schemastery`（3.18.1，[05 § 5.13](05-启动与Cordis落地.md)）。

💡 **DSH 的插件 Config 都用 schemastery**（`z.object({...})`，如 [07 § 7.20](07-请求管线-LLM工具与提示.md) 的 `SystemPrompt.Config`）。它实现了 Standard Schema 接口，所以 cordis 的 `resolveConfig`（[cordis 03 § 3.6](../hello-cordis/03-Fiber模型.md)）能直接用。

💡 **`client-schema-form`（195 行）从 schema 生成表单**（[09 § 9.2](09-宿主与运行面-Web网关编排存储类型.md)）——**同一份 schema 三用**：运行时校验、类型推导、UI 生成。

## 9.34 存储位置：Harness home

| 相关符号 | 位置 |
|---|---|
| `dshHomePath` | `boot()` 里 `ctx.provide('dshHomePath', dshHomePath)`（`AB/index.ts:~766`） |
| `PROFILES_DIR = 'profiles'` | `AB/profile.ts:36` |
| `util/home-paths` | 路径解析包 |
| `XDG_*` 环境变量 | `BOOTSTRAP_PREFIXES` 之一（[05 § 5.8](05-启动与Cordis落地.md)） |

💡 **`XDG_*` 被列为 bootstrap-only**说明 DSH 遵循 XDG Base Directory 规范来定位 home 目录。

## 9.35 `docs/persistence-catalog.md`

上游有专门的持久化目录文档（脚本生成）。

💡 **本篇给的是"为什么这样分"，官方文档给的是"具体存了什么"**。要查某个数据存在哪，读官方目录。

---

> 📎 **以下承接原「22 类型系统 TypeRT 与 Schema」。**
> 本篇讲 DSH 的两套类型基础设施：**TypeRT**（运行时类型注册表 + 类型安全 RPC + 代码生成，8427 行）与 **schemastery**（配置 schema，一份三用）。
> 路径缩写：`P/` = `packages/`，`TP/` = `packages/typert/protocol/src/`。行号对应快照 `47f94385`。

## 9.36 TypeRT 的四个包

| 包 | 行数 | 角色 |
|---|---|---|
| **`generator`** | **6245** | 代码生成器（占 74%） |
| `registry` | 909 | 运行时类型注册表 |
| `protocol` | 801 | 协议与装饰器定义 |
| `loader` | 472 | 加载器 |

💡 **generator 占 74%** 说明 TypeRT 的重心是**编译期产出**，运行时只留一个轻量注册表。

💡 **`dsh-base` patch 里三行相邻**（[05 § 5.11](05-启动与Cordis落地.md)）：

```yaml
- id: typert            → @deepseek-ai/dsh-typert-registry
- id: typert-loader     → @deepseek-ai/dsh-typert-loader
- id: typert-gateway    → @deepseek-ai/dsh-api-gateway
```

**注册表 → 加载器 → 网关**，三段流水线。

## 9.37 `@Remote()`：类型安全 RPC 的入口

`TP/index.ts` 的核心导出：

| 符号 | 行号 | 说明 |
|---|---|---|
| `isTypertRemoteSegment()` | 17 | 路径段判定 |
| `TypertLookupFailure<Failure>` | 25 | 查找失败错误（**带泛型 failure 载荷**） |
| `TypertGatewayBindingOptions` | 83 | 网关绑定选项 |
| `TypertGatewayBinding<Service>` | 89 | 网关绑定 |
| `RemoteInvocationMarker` | 96 | 远端调用标记 |
| `RemoteMethodMarker` | 101 | 远端方法标记 |
| **`bindTypertRemote<Service>()`** | **135** | 绑定远端服务 |
| **`abstract class TypertRemoteService<T> extends Service<T>`** | **147** | **远端服务基类** |
| **`Remote()` 装饰器**（3 个重载） | **168 / 177 / 178** | 标记远端方法 |

![TypeRT 的完整生成管线](diagrams/09-typert-pipeline.svg)

**TypeRT 的完整生成管线** — [交互版](diagrams/09-typert-pipeline.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-typert-pipeline.architecture.json)

- **五个包构成闭环**：protocol 提供装饰器与基类 · registry 在运行时收集 · gateway 与 generator 分别面向服务端与客户端，remotes 负责实际连接
- **类型安全跨进程**：客户端存根的类型来自服务端定义 · 改服务端签名会让客户端编译失败 · 避免运行期才发现协议不一致
- **配置里三行相邻**：typert、typert-loader、typert-gateway · dsh-base patch 中顺序固定 · 这是依赖顺序的直接体现

💡 **`TypertRemoteService<out T = never> extends Service<T>`（`:147`）** —— 它是 **cordis `Service` 的子类**。所以"可远端调用的服务"仍然是普通的 cordis 服务，只是多了远端能力。**又一处"everything is a plugin"。**

💡 **`TypertLookupFailure<Failure = unknown>`（`:25`）带泛型**：查找失败时能携带结构化的失败原因，而不只是消息字符串。与 `LlmFailure`（[07 § 7.7](07-请求管线-LLM工具与提示.md)）是同一思路。

## 9.38 schemastery：一份 schema 三用

`vendor/schemastery`（3.18.1，[05 § 5.13](05-启动与Cordis落地.md)）。

![一份 schema 的三种用途](diagrams/09-schema-three-uses.svg)

**一份 schema 的三种用途** — [交互版](diagrams/09-schema-three-uses.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-schema-three-uses.architecture.json)

- **为什么用 schemastery**：它同时提供运行时校验与类型推导 · cordis 的配置校验原生支持它 · 默认值也由 schema 声明
- **默认值的坑**：某些字段需要区分未设置与空值 · 例如 toolOrder 的空数组缺少 rest 锚点 · 因此默认值要显式写成未定义态
- **界面自动生成的边界**：简单标量与数组可以直接渲染 · 复杂联合类型仍需手写控件 · 这时用 schema 只做校验

## 9.39 工具 schema 的四种表示

`ctx.tools` 里同一个工具的 schema 有四种形态（[07 § 7.9](07-请求管线-LLM工具与提示.md)）：

| 形态 | 产生者 | 用途 |
|---|---|---|
| **JSON Schema** | `T/json-schema.ts`（656 行） | 发给模型的 tool 定义 |
| **TypeScript 类型** | `T/ts-types.ts`（293 行）`jsonSchemaToTs` / `renderToolsSdk` | Code Mode 里模型写 TS |
| **Python 类型** | `T/py-types.ts`（818 行）`jsonSchemaToPy` / `renderToolsSdkPy` | Code Mode 里模型写 Python |
| **呈现配置** | `T/presentation.ts`（389 行） | native vs code mode 的展示选择 |

💡 **Python 类型生成（818 行）比 TS（293 行）大 2.8 倍**。因为 TS 与 JSON Schema 结构接近（都有 union、optional、literal），而 Python 需要映射到 `TypedDict` / `Literal` / `Optional` 等，且要处理 Python 的命名约定与保留字。

💡 **这解释了 `python/sdk` 的存在**（[04 篇](04-扩展与生态.md)）——Code Mode 里模型能写 Python，就需要 Python 侧的运行时。

## 9.40 代码生成脚本一览

`scripts/` 里与类型/生成相关的（[02 § 2.8](02-代码结构地图.md)）：

| 脚本 | 产出 |
|---|---|
| `gen-cordis-api.ts` | `docs/cordis-api/`（11 md） |
| `gen-cordis-catalog.ts` | cordis 插件目录 |
| `gen-cordis-inspect-catalog.ts` | 检视目录 |
| `gen-config-catalog.ts` | `docs/config-catalog.md` |
| `gen-client-catalog.ts` | 前端目录 |
| `verify-*` 对应版本 | **CI 里校验产物是最新的**（`--check` 模式） |

💡 **每个 `gen-*` 都有对应的 `verify-*`（或 `--check` 参数）**。根 `package.json` 的 `hygiene` 脚本串起来跑（[02 § 2.8](02-代码结构地图.md)）。**生成物进版本库 + CI 校验一致性**是这类工具链的标准做法。

## 9.41 `*.generated.ts` 文件

已知的一个：`P/core/scope/src/scoped-events.generated.ts`（49 行，[03 § 3.6](03-能力缝与服务全景.md)）。

💡 **改 `.generated.ts` 会被覆盖**——要改生成器。`scripts/check-expected-filenames.sh` + `.github/workflows/expected-filenames.yml` 大概就在校验这类文件名约定。

## 9.42 品牌类型（nominal typing）

DSH 大量使用"品牌化类型"来防止类型混用：

| 类型 | 位置 | 形式 |
|---|---|---|
| `Scoped<T>` | `SC/index.ts:27` | `object & { readonly [ScopedBrand]: T }` |
| `ToolExecutionToken` | `T/index.ts:307` | `symbol & { readonly [brand]: true }` |
| `SessionId` | `P/core/session` | 品牌化 string |
| `CallId` | `P/core/tools` | 品牌化 string |
| — | `P/llm/llm/src/brand.ts`（64 行） | 品牌工具 |
| — | `P/util/brand` | 品牌工具包 |

💡 **两个独立的 brand 工具包**（`llm/src/brand.ts` 与 `util/brand`）说明这个模式用得很广。品牌类型让 `SessionId` 与普通 `string` 在编译期不可互换——**避免"把 callId 当 sessionId 传"这类错误**。

💡 **`ToolExecutionToken` 用 `symbol` 而非 `string` 品牌**（`T/index.ts:307`）：symbol 无法伪造（不能从字符串构造），适合做能力令牌。

## 9.43 类型检查工具链

| 工具 | 配置 | 作用 |
|---|---|---|
| TypeScript | 5 份 tsconfig（[02 § 2.9](02-代码结构地图.md)） | host / client 分离 |
| **oxlint** | `.oxlintrc.json` + `.oxlintrc.staged.json` | Rust 写的 linter |
| knip | `knip.json` | 未使用的导出/依赖 |
| jscpd | `.jscpd.json` | 重复代码 |
| **doc-typecheck** | `scripts/doc-typecheck.ts` | **文档里的代码块必须能编译** |
| publint | — | 包导出正确性 |
| `verify-node-next-types` | `scripts/` | Node 的 `NodeNext` 模块类型 |

💡 **`verify-node-next-types`** 针对 ESM + `NodeNext` 的 `.ts` 扩展名 import 问题（DSH 的 import 都写 `./x.ts`，见 vendor cordis 的 import 风格，[05 § 5.15](05-启动与Cordis落地.md)）。

💡 **`doc-typecheck` + `doc-budgets.manifest.json`** 是很少见的实践：文档里的代码块**必须能编译**，且文档有**长度预算**。169055 行 markdown 靠工程手段维持质量（[02 § 2.8](02-代码结构地图.md)）。

---

**上一篇** ← [08 执行侧服务：文件、Shell、沙箱、子代理、压缩](08-执行侧服务-文件Shell沙箱子代理压缩.md) ｜ **下一篇** → [10 测试与工程实践](10-测试与工程实践.md)：测试占 45%、逐文件 100% 覆盖率门禁、双轨 CI。
