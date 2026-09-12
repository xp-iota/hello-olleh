---
layout: content
title: "OpenCode 深度专题 B08：启动与配置加载，从全局目录到 .opencode 覆写"
---
# OpenCode 深度专题 B08：启动与配置加载，从全局目录到 `.opencode` 覆写

> 本文基于 `sources/opencode/packages/opencode/package.json` 中的 OpenCode `v1.4.14` 源码校对

前面的 A/B 章节大多从”请求已经进入 runtime”开始讲。但在 OpenCode 当前实现里，很多关键行为其实发生在第一条 prompt 之前：全局目录准备、日志与数据库迁移、配置叠加、`.opencode` 目录装载、依赖安装，以及 `InstanceBootstrap()` 固定服务图初始化。B08 的任务，就是把这条”启动前半场”讲清楚。

---

**目录**

- [0. 工程框架概览：代码组织与构建体系](#0-工程框架概览代码组织与构建体系)
- [1. 启动与配置不是一步，而是四段](#1-启动与配置不是一步而是四段)
- [2. import 阶段已经有显式副作用](#2-import-阶段已经有显式副作用)
- [3. `src/index.ts` 的 middleware 先准备运行环境，再谈命令分发](#3-srcindexts-的-middleware-先准备运行环境再谈命令分发)
- [4. `Config.get()` 不是读一个文件，而是编译一棵配置树](#4-configget-不是读一个文件而是编译一棵配置树)
- [5. 项目配置与 `.opencode` 目录是两条不同的发现机制](#5-项目配置与-opencode-目录是两条不同的发现机制)
- [6. `.opencode` 目录装载的不只是 JSON，还包括可执行扩展内容](#6-opencode-目录装载的不只是-json还包括可执行扩展内容)
- [7. 配置文本本身还支持二次展开](#7-配置文本本身还支持二次展开)
- [8. `Config.get()` 最后还会做一轮兼容与归一化](#8-configget-最后还会做一轮兼容与归一化)
- [9. `InstanceBootstrap()` 才是“完整项目 runtime”真正启动的地方](#9-instancebootstrap-才是完整项目-runtime真正启动的地方)
- [10. 启动与配置系统为什么是 OpenCode 骨架的一部分](#10-启动与配置系统为什么是-opencode-骨架的一部分)
- [11. 把 B08 压成一句代码级结论](#11-把-b08-压成一句代码级结论)

---

## 0. 工程框架概览：代码组织与构建体系

### 0.1 当前是 Turborepo monorepo，核心分为三个包

> Monorepo（单体仓库）
> Turborepo（Vercel 出品）是 Monorepo 工具链的一种具体实现，专门针对 Node.js/TypeScript 生态。

| 包 | 路径 | 职责 |
| --- | --- | --- |
| `packages/opencode` | `packages/opencode/src/` | 核心 runtime：server、session、llm、config、bus、storage、plugin 等 |
| `cli` | `cli/` | 命令行入口：run、tui、attach、desktop 等命令的 CLI 入口 |
| 工具包（内部） | `packages/*/` | provider、sdk 等内部共享包 |

`packages/opencode` 是核心，`cli` 依赖它。两者都走 TypeScript + Bun 构建。

### 0.2 `packages/opencode/src` 下的主目录结构

```
src/
  index.ts                 # CLI middleware 入口，Log/init/migration 注册
  global/index.ts          # XDG 目录、缓存版本、进程级全局路径计算
  config/
    config.ts              # Config.get() 主实现：多来源配置合并、plugin 加载
    paths.ts               # 项目配置发现（opencode.jsonc）和 .opencode 目录遍历
  server/
    server.ts              # Hono app：middleware 链、路由挂载
    routes/
      session.ts           # /session/:id/message 等核心 session 路由
      event.ts             # /event SSE 端点（Bus 投影）
      global.ts            # /global/event 端点（GlobalBus 投影）
  session/
    prompt.ts              # prompt() / loop()：输入编译和执行状态机
    processor.ts           # processor.process()：消费单轮 LLM 流事件
    llm.ts                 # LLM.stream() 封装、provider 调用
    system.ts              # system prompt 编译
    index.ts               # Session.updateMessage() / updatePart() 落库
    message-v2.ts          # MessageV2 durable 模型和 toModelMessages() 投影
    status.ts              # SessionStatus（busy/retry/idle）实例作用域状态
  bus/
    index.ts               # Bus（instance-scoped）和 GlobalBus（进程级）实现
  storage/
    db.ts                  # Database.use() / transaction() / effect() SQLite 封装
    storage.ts             # JSON Storage（session_diff 等派生数据）
  project/
    bootstrap.ts           # InstanceBootstrap() 固定服务装配顺序
    instance.ts            # Instance / WorkspaceContext 请求作用域绑定
  plugin/
    index.ts               # Plugin.init() 和 plugin 动态加载
  provider/
    provider.ts            # provider prompt 编译和模型调用封装
  cli/
    cmd/
      run.ts / tui/*       # CLI 命令实现（默认 $0 [project] 走 tui/thread.ts）
```

### 0.3 构建链路简述

```
opencode/package.json (dev)
  -> packages/opencode/src/index.ts       # runtime 入口
  -> cli/cmd/tui/thread.ts                 # 默认命令解析
  -> server/server.ts                     # Hono server 启动
  -> 监听 127.0.0.1:18789                 # 默认端口
```

`cli` 包和 `packages/opencode` 包各自独立 TypeScript 编译，产物用 Bun run 执行。

### 0.4 为什么这个结构值得先看

`packages/opencode/src/index.ts` 只做 middleware 注册和命令分发，不含任何 session 逻辑。真正的执行链是从 `cli/cmd/tui/thread.ts` 发请求到 `server/server.ts` 才开始的。这条冷路径（启动路径）和 `11-17` 的热路径（执行主线）在代码上完全分离，是理解 OpenCode 架构的第一步。

---

## 1. 启动与配置不是一步，而是四段

| 阶段 | 代码坐标 | 真正在做什么 |
| --- | --- | --- |
| import 阶段 | `packages/opencode/src/global/index.ts:14-40` | 准备 XDG 目录、缓存目录和 cache version。 |
| CLI middleware 阶段 | `packages/opencode/src/index.ts:67-123` | 初始化日志、设置环境变量、做首次 SQLite/JSON migration。 |
| 配置编译阶段 | `packages/opencode/src/config/config.ts:79-260`、`config/paths.ts:10-144` | 按优先级叠加 config，并装载 `.opencode` 下的 commands/agents/modes/plugins。 |
| 实例 bootstrap 阶段 | `packages/opencode/src/project/bootstrap.ts:15-30` | 固定顺序初始化 Plugin、Format、LSP、File、Watcher、VCS、Snapshot 等服务。 |

所以 OpenCode 的“启动”不能只理解成“命令行 parse 完就开始跑 agent”。它更像是一个分层装配过程。

---

## 2. import 阶段已经有显式副作用

`packages/opencode/src/global/index.ts:14-40` 在模块加载时就做了两件事：

1. 计算 `Global.Path.data/cache/config/state/log/bin`。
2. 确保这些目录存在，并校验 `cache/version`。

这说明 OpenCode 不是等命令 handler 里才懒创建工作目录，而是在进程 import 阶段就先把：

1. 配置根目录
2. 日志目录
3. 缓存目录
4. 二进制缓存目录

全部准备好。

这里还有个容易忽略的细节：cache version 不匹配时，会主动清理整份 cache 再写入新版本。这意味着升级并不只是二进制替换，缓存布局也被显式版本化了。

---

## 3. `src/index.ts` 的 middleware 先准备运行环境，再谈命令分发

`packages/opencode/src/index.ts:50-123` 当前最重要的不是命令注册，而是全局 middleware。

这一层按顺序做：

1. `Log.init(...)`
2. 写入 `AGENT=1`、`OPENCODE=1`、`OPENCODE_PID`
3. 打启动日志
4. 检查 `Global.Path.data/opencode.db`
5. 若数据库不存在，则执行一次性迁移

迁移分支在 `87-121` 很明确：

1. 用 `Database.Client().$client` 打开 SQLite
2. 调 `JsonMigration.run(...)`
3. 把历史 JSON 存储迁进 SQLite

因此，OpenCode 当前不是“命令执行时如果要用数据库再顺便初始化”，而是把数据库就绪看成 CLI 入口的公共前置条件。

---

## 4. `Config.get()` 不是读一个文件，而是编译一棵配置树

`packages/opencode/src/config/config.ts:81-88` 已经把优先级写得很直白了。当前配置加载顺序是从低到高：

1. 远端 `.well-known/opencode`
2. 全局 config
3. `OPENCODE_CONFIG`
4. 项目 `opencode.json/jsonc`
5. `.opencode` 目录配置与附属内容
6. `OPENCODE_CONFIG_CONTENT`
7. 组织级远端 account config
8. managed config dir

`79-260` 的实现说明，`Config.get()` 的本质不是“读 JSON”，而是：

1. 拉远端配置
2. 合并本地多来源配置
3. 解析配置目录里的 commands/agents/modes/plugins
4. 做一轮兼容迁移与 flag 覆写
5. 再产出最终 runtime config

换句话说，配置系统在 OpenCode 里本身就是一层编译器。

---

## 5. 项目配置与 `.opencode` 目录是两条不同的发现机制

`packages/opencode/src/config/paths.ts:10-42` 把这两种发现方式明确分开了。

### 5.1 `projectFiles(...)`

`11-20` 会沿着 `directory -> worktree` 向上找 `opencode.jsonc/json`，然后按上层到下层的顺序返回。

这意味着普通项目配置是典型的“层层覆盖”。

### 5.2 `directories(...)`

`22-42` 返回的则是：

1. `Global.Path.config`
2. 当前工程向上所有 `.opencode`
3. `$HOME` 下的 `.opencode`
4. `OPENCODE_CONFIG_DIR`

也就是说，`.opencode` 目录不是普通 config file 的附庸，而是另一条独立的“配置目录发现链”。

---

## 6. `.opencode` 目录装载的不只是 JSON，还包括可执行扩展内容

这是 B08 最关键的一点。

`packages/opencode/src/config/config.ts:143-166` 在遍历 `directories` 时，不只是 merge `opencode.jsonc/json`，还会同步装载：

1. `loadCommand(dir)`，见 `384-420`
2. `loadAgent(dir)`，见 `422-459`
3. `loadMode(dir)`，见 `461-495`
4. `loadPlugin(dir)`，见 `497-509`

这说明 `.opencode` 在 OpenCode 当前实现里不是“一个额外配置目录”，而是**本地扩展仓**。

更进一步，`273-360` 还能看到：

1. `needsInstall(dir)` 会检查目录是否可写、`node_modules` 是否存在、`@opencode-ai/plugin` 是否过期。
2. `installDependencies(dir)` 会自动写 `package.json`、补 `@opencode-ai/plugin` 依赖，并执行 `bun install`。

所以当前启动链实际上允许配置目录在初始化阶段触发依赖安装。这已经远远超出了“读配置文件”的范围。

---

## 7. 配置文本本身还支持二次展开

`packages/opencode/src/config/paths.ts:84-144` 的 `parseText()` / `substitute()` 还定义了两种内联替换：

1. `{env:VAR}`：直接读取环境变量。
2. `{file:path}`：把其他文件内容内联进当前配置文本。

这意味着 OpenCode 配置不只是静态 JSONC，还支持：

1. 依赖环境变量注入
2. 依赖外部文件拼装

因此所谓“配置文件”在当前实现里，更像是一份可展开的模板。

---

## 8. `Config.get()` 最后还会做一轮兼容与归一化

`packages/opencode/src/config/config.ts:216-259` 的后处理也很重要：

1. 把旧 `mode` 字段迁成 `agent`
2. 把旧 `tools` 配置迁成 `permission`
3. 把 `autoshare` 迁成 `share`
4. 应用 `Flag.OPENCODE_PERMISSION`
5. 应用关闭 auto compact / prune 的 flag
6. 对 plugin 做去重

其中 plugin 去重实现在 `543+`，本质上是按 plugin 名称保留高优先级来源。

这说明最终 runtime 看到的 config，并不是磁盘原样，而是经过了一轮兼容归一化的结果。

---

## 9. `InstanceBootstrap()` 才是“完整项目 runtime”真正启动的地方

当前固定启动顺序写在 `packages/opencode/src/project/bootstrap.ts:15-24`：

1. `Plugin.init()`
2. `ShareNext.init()`
3. `Format.init()`
4. `LSP.init()`
5. `File.init()`
6. `FileWatcher.init()`
7. `Vcs.init()`
8. `Snapshot.init()`

它的意义不是“把所有服务都立刻做完”，而是把当前 project/instance 作用域里的服务图挂好。

例如：

1. `Format.init()` 会基于 `Config.get()` 建 formatter 集合，并订阅 `File.Event.Edited`，见 `format/index.ts:39-115`。
2. `LSP.init()` 会先建可用 server 列表，但具体 language server 仍按文件懒启动，见 [20-lsp-integration.md](./18-lsp-integration.md)。
3. `Snapshot.init()` 只准备 snapshot state 和后台清理循环；真正 `git init`/`write-tree` 在 `track()` 时才发生，见 `snapshot/index.ts:68-175`。

所以 bootstrap 的风格是：**固定装配、延迟执行。**

### 9.1 `Plugin.init()`：完整 `Config.get()` 的真正入口

worker runtime 第一次真正触发 `Config.get()` 的地方，就是 `Plugin.init()`。它会：

1. 创建内嵌 SDK client，`fetch` 仍然指向 `Server.Default().fetch(...)`
2. 读取完整配置 `Config.get()`
3. 先加载内建插件，如 `CodexAuthPlugin`、`CopilotAuthPlugin`、`GitlabAuthPlugin`、`PoeAuthPlugin`
4. 如果配置里声明了外部插件
   - 先 `Config.waitForDependencies()`
   - 必要时给配置目录写 `package.json`
   - 执行 `bun install`
   - 再 `import(plugin)` 动态加载
5. 调用插件的 `config` hook
6. 订阅总线事件，把 bus event 交给插件的 `event` hook

因此插件初始化本身也是完整配置系统、依赖安装、动态模块加载的入口。

### 9.2 其他各步的延迟执行细节

| 步骤 | 启动时真正在做什么 | 延迟到何时 |
| --- | --- | --- |
| `Format.init()` | 读取 `Config.get().formatter`，建立 formatter 表，并订阅 `File.Event.Edited` | 真正格式化在文件编辑时按扩展名触发 |
| `LSP.init()` | 读取配置、建立可用 LSP 列表、记录禁用项和扩展名映射 | LSP 子进程按文件访问懒启动 |
| `File.init()` | 建立文件搜索缓存；git 项目下通过 `Ripgrep.files()` 扫描文件并缓存目录层级 | 文件内容读取在具体 tool call 时 |
| `FileWatcher.init()` | 加载 `@parcel/watcher` 平台绑定，订阅项目目录变化；git 项目额外订阅 `.git` | 文件变化事件触发后续处理 |
| `Vcs.init()` | 读取当前 branch，监听 `HEAD` 变化 | 分支变化时发布 `vcs.branch.updated` |
| `Snapshot.init()` | 为当前 project 维护独立 snapshot gitdir：`<Global.Path.data>/snapshot/<project.id>`，建立每小时一次 `git gc --prune=7.days` 清理循环 | 真正写快照在 `Snapshot.track()` 时 |
| `ShareNext.init()` | 订阅 `session.updated`、`message.updated`、`message.part.updated`、`session.diff` 事件 | 真正 share sync 在会话变化时触发 |

---

## 10. 启动与配置系统为什么是 OpenCode 骨架的一部分

把 B08 前面的点合起来，可以得到一个很稳定的结构：

1. import 阶段先保证目录与缓存布局
2. CLI middleware 再保证日志和数据库迁移
3. `Config.get()` 把多来源配置和扩展目录编译成 runtime config
4. `InstanceBootstrap()` 用固定顺序装配一组作用域化服务

因此 OpenCode 当前并不是：

> 先有一个 agent runtime，再去读配置和附加插件

而更接近：

> 先把目录、数据库、配置、扩展和服务图装好，agent runtime 才能成立

---

## 11. 把 B08 压成一句代码级结论

OpenCode 当前的启动/配置链可以压成四句话：

1. **启动不是一次 parse，而是 import、副作用、middleware、config 编译、instance bootstrap 的分层过程。**
2. **配置不是单文件读取，而是带优先级、多来源、可展开、可迁移的编译产物。**
3. **`.opencode` 目录不只是配置覆盖点，更是 commands/agents/plugins/custom tools 的本地扩展仓。**
4. **`InstanceBootstrap()` 通过固定服务顺序，把配置编译结果装配成真正可运行的项目 runtime。**

所以如果要一句话概括 B08：

> 在 OpenCode 里，“启动”真正启动的不是某个聊天循环，而是一整套带配置编译和作用域服务图的 runtime 装配过程。

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `Config.get()` | `config/config.ts` | 编译配置树：global → project → `.opencode` 三层叠加，并做兼容归一化 |
| `Config.compile()` | `config/config.ts:143-166` | 发现并合并 global config + project 配置，支持 template 展开 |
| `InstanceBootstrap()` | `project/bootstrap.ts` | 完整 project runtime 启动入口：注册 tools/MCP/LSP/session store |
| `src/index.ts` middleware | `cli/src/index.ts` | 启动前环境准备：PATH 注入、binary 检测、`.opencode` 装载 |
| `.opencode` 目录加载器 | `project/` | 扫描并加载 `.opencode/*.ts`（tools/commands/skills）|

---

## 代码质量评估

**优点**

- **四段启动流程有序**：import 副作用 → middleware 环境准备 → `Config.get()` 配置树编译 → `InstanceBootstrap()` runtime 装配，层次清晰，调试时可在任一阶段加断点。
- **配置支持二次展开（template 变量）**：配置文本中的变量引用在 `compile()` 阶段自动展开，避免运行时字符串拼接分散在业务代码中。
- **`.opencode` 目录装载可执行扩展**：不只是 JSON 配置，`.opencode/*.ts` 文件可以直接注册 tool/command/skill，配置与代码融为一体。

**风险与改进点**

- **import 阶段副作用不可见**：Effect service 注册在 module 加载时发生，若某个 service 初始化失败，错误可能在调用栈深处才被发现，不如显式 `bootstrap()` 调用直观。
- **`InstanceBootstrap()` 串行装配无超时**：所有服务（tools/MCP/LSP）按顺序初始化，若某个 MCP server 响应慢，整个启动流程会无限等待。
- **多 workspace 配置隔离依赖文件路径约定**：不同 workspace 的配置完全依赖目录结构区分，若用户在相同 workspace 目录打开多个 project，可能误用同一份配置。

## 横向对齐补强：OpenCode 配置参与 InstanceBootstrap

OpenCode 的配置不是静态读入，而是影响 Instance、Agent、Permission、MCP、Plugin、Provider 的启动装配。

| 配置面 | 影响 |
| --- | --- |
| agent | 权限、模型、system prompt |
| permission | tool/skill/task 可用性 |
| plugin | hook 和 custom tool |
| mcp | server 启动和工具发现 |
| provider | auth/model/compat wrapper |

横向看，OpenCode 配置与运行时依赖注入耦合更深，因此需要把启动顺序和失败边界一起看。

## 启动顺序与失败边界

```mermaid
flowchart TD
    Import[import side effects] --> Bootstrap[cli/bootstrap.ts]
    Bootstrap --> Config[Config.get / compile]
    Config --> Instance[InstanceBootstrap]
    Instance --> Services[Agent / Permission / Plugin / MCP / LSP / FileWatcher]
    Services --> Runtime[Session / Tool / Bus runtime]
```

| 阶段 | 源码锚点 | 失败边界 |
| --- | --- | --- |
| CLI bootstrap | `sources/opencode/packages/opencode/src/cli/bootstrap.ts:7` | 入口只声明 init，具体失败多在下游 service 暴露 |
| Config schema / MCP config | `sources/opencode/packages/opencode/src/config/config.ts:565`, `sources/opencode/packages/opencode/src/config/mcp.ts:57` | 配置错误应在编译/读取阶段暴露，避免进入 session 后才失败 |
| Instance dispose | `sources/opencode/packages/opencode/src/config/config.ts:723`, `sources/opencode/packages/opencode/src/config/config.ts:728` | 配置变化会触发 instance dispose / disposeAll |
| File watcher | `sources/opencode/packages/opencode/src/file/watcher.ts:155` | watcher 初始化失败会影响配置/文件变更感知 |
| MCP 工具变更 | `sources/opencode/packages/opencode/src/mcp/index.ts:116` | MCP server 状态变化通过 Bus 通知工具刷新 |

这说明 OpenCode 配置章节不能只列 schema。配置值会直接影响 Instance 级服务装配，失败也可能表现为 session tool 缺失、MCP tool 不刷新、FileWatcher 不工作或 provider auth 失败。
