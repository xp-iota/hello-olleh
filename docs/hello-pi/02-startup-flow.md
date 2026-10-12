---
title: "启动链路：从二进制入口到四模式分发"
---
# 启动链路：从二进制入口到四模式分发

> 基于 `sources/pi/packages/coding-agent/src/`（pi v1.1.0）源码校对。注意一个容易搞反的细节：`bin` 指向的 `cli.ts` 只有 6 行，真正的编排逻辑在同目录的 `main.ts`（约 1000 行）。

**目录**

- [1. 入口与 10 步启动序列](#1-入口与-10-步启动序列)
- [2. 四模式判定](#2-四模式判定)
- [3. createRuntime 工厂](#3-createruntime-工厂)
- [4. `~/.pi/agent/` 目录布局](#4-piagent-目录布局)

---

## 1. 入口与 10 步启动序列

`package.json` 的 `bin: { pi: dist/bundle/cli.js }`。源码入口 `src/cli.ts` 只做两件事：`setupCli()`（`src/cli/setup.ts`，未处理 rejection 兜底等运行时引导）然后 `main(process.argv.slice(2))`；`main()` 定义在 `src/main.ts:573`。它的十步：

1. 合并内建扩展 `builtInExtensions`（`src/extensions/index.ts`）与调用方注入的 inline extension 工厂（`main.ts:575`）。
2. `runAuthCommand(args)`（`main.ts:582`，实现于 `:133`）：拦截 `pi auth login|logout|check|credential` 子命令，直接短路返回。
3. Windows 自更新隔离区清理与托管安装清理后，`handlePackageCommand`（`pi install|remove|update|list`，`main.ts:597`）、`handleConfigCommand`（`pi config`，`:610`）、`pi mcp ...` 分发（`:614`）依次短路。
4. `parseArgs(args)`（`:620`，`src/cli/args.ts`）解析主参数；扩展自定义 `--flags` 留待后续校验。
5. `resolveAppMode()`（`:651`，定义于 `:112`）判出四种模式；非交互模式下 `takeOverStdout()`（`core/output-guard.ts:45`）把 `console.log` 从 stdout 引开，保证 JSONL 协议输出干净。
6. `runMigrations(cwd)`（`:666`，`src/migrations.ts`）+ 设置诊断 + 可选的首启引导（`src/cli/startup-ui.ts`）。
7. `createSessionManager(parsed, cwd, ...)`（`:693`，实现于 `:358`）：解析 `--session <id|path>`、`--resume`、`--continue`、`--fork`、`--session-id`、`--no-session`；会话可按精确 ID、前缀、路径或跨项目全局搜索定位（详见 [04-state-session-memory.md](./04-state-session-memory.md)）。
8. `createRuntime` 工厂（`:730`）按 cwd 构建运行时，再被 `createAgentSessionRuntime()`（`core/agent-session-runtime.ts:420`）包起来，以便在切目录 / 切会话 / `/reload` 时整体重建。
9. 初始消息组装（`@file` 参数经 `src/cli/file-processor.ts`、管道 stdin 经 `src/cli/initial-message.ts`）；主题初始化 `initTheme()`（`:905`）并装上严格 JSON schema 校验器。
10. 模式分发（`main.ts:948-997`）：`runRpcMode(runtime)` / `new InteractiveMode(runtime).run()` / `runPrintMode(runtime, { mode: "text"|"json" })`。

## 2. 四模式判定

`resolveAppMode`（`main.ts:112-123`）的优先级：

| 优先级 | 条件 | 模式 | 说明 |
| --- | --- | --- | --- |
| 1 | `--mode rpc` | `rpc` | stdout 被 JSONL-RPC 接管，LF-only 严格分帧 |
| 2 | `--mode json` | `json` | print mode 的 JSON 事件流变体 |
| 3 | `--print`/`-p` 或 stdin/stdout 非 TTY | `print` | 单发单答；管道 I/O 自动进入 |
| 4 | 其余 | `interactive` | 全屏 TUI（`src/modes/interactive/`） |

四种模式共享同一个 `AgentSessionRuntime`（services + session + resource loader），不是类继承体系；扩展通过 `ExtensionMode`（`core/extensions/types.ts:323`）感知自己身处哪个 UI 面。

## 3. createRuntime 工厂

`main.ts:730` 起的工厂是"每 cwd 一套服务"的构建点：

- `SettingsManager`（`core/settings-manager.ts`）：全局 + 项目设置合并（`.pi/settings.json` 受 trust 门控）。
- `createAgentSessionServices()`（`core/agent-session-services.ts:135`）：cwd 绑定的服务束——ModelRuntime（`auth.json` + `models.json`）、DefaultResourceLoader；并在此排干扩展注册的自定义 provider / virtual model，校验扩展 CLI flags。
- 项目信任解析（`core/trust-manager.ts`、`src/cli/project-trust.ts`）：未信任项目的 `.pi/` 资源与扩展被拒绝加载。
- 模型 scope 解析后 `createAgentSessionFromServices()` 落成 `AgentSession`（`core/agent-session.ts:378`）。

## 4. `~/.pi/agent/` 目录布局

`getAgentDir()`（`src/config.ts:605`）= `~/.pi/agent/`，可被 `PI_CODING_AGENT_DIR` 覆盖（config.ts:584）。子路径（config.ts:604-656）：

| 路径 | 内容 |
| --- | --- |
| `auth.json` / `models.json` / `settings.json` | 凭据、模型目录、全局设置 |
| `themes/` / `prompts/` / `skills/` | 主题（热重载）、prompt 模板、技能目录 |
| `sessions/` | JSONL 会话存储 |
| `bin/` | 托管二进制（`fd`、`rg`，供 find/grep 工具使用） |
| `extensions/` / `npm/` | 本地扩展与 npm 安装的 pi package |
| `pi-debug.log` | 调试日志 |

项目侧的 `.pi/`（`.pi/extensions/`、`.pi/skills/`、`.pi/prompts/`、`.pi/themes/`、`.pi/settings.json`）在项目受信任后叠加进同一套资源发现。

## 源码锚点

- [`sources/pi/packages/coding-agent/src/cli.ts`](../../sources/pi/packages/coding-agent/src/cli.ts)：二进制入口（setupCli + main）
- [`sources/pi/packages/coding-agent/src/main.ts`](../../sources/pi/packages/coding-agent/src/main.ts)：`main()` 十步编排、`resolveAppMode`、模式分发
- [`sources/pi/packages/coding-agent/src/config.ts`](../../sources/pi/packages/coding-agent/src/config.ts)：`getAgentDir` 与 `~/.pi/agent/` 路径布局
- [`sources/pi/packages/coding-agent/src/core/agent-session-services.ts`](../../sources/pi/packages/coding-agent/src/core/agent-session-services.ts)：cwd 绑定服务束
- [`sources/pi/packages/coding-agent/src/cli/args.ts`](../../sources/pi/packages/coding-agent/src/cli/args.ts)：参数解析
