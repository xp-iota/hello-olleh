---
title: "设置与配置：settings.json、配置目录与环境变量"
---
# 设置与配置：settings.json、配置目录与环境变量

> 基于 `sources/pi/` 快照（pi v1.1.0）：`src/core/settings-manager.ts`、`src/config.ts`、`src/migrations.ts`、`docs/settings.md` 校对。

**目录**

- [1. SettingsManager：两层合并](#1-settingsmanager两层合并)
- [2. 配置目录全景](#2-配置目录全景)
- [3. project trust 门控](#3-project-trust-门控)
- [4. 环境变量](#4-环境变量)
- [5. migrations.ts](#5-migrationsts)
- [6. models.json 与工具 allow/deny](#6-modelsjson-与工具-allowdeny)

---

## 1. SettingsManager：两层合并

设置分两层：全局 `~/.pi/agent/settings.json` 与项目 `<cwd>/.pi/settings.json`。`SettingsManager`（`src/core/settings-manager.ts`）在 `create()` 时分别读取两份文件（:323-324 的路径拼接），合并规则是：嵌套对象**递归深合并**、项目层优先（`deepMergeObjects` + `defaultTools` 特殊处理，:272-276）；任一层 JSON 解析失败都单独记账（`globalSettingsLoadError` / `projectSettingsLoadError`）并回退默认值，不让坏文件挡启动。运行时变更走 scope 化的 setter（`"global" | "project"`，:355），设置文件由 pi 自己写回。全部可配置项的类型与默认值见 `docs/settings.md`；项目层能覆盖哪些（如 `defaultTools`、`extensions`、资源 overrides）与不能覆盖哪些，同样由 schema 文档约定。

## 2. 配置目录全景

`~/.pi/agent/`（`src/config.ts` 的 `getAgentDir()`，:605）是唯一的用户配置根，可用 `PI_CODING_AGENT_DIR` 整体重定向。目录成员各有专门 getter（:613-650 一带）：

| 路径 | 内容 |
| --- | --- |
| `settings.json` | 全局设置 |
| `auth.json` | 登录凭据（OAuth token / API key） |
| `models.json` | 自定义模型/端点覆盖（见 §6） |
| `prompts/` | prompt 模板（`/name` 命令） |
| `sessions/` | JSONL 会话文件 |
| `themes/` | 用户主题 JSON（文件 watch 热重载） |
| `bin/` | 托管的 `fd` / `rg` 二进制 |
| `extensions/`、`skills/`、`npm/` | 用户级扩展、skill 与 Pi package 安装（见 [14-plugin-system.md](./14-plugin-system.md)） |

项目侧 `.pi/` 镜像其中一部分（`settings.json`、`extensions/`、`skills/`、`prompts/`、`themes/`）。注意 `src/config.ts` 承担的是**安装检测与路径布局**（npm/pnpm/yarn/bun/binary 五种安装形态、self-update 命令构造），不负责设置内容本身——后者全在 SettingsManager。AGENTS.md 规定所有资产解析必须经 config.ts 的 helper，禁止裸用 `__dirname`，因为同一份代码要同时跑在 source checkout、npm install 与 Bun 单文件二进制三种形态下。

## 3. project trust 门控

项目层资源（`.pi/` 与祖先 `.agents/skills/`）默认**不可信**：`src/core/trust-manager.ts` 在 agent dir 里维护 trust 库，未经用户确认的项目不加载其 settings、扩展与 skill。trust 决定在 CLI 启动时解析并传入 `SettingsManager.create(cwd, agentDir, { projectTrusted })`——`isProjectTrusted()` 直接决定 `package-manager.ts` 里项目资源分支是否执行（skill 发现一节已见 `projectTrusted ? ... : []`）。交互模式用 `/trust` 切换；这是"模型输出不可信 + 项目文件可执行代码"威胁模型的闸门（`docs/security.md`）。

## 4. 环境变量

环境变量统一 `PI_` 前缀，全表在 `docs/environment-variables.md`，常用的几类：

| 变量 | 作用 |
| --- | --- |
| `PI_CODING_AGENT_DIR` | 重定向整个 agent 配置目录 |
| `PI_PROVIDER` / `PI_MODEL` / `PI_KEY` | 免登录指定 provider、模型与 API key |
| `PI_REASONING_LEVEL` | 默认 thinking 档位 |
| `PI_SESSION_ID` / `PI_SESSION_FILE` / `PI_CODING_AGENT_SESSION_DIR` | 会话定位与目录覆盖 |
| `PI_OFFLINE` | 离线模式（跳过目录刷新等网络行为） |
| `PI_PACKAGE_DIR` | 包资产目录覆盖 |
| `PI_SHARE_VIEWER_URL` | `/share` 导出的查看器地址 |

此外 pi 会给子 shell 设置进程标记（供扩展与脚本检测自己运行在 pi 内）。

## 5. migrations.ts

`src/migrations.ts` 处理配置布局的历史迁移，`runMigrations()` 在每次 CLI 启动时调用（`src/main.ts:666`）：`migrateAuthToAuthJson()`（:21）把旧位置的凭据迁进 `~/.pi/agent/auth.json`，`migrateSessionsFromAgentRoot()`（:84）把散在 agent dir 根部的旧会话归位到 `sessions/`；`showDeprecationWarnings()` 对仍在用但已过时的写法给出提示。迁移是幂等的单向搬家，不回滚。

## 6. models.json 与工具 allow/deny

`~/.pi/agent/models.json` 是自定义模型端点的覆盖面：可添加 provider 未收录的模型、覆盖 baseUrl/定价/maxTokens，或在 `virtual-models` 里定义路由模型（按请求挑物理模型，见 `docs/virtual-models.md`）；`ModelRuntime` 把它与内建目录及 pi.dev 远端目录叠加。

工具选择在两处生效，共享同一套 `+name` / `-name` 修饰语法：settings 的 `defaultTools` 若只含修饰项则是在默认集上增删（`settings-manager.ts:256` 的 `mergeDefaultTools`），否则整表替换；SDK 的 `tools` 选项同理（`src/core/sdk.ts:280-294`），另有 `excludeTools` 排除与 `+pattern`/`-pattern` 通配。默认工具集是 `read, bash, edit, write`，只读集 `read, grep, find, ls`。

## 源码锚点

- [`sources/pi/packages/coding-agent/src/core/settings-manager.ts`](../../sources/pi/packages/coding-agent/src/core/settings-manager.ts)：两层设置合并与写回
- [`sources/pi/packages/coding-agent/src/config.ts`](../../sources/pi/packages/coding-agent/src/config.ts)：配置目录布局与安装检测
- [`sources/pi/packages/coding-agent/src/migrations.ts`](../../sources/pi/packages/coding-agent/src/migrations.ts)：启动迁移
- [`sources/pi/packages/coding-agent/src/core/trust-manager.ts`](../../sources/pi/packages/coding-agent/src/core/trust-manager.ts)：project trust 库
- [`sources/pi/packages/coding-agent/docs/settings.md`](../../sources/pi/packages/coding-agent/docs/settings.md)：设置项参考
- [`sources/pi/packages/coding-agent/docs/environment-variables.md`](../../sources/pi/packages/coding-agent/docs/environment-variables.md)：环境变量全表
