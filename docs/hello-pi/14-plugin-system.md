---
title: "Plugin 系统：Pi packages 与 chord facets"
---
# Plugin 系统：Pi packages 与 chord facets

> 基于 `sources/pi/` 快照（pi v1.1.0）：`src/core/package-manager.ts`、`src/core/pi-manifest.ts`、`src/package-manager-cli.ts`、`packages/chord/` 校对。

**目录**

- [1. 两个"plugin"概念](#1-两个plugin概念)
- [2. Pi packages：源、命令与 manifest](#2-pi-packages源命令与-manifest)
- [3. 安装与更新机制](#3-安装与更新机制)
- [4. chord facets：服务依赖图运行时](#4-chord-facets服务依赖图运行时)
- [5. 两者的关系与边界](#5-两者的关系与边界)

---

## 1. 两个"plugin"概念

pi 语境下的"plugin"有两层，分属不同抽象级：

| 概念 | 是什么 | 状态 |
| --- | --- | --- |
| **Pi packages** | 以 npm 或 git 源分发、经 `pi install` 管理的资源包，可携带 extensions / skills / prompts / themes | 稳定，`docs/packages.md` 正式文档 |
| **chord facets** | `@earendil-works/chord` 提供的应用组装运行时：声明式服务依赖图 + 跨进程服务 | 独立库；coding-agent 仅在 experimental 服务化重构中使用 |

前者是**资源分发机制**（把文件放进对的目录），后者是**进程组装机制**（把服务接进依赖图）。日常"写一个 pi plugin"指的是前者里的 extension（见 [12-multi-agent.md](./12-multi-agent.md) 的 subagent 示例）。

## 2. Pi packages：源、命令与 manifest

`src/package-manager-cli.ts` 提供四个子命令：`pi install <source> [-l]`（`-l` 装到项目 `.pi/`，默认装到用户 `~/.pi/agent/`）、`pi remove` / `uninstall`、`pi update`（可加 `--extensions`、`--models`、`--all`，含 pi 自身的 self-update）、`pi list`。source 是 npm 说明符（包名、版本、tarball）或 git URL。

包的入口是 `package.json` 里的 `"pi"` manifest 字段（`src/core/pi-manifest.ts` 的 `PiManifest`）：四个可选数组 `extensions` / `skills` / `prompts` / `themes`，各列相对路径；没有 `"pi"` 字段时退回常规目录约定（如 `skills/`、`prompts/`），并可用 glob 过滤。也就是说一个 Pi package 与普通 npm 包完全同构，只是多了一个资源清单字段——manifest 本身由 `readPiManifest` 解析，BOM 会被剥掉。

## 3. 安装与更新机制

安装走 npm 的常规产物：npm 源安装到 `~/.pi/agent/npm/node_modules`（用户）或 `.pi/npm/node_modules`（项目）；git 源克隆到受管根目录。要点：

- **安装锁**：`src/package-manager-cli.ts` 直接依赖 `proper-lockfile`，防止并发的 `pi install`/`pi update` 互相踩踏；
- **git 源更新**：`package-manager.ts:1925` 的 `updateGit` 对已克隆仓库执行拉取而非重装；
- 资源启用状态持久化在 settings 的 `extensions`/`skills`/`prompts`/`themes` 键里，可用 `+pattern`/`-pattern` 覆盖（同 [17-settings-config.md](./17-settings-config.md) 的 tools 修饰语法）；
- `pi update --all` 顺带跑模型目录刷新与 self-update（`config.ts` 的 `getSelfUpdateCommand` 构造各包管理器的全局更新命令）。

## 4. chord facets：服务依赖图运行时

`packages/chord` 是**独立发布的库**，"不依赖任何其他 Pi workspace package"（其 README），导出面在 `packages/chord/src/index.ts`：`defineFacet` / `createFacetHost` / `combineFacetLoaders` / `createStaticFacetLoader` / `defineService` / `replicatedState` / `createRemoteServiceBinding`。模型是典型的 facet/plugin 系统：

- **facet** 声明自己提供（provides）与需要（requires）哪些服务；`createFacetHost` 校验整张依赖图，**先激活 provider 后激活 consumer**，销毁时按激活顺序的**逆序** dispose（`facets/host.ts` 中 `disposeFacetRecords(staged.reverse())` 的多个调用点）；
- **service** 是类型化 token 的实例，可进程内也可跨进程暴露；远程边界是一套传输无关的 strict-JSON wire 协议（catalogue、subscribe/unsubscribe、snapshot + 缓冲 delta，积压 100 条后整份重置快照）；
- **replicated state**：权威状态经原子 overlay 事务发布，消费方拿不可变快照与操作批次。

## 5. 两者的关系与边界

两者在 coding-agent 里几乎不重叠：主交互路径（interactive/print/rpc）不使用 chord；chord 的使用者是 experimental 的 client/server 服务化重构——`src/experimental/services/`（`PI_EXPERIMENTAL=1` 下的 `pi server`/`pi client`，服务分片如 `SessionDirectory`、`AgentController`、`Transcript`）、`src/experimental/session-worker.ts` 与 durable/vacation harness、以及 `packages/protocol`/`client`/`server` 的 CBOR RPC 栈（见 [15-sdk-transport.md](./15-sdk-transport.md)）。Pi packages 则服务于所有模式：装好的 extension/skill/prompt/theme 对四种模式一视同仁。边界可以这么记：**packages 决定"哪些代码和资源在场"，chord 决定"在场的服务如何装配"**；把 Pi package 装进一个 chord 化的实验客户端时，资源发现逻辑是共享的，插件运行时却是 chord 的 facet host。

## 源码锚点

- [`sources/pi/packages/coding-agent/src/core/package-manager.ts`](../../sources/pi/packages/coding-agent/src/core/package-manager.ts)：Pi package 安装、更新、资源收集
- [`sources/pi/packages/coding-agent/src/core/pi-manifest.ts`](../../sources/pi/packages/coding-agent/src/core/pi-manifest.ts)：`"pi"` manifest 字段解析
- [`sources/pi/packages/coding-agent/src/package-manager-cli.ts`](../../sources/pi/packages/coding-agent/src/package-manager-cli.ts)：`pi install/remove/update/list` CLI 与 proper-lockfile
- [`sources/pi/packages/coding-agent/docs/packages.md`](../../sources/pi/packages/coding-agent/docs/packages.md)：上游 package 文档
- [`sources/pi/packages/chord/README.md`](../../sources/pi/packages/chord/README.md)：facet/服务运行时说明
- [`sources/pi/packages/coding-agent/src/experimental/services/README.md`](../../sources/pi/packages/coding-agent/src/experimental/services/README.md)：chord 化 client/server 服务分片
