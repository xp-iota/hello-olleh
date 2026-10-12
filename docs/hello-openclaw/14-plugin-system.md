---
title: "Plugin 系统：capability 所有权、加载管线与 ClawHub"
---
# Plugin 系统：capability 所有权、加载管线与 ClawHub

> 基于 sources/openclaw/（openclaw v2026.10.2，OpenClaw Foundation）源码校对。`src/plugins/` 负责发现、manifest 校验、加载与注册表装配，`src/plugin-sdk/` 是插件与核心之间的公共契约，`src/plugin-state/` 提供持久化的每插件状态。

**目录**

- [1. plugin 是所有权边界，capability 是核心契约](#1-plugin-是所有权边界capability-是核心契约)
- [2. manifest 与 SDK 入口](#2-manifest-与-sdk-入口)
- [3. 加载、热替换与源码捕获](#3-加载热替换与源码捕获)
- [4. 安装、ClawHub 与 capability consent](#4-安装clawhub-与-capability-consent)
- [5. 持久化状态：runtime store 与 plugin-state](#5-持久化状态runtime-store-与-plugin-state)
- [6. 形态诊断与插件 CLI](#6-形态诊断与插件-cli)

---

## 1. plugin 是所有权边界，capability 是核心契约

OpenClaw 的能力模型把注册点做成了**类型化 capability 注册表**（`docs/plugins/architecture.md`）：`api.registerProvider(...)`（文本推理）、`registerCliBackend`（本地 CLI 后端）、`registerEmbeddingProvider` / `registerSpeechProvider` / `registerRealtimeVoiceProvider` / `registerMediaUnderstandingProvider` / `registerImageGenerationProvider` / `registerWebFetchProvider` / `registerWebSearchProvider` / `registerChannel`（消息通道）、`registerGatewayDiscoveryService`、`registerMigrationProvider` 等十余种。所有权规则明确到近乎组织学：**plugin 是一家公司或一个特性的所有权边界**——`google` 一个插件拥有其全部 OpenClaw 面（推理、语音、媒体理解、图片生成、搜索），`voice-call` 这类 feature 插件消费共享 capability 而不是直接 import vendor 插件。区分两种 enforcement：运行时注册表校验（重复 provider id 等产生 diagnostics 而非未定义行为），以及 contract tests（`doctor-contract-registry.ts`、`bundled-manifest-contract-plugins.ts` 在测试期捕获内建插件注册，断言 ownership 不漂移）。只注册 hooks 的插件是 `hook-only` shape，仍是受支持的路径。

## 2. manifest 与 SDK 入口

每个 native plugin 有 `openclaw.plugin.json`（`src/plugins/manifest.ts` 解析）：id/name、`categories`、`providers`/`channels` 等 ownership 字段、`activation.*` 激活提示、`configSchema`、`enabledByDefault`、`skills`/`hooks` 目录。SDK 入口是 `definePluginEntry`（`src/plugin-sdk/plugin-entry.ts`），插件 default export 一个带 `register(api)` 的入口对象；`api` 是类型化的 `OpenClawPluginApi`：`api.pluginConfig` 读 `plugins.entries.<id>.config`，`api.runtime` 是 runtime helpers 命名空间，`api.registrationMode` 区分全量加载与 setup 轻量流程。SDK 以 `openclaw/plugin-sdk/<窄子路径>` 的形式发布（`docs/plugins/sdk-overview.md`），baseline 由 `src/plugin-sdk/api-baseline.ts` 生成并纳入 API diff 检查——**禁止手改生成的 baseline**（`src/plugin-sdk/AGENTS.md`）。全部 API 官方声明为 experimental，兼容窗口按 surface 逐个登记 `removeAfter` 日期。

## 3. 加载、热替换与源码捕获

native plugin **进程内加载、无沙箱**（`docs/plugins/architecture.md` 的 Warning 写明：恶意 native plugin 等价于进程内任意代码执行），安全靠 allowlist + 安装路径控制。加载层的工程复杂度集中在**源码捕获与热替换**：

- TypeScript 入口经 Jiti 编译（同步入口禁止 top-level await），插件源码被捕获到 `<stateDir>/tmp/plugin-captures/<instanceId>/captures/`，配一个 SQLite custody token（`owner.sqlite`）；按需捕获 import 的依赖文件，native addon 保留包根相对路径。捕获目录有独立的生命周期：一小时宽限后仅当清理方能取得 token 的独占租约才可回收——**文件年龄本身永远不构成删除授权**，重启后同样适用；
- 捕获代系把宿主 `openclaw` 包 link 进去，让插件派生的 worker/子进程能解析同一份 host SDK——插件与宿主共享 SDK 身份，杜绝双实例；
- **热替换**（`openclaw plugins reload <id>`）：替换前校验元数据、暂停新调用，给在途工作 60 秒 drain 预算；失败时用捕获的旧代码+旧配置自动恢复（recovery 有独立的 Gateway 拥有的取消信号，断开连接的请求者无法打断）；成功发布后发出 `plugins.changed` 事件；
- 控制面（discovery/校验/激活计划，见 [06-extension-mcp.md](./06-extension-mcp.md) §3）与运行面（`register(api)`）严格分离，`src/plugins/AGENTS.md` 把这条列为边界规则：禁止内建插件享有外部插件没有的私有后门。

## 4. 安装、ClawHub 与 capability consent

ClawHub（clawhub.ai）是插件与 skill 共用的公共注册表。`openclaw plugins search` 查询 ClawHub，安装命令支持 `clawhub:<package>`、npm、git、本地路径（`--link ./dir --force`）、npm-pack tarball 与 marketplace 源（`docs/plugins/manage-plugins.md`）。安装第三方插件前必须过 **capability consent**：列出声明的通道、provider、工具、hooks、MCP server、CLI 命令、危险配置 flag 与 operator 授权，校验包身份对 ClawHub verified record；内建插件与官方 catalog 验证过的一方插件免审。CLI 侧确认由 `src/cli/clawhub-install-confirmation.ts` 提供（TTY 下的 "Proceed with installation?"）；registry 逻辑在 `src/plugins/clawhub.ts`。启用插件把 id 写进 restrictive `plugins.allow`，显式 `plugins.deny` 始终优先；管理员 enable 动作记录显式信任。Control UI 的安装/启停/重载等动作直接作用于运行中的 Gateway（`operator.read`/`operator.admin` 两级权限）。

## 5. 持久化状态：runtime store 与 plugin-state

插件有两层持久化面：`src/plugin-sdk/runtime-store.ts` 提供进程内 registry（session store、media store、cron store、persistent-dedupe 等 keyed store 的注册表），而 `src/plugin-state/plugin-state-store.ts` 是 **SQLite 支撑的每插件持久 KV**：journal 化写入、key range 校验、保留 namespace 独立性检查、过期与 retention、doctor 导入分批，值大小受 `MAX_PLUGIN_STATE_VALUE_BYTES` 限制，另有 `plugin-blob-store.ts`（独立 worker + SQLite）承载大二进制并做 admission/eviction/readonly 控制。写路径有 admission（SQLite write admission）防写放大。状态层的存在呼应了"网关"定位：插件可以是有状态的长驻服务（聊天机器人记忆、板卡、监控），而不只是无状态工具。

多数 capability 允许多插件并存（多个 search provider 共存、按配置选择），但两个 **exclusive slot** 例外：context engine 与 memory capability 各自同一时刻只有一个活跃插件（`docs/plugins/sdk-overview.md` 的 Exclusive slots 一节），被淘汰出槽位的插件记入 disabled/failed 的既定事实，工具解析不再逐回合重载它。这也解释了为什么启停面（`enable.ts` / `default-enablement.ts`）与控制面快照如此强调"settled outcome"：slot 选择、provider ownership、channel presence 都是启动时一次性裁决，运行期只消费快照。

## 6. 形态诊断与插件 CLI

可观测性内建在注册表里：`openclaw plugins list --json` 输出每个插件的 `format`/`source`/`dependencyStatus`（声明的 dependencies 是否在磁盘上可解析）与 registry diagnostics；`openclaw plugins inspect <id> --runtime --json` 报告插件 shape、capability 分解与被回滚的失败注册——失败注册留在诊断面但不进执行 scope，也不阻塞健康插件。`openclaw doctor` / `plugins doctor` 输出兼容信号（`config valid`、`hook-only` info、deprecated memory-embedding warn、加载失败 hard error），并持有 Gateway 维护权限做安装修复。插件 CLI 走**两阶段发现**：parse-time 只读 `registerCli(..., { descriptors: [...] })` 声明的元数据，让根命令名在参数解析前被保留；真正的插件 CLI 模块保持 lazy，首次调用才注册——插件代码留在插件里，宿主不为占位加载运行时（`src/plugins/cli-registry-loader.ts`）。这一节与 [19-hooks-lifecycle.md](./19-hooks-lifecycle.md) §3 的 registration gate 合起来构成"能力可见性先于能力执行"的完整面。

## 源码锚点

- [`sources/openclaw/src/plugins/manifest.ts`](../../sources/openclaw/src/plugins/manifest.ts)：`openclaw.plugin.json` 解析与归一化
- [`sources/openclaw/src/plugins/activation-planner.ts`](../../sources/openclaw/src/plugins/activation-planner.ts)：窄化加载的激活计划
- [`sources/openclaw/src/plugin-sdk/plugin-entry.ts`](../../sources/openclaw/src/plugin-sdk/plugin-entry.ts)：`definePluginEntry` SDK 入口
- [`sources/openclaw/src/plugin-sdk/api-baseline.ts`](../../sources/openclaw/src/plugin-sdk/api-baseline.ts)：生成的 SDK API baseline
- [`sources/openclaw/src/plugins/clawhub.ts`](../../sources/openclaw/src/plugins/clawhub.ts)：ClawHub registry 客户端
- [`sources/openclaw/src/cli/clawhub-install-confirmation.ts`](../../sources/openclaw/src/cli/clawhub-install-confirmation.ts)：CLI 安装确认
- [`sources/openclaw/src/plugin-state/plugin-state-store.ts`](../../sources/openclaw/src/plugin-state/plugin-state-store.ts)：每插件 SQLite 持久状态
- [`sources/openclaw/src/plugin-sdk/runtime-store.ts`](../../sources/openclaw/src/plugin-sdk/runtime-store.ts)：runtime keyed store 注册表
- [`sources/openclaw/docs/plugins/architecture.md`](../../sources/openclaw/docs/plugins/architecture.md)：能力模型与加载管线深文档
- [`sources/openclaw/docs/plugins/manage-plugins.md`](../../sources/openclaw/docs/plugins/manage-plugins.md)：安装/启停/重载操作文档
