---
title: "MCP 系统深挖：配置、客户端运行时与三条服务腿"
---
# MCP 系统深挖：配置、客户端运行时与三条服务腿

> 基于 sources/openclaw/（openclaw v2026.10.2，OpenClaw Foundation）源码校对。MCP 是 OpenClaw 向外借工具与向外交付工具的统一协议面：配置优先、策略同权、按 session/requester 管理连接生命周期。

**目录**

- [1. 配置优先与策略同权](#1-配置优先与策略同权)
- [2. 客户端运行时：session 管理器与 requester 隔离](#2-客户端运行时session-管理器与-requester-隔离)
- [3. 传输与 OAuth](#3-传输与-oauth)
- [4. 失败退避与工具清单](#4-失败退避与工具清单)
- [5. 三条服务腿与审批](#5-三条服务腿与审批)
- [6. Doctor、探测与生态位](#6-doctor探测与生态位)

---

## 1. 配置优先与策略同权

MCP 服务器定义在 `openclaw.json` 的 `mcp.servers` 下（`docs/tools/mcp.md`），可从 Control UI、CLI（`openclaw mcp add ... --command/--url`）或直接写配置三种方式落地：

```json5
{
  mcp: {
    servers: {
      docs: {
        url: "https://mcp.example.com/mcp",
        transport: "streamable-http",
        enabled: true,
        connectionTimeoutMs: 5000,
        toolFilter: { include: ["search", "read_*"] },
      },
    },
  },
}
```

每个 server 声明 `transport: "stdio" | "sse" | "streamable-http"`、超时、`toolFilter.include/exclude`（支持 glob）与 OAuth 元数据；`__proto__` 作为 server 名被保留拒绝，`enabled: false` 保留定义但不连接。设计立场写在文档第一段：**连接一个 MCP server 不会绕过 tool-profile / tool-policy**——MCP 工具与内建工具过同一条策略管线。插件也能声明 MCP 服务器：`src/plugins/bundle-mcp.ts` 把各插件 manifest 的 servers 合并进有效配置，并为每个 server 准备 dataDir 归属（`pluginIdsByServer`），同时支持 Claude/Codex/Cursor bundle manifest 里的 mcpServers 字段。

## 2. 客户端运行时：session 管理器与 requester 隔离

客户端侧的核心是 `src/agents/agent-bundle-mcp-manager.ts` 的 session MCP runtime manager：它组合 install / lifecycle / store 三个模块，惰性加载真正的 transport 实现（`createLazyImportLoader(() => import("./agent-bundle-mcp-runtime.js"))`），按 **session 粒度**获取/归还运行时租约（`SessionMcpRuntimeLease`），空闲按 TTL 退役未用服务器。连接不是全局共享的：`src/agents/mcp-connection-resolver.ts` 的 `partitionMcpServersByConnectionScope` 与 `buildMcpRequesterRuntimeCacheKey` 把 server 按连接作用域分区，**requester（发送者）各拿各的连接**——同一个服务器对不同 requester 可以呈现不同的工具与凭据（per-requester identity、auth-profile 映射）。Gateway 热重载下，未变化的 server 保留连接与缓存工具，变化/删除的 server 立即退役，下一回合的发现使用新定义。

## 3. 传输与 OAuth

`src/agents/mcp-transport-config.ts` 归一化三种 transport 配置（`kind: "stdio"` 等）；带 command 的 server 一律按 stdio 处理，即便误填了 HTTP 字段。stdio 侧 `mcp-stdio-client.ts` / `mcp-stdio-transport.ts` 自己管理子进程与帧解码（`mcp-stdio-frame-decoder.ts` 处理跨写入的 Unicode 截断），并有启动安全规则：`bundle-mcp: server "...": env "..." is blocked for stdio startup safety` 这类诊断说明某些环境变量被刻意忽略，防止服务器注入劫持宿主进程。HTTP 侧 `mcp-http-transport.ts` 处理 SSE 与 Streamable HTTP 两种模式及其恢复。OAuth 全套自建：`mcp-oauth.ts` 提供 loopback redirect + `--code` 回退的登录流程，`mcp-oauth-store.ts`（含 worker）把凭据持久化进状态库，`mcp-oauth-refresh` 处理刷新与身份。stderr 日志带 `bundle-mcp:<name>:` 前缀、8 KiB 截断与 Unicode 安全尾部保留。

## 4. 失败退避与工具清单

启动失败的服务器进入**指数退避**：`src/agents/mcp-startup-backoff.ts` 从 30 秒起倍增至 10 分钟上限；首次失败的 runtime 可在其 5 秒目录调度上重试一次，仍失败则进入同样的退避。失败状态跨 session 清理存活，作用域是 server 配置 + requester；成功连接、配置发布或显式 `openclaw mcp reload` 清除退避（`agent-bundle-mcp-manager.ts` 顶部 `resetMcpStartupBackoff`）。`mcp-tool-filter.ts` 按 include/exclude 过滤工具，`tools-effective-mcp-inventory.ts` 计算有效工具清单并把不可用 server 连同下次重试时间一并呈现。MCP 还能反向供给 UI：opt-in 的 MCP Apps host（`mcp-app-sandbox.ts`、`mcp-ui-resource.ts`）允许服务器提供沙箱化的交互视图，连接服务器不会自动启用其 UI 代码。

## 5. 三条服务腿与审批

OpenClaw 作为 MCP **服务器**有三条独立的腿（`src/mcp/`）：

| 腿 | 入口 | 暴露内容 |
| --- | --- | --- |
| 通道桥 | `channel-server.ts` → `channel-bridge.ts` | 通道会话：`conversations_list` / `conversation_get` / `messages_read`（`channel-tools.ts`），handler 刻意保持薄，Gateway 就绪、路由与审批都归 bridge |
| 内建工具 | `openclaw-tools-serve.ts` | 环境变量选定的内建工具（cron、system-agent 等），复用同一套 tool-policy 管线 |
| 插件工具 | `plugin-tools-serve.ts` | 插件注册的工具（如 `memory-lancedb`），供 ACP 里跑的 Claude Code 会话调用，同样走 `applyToolPolicyPipeline` |

Codex MCP 工具审批跟随 session 权限姿态；持久化时的 **Allow Always** 会为精确的 server+tool 存 per-agent 授权（`mcp-codex-tool-approval.ts`），重启后仍在下一次线程配置时生效。整体架构见 [06-extension-mcp.md](./06-extension-mcp.md) §5，策略管线的宿主插件面见 [14-plugin-system.md](./14-plugin-system.md)。

## 6. Doctor、探测与生态位

配置写对不等于服务器可达，这是 `openclaw mcp doctor <name> --probe` 存在的理由：doctor 先校验保存的定义，再开一条真连接报告工具与其他能力；`openclaw mcp status --verbose` 只读配置，`probe <name>` 拿实时 capabilities，`login <name>` 走 HTTP 服务器的 OAuth。改动不达活跃 agent 时，`openclaw mcp reload` 只刷新**当前 CLI 进程**拥有的 runtime——Gateway 得有自己的 reload/发布或重启，这在多进程部署（daemon 管理的 Gateway，见 [19-hooks-lifecycle.md](./19-hooks-lifecycle.md) §5）里是刻意的所有权边界。对照其他实现：pi 把 MCP 做成一个可替换的内建扩展加独立客户端包，Claude Code 把 MCP server 配置放在 `.mcp.json` 项目作用域；OpenClaw 的差异在于把 MCP **请求方作用域化**（同一 server 对不同 requester 独立连接与授权）与**策略同权**（MCP 工具与内建工具共用 tool-profile 管线）作为默认设计，而不只是连接管理。

## 源码锚点

- [`sources/openclaw/src/agents/mcp-transport-config.ts`](../../sources/openclaw/src/agents/mcp-transport-config.ts)：三种 transport 归一化与 stdio 安全规则
- [`sources/openclaw/src/agents/agent-bundle-mcp-manager.ts`](../../sources/openclaw/src/agents/agent-bundle-mcp-manager.ts)：session runtime 管理器与租约
- [`sources/openclaw/src/agents/mcp-connection-resolver.ts`](../../sources/openclaw/src/agents/mcp-connection-resolver.ts)：requester 作用域分区与缓存键
- [`sources/openclaw/src/agents/mcp-startup-backoff.ts`](../../sources/openclaw/src/agents/mcp-startup-backoff.ts)：指数退避状态
- [`sources/openclaw/src/agents/mcp-oauth.ts`](../../sources/openclaw/src/agents/mcp-oauth.ts)：OAuth 登录流程
- [`sources/openclaw/src/mcp/channel-server.ts`](../../sources/openclaw/src/mcp/channel-server.ts)：`openclaw mcp serve` stdio 入口
- [`sources/openclaw/src/mcp/channel-bridge.ts`](../../sources/openclaw/src/mcp/channel-bridge.ts)：通道桥（就绪、路由、审批）
- [`sources/openclaw/src/mcp/plugin-tools-serve.ts`](../../sources/openclaw/src/mcp/plugin-tools-serve.ts)：插件工具的独立 MCP server
- [`sources/openclaw/src/plugins/bundle-mcp.ts`](../../sources/openclaw/src/plugins/bundle-mcp.ts)：插件声明 MCP server 的配置合并
- [`sources/openclaw/docs/tools/mcp.md`](../../sources/openclaw/docs/tools/mcp.md)：MCP 用户文档
