---
layout: content
title: "OpenCode 深度专题 C01：断点调试指南"
---
# OpenCode 深度专题 C01：断点调试指南

> 本文基于 `sources/opencode/packages/opencode/package.json` 中的 OpenCode `v1.4.14` 源码校对

B 系列前面讲的都是代码架构和执行逻辑，这篇换一个工程视角：如何在 VS Code 和 JetBrains 里对 `packages/opencode` 源码设置断点、调试具体命令、以及一边断点一边看日志。这对想深入主链路或排查运行时问题的人来说是实用工具。

**目录**

- [调试前准备](#调试前准备)
- [VS Code](#vs-code)
- [JetBrains](#jetbrains)
- [最后](#最后)

---

## 调试前准备

1. 用 IDE 打开 `opencode` 仓库根目录。
2. 在仓库根目录执行一次：

    ```powershell
    bun install
    ```

3. VS Code 需要安装 Bun 扩展 `oven.bun-vscode`。
4. 第一次调试时，先把断点打在 `packages/opencode/src/index.ts` 顶部。

如果你是第一次连断点，最稳妥的顺序仍然是先确认 `index.ts` 能停住，再往具体命令文件里追。另一个容易踩坑的点是：不要从 `packages/opencode/bin/opencode` 开始调，那一层主要是发布分发时的包装入口。

## VS Code

### 第一步：配置 `launch.json`

当前工作区，复制`.vscode/launch.example.json`为 `.vscode/launch.json` ：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "bun",
      "request": "attach",
      "name": "opencode (attach 6499)",
      "url": "ws://localhost:6499/opencode"
    }
  ]
}
```

### 第二步：先下断点

第一次建议就下在：

- `packages/opencode/src/index.ts`

这样最容易判断附加到底有没有成功。

### 第三步：在终端启动等待调试的进程

在仓库根目录执行：

```powershell
bun run --inspect-brk=6499/opencode --cwd packages/opencode --conditions=browser src/index.ts
```

如果终端里看到 Inspector 横幅，并且地址是 `ws://localhost:6499/opencode`，就说明端口已经起来了，而且监听路径和 VS Code 的附加配置是对上的。

这里没有继续用 `bun run dev:debug` 的原因也很简单：当前仓库根目录并没有这个脚本，最稳的方式就是直接把 Bun 调试参数写全。

### 第四步：让 IDE 附加到 6499

在 VS Code 或 Cursor 里：

1. 按 `F5`
2. 选择 `opencode (attach 6499)`

附加成功后，IDE 会连到刚才那个已经暂停住的 Bun 进程。因为启动命令显式用了 `--inspect-brk`，所以它会先停在入口附近，适合抓启动阶段的问题。

### 第五步：继续执行并观察断点

附加成功后：

1. 如果当前先停在入口，按一次继续执行
2. 程序走到你的断点时就会停住
3. 这时重点看这几类信息：
   - 调用栈
   - 局部变量
   - `yargs(...)` 注册了哪些命令
   - `cli.parse()` 前后的执行流

### 调某个具体命令

IDE 配置不用改，只改终端里的启动参数即可。

例如调 `run` 子命令：

```powershell
bun run --inspect-brk=6499/opencode --cwd packages/opencode --conditions=browser src/index.ts run "hello"
```

如果你想在端点调试时给 `run "hello"` 指定模型，把 `--model` 放在 `run` 后面、消息前面即可。例如：

```powershell
bun run --inspect-brk=6499/opencode --cwd packages/opencode --conditions=browser src/index.ts run --model <provider>/<model> "hello"
```

简写也可以：

```powershell
bun run --inspect-brk=6499/opencode --cwd packages/opencode --conditions=browser src/index.ts run -m <provider>/<model> "hello"
```

注意这里的 `<provider>/<model>` 只是占位写法，尖括号也不要原样输入。查看opencode的模型使用如下命令。

```powershell
opencode models
```

"OpenCode Zen"/"MiMo V2 Pro Free":

```
bun run --inspect-brk=6499/opencode --cwd packages/opencode --conditions=browser src/index.ts run -m minimax-cn-coding-plan/MiniMax-M2.7 "hello"
```

如果还要一起指定模型变体，也是在 `run` 子命令后继续补，例如：

```powershell
bun run --inspect-brk=6499/opencode --cwd packages/opencode --conditions=browser src/index.ts run --model <provider>/<model> --variant high "hello"
```

例如调 MCP：

```powershell
bun run --inspect-brk=6499/opencode --cwd packages/opencode --conditions=browser src/index.ts mcp debug my-server
```

然后仍然在 IDE 里附加：

- `opencode (attach 6499)`

所以 VS Code 这一套里，真正需要记住的其实只有一句话：

- 进程跑在 `6499/opencode`，IDE 就附加 `opencode (attach 6499)`

## JetBrains

### 第一步：确认 JetBrains 已启用 Bun 支持

先检查这两处：

1. `Settings | Plugins` 里启用了 `Bun` 插件
2. `Settings | Languages & Frameworks | JavaScript Runtime` 里把运行时设成 `Bun`

### 第二步：创建 `Bun` 运行配置

在 JetBrains 里执行：

1. `Run | Edit Configurations` 点 `+` 选择 `Bun`

- `File`: `packages/opencode/src/index.ts`
- `Bun parameters`: `--cwd packages/opencode --conditions=browser`

### 第三步：直接点 Debug

JetBrains / WebStorm 会在你点 `Debug` 时自己拉起并附加调试器，所以这里通常不需要像 VS Code 那样手工维护 `6499/opencode` 这个 inspector 地址。

### 调某个具体命令

RUN:

- `File`：`packages/opencode/src/index.ts`
- `Bun parameters`：`--cwd packages/opencode --conditions=browser`
- `Arguments` / `Program arguments`：`run --model minimax-cn-coding-plan/MiniMax-M2.7 "hello"`

如果还要指定模型变体：

- `Arguments` / `Program arguments`：`run --model <provider>/<model> --variant high "hello"`

> 查看opencode的模型使用如下命令。
>
```powershell
opencode models
```

调 MCP:

- `File`：`packages/opencode/src/index.ts`
- `Bun parameters`：`--cwd packages/opencode --conditions=browser`
- `Arguments` / `Program arguments`：`mcp debug my-server`

## 最后

### 想一边断点一边看日志

VS Code 可以直接在启动命令后面补日志参数：

```powershell
bun run --inspect-brk=6499/opencode --cwd packages/opencode --conditions=browser src/index.ts --print-logs --log-level DEBUG
```

JetBrains 如果要看同样的日志，把下面这段放到 `Arguments` / `Program arguments` 里即可：

```text
--print-logs --log-level DEBUG
```

### 总结

- VS Code：先跑 `bun run --inspect-brk=6499/opencode --cwd packages/opencode --conditions=browser src/index.ts`，再附加 `opencode (attach 6499)`

- ###### JetBrains：直接建一个 `Bun` 运行配置，`File` 指向 `packages/opencode/src/index.ts`，`Bun parameters` 填 `--cwd packages/opencode --conditions=browser`，具体子命令和模型参数都放到 `Arguments` / `Program arguments`，然后点 `Debug`

---

## 关键函数清单

| 函数/类型 | 文件 | 职责 |
| :----------| :------| :------|
| `--inspect-brk` flag | Bun/Node.js | 启动时暂停等待 debugger 附加，适合调试启动链路 |
| `bun run --inspect` | Bun | Bun 内置 debugger 模式，VS Code 通过 attach 接入 |
| `opencode (attach 6499)` | VS Code launch.json | VS Code attach 配置，调试已运行的 opencode 进程 |
| `Log.setLevel('debug')` | `util/log.ts` | 运行时提升日志详细程度 |
| `Bun.env.OPENCODE_DEBUG` | 环境变量 | API 调试开关，打印完整 LLM 请求/响应 |

---

## 代码质量评估

**优点**

- **Bun 原生 debugger 集成**：不需要额外安装调试工具，`bun --inspect` 直接暴露 Chrome DevTools 协议端口，VS Code/JetBrains 均可 attach。
- **日志级别运行时可调**：支持在不重启进程的情况下动态改变 log level，减少为了看日志而重启 session 的调试中断。
- **短 attach 配置**：`opencode (attach 6499)` 的 VS Code 配置简洁，贡献者复盘配置成本低。

**风险与改进点**

- **调试文档极薄（仅 4 节）**：相比系统的功能复杂度，调试文档缺少 MCP 通信调试、Tool 执行调试、durable history 查看等常用场景的具体指引。
- **JetBrains 调试配置依赖 Bun 插件**：JetBrains 系列 IDE 对 Bun 的支持依赖第三方插件，非 Node.js 标准 attach 方式，配置复杂度高于 VS Code。
- **无 REPL 或热重载调试模式**：修改插件或工具逻辑后需要完整重启进程，无法在会话中即时验证代码改动，调试迭代速度较慢。

## 横向对齐补强：OpenCode 调试应从 durable history 开始

OpenCode 的调试优势是状态可查：message、part、session、Bus/SSE 都能回到 durable history 或 server route。

| 症状 | 优先检查 |
| --- | --- |
| prompt 未进入模型 | `SessionPrompt.prompt()` 和 message/part rows |
| tool 卡住 | ToolRegistry / Permission / tool part |
| stream 异常 | `SessionProcessor.process()` / provider wrapper |
| UI 不更新 | Bus/SSE route |
| MCP 失败 | MCP status / config / auth |

## 调试操作步骤补强

| 症状 | 优先检查 | 操作路径 |
| --- | --- | --- |
| UI 没有更新 | Bus/SSE 是否有事件 | 订阅 `/event`，对应 server route 是 `sources/opencode/packages/opencode/src/server/routes/instance/event.ts:19` |
| 工具卡住 | durable part 是否停在 pending/running | 查 `PartTable`，再对照 `sources/opencode/packages/opencode/src/session/processor.ts:121` 和 `processor.ts:142` |
| 工具结果丢失 | 是否发布 `message.part.updated` | 看 `sources/opencode/packages/opencode/src/session/session.ts:481` 和 CLI 消费点 `sources/opencode/packages/opencode/src/cli/cmd/run.ts:460` |
| MCP 不能用 | status 是否 `needs_auth` / `failed` | 查 `sources/opencode/packages/opencode/src/server/routes/instance/mcp.ts:16` 的 status 接口 |
| MCP OAuth 卡住 | pending transport 是否存在 | 看 `sources/opencode/packages/opencode/src/mcp/index.ts:153` 和 `mcp/index.ts:896` |
| 远端 attach 失败 | basic auth header 是否存在 | 看 `sources/opencode/packages/opencode/src/cli/cmd/run.ts:655` 和 `server.ts:81` |
| provider 请求中断 | provider/model stream 配置 | 先查 config，再看 session error 是否经 `Bus.publish(Session.Event.Error)` 发出 |

最小定位顺序：先看 durable row，再看 Bus event，再看 SSE/SDK consumer。OpenCode 的很多“UI 问题”其实是 projection 问题，不能只盯 TUI。

## 源码锚点补强

| 调试目标 | 源码锚点 | 说明 |
| --- | --- | --- |
| prompt 编译 | `sources/opencode/packages/opencode/src/session/prompt.ts:162`, `sources/opencode/packages/opencode/src/session/prompt.ts:986` | 输入是否写成 message/part |
| loop/stream | `sources/opencode/packages/opencode/src/session/prompt.ts:278`, `sources/opencode/packages/opencode/src/session/processor.ts:46` | loop 和 processor |
| tool/permission | `sources/opencode/packages/opencode/src/tool/registry.ts:155`, `sources/opencode/packages/opencode/src/permission/index.ts:166` | 工具可用性和审批 |
| SSE/UI | `sources/opencode/packages/opencode/src/server/routes/instance/event.ts:35`, `sources/opencode/packages/opencode/src/server/routes/global.ts:73` | UI 是否收到事件 |
| server prompt route | `sources/opencode/packages/opencode/src/server/routes/instance/session.ts:819`, `sources/opencode/packages/opencode/src/server/routes/instance/session.ts:851` | blocking/async prompt 路由 |
