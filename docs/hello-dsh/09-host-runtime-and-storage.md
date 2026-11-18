---
title: "宿主与运行面：Web、网关、编排、存储、类型"
---
# 宿主与运行面：Web、网关、编排、存储、类型

> **本篇回答**：把内核包起来交付给人和程序的那一层。396936 行的前端（10 个基础设施包 + 61 个 `ui-*` 插件、`ConversationNodeDefinition` 的事件投影、"前端也是 cordis 插件树"）→ host 与 API 控制器族（webserver 862 行 + `packages/api` 9 包，`seq` 断点续传）→ 五种"多步推进"机制（Jobs / Schedule / Workflow / Goal / Plan 的 turn 内外之分）→ 四条存储路径 → 撑起这一切的类型系统（TypeRT 的 `@Remote()`、schemastery 一份 schema 多用、品牌类型）。
> **路径缩写**：`P/` = `packages/`，`CL/` = `packages/client/`，`TP/` = `packages/typert/protocol/src/`。行号对应快照 `38a6a5c9`（`dsh-v0.2.2-rc.3`）。
>
> 🧭 **本篇导览**：9.1–9.8 Web 前端 → 9.9–9.16 Host 与 API 网关 → 9.17–9.26 Settings 与多步编排 → 9.27–9.35 持久化 → 9.36–9.43 TypeRT 与 Schema。
>

## 9.1 前端占全仓代码的 27%

| 项 | 数值 |
|---|---|
| `client` 组总行数（`.ts` + `.tsx`） | **396936** |
| 占全仓代码（1460227 行） | **27%** |
| 是 `core` 组（50758）的 | **7.8 倍** |
| 子包数 | 10 个基础设施 + **61 个 `ui-*`** |
| 另有 | `apps/web`（Vite + React 壳）、`apps/desktop`（Electron 壳，§ 9.9a） |

## 9.2 10 个基础设施包

| 包 | 行数（src） | 职责 |
|---|---|---|
| **`client-modules`** | **2835** | 模块注册 |
| **`client-connection`** | **2751** | 与 host 的连接（HTTP/WS） |
| `client-locale` | 1280 | i18n |
| `client-shortcuts` | 1245 | 快捷键 |
| `client-web` | 889 | Web 壳 |
| `client-file-upload` | 975 | 文件上传 |
| `client-hmr` | 345 | **前端热重载** |
| `client-product-analytics` | 495 | 产品分析 |
| `client-resources` | 371 | 资源服务 |
| `client-store` | 393 | 前端状态存储 |

💡 **rc.3 删掉了四个旧基础设施包**：`client-runtime`、`client-web`、`client-web-react`、`client-schema-form` 全部不存在了。旧版"`client-runtime` 是前端核心"的论述随之失效——"把 session 事件流投影成 UI 状态"的逻辑现在分散在 `ui-conversation` 的 contract 层（§ 9.3）与 `ui-chat` 的 `conversation-nodes/` 里。

💡 **由 schema 生成配置表单**的能力没有消失：`ui-settings/src/client/config-form.ts` 接棒了旧 `client-schema-form` 的角色。DSH 的插件配置都有 schemastery schema，前端照 schema 自动渲染设置界面（§ 9.33）。

💡 **`client-hmr` 与 cordis 的 hmr 是两套**：前者是浏览器侧（Vite HMR 集成），后者是 Node 侧模块热替换（[cordis 08](../hello-cordis/08-hmr.md)）。`web-app` bundle 里把 cordis 的 hmr 关掉了（`disabled: true`，[05 § 5.3](05-startup-and-cordis-runtime.md)）。

## 9.3 `ConversationNodeDefinition`：事件 → UI 节点的投影

契约现在在 `CL/ui-conversation/src/client/contract/conversation.ts:213`（`ConversationNodeDefinition`），具体的节点定义搬到了 `CL/ui-chat/src/client/conversation-nodes/`（assistant、tool、command、compaction、request-prompt 等 20+ 个文件）。这是前端最重要的扩展点，`docs/architecture.md:163` 仍列在映射表里：

> Add a Web Client Chat node → register a `ConversationNodeDefinition` + keyed renderer

![会话节点定义如何消费事件流](diagrams/09-conversation-nodes.svg)

**会话节点定义如何消费事件流** — [交互版](diagrams/09-conversation-nodes.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-conversation-nodes.architecture.json)

- **加一种界面节点的成本**：只需实现一个 ConversationNodeDefinition · 不改 session 也不改 agent-loop · 注册后自动参与事件路由
- **match 决定归属**：同一事件可以属于某个已有节点 · 也可以开启一个新节点 · 还要说明这条事件在节点里的角色
- **state 由增量累积**：start 建立初始 state · update 用后续事件推进它 · 流式分片因此能逐步显示

### 一个真实例子：`deliverablesDefinition`

`CL/ui-deliverables/src/client/turn-deliverables.ts:173`。注释说明它的特殊性：

> Turn-local successful mutation accumulator; **it publishes no view Node**.

```ts
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'deliverables/presented') return isPresentedData(event.data) ? { id: String(event.data.turn), role: 'update' } : null
    if (event.type === 'workspace/changes') return isChangesEvent(event.data) ? { id: String(event.data.turn), role: 'update' } : null
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => { /* 用 turn/start 建初始 state */ },
  update: (context, match) => { /* 累积 tool/call、tool/result 与 deliverables/workspace 事件 */ },
}
```

💡 **`match` 返回 `{ id, role }`**：
- `id` = 节点标识（这里用 `turn` 号 → **一个 turn 一个节点**）
- `role` = `'start'`（创建）或 `'update'`（更新）
- 返回 `null` = 不关心这个事件

💡 **`isAppendSurfaceEvent(event)` 的使用**：只处理 `surfaceOp: 'append'` 的 `tool/result`，**跳过压缩产生的 `replace` 节点**（[06 § 6.15](06-agent-loop-and-session-log.md)）。前端与后端共享同一套表面语义。

💡 **"publishes no view Node"** —— 这个定义只做**状态累积**（收集本 turn 产出了哪些文件），不渲染自己。累积结果被别的 UI 组件消费。**投影机制与渲染解耦。**

## 9.4 61 个 `ui-*` 包（按 src 行数）

| 包 | src 行数 | 说明 |
|---|---|---|
| **`ui-conversation`** | **17721** | **对话主体**（含 § 9.3 的 contract 层） |
| **`ui-chat`** | **16780** | **聊天视图**（conversation-nodes 投影都在这里） |
| **`ui-primitives`** | **14022** | 基础组件库 |
| **`ui-trajectory`** | **10955** | **轨迹视图**（agent 行为可视化） |
| `ui-schedule` | 7864 | 定时任务视图 |
| **`ui-plugin-manager`** | **7570** | 插件管理（新） |
| `ui-workspace` | 6851 | 工作区 |
| `ui-settings-models` | 6436 | 模型设置 |
| `ui-sidebar-documentpreview` | 6285 | 文档预览侧栏 |
| `ui-tool` | 5196 | 工具调用展示 |
| `ui-sidebar-right` | 4694 | 右侧栏 |
| `ui-dockkit` | 4613 | 停靠布局（新） |

其余 49 个：`ui-sidebar-files`、`ui-settings-account`、`ui-renderer`、`ui-deliverables`（2641）、`ui-user-questions`、`ui-agent-preset`、`ui-slots`、`ui-plugin-market`、`ui-theme`、`ui-subagent`、`ui-settings-general`、`ui-commands`、`ui-model-selection`、`ui-approval`、`ui-session`、`ui-secret-mask`、`ui-brand-official`、`ui-account-notifications`、`ui-file-actions`、`ui-agent-team`、`ui-open-in-app` 等。

💡 **rc.3 新增了一整批"平台 UI"**：`ui-plugin-manager`（7570）、`ui-plugin-market`、`ui-approval`、`ui-session`、`ui-renderer`、`ui-agent-team`、`ui-secret-mask`、`ui-dockkit`、`ui-account-notifications`……插件管理、市场、审批、账号通知都进了 UI 层。

💡 **`ui-trajectory`（10955 行）值得注意**：它是"agent 做了什么"的可视化。这类视图对调试 agent 行为很关键——比读日志直观。

💡 **`ui-slots` 是前端的扩展点机制**：其它 `ui-*` 包往命名插槽里塞组件，而不是硬编码组合。这与 cordis 的服务注册是同一思路。

💡 **`ui-primitives`（14022 行）是自建组件库**，不依赖第三方 UI 框架（否则不需要这么多行）。

## 9.5 前端也是 cordis 插件树

`packages/extensions/cordis-client-runner`（9245 行 src，[04 § 4.4](04-extensions-and-ecosystem.md)）。

![浏览器里也跑一棵 cordis 树](diagrams/09-client-runner.svg)

**浏览器里也跑一棵 cordis 树** — [交互版](diagrams/09-client-runner.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-client-runner.architecture.json)

- **两个 runner 的差异来源**：host 版可以直接用 node 的模块系统 · client 版必须自己解析与加载模块 · 这部分逻辑就是多出的近 6000 行
- **前端也获得可组合性**：界面组件以插件形式注册 · 不同 profile 可以给出不同界面 · 与后端能力组合方式一致
- **代价是启动更慢**：浏览器侧要先建立插件树 · 首屏需要等树就绪 · web-app bundle 因此关掉了 hmr

## 9.6 host 与 client 的分离

![Host 与 Client 的分离](diagrams/09-host-client-split.svg)

**Host 与 Client 的分离** — [交互版](diagrams/09-host-client-split.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-host-client-split.architecture.json)

- **Host 侧各司其职**：webserver 只负责监听与路由挂载 · api 控制器族处理 API 请求与鉴权（§ 9.11） · frontend-static 只服务静态文件
- **Client 侧是完整的插件树**：不只是一个 React 应用 · ui 包以 cordis 插件形式注册 · 于是界面能力也可按 profile 组合
- **分离带来的好处**：headless bundle 直接不起 server · CLI 与 Web 共用同一套后端能力 · 前端可以独立部署

💡 **`web-app` bundle 的 patch 有 620 行**（[05 § 5.3](05-startup-and-cordis-runtime.md)），大部分是配置这些前端相关的行。

## 9.7 前端相关的工程约束

`scripts/` 里有专门的前端校验（[02 § 2.8](02-codebase-map.md)）：

| 脚本 | 作用 |
|---|---|
| `client-bundle-css.spec.ts` | CSS 打包校验 |
| **`client-bundle-purity.spec.ts`** | **打包纯净性**（大概检查前端 bundle 里没混入 Node 代码） |
| `client-tsconfig.spec.ts` | tsconfig 一致性 |
| `gen-client-catalog.ts`（+ `.spec.ts`） | 生成前端目录 |
| `dev-web.ts`（+ `.spec.ts`） | 开发服务器 |

💡 **`client-bundle-purity.spec.ts` 是个好实践**：在 384 包的 monorepo 里，很容易不小心让前端 import 到 Node-only 的包。用测试锁住。

## 9.8 `docs/web-styling.md`

上游有专门的样式文档（`docs/web-styling.md` + `.zh.md` + `.i18n.yaml`）。

💡 **61 个 `ui-*` 包要保持视觉一致**，靠 `ui-primitives`（14022 行）+ `ui-theme` + 一份样式规范文档。

---

> 📎 **以下承接原「19 Host 与 API 网关」。**
> 本篇讲 host 侧的对外接口层：`webserver`（862 行）为什么仍然只做传输层、被删掉的 `apiproxy`（8571 行）换成了 `packages/api` 的 9 个控制器包、以及 `api/gateway` 与 TypeRT 的关系。
> 路径缩写：`P/` = `packages/`。行号对应快照 `38a6a5c9`。

## 9.9 host 组的 9 个包

| 包 | 行数（src） | 职责 |
|---|---|---|
| **`open-in-app`** | **1668** | 在外部应用中打开（新） |
| **`webserver`** | **862** | HTTP / HTTPS 路由注册与监听 |
| `directory-picker-native` | 781 | 目录选择（原生） |
| `directory-picker-browse` | 324 | 目录选择（浏览式） |
| `directory-picker-auto` | 217 | 自动择一 |
| `directory-picker` | 154 | 目录选择 Definition |
| `frontend-static` | 167 | 静态资源服务 |
| `plugin-inventory` | 198 | 插件清单 |
| `product-telemetry-otel` | 121 | 产品遥测（OTel，新） |

💡 **`apiproxy`（8571 行）已被整个删除**——旧版"它是 webserver 的 26 倍"的论证随之失效。API 面的复杂度没有消失，而是按资源分域搬进了 `packages/api/` 的 9 个控制器包（§ 9.11）。

### 9.9a 第四个宿主面：`apps/desktop` 与 `apps/desktop-host`

rc.3 的宿主面从 "Web + CLI" 扩为 **"Web + CLI + Desktop"**：

| 应用 | 角色 |
|---|---|
| **`apps/desktop`** | Electron 桌面壳（`@deepseek-ai/dsh-desktop`，private）——"Electron desktop shell for a bundled dsh runtime and external plugins"；electron-builder 打包（mac-arm64/mac-x64/win-x64 目标）、electron-updater 自动更新、windows-signing/、发布走 `desktop-publish.yml` + `desktop-rollout.yml` |
| **`apps/desktop-host`** | `@deepseek-ai/dsh-desktop-host`——"Private Node-mode host process for the Electron desktop application"，Node 侧宿主进程（koffi 原生调用），是 `directory-picker-native` 的宿主 |

💡 **两个 app 合计约 12036 行 `.ts`/`.tsx`**（src、不含测试；apps/desktop 11524 + apps/desktop-host 512）。`directory-picker` 四包 seam（§ 9.13）里"桌面 Electron / 原生壳"那条路径，在 rc.3 有了真正的宿主。

💡 **这解释了 host 组为什么新增 `open-in-app`（1668 行）**：桌面端与浏览器对"把文件/URL 交给系统应用打开"的需求不同，这条 seam 在桌面宿主下才成立。

## 9.10 为什么 `webserver` 只有 862 行

![webserver 为什么这么小](diagrams/09-webserver-minimal.svg)

**webserver 为什么这么小** — [交互版](diagrams/09-webserver-minimal.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-webserver-minimal.architecture.json)

- **职责仍然单一**：`src/index.ts:2` 自述 "node:http route registration — node:https" · 路由处理器保留响应的直接所有权 · 业务判断都不在这里
- **路由交给别人**：api 控制器族处理 API 请求与鉴权（§ 9.11） · frontend-static 处理静态资源 · gateway 按类型注册表生成端点
- **行数从 325 涨到 862**：新增的是 TLS/HTTPS 监听、证书链重读与响应压缩配置 · 仍然没有业务逻辑

⚠️ **默认绑定 `127.0.0.1`**（`README.md:27`：`http://127.0.0.1:3080`）——只监听本机回环，不暴露到网络。这是安全默认值。如果改成 `0.0.0.0` 对外提供，**必须自己加鉴权**——DSH 的 Web UI 默认没有登录机制（它假设是单用户本地工具）。

## 9.11 `apiproxy` 的遗产：`packages/api` 控制器族

rc.3 把 8571 行的 `apiproxy` 删除，API 面按**资源域**拆成 9 个控制器包：

| 包 | 行数（src） | 分域 |
|---|---|---|
| **`api/session-controller`** | **9413** | 会话（含事件流转发） |
| **`api/gateway`** | **5691** | TypeRT 端点生成（§ 9.12） |
| `api/terminal-controller` | 2857 | 终端 |
| `api/workspace-controller` | 1960 | 工作区 |
| `api/workspace-files` | 1624 | 工作区文件 |
| `api/remote-access` | 1073 | 远端访问（dsh-base patch `:57` 挂载） |
| `api/job-controller` | 994 | 后台任务 |
| `api/settings-controller` | 461 | 设置 |
| `api/remotes` | 469 | 远端连接 |

💡 **"按资源分域"比"一个 8571 行的代理"更符合 everything-is-a-plugin**：每个控制器是一个独立插件，可以按 profile 组合；`remote-access` 甚至进了 `dsh-base` patch（`:57`），说明鉴权/远端面被当成了基础能力。

💡 **`seq` 是断点续传的关键**：session 事件的 `seq` 就是日志数组下标（[06 § 6.14](06-agent-loop-and-session-log.md) ⑥）。客户端重连时报"我看到 seq N"，服务端从 N+1 继续推。**这是 append-only 设计的又一处红利。**

## 9.12 `api/gateway` 与 TypeRT

`packages/api/`（src 合计约 24542 行）：`gateway`（5691）+ 8 个控制器/连接包（§ 9.11）。

💡 **`dsh-base` patch 里这一行**（[05 § 5.11](05-startup-and-cordis-runtime.md)，base patch `:52`）：

```yaml
- id: typert-gateway
  name: '@deepseek-ai/dsh-api-gateway'
```

**id 叫 `typert-gateway` 但包名是 `dsh-api-gateway`** —— 说明网关的接口是**由 TypeRT 的类型注册表驱动的**（[09 篇](09-host-runtime-and-storage.md)）。

![TypeRT 到 API 端点的三行相邻](diagrams/09-typert-gateway.svg)

**TypeRT 到 API 端点的三行相邻** — [交互版](diagrams/09-typert-gateway.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-typert-gateway.architecture.json)

- **三行相邻不是偶然**：dsh-base patch 里 typert（`:46`）、typert-loader（`:49`）、typert-gateway（`:52`）相邻 · 前者提供类型信息，后者消费它 · 顺序即依赖顺序
- **端点是生成的**：不手写路由表 · 服务方法上标注装饰器即可暴露 · 于是新增远端方法不必改 gateway
- **包 id 与包名不一致**：配置里的 id 是 typert-gateway · 实际包名是 api/gateway · 按 id 覆盖时要用配置里的 id

## 9.13 `directory-picker`：四包 seam

| 包 | 行数（src） | 角色 |
|---|---|---|
| `directory-picker` | 154 | Definition |
| `directory-picker-native` | 781 | Provider（**原生对话框**） |
| `directory-picker-browse` | 324 | Provider（**浏览式**，Web 里手动导航） |
| `directory-picker-auto` | 217 | Provider（**自动择一**） |

前端对偶：`client/ui-directory-picker-native`（121 行）与 `ui-directory-picker-browse`（1300 行）。

💡 **"选一个目录"这种小事也做成 seam**，因为环境差异大：
- 桌面 Electron / 原生壳 → 系统文件对话框（`native`，781 行，宿主是 `apps/desktop-host`，§ 9.9a）
- 纯浏览器 → 只能列目录让用户点（`browse`，324 行）
- `auto` → 探测环境后择一（217 行）

💡 **`native` 比 `browse` 大 2.4 倍**：调用系统对话框要处理多平台差异（macOS/Windows/Linux 的不同机制）。

## 9.14 `frontend-static`（167 行）

💡 **只有 167 行**——服务 `apps/web` 构建出的静态文件。之所以要单独一个包（而不是直接在 webserver 里）：**它是一个可选的 cordis 插件**。headless 模式不加载它，就不服务前端资源。

## 9.15 `plugin-inventory`（198 行）

配合 `client/ui-settings-plugin-inventory`、`ui-plugin-manager`/`ui-plugin-market` 与 `dsh plugin` 命令（[04 § 4.5](04-extensions-and-ecosystem.md)）。

💡 **198 行**说明它只做"列出可用/已装插件"，安装靠 pnpm（profile 目录本身是 workspace）。

## 9.16 对外通道的对照

| 通道 | 实现 | 面向 | 特点 |
|---|---|---|---|
| **Web UI** | `webserver` + `api` 控制器族 + `frontend-static` + `api/gateway` | **人** | 默认 `127.0.0.1:3080`，无鉴权 |
| **Desktop** | `apps/desktop` + `apps/desktop-host`（§ 9.9a） | **人** | Electron 壳，捆绑 dsh 运行时 |
| **ACP** | `acp`（1781 行）+ `acp-app` bundle profile | **自动化** | "automation-only"，权限是机器策略通道（[04 § 4.13](04-extensions-and-ecosystem.md)） |
| **DSH SDK** | `sdk/{client,protocol,server}`（1425/571/1049 行） | **DSH↔DSH / 多语言** | 含 Python SDK（[04 篇](04-extensions-and-ecosystem.md)） |

💡 **四者都可以驱动同一个 agent**，因为它们都最终调 `ctx.agents`（[06 § 6.10](06-agent-loop-and-session-log.md)）。这是"everything is a plugin"在接口层的体现——**接入方式也是插件**。

## 9.17 `settings` 组

> 📐 **配套可跑示例**：[`M11.1 · 存储域：schema 校验的结构化记录`](../../dsh-lab/examples/dsh-storage-demo/src/index.ts) 打开一个命名领域
> （`lab_m11_demo` / 表 `notes`），并用 zod 校验写入——schema 不符即报错，不会静默存脏数据。
> ⚠️ 配套工程**没有挂载 settings 服务**（`@deepseek-ai/dsh-settings` 不在 `cordis.patch.yml` 的 89 条行里），
> 所以"默认值 → `update` 合并 → 过期 `expectedRevision` 冲突 → `mutate` → `replace({})` 重置 → 重复注册抛错"
> 这条 CAS 链在本工程里**没有可跑对照**——它以本快照的源码分析为准。


`packages/settings/`：只剩 `settings` 一个包（src 704 行：index 432 / redact 116 / schema 79 / types 77）。旧的 `settings-file` 已并入。主类改名 **`SettingsForms`**（`settings/src/index.ts:223`，旧名 `Settings`），CAS 冲突类型 `SettingsConflictError`（`:45`）。

💡 **settings 与配置（cordis config）是两回事**：
- **cordis config**：启动时由 profile/bundle patch 决定，改了要重载插件
- **settings**：运行时用户可改的偏好，存在文件里

💡 **两者会交叉**：[06 § 6.11](06-agent-loop-and-session-log.md) 提到 `maxParallelToolCalls` 同时出现在插件 Config 与 Settings 里（`AL/index.ts:294-295`）——**settings 可覆盖启动配置**。前端有 `ui-settings` 系列包（`ui-settings`、`ui-settings-models`、`ui-settings-account`、`ui-settings-agent-loop`、`ui-settings-general`、`ui-settings-plugins`、`ui-settings-session-log`、`ui-settings-shell`、`ui-settings-subagent`、`ui-settings-web-search` 等）。

---

> 📎 **以下承接原「20 任务编排 Jobs / Schedule / Workflow」。**
> 本篇梳理 DSH 里**五种"多步推进"机制**：Jobs（后台任务）、Schedule（定时）、Workflow（流程）、Goal（同会话目标）、Plan/Todo（计划与清单）。它们容易混淆，但职责清晰不同。
> 路径缩写：`P/` = `packages/`。行号对应快照 `38a6a5c9`。

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

> 📐 **配套可跑示例**：[`M09.1 · 启动一个后台任务并读它的输出`](../../dsh-lab/examples/dsh-jobs-demo/src/index.ts) 启动一个 job、确认它出现在会话可见的列表里，
> 再读出它的状态与本次产出的 chunk 数——后台任务的输出有界保留（ring buffer），模型用游标读取，观察者用字节偏移读。
> ⚠️ 配套工程**没有**覆盖"JobHooks 拉模型 / `wait` 结算 / 属主栅栏 / `kill` / 没有 controller 时 start 被拒"这几条——以本快照的源码分析为准。


| 包 | 行数（src） | 角色 |
|---|---|---|
| `jobs-local` | 1049 | Provider |
| `tool-jobs` | 697 | Consumer |
| `jobs` | 726 | Definition |

💡 **`dsh-base` patch 里 jobs 那行直接用 `jobs-local`**（[05 § 5.11](05-startup-and-cordis-runtime.md)，base patch `:96`）：

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'
```

**id 是 `jobs` 但 name 是 provider 包** —— 这样上层 patch 可以按 `id: jobs` 换成别的 provider（如远端 job 队列）。

💡 **`job_*` 工具（复数）**：`docs/architecture.md` 说 "`job_*` tools collect or stop it"，说明 `tool-jobs`（697 行）注册了多个工具（列出、查询、停止）。

## 9.21 Schedule：3565 行的组

`packages/schedule/` 现在是 **2 个包**：`schedule`（3565 行 src）+ **`tool-schedule`**（489 行，新）——模型现在能直接操作定时任务。

💡 **它有组级 `AGENTS.md`**（`packages/schedule/AGENTS.md`）——全仓只有少数几个组有（`client`、`web`、`schedule`）。说明这个包的开发规则比较特殊，需要单独给 agent 说明。

💡 **3565 行的量级**对应定时任务的固有复杂度：cron 表达式解析、时区、错过的触发（misfire）处理、持久化（重启后恢复）。

## 9.22 Workflow：跑在 PTC guest realm 里

| 包 | 行数（src） | 说明 |
|---|---|---|
| **`workflow-ptc`** | **1338** | 在 PTC guest realm 里跑流程（旧 `workflow-worker-thread`） |
| `tool-workflow` | 615 | Consumer |
| `workflow` | 383 | Definition |
| `tool-ralph`（experimental） | 477 | **另一个 Consumer**（已迁至 `packages/experimental/`） |

💡 **`workflow-ptc` 的 src 是九个文件**：`guest.ts`、`guest-source.ts`、`guest-types.ts`、`host.ts`、`index.ts`、`meta.ts`、`realm.ts`、`runtime.ts`、`types.ts`——流程现在作为 **PTC guest** 在 host realm 里跑，不再是 "worker thread 通信是主要复杂度"（旧论证已失效）。与 `ptc-runtime`（[07 § 7.15](07-request-pipeline-llm-tools-and-prompts.md)）同一思路。

💡 **`tool-ralph`（477 行）**：名字来自 agent 圈里的 "Ralph Wiggum" 模式——**反复重跑同一个提示直到任务完成**（源自《辛普森一家》角色，取"傻但坚持"之意）。它仍是 `workflow` 的一个 consumer，但 rc.3 把它**降级到 `packages/experimental/`**——"暴力循环"从正式能力变成了实验能力。

## 9.23 Goal：同会话目标

> 📐 **配套可跑示例**：[`M09.2 · 目标与自动续跑`](../../dsh-lab/examples/dsh-jobs-demo/src/index.ts) 创建一个目标并读回，
> > 说明"目标通过投影单元重建，因此重启后仍在"。
> ⚠️ 配套工程**没有**覆盖"过期 `GoalRef` 的 CAS 冲突"与"状态完全折叠自日志"这两条——以本快照的源码分析为准。


| 包 | 行数（src） | 角色 |
|---|---|---|
| `goal` | 1306 | Definition（`ctx.goals`） |
| `goal-round-driver` | 484 | **推进器** |
| `tool-goal` | 482 | Consumer |
| `command-goal` | 198 | 人类命令 |

![goal-round-driver 如何推进下一轮](diagrams/09-goal-driver.svg)

**goal-round-driver 如何推进下一轮** — [交互版](diagrams/09-goal-driver.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-goal-driver.sequence.json)

- **续跑机制已重做**：driver 不再挂 `agent/turn-stopping` · 改为监听 `agent/status`（到 idle）、`goal/changed`、`agent/inbox/{inserted,claimed,discarded}` 与 `session/event` · 在 agent 空闲且无竞争提示时预约下一轮（`goal-round-driver/src/index.ts:111`、`:146`）
- **续跑的实现是"再排一条 followup"**：`drive()` 生成第 N+1 轮的 user message（source 带 `{ kind: 'goal', goalId, revision, round }`，`:190-208`）调 `agent.followup()` · 开新 turn 而不是延长旧 turn · `agent/pre-step` waterfall 里做二次校验，预约失效即 fail-closed 拒绝（`:387-452`）
- **目标态由独立服务持有**：ctx.goals 与 Agent 解耦，命令层只管写 · driver 只管读并决定是否续跑 · 换掉判定策略不影响 Agent 主循环

💡 **旧文档说 driver 是 `agent/turn-stopping` 最典型的用户——rc.3 已不成立**。`agent/turn-stopping` 事件本身还在（`AG/runtime-types.ts:418`），但 goal 续跑走的是"空闲时预约 + pre-step 校验"的新路：round 上限检查在 `:182`（`maxGoalRounds`），每轮先 `ctx.sessions.flush` 做持久化检查点（`:153`），`turn/end` 里 `max-tokens` 直接 disarm（`:349-351`）。

💡 **与 subagent 的区别**（[08 § 8.31](08-execution-services.md)）：goal 在**同一会话**里推进（历史连续），subagent 派生**新会话**（上下文隔离）。

## 9.24 Plan mode 与 Todo

| 包 | 行数（src） | 机制 |
|---|---|---|
| `plan-mode` | 538 | 拦 `agent/pre-step`，先让模型出计划 |
| `tool-todo` | 271 | 写 `todo/write` session 事件 + 注册 `todos` 投影 |

💡 **`todo/write` 不再是核心 session 事件**：核心 `SessionEventMap` 现在是 14 个事件（[06 § 6.13](06-agent-loop-and-session-log.md)），`todo/write` 的载荷类型改由 todo 包自己声明——`tool-todo/src/types.ts:30-33` 用 `declare module '@deepseek-ai/dsh-session/types'` 做声明合并（核心只在 `S/known-event-types.ts:71` 记录事件名）。它**不上表面**（不是 `SurfaceEventType`），所以：
- 不直接进模型历史
- 但持久、可回放、UI 能渲染

💡 **`tool-todo` 现在还注册一个 session 投影**：`ctx.sessionProjections.register<'todos', TodoItem[] | null>`（`tool-todo/src/index.ts:124-129`），把日志折叠成"最新一份待办清单"，下一个 `turn/start` 清回 `null`（`turn/end` 保留已完成的清单可见）。**待办清单的状态由日志投影而来**，与 `deriveMessages` 是并行的两种投影。

💡 **前端有 `ui-plan`**，但没有 `ui-todo` 独立包——todo 大概在 `ui-conversation` 里渲染。

## 9.25 `deliverables`：产出物追踪（后端化了）

rc.3 新增了 `packages/deliverables/` 组：`workspace-changes`（1294 行 src）、`tool-present`（127）、`deliverable-file-references`（30）。前端 `ui-deliverables`（2641 行 src）的 `deliverablesDefinition`（§ 9.3）仍在，但现在消费的是后端宣告的 `workspace/changes` 与 `deliverables/presented` 事件，不再纯靠前端从 `tool/call` + `tool/result` 推断。

💡 **这仍是第六种"推进感知"**，但从"纯前端投影"升级为"后端宣告 + 前端折叠"两层。**投影机制的灵活性保留**——加一种视图不需要加核心事件类型（`workspace/changes` 也是包级声明合并的扩展事件）。

## 9.26 五种机制的选择表

| 需求 | 用什么 | 为什么 |
|---|---|---|
| 跑一个长命令不阻塞对话 | **Jobs** | turn 外执行，`job_*` 工具收结果 |
| 每天早上跑一次检查 | **Schedule** | 定时触发（`tool-schedule` 让模型直接操作） |
| 固定的多步流程（步骤明确） | **Workflow** | 无需模型决策每步，跑在 PTC guest realm |
| "反复试直到成功" | **`tool-ralph`**（experimental，Workflow 的 consumer） | 受管的重试循环 |
| 让模型持续朝一个目标推进 | **Goal** | 同会话空闲时预约下一轮 turn |
| 把子任务交给独立的 agent | **Subagent** | 新会话/fork，上下文隔离 |
| 只记录进度给人看 | **Todo** | session 事件（包级声明合并），不驱动执行 |
| 先规划再执行 | **Plan mode** | 拦 `agent/pre-step` |

---

> 📎 **以下承接原「21 存储与持久化」。**
> 本篇梳理 DSH 的四条存储路径：`ctx.storage`（通用键值）、`spill`（大内容外溢）、`session-persistence`（会话日志落盘）、`session-query`（历史检索）。以及它们为什么不能合并成一个。
> 路径缩写：`P/` = `packages/`。行号对应快照 `38a6a5c9`。

## 9.27 四条路径的分工

![存储的四条路径](diagrams/09-storage-paths.svg)

**存储的四条路径** — [交互版](diagrams/09-storage-paths.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-storage-paths.architecture.json)

- **四条路径的取舍**：通用键值适合小而频繁的状态 · spill 适合大块只读内容 · session 持久化要求严格顺序与可恢复
- **spill 是最小的一组**：三个包合计只有 664 行 · 因为它只做搬运与引用，不做解释 · 策略包决定何时触发外溢
- **凭据单独隔离**：敏感级别最高，不与普通状态混放 · 便于施加额外的访问控制 · 也便于整体清除

## 9.28 `ctx.storage`：四个包

| 包 | 行数（src） | 角色 |
|---|---|---|
| **`storage-domain`** | **910** | **域隔离**（最大） |
| `storage-sqlite` | 516 | Provider |
| `storage-json` | 844 | Provider |
| `storage` | 364 | Definition |

💡 **`storage-domain`（910 行）比两个 provider 都大**。"domain" 指的应该是**命名空间隔离**：每个插件有自己的存储域，互不干扰。这类似 cordis 的 isolate realm（[cordis 04 § 4.5](../hello-cordis/04-context-and-reflect-proxy.md)），但作用于持久数据。

💡 **JSON 与 SQLite 两个 provider**：
- `storage-json`（844）：小量数据、人可读、易调试
- `storage-sqlite`（516）：大量数据、需要查询

## 9.29 `spill`：小的一组（1210 行）

| 包 | 行数（src） | 角色 |
|---|---|---|
| `spill-policy` | 346 | **策略**（何时该 spill） |
| `spill-local` | **726** | Provider |
| `spill` | 138 | Definition |

💡 **结论反转了**：provider（726）比 policy（346）大。旧版"policy 比 provider 还大"（288 vs 215）在 rc.3 不成立——spill-local 长到 726 行，"把内容挪出去"本身（远端、检索、引用管理）不再简单。

💡 **与 compaction 的分工**（[08 § 8.37](08-execution-services.md)）：
- **spill**：内容还在，只是不在上下文里（可按需取回）
- **compaction**：内容被摘要替代（原文在日志里但不再进模型）

💡 **与 `util/output-retention`（[04 § 4.9](04-extensions-and-ecosystem.md)）的关系**：后者决定"截断多少"，spill 决定"截断掉的放哪"。

## 9.30 `session-persistence`：JSONL 为主

| 包 | 行数（src） | 说明 |
|---|---|---|
| **`session-persistence-jsonl`** | **5086** | JSONL provider（**重头**） |
| `session-persistence` | 636 | Definition + 通用逻辑 |
| `session-checkpoint-policy` | 83 | 落盘时机策略 |

**`session-persistence-sqlite` 已删除**——SQLite 只保留 `node:sqlite` 的全文索引面（`session-query-sqlite`，§ 9.31）。

![JSONL 为何契合又为何有 5086 行](diagrams/09-jsonl-persistence.svg)

**JSONL 为何契合又为何有 5086 行** — [交互版](diagrams/09-jsonl-persistence.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-jsonl-persistence.architecture.json)

- **格式选择的匹配度**：append-only 语义与 JSONL 完全一致 · 不需要事务也不需要重写 · 崩溃恢复只需处理尾部一行
- **复杂度不在写，在读与运维**：长会话需要按文件轮转 · 要能快速定位某个 seq，因此需要索引 · 损坏文件要能尽量修复而不是整份作废
- **原子写是必要的**：索引与元数据不能写坏 · 用 util/atomic-write 保证替换的原子性 · 否则崩溃会留下半个索引

💡 **`session-checkpoint-policy` 只有 83 行**但很关键：决定"什么时候 flush"。压缩后是好时机（[08 § 8.39](08-execution-services.md)），turn 结束也是（goal-round-driver 每轮前也先 `ctx.sessions.flush`，§ 9.23）。

### session-projection 独立成包

会话投影从 `core/session` 里拆出来独立成包：`session/session-projection`（1031 行 src，`ctx.sessionProjections` 注册表，`session-projection/src/index.ts:32`）+ `session/session-projection-cache`（579 行）。**消费者**：`AgentRegistry` 的 turn 边界投影（`AG/index.ts:292`）、todo 的 `todos` 折叠（§ 9.24）、compaction-image-offload 的投影——"从日志折叠出派生状态"现在是公开能力，不再藏在 core 里（[06 § 6.16](06-agent-loop-and-session-log.md) 的旧叙述由这两个包承接）。

## 9.31 `session-query`：检索与导出

| 包 | 行数（src） | 角色 |
|---|---|---|
| **`session-query`** | **2241** | Definition |
| **`session-query-sqlite`** | **1781** | Provider（SQLite 全文索引） |
| **`session-log-export`** | **1918** | 导出 |
| `tool-session-query`（experimental） | 1413 | Consumer（**模型可查历史**，已迁至 `packages/experimental/`） |

💡 **`web-app` bundle 里默认关闭**（[05 § 5.3](05-startup-and-cordis-runtime.md)，web-app patch `:27`）：

```yaml
- id: session-query-sqlite
  config:
    path: ':memory:'
    openAt: never
```

patch 注释解释了三层考虑：

> Full-text session search is opt-in (the base row's `openAt: never`). This restatement keeps the Web values on one ephemeral in-memory index; a deployment enabling content search overrides `openAt` to `first-search` in a later patch layer, which **defers the `node:sqlite` import and in-memory handle to the first search so startup stays quiet**.

| 设置 | 含义 |
|---|---|
| `path: ':memory:'` | 内存索引，不落盘（临时） |
| `openAt: 'never'` | **不打开** → 全文搜索禁用 |
| `openAt: 'first-search'` | 首次搜索时才 import `node:sqlite` |

💡 **注意措辞变化**：rc.3 的注释不再说 "so Node 22 startup stays quiet"，只说 "startup stays quiet"——engines 已提到 Node **>=24.9.0**（`package.json:9`），但延迟 import 的考虑不变。

💡 **`tool-session-query`（1413 行）让模型能查自己的历史会话**——这是 agent 长期记忆的一种实现方式（检索式而非全量加载）。rc.3 把它**降级到 `packages/experimental/`**。

## 9.32 `typert`：类型运行时

`packages/typert/`（4 个包）：

| 包 | 行数（src） | 角色 |
|---|---|---|
| **`generator`** | **7598** | **代码生成器**（最大） |
| `protocol` | 1802 | 协议定义 |
| `registry` | 977 | 运行时类型注册表 |
| `loader` | 507 | 加载器 |

💡 **`dsh-base` patch 里三行相邻**（[05 § 5.11](05-startup-and-cordis-runtime.md)）：`typert`（= `dsh-typert-registry`，base patch `:46`）→ `typert-loader`（`:49`）→ `typert-gateway`（= `dsh-api-gateway`，`:52`）。

### `typert/protocol` 的关键符号

| 符号 | 行号 | 说明 |
|---|---|---|
| `isTypertRemoteSegment()` | 31 | 路径段判定 |
| `TypertGatewayBindingOptions` | 111 | 网关绑定选项 |
| `TypertGatewayBinding<Service>` | 117 | 网关绑定 |
| `RemoteInvocationMarker` | 124 | 远端调用标记 |
| `RemoteMethodMarker` | 129 | 远端方法标记 |
| **`bindTypertRemote<Service>()`** | **236** | 绑定远端服务 |
| **`abstract class TypertRemoteService<T> extends Service<T>`** | **250** | **远端服务基类** |
| **`Remote()` 装饰器** | **282 / 291 / 297** | **标记远端方法（3 个重载）** |
| `RemoteScope()` 装饰器 | 369 | 按上下文键暴露（新） |

![@Remote 装饰器的三段链路](diagrams/09-remote-decorator.svg)

**@Remote 装饰器的三段链路** — [交互版](diagrams/09-remote-decorator.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-remote-decorator.architecture.json)

- **一次声明，两处消费**：同一份类型信息既生成端点也生成客户端 · 于是前后端类型天然一致 · 不需要手工同步接口定义
- **generator 是最大的一块**：7598 行，负责产出存根与 .d.ts · 要处理泛型、联合类型与可选参数 · 因此体量远超 registry 与 gateway
- **装饰器有三个重载**：可以只标记，也可以指定端点名或流/资源选项 · 端点名用于控制生成的客户端方法名 · 默认取方法自身名字

💡 **`@Remote` 有三个重载签名**（`:282`、`:291`、`:297`）——支持不带参数（仅标记）、带端点名、带 `RemoteMethodOptions` 三种形式，与 cordis 的 `@Inject()`（[cordis 05 § 5.3](../hello-cordis/05-service-registration-and-dependency-resolution.md)）是同一风格。另新增 `RemoteScope(key, name?)`（`:369`）按 `TypertContextMap` 的键分域暴露。

## 9.33 `schemastery`：配置 schema

`vendor/schemastery`（3.19.0，[05 § 5.13](05-startup-and-cordis-runtime.md)）。

💡 **DSH 的插件 Config 都用 schemastery**（`z.object({...})`，如 [07 § 7.20](07-request-pipeline-llm-tools-and-prompts.md) 的 `SystemPrompt.Config`）。它实现了 Standard Schema 接口，所以 cordis 的 `resolveConfig`（[cordis 03 § 3.6](../hello-cordis/03-fiber-model.md)）能直接用。

💡 **从 schema 生成表单**的能力现在在 `ui-settings/src/client/config-form.ts`（`client-schema-form` 已删除，[09 § 9.2](09-host-runtime-and-storage.md)）——**同一份 schema 多用**：运行时校验、类型推导、UI 生成。

## 9.34 存储位置：Harness home

| 相关符号 | 位置 |
|---|---|
| `dshHomePath` | `boot()` 里 `ctx.provide('dshHomePath', dshHomePath)`（`AB/index.ts:1243`） |
| `PROFILES_DIR = 'profiles'` | `AB/profile.ts:39` |
| `util/home-paths` | `@deepseek-ai/dsh-home-paths`（路径解析包） |
| `XDG_*` 环境变量 | `BOOTSTRAP_PREFIXES` 之一（`AB/index.ts:158`，[05 § 5.8](05-startup-and-cordis-runtime.md)） |

💡 **`XDG_*` 被列为 bootstrap-only**说明 DSH 遵循 XDG Base Directory 规范来定位 home 目录。

## 9.35 `docs/persistence-catalog.md`

上游有专门的持久化目录文档（脚本生成）。

💡 **本篇给的是"为什么这样分"，官方文档给的是"具体存了什么"**。要查某个数据存在哪，读官方目录。另有 `docs/experimental-persistence-catalog.md` 记录实验性持久化面。

---

> 📎 **以下承接原「22 类型系统 TypeRT 与 Schema」。**
> 本篇讲 DSH 的两套类型基础设施：**TypeRT**（运行时类型注册表 + 类型安全 RPC + 代码生成，10884 行 src）与 **schemastery**（配置 schema，一份多用）。
> 路径缩写：`P/` = `packages/`，`TP/` = `packages/typert/protocol/src/`。行号对应快照 `38a6a5c9`。

## 9.36 TypeRT 的四个包

| 包 | 行数（src） | 角色 |
|---|---|---|
| **`generator`** | **7598** | 代码生成器（占 70%） |
| `protocol` | 1802 | 协议与装饰器定义 |
| `registry` | 977 | 运行时类型注册表 |
| `loader` | 507 | 加载器 |

💡 **generator 占 70%** 说明 TypeRT 的重心是**编译期产出**，运行时只留一个轻量注册表。

💡 **`dsh-base` patch 里三行相邻**（[05 § 5.11](05-startup-and-cordis-runtime.md)）：

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
| `isTypertRemoteSegment()` | 31 | 路径段判定 |
| `TypertGatewayBindingOptions` | 111 | 网关绑定选项 |
| `TypertGatewayBinding<Service>` | 117 | 网关绑定 |
| `RemoteInvocationMarker` | 124 | 远端调用标记 |
| `RemoteMethodMarker` | 129 | 远端方法标记 |
| **`bindTypertRemote<Service>()`** | **236** | 绑定远端服务 |
| **`abstract class TypertRemoteService<T> extends Service<T>`** | **250** | **远端服务基类** |
| **`Remote()` 装饰器**（3 个重载） | **282 / 291 / 297** | 标记远端方法 |
| `RemoteScope()` 装饰器 | 369 | 按上下文键分域暴露 |

![TypeRT 的完整生成管线](diagrams/09-typert-pipeline.svg)

**TypeRT 的完整生成管线** — [交互版](diagrams/09-typert-pipeline.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-typert-pipeline.architecture.json)

- **五个包构成闭环**：protocol 提供装饰器与基类 · registry 在运行时收集 · gateway 与 generator 分别面向服务端与客户端，remotes 负责实际连接
- **类型安全跨进程**：客户端存根的类型来自服务端定义 · 改服务端签名会让客户端编译失败 · 避免运行期才发现协议不一致
- **配置里三行相邻**：typert、typert-loader、typert-gateway · dsh-base patch 中顺序固定 · 这是依赖顺序的直接体现

💡 **`TypertRemoteService<out T = never> extends Service<T>`（`:250`）** —— 它是 **cordis `Service` 的子类**。所以"可远端调用的服务"仍然是普通的 cordis 服务，只是多了远端能力。**又一处"everything is a plugin"。**（`TypertLookupFailure` 在 rc.3 的 protocol 导出面已不存在。）

## 9.38 schemastery：一份 schema 多用

`vendor/schemastery`（3.19.0，[05 § 5.13](05-startup-and-cordis-runtime.md)）。

![一份 schema 的三种用途](diagrams/09-schema-three-uses.svg)

**一份 schema 的多种用途** — [交互版](diagrams/09-schema-three-uses.html)（明暗主题 / 缩放 / 关系追踪 / 导出） · [IR 源](diagrams/09-schema-three-uses.architecture.json)

- **为什么用 schemastery**：它同时提供运行时校验与类型推导 · cordis 的配置校验原生支持它 · 默认值也由 schema 声明
- **默认值的坑**：某些字段需要区分未设置与空值 · 例如 toolOrder 的空数组缺少 rest 锚点 · 因此默认值要显式写成未定义态
- **界面自动生成的边界**：简单标量与数组可以直接渲染 · 复杂联合类型仍需手写控件 · 这时用 schema 只做校验

## 9.39 工具 schema 的表示形态

`ctx.tools` 里工具 schema 的生成文件现在都在 `T/`（[07 § 7.9](07-request-pipeline-llm-tools-and-prompts.md)）：

| 形态 | 产生者 | 用途 |
|---|---|---|
| **JSON Schema** | `T/json-schema.ts`（656 行） | 发给模型的 tool 定义 |
| **共享 schema 类型** | `T/schema.ts`（646 行） | 工具 schema 的公共类型与校验 |
| **呈现配置** | `T/presentation.ts`（389 行） | native vs PTC 的展示选择 |
| **Python 类型** | `P/core/tool-executor-ptc/src/py-types.ts`（817 行） | PTC 模式里模型写 Python |

💡 **`ts-types.ts`（旧 293 行）已删除，`py-types.ts` 迁到了 `tool-executor-ptc`**——TypeScript 侧类型生成不再是独立文件，Python 类型生成则跟着 PTC 执行器走（[07 § 7.15](07-request-pipeline-llm-tools-and-prompts.md)）。

💡 **这解释了 `python/sdk` 的存在**（[04 篇](04-extensions-and-ecosystem.md)）——PTC 模式里模型能写 Python，就需要 Python 侧的运行时。

## 9.40 代码生成脚本一览

`scripts/` 里与类型/生成相关的（[02 § 2.8](02-codebase-map.md)）：

| 脚本 | 产出 |
|---|---|
| `gen-cordis-api.ts` | `docs/cordis-api/`（6 篇英文 md + 中文对照） |
| `gen-cordis-catalog.ts` | cordis 插件目录 |
| `gen-cordis-inspect-catalog.ts` | 检视目录 |
| `gen-config-catalog.ts` | `docs/config-catalog.md` |
| `gen-client-catalog.ts` | 前端目录 |
| `gen-session-format-catalog.ts` | `session/session-format-catalog/src/generated.ts`（新，会话格式迁移目录） |
| `verify-*` 对应版本 | **CI 里校验产物是最新的**（`--check` 模式） |

💡 **每个 `gen-*` 都有对应的 `verify-*`（或 `--check` 参数）**。根 `package.json` 的 `hygiene` 脚本（`tsx scripts/run-gates.ts hygiene`，`package.json:204`）串起来跑（[02 § 2.8](02-codebase-map.md)）。**生成物进版本库 + CI 校验一致性**是这类工具链的标准做法。

## 9.41 `*.generated.ts` 文件

已知例子：`P/llm/llm-pi-ai/src/provider-data.generated.ts`、`P/util/official-bundles/src/catalog.generated.ts`。（旧例子 `P/core/scope/src/scoped-events.generated.ts` 已删除。）

💡 **改 `.generated.ts` 会被覆盖**——要改生成器。`scripts/check-expected-filenames.sh` + `.github/workflows/expected-filenames.yml` 大概就在校验这类文件名约定。

## 9.42 品牌类型（nominal typing）

DSH 大量使用"品牌化类型"来防止类型混用：

| 类型 | 位置 | 形式 |
|---|---|---|
| `Scoped<T>` | `SC/index.ts:27` | `object & { readonly [ScopedBrand]: T }` |
| `ToolExecutionToken` | `T/contracts.ts:168` | `symbol & { readonly [brand]: true }` |
| `SessionId` | `S/types.ts:21` | `Branded<'SessionId'>` 品牌化 string |
| `ToolCallId` | `P/core/session`（types 导入） | 品牌化 string |
| — | `P/llm/llm/src/brand.ts`（76 行） | 品牌工具 |
| — | `P/util/brand` | 品牌工具包 |

💡 **两个独立的 brand 工具包**（`llm/src/brand.ts` 与 `util/brand`）说明这个模式用得很广。品牌类型让 `SessionId` 与普通 `string` 在编译期不可互换——**避免"把 callId 当 sessionId 传"这类错误**。

💡 **`ToolExecutionToken` 用 `symbol` 而非 `string` 品牌**（`T/contracts.ts:168`）：symbol 无法伪造（不能从字符串构造），适合做能力令牌。

## 9.43 类型检查工具链

| 工具 | 配置 | 作用 |
|---|---|---|
| TypeScript | 6 份 tsconfig（[02 § 2.9](02-codebase-map.md)） | host / client 分离（新增 `tsconfig.node.base.json`） |
| **oxlint** | `.oxlintrc.json` + `.oxlintrc.staged.json` | Rust 写的 linter |
| jscpd | `.jscpd.json` | 重复代码 |
| **doc-typecheck** | `scripts/doc-typecheck.ts` | **文档里的代码块必须能编译** |
| publint | — | 包导出正确性 |
| `verify-node-next-types` | `scripts/verify-node-next-types.ts` | Node 的 `NodeNext` 模块类型 |

💡 **knip 已退出**：根目录没有 `knip.json`，`hygiene` 门禁串里也不再有 knip。

💡 **`verify-node-next-types`** 针对 ESM + `NodeNext` 的 `.ts` 扩展名 import 问题（DSH 的 import 都写 `./x.ts`，见 vendor cordis 的 import 风格，[05 § 5.15](05-startup-and-cordis-runtime.md)）。

💡 **`doc-typecheck` + `doc-budgets.manifest.json`** 是很少见的实践：文档里的代码块**必须能编译**，且文档有**长度预算**。`docs/` 下 709 篇 md（含 352 篇中文对照，共 167089 行）靠工程手段维持质量（[02 § 2.8](02-codebase-map.md)）。

---

**上一篇** ← [08 执行侧服务：文件、Shell、沙箱、子代理、压缩](08-execution-services.md) ｜ **下一篇** → [10 测试与工程实践](10-testing-and-engineering.md)：测试占 51%、逐文件 100% 覆盖率门禁、多轨 CI。
