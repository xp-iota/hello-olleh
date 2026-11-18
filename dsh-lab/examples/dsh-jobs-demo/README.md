# dsh 的长期运行示例

本示例演示 dsh 里五种「活得比 turn 久」的机制：后台任务、目标生命周期、
PTC run_code、workflow 编排、schedule 定时任务。34 个服务全部在
cordis.patch.yml 里声明，boot 后全程在位，代码里没有一处 ctx.plugin()。
版本面：`@deepseek-ai/*` 0.2.2-rc.3 + `@deepseek-ai/cordis` 4.1.0；
Node v26.12.1 与 Bun 1.4.4 双运行时实测，输出除 runtime 行外逐行一致。

> 配套文章：[09 § 9.20–9.23](../../../docs/hello-dsh/09-host-runtime-and-storage.md)
> （五种「多步推进」机制）与 [08](../../../docs/hello-dsh/08-execution-services.md)（goal 组）。
> 本工程完全独立：整目录拷走，`npm install` 后 `npm start`（Node）或
> `npm run start:bun`（Bun）即可运行，不需要 API key——jobs/goal/schedule 直接
> 驱动服务 API，run_code/workflow 用 `callTool` 走真实工具管线，不跑模型 turn。

## 1 五种机制，职责不同

一个 turn 结束了，它启动的东西怎么办？dsh 给出五种机制，各答各的问题：

| 机制 | 服务/包 | 回答的问题 |
|:-----|:--------|:-----------|
| 后台任务 | `jobs-local` + `tool-jobs` | 长命令的输出放哪、怎么按游标读、怎么取消？ |
| 目标 | `goal` + `goal-round-driver` + `tool-goal` + `command-goal` | 同会话的长期目标怎么落日志、怎么驱动自动续跑？ |
| 程序传输面 | `tool-executor-ptc` + `ptc-runtime-node` | 模型写的代码在哪个进程、什么边界里执行？ |
| 工作流 | `workflow-ptc` + `tool-workflow` + `subagent` | 多步脚本怎么编排 phase/log/args、怎么 fan-out 子代理？ |
| 定时 | `schedule` + `tool-schedule` | 到点把一条 prompt 送进会话，重启后还在吗？ |

> 关键认识：这五样东西都走「**注册 + 持久化 + 可观测**」——状态落在会话日志或
> 存储域里，而不是只活在某个 Promise 里。按位置分：Jobs 与 Schedule 在 turn
> 之外，Goal 在 turn 之内；本示例全部离线驱动，不烧一个 token。

## 2 装配树：九行 base + 二十五行长生栈

执行器用 **tool-executor-ptc 替换 native**——`run_code` 只在 PTC 执行器下暴露。
34 行按职责分七组：

| 组 | 行 | 职责 |
|:---|:---|:-----|
| base（9） | timer / system-prompt / tools / tool-executor-ptc / session / session-projection / agent / llm / agent-loop | 会话与工具管线的最小底座，执行器换成 PTC |
| 后台任务（2） | jobs / tool-jobs | 输出环 registry + 工具面 |
| 目标（5） | commands / goal / tool-goal / command-goal / goal-round-driver | 目标服务 + 工具 + /goal 命令 + 续跑驱动 |
| PTC 与沙箱（6） | subprocess / sandbox / sandbox-policy / fs-sandbox / working-directory / ptc-runtime | run_code 的宿主与边界 |
| 工作流（4） | subagent / subagent-spawn / workflow-ptc / tool-workflow | fan-out 宿主 + PTC 引擎 + 工具 |
| 存储与持久化（6） | storage / storage-json / storage-domain / session-log-deepseek / deepseek-llm-api-extensions / session-persistence-jsonl | schedule 的 durable 底座 + 会话落盘 |
| 定时（2） | schedule / tool-schedule | 到点把一条 prompt 送进会话 |

> 依赖链：`ptc-runtime-node` 注入 `fs + subprocess + sandbox + sandboxPolicy`；
> `workflow-ptc` 注入 `subagents + ptcRuntime + sandboxPolicy + workingDirectory`；
> `schedule` 注入 `agents + sessions + storageDomain + sessionPersistence`；
> `goal-round-driver` 注入 `agents + goals + sessions`。漏一行，下游服务在
> boot 期就报缺依赖，不会静默降级。

两处配置值得单独看。执行器替换（base 第 4 行）：

```yaml
    # PTC 执行器：setExecutor 覆盖 native，run_code 成为模型可见的程序传输面。
    - id: tool-executor-ptc
      name: '@deepseek-ai/dsh-tool-executor-ptc'
```

存储域必须显式选 json 后端（不配时默认后端不是 json，schedule 的 durable
存取直接失败）：

```yaml
    - id: storage-domain
      name: '@deepseek-ai/dsh-storage-domain'
      config:
        backend: json
```

## 3 逐场景机制

**S1 后台任务与输出环。** `JobSpec` 没有「command 字符串」字段：producer 自己在
`run(job)` 里 `job.append(chunk, { channel })` 推输出，registry 只负责有界环缓冲、
生命周期事件和按游标读取。`read(id, sid)` 每读一次游标推进一次，重复读为空。
`JobHooks` 两项都必需：`cancel` 同步幂等，`done` 必须不 reject。`kill` 返回
`'requested'`——它只是请求，真正收尾靠 producer 的 cancel 钩子把 done resolve
成 `{ status: 'killed' }`，所以演示里轮询等状态落定。

**S2 目标生命周期。** goal 落在会话日志里，`GoalRef` 带 revision 乐观锁：
pause/resume/complete 都要传当前 revision。挂了 `goal-round-driver` 时
**create 即 armed**（随时准备自动续跑），resume 也重新 arm——离线演示必须
`disarm` 同步解除，否则驱动会在 idle 边缘偷跑一个没有适配器的 turn。一个会话
同时只容一个未完成目标，重复 create 被拒。`/goal` 命令由 command-goal 行注册，
`ctx.commands.execute(agent, '/goal', [], signal)` 直接执行。

**S3 PTC run_code。** `run_code` 不在 `tools.schemas()` 里：它是执行器拥有的
传输面，在注册能力之外构建（`tool-executor-ptc/src/ptc.ts:268`）。PTC 模式下
**顶层只容 run_code**，直接调别的工具报 `unknown tool … only run_code is
callable directly`。程序是 async 函数体，`return` 即输出，在沙箱子进程
（ptc-runtime-node 的 worker）里经 `vm.compileFunction` 求值执行。

**S4 workflow 脚本编排。** workflow 工具注册在 SDK 声明里（`tools.schemas()`
可见），但 PTC 模式下要从 run_code 程序内的 `tools.*` 绑定调。脚本只用
`phase/log/args` 钩子、不 fan-out 子代理，离线可跑；返回
`{ kind: 'foreground', runId, agentsStarted: 0, result: 42 }`。guest 程序经
**data URL 动态导入**注入 worker（`workflow-ptc/src/host.ts:26-27`）——这条缝
在 Bun 下会断，见坑 5。

**S5 schedule 定时任务。** 存储是 durable 的（storage-json 落在
`.dsh-home/storages`）：上次运行残留的任务还在，先幂等清理保证计数确定。
服务 API 与工具面**参数形状不同**：服务面 `timing: { kind: 'after',
after_seconds }` + `target: { kind: 'session', sessionId }`；工具面
（`tool-schedule/src/index.ts:375-383`）换成 `rrule`（RFC 5545 子集）+
`target` 枚举 `this_session/new_once/new`。默认 `new_once` 要 Host 能建会话
（sessionController），本示例没挂那条缝，所以服务面显式选已存在的会话。

## 4 运行 jobs 示例

`cordis.yml` 全文（根配置留空，装配全部来自 patch，见
[dsh-boot-demo](../dsh-boot-demo/README.md) 的装配哲学）：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

`cordis.patch.yml` 全文（34 行树）：

```yaml
# 长期运行工作的完整树：九行 base + 二十五行长生栈。
# 本示例不跑模型 turn：jobs/goal/schedule 直接驱动服务 API，workflow/run_code
# 用 callTool 走真实工具管线（不需要 key）。
# 执行器选 PTC（tool-executor-ptc 替换 native）：run_code 只在 PTC 执行器下暴露。
# 依赖链：ptc-runtime-node 注入 fs + subprocess + sandbox + sandboxPolicy；
#         workflow-ptc 注入 subagents + ptcRuntime + sandboxPolicy + workingDirectory；
#         schedule 注入 agents + sessions + storageDomain + sessionPersistence；
#         storage-domain/storage-json 注入 storage；goal-round-driver 注入 agents + goals + sessions。
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'

    - id: system-prompt
      name: '@deepseek-ai/dsh-system-prompt'

    - id: tools
      name: '@deepseek-ai/dsh-tools'

    # PTC 执行器：setExecutor 覆盖 native，run_code 成为模型可见的程序传输面。
    - id: tool-executor-ptc
      name: '@deepseek-ai/dsh-tool-executor-ptc'

    - id: session
      name: '@deepseek-ai/dsh-session'

    - id: session-projection
      name: '@deepseek-ai/dsh-session-projection'

    - id: agent
      name: '@deepseek-ai/dsh-agent'

    - id: llm
      name: '@deepseek-ai/dsh-llm'

    - id: agent-loop
      name: '@deepseek-ai/dsh-agent-loop'
      config:
        agents: []

    # ── 后台任务：registry + 工具面 ────────────────────────────────────────
    - id: jobs
      name: '@deepseek-ai/dsh-jobs-local'

    - id: tool-jobs
      name: '@deepseek-ai/dsh-tool-jobs'

    # ── 目标：服务 + 工具 + /goal 命令 + 续跑驱动 ──────────────────────────
    - id: commands
      name: '@deepseek-ai/dsh-commands'

    - id: goal
      name: '@deepseek-ai/dsh-goal'

    - id: tool-goal
      name: '@deepseek-ai/dsh-tool-goal'

    - id: command-goal
      name: '@deepseek-ai/dsh-command-goal'

    # 续跑驱动：只在 goal active 且 armed 时驱动自动续跑；
    # create/resume 都会 arm，演示里用 disarm 同步解除，避免离线环境偷跑 turn。
    - id: goal-round-driver
      name: '@deepseek-ai/dsh-goal-round-driver'

    # ── PTC 与沙箱：run_code 的宿主与边界 ──────────────────────────────────
    - id: subprocess
      name: '@deepseek-ai/dsh-subprocess-local'

    - id: sandbox
      name: '@deepseek-ai/dsh-sandbox-local'

    - id: sandbox-policy
      name: '@deepseek-ai/dsh-sandbox-policy'
      config:
        mode: workspace-write
        workspaceRoot: !!js "process.cwd()"

    - id: fs-sandbox
      name: '@deepseek-ai/dsh-fs-sandbox'

    - id: working-directory
      name: '@deepseek-ai/dsh-working-directory'

    - id: ptc-runtime
      name: '@deepseek-ai/dsh-ptc-runtime-node'

    # ── 工作流：subagent 服务（fan-out 的宿主）+ PTC 引擎 + 工具 ───────────
    - id: subagent
      name: '@deepseek-ai/dsh-subagent'
      config:
        maxDepth: 1

    # workflow 启动即解析默认 provider（spawn）：不挂 provider 连不 fan-out
    # 的脚本也起不来；continuable 激活要求会话持久化（上面已挂）。
    - id: subagent-spawn
      name: '@deepseek-ai/dsh-subagent-spawn-in-process'
      config:
        providerName: spawn

    - id: workflow-ptc
      name: '@deepseek-ai/dsh-workflow-ptc'

    - id: tool-workflow
      name: '@deepseek-ai/dsh-tool-workflow'

    # ── 存储与持久化：schedule 的 durable 底座 ─────────────────────────────
    - id: storage
      name: '@deepseek-ai/dsh-storage'

    - id: storage-json
      name: '@deepseek-ai/dsh-storage-json'
      config:
        root: !!js dshHomePath('storages')

    - id: storage-domain
      name: '@deepseek-ai/dsh-storage-domain'
      config:
        backend: json

    - id: session-log-deepseek
      name: '@deepseek-ai/dsh-session-log-deepseek'

    - id: deepseek-llm-api-extensions
      name: '@deepseek-ai/dsh-deepseek-llm-api-extensions'

    - id: session-persistence-jsonl
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      config:
        root: !!js dshHomePath('sessions')
        compression: none

    # ── 定时与提醒：到点把一条 prompt 送进会话 ─────────────────────────────
    - id: schedule
      name: '@deepseek-ai/dsh-schedule'

    - id: tool-schedule
      name: '@deepseek-ai/dsh-tool-schedule'
```

`src/index.ts` 的 boot 入口（节选）——官方 `boot()` 读两份 YAML，场景代码
只驱动服务 API 与工具管线：

```ts
const ctx = await boot(
  'dsh-jobs-demo', CONFIG,
  loadOverlayPatches('dsh-jobs-demo', PATCH),
  undefined, BASE_URL,
)
```

```bash
# 安装依赖（41 个运行时依赖 + 2 个 devDependencies）
npm install

# Windows：先按坑 11 给工程目录补 FullControl（只需一次）

# Node 侧（start 脚本带 --no-warnings，见坑 10）
npm start

# Bun 侧（run-bun.mjs 用 Node 拉起 Bun 并注入 preload，见坑 1–5）
npm run start:bun

# 类型检查
npm run typecheck
```

`npm start` 实测输出（Node v26.12.1，Windows，工作目录即本工程目录）：

```text
runtime = node v26.12.1

=== S1 后台任务与输出环 ===
会话可见 job 数：1
首次读：2 个 chunk，status=running
游标再读：0 个 chunk（游标已推进）
kill 返回：requested
取消后状态：killed

=== S2 目标生命周期 ===
初始目标：(无)
create：phase=active，activation=armed
disarm：activation=disarmed
pause → paused；resume → active（activation=armed）
重复 create：goal "<id>" already exists with phase "active"
/goal 命令可见：true
/goal 执行：kind=success
complete：phase=complete

=== S3 PTC run_code ===
顶层直调 workflow：isError=true，Error: unknown tool "workflow": only `run_code` is callable directly — call `wo…
run_code：isError=false，42 File sandbox enforcement is partial on this host.

=== S4 workflow 脚本编排 ===
workflow 工具已注册：true（在 SDK 声明里，不在顶层）
workflow：isError=false，{ "kind": "foreground", "runId": "<uuid>", "agentsStarted": 0, "result": 42 } F…

=== S5 schedule 定时任务 ===
create：status=active，title=演示提醒
list：total=1
工具面 create/list/delete：isError=false，{ "total": 2, "deleted": true } File sandbox enforcement is partial on this hos…
delete：deleted=true
删除后 list：total=0

JOBS_OK
```

`npm run start:bun`（Bun 1.4.4）除首行 `runtime = bun 1.4.4` 外**逐行一致**
（归一化比对实测，正文 34 行全同），同样以 `JOBS_OK` 收尾。`npm run typecheck`
0 错误。尾部 `…` 是 `preview()` 的 80 字符截断；`<id>`/`<uuid>` 是随机标识符的
规范化占位；`File sandbox enforcement is partial on this host.` 是 Windows 上
fs-sandbox 附加的能力警告，不是错误。

7 个值得注意的数字与事实：

- **34 行 patch、41 个运行时依赖**，代码里没有一处 ctx.plugin()——装配全部
  来自清单，boot 后全程在位。
- **0 个模型 turn**：jobs/goal/schedule 直接驱动服务 API，run_code/workflow
  走 callTool 进真实工具管线，全程不需要 key。
- **kill 只返回 requested**：真正收尾靠 producer 的 cancel 钩子把 done
  resolve 成 killed，S1 轮询等状态落定（100 × 10ms 上限）。
- **goal create 即 armed**：挂了续跑驱动时 create/resume 都会 arm，离线演示
  每次立刻 disarm；complete 前重新取最新 revision，拿旧值会被乐观锁拒绝。
- **顶层只容 run_code**：直调 workflow 被拒（S3）；workflow 与 schedule
  工具面都从 run_code 程序内的 `tools.*` 绑定调（S4/S5）。
- **schedule 是 durable 的**：上次运行残留的任务还在，演示开头幂等清理；
  计数 1 → 2 → 0 全程断言。
- **双运行时逐行一致**：除 runtime 行与 npm notice 外正文 34 行全同；
  typecheck 0 错误。

留档：[runtime/out-node.txt](runtime/out-node.txt) ·
[runtime/out-bun.txt](runtime/out-bun.txt)（含 npm notice 行的完整输出）。## 5 边界与坑（全部实测）

1. **Bun 缝 1：runner 分隔符。** subprocess-local 的协议是
   `process.execPath runner.js -- <argv>`，Bun 吞掉脚本后第一个 `--`。
   `runtime/bun-preload.mjs` 在 runner 入口（`DSH_SUBPROCESS_RUNNER` +
   文件名双判定）补回；`runtime/run-bun.mjs` 用 Node 拉起 Bun 并经
   **BUN_OPTIONS** 注入 preload（runner 是孙进程，命令行 `--preload` 到不了）。
2. **Bun 缝 2：`node:module` 具名导出缺失。** Bun 1.4.4 缺
   `stripTypeScriptTypes`/`registerHooks`/`syncBuiltinESMExports`，
   ptc-runtime-node 直接导入失败、`ptc-runtime` 静默不激活。preload 把该包
   lib 全部 js 的 `from "node:module"` 重定向到 `runtime/lib/bun-shim.mjs`
   （`Bun.Transpiler` 实现，保留上游 `slice(35, -2)` 依赖的 35 字节前缀/`\n}`
   后缀；`registerHooks` 是空壳 `{ deregister() {} }`）。**空壳的代价**：程序内
   动态 import 不再经沙箱判决钩子——演示程序不依赖这一点，生产环境要留意。
3. **Bun 缝 3：worker env 白名单清洗。** 修好缝 2 后 worker 仍报
   registerHooks missing——根因是 preload 根本没到 worker：宿主 spawn worker
   时把 `process.env` 除白名单外全部键置 undefined
   （`ptc-runtime-node/src/worker.ts:290-296`，白名单
   `STARTUP_ENVIRONMENT_NAMES = PATH/PATHEXT/SYSTEMROOT/WINDIR/TEMP/TMP`，
   `environment.ts:5`），`BUN_OPTIONS` 被清洗掉。穿透路径是存在的：
   subprocess-local 的 `childEnv(extra)` 在清洗后的父 env **之后**合并 extra
   （`subprocess-local/src/spawn.ts:44-52`），Windows runner 又把完整 targetEnv
   经 IPC 交给 `CreateProcessW`（`windows-job.ts:230`）。修法：preload 在宿主
   lib/index.js 的 `const handle = this.ctx.subprocess.spawn({` 锚点前注入
   `env.BUN_OPTIONS = "--preload <path>"`，让 preload 随 extra 一路穿透到 worker。
4. **Bun 缝 4：fd 控制通道。** worker 与 runner 之间的控制通道是继承的匿名
   管道，上游用 `new Socket({ fd: 7, … })` 打开
   （`subprocess/src/control.ts:19-24`）。Bun/Windows 既不把继承句柄映射到 fd
   （`fs.readSync(7)` EBADF），`Socket({ fd })` 也抛 `Unsupported fd type:
   UNKNOWN`——但句柄确实在进程里（koffi `GetFileType` 扫到 PIPE）。修法：
   `runtime/lib/bun-control-channel.mjs` 用 koffi 直调 kernel32：扫句柄
   4..4096（步长 4）、排除 `GetStdHandle` 的三个 std 句柄、`PeekNamedPipe`
   确认是管道且**恰好一根**，再用 overlapped `ReadFile`（OVERLAPPED 的 hEvent
   在 x64 偏移 **24**）+ manual-reset event 轮询、同步 `WriteFile`，包成
   Duplex 替换 `Socket({ fd: 7 })`。假设「恰好一根非 std 管道」对本工程的
   worker 成立；多管道场景会大声报错而不是猜。
5. **Bun 缝 5：data URL 模块格式误判。** workflow guest 经
   `data:text/javascript,${encodeURIComponent(source)}` 动态导入
   （`workflow-ptc/src/host.ts:26-27`）。Bun 1.4.4 的 data URL 格式判定被
   guest 源码里的 **class 字段**（`path;`）与 **//#region 注释**触发，误按
   CJS 包成 `{ __esModule, default }`，named export 全丢，报
   `runWorkflowGuest is not a function`；同源码落盘成 `.mjs` 导入则正常，
   与尺寸无关（104KB 合成源正常），`Bun.plugin` onLoad 也拦不到运行时动态
   import。修法：`runtime/lib/bun-guest-import.mjs` 把 data URL 解码落盘到
   `.bun-guest-cache/<sha1>.mjs`（已 gitignore）再 import；preload 双侧补丁——
   宿主侧把 PROGRAM 模板的 import 换成 `__dshBunGuestImport(GUEST_URL)`，
   worker 侧把该函数注入求值器 globals（作为 AsyncFunction 参数传入程序）。
6. **storage-domain 必须显式 `backend: json`。** 不配时默认后端不是 json，
   schedule 的 durable 存取直接失败。storage-json 的 root 用
   `!!js dshHomePath('storages')` 落在示例自己的 `.dsh-home` 里。
7. **goal create 即 armed，complete 要用最新 revision。** 见 S2：离线演示
   每次 create/resume 后立刻 disarm；complete 前重新 `ctx.goals.get(agent)`
   取 revision，拿旧值会被乐观锁拒绝。
8. **schedule 两面形状不同 + durable 残留。** 服务面 timing 对象/工具面
   rrule，服务面 target 对象/工具面枚举（见 S5）；默认 `new_once` 需要
   sessionController。存储跨运行持久，演示开头必须幂等清理，否则第二次运行
   计数断言失败。
9. **workflow-ptc 启动即解析 spawn provider。** 不挂
   `subagent-spawn-in-process`（providerName: spawn），连不 fan-out 的脚本
   也起不来；continuable 激活还要求会话持久化（session-persistence-jsonl 行）。
10. **`node --no-warnings` 不是可选的。** 宿主调 `stripTypeScriptTypes` 会报
    实验警告，警告带随机 pid，破坏双运行时输出逐行一致；start 脚本用
    `node --no-warnings` 抑制，Bun 侧无此警告。
11. **Windows 工作目录 ACL。** 本示例同样挂 sandbox-local，工作目录必须给
    当前用户 FullControl（含 WRITE_OWNER），否则 Win32 5——修法与根因见
    [dsh-sandbox-demo 坑 1](../dsh-sandbox-demo/README.md)。

## 6 从零复现：完整文件与运行路径

前置条件：Node ≥ 22.18（实测 v26.12.1，原生 TypeScript 类型剥离）；跑 Bun 侧
需要 Bun ≥ 1.4.4（实测 1.4.4，`npm i -g bun` 或官方安装器）；Windows 上先按
坑 11 给工程目录补一次 FullControl。不需要 API key，不访问网络（npm install
除外）。

目录结构（node_modules、.dsh-home、.bun-guest-cache 除外，后两者已 gitignore）：

```text
dsh-jobs-demo/
├── cordis.yml              # []，装配全在 patch
├── cordis.patch.yml        # 34 行树（上文全文）
├── package.json            # 41 个运行时依赖，全文见下
├── tsconfig.json
├── src/
│   ├── index.ts            # 五场景，235 行
│   └── tools.ts            # callTool/preview 封装（与 tool-pipeline-demo 逐字一致）
├── runtime/
│   ├── run-bun.mjs         # Node 拉 Bun + BUN_OPTIONS 注入 + 版本回退候选
│   ├── bun-preload.mjs     # 五条缝的总入口（加载期锚点补丁）
│   ├── lib/
│   │   ├── bun-shim.mjs            # 缝 2：node:module 导出（Bun.Transpiler）
│   │   ├── bun-control-channel.mjs # 缝 4：koffi 管道 Duplex
│   │   └── bun-guest-import.mjs    # 缝 5：data URL 落盘导入
│   ├── out-node.txt        # Node 侧留档
│   └── out-bun.txt         # Bun 侧留档
└── README.md
```

`package.json` 全文：

```json
{
  "name": "dsh-jobs-demo",
  "private": true,
  "type": "module",
  "description": "长期运行的工作：后台任务输出环、目标生命周期与续跑驱动、workflow 编排、PTC run_code、schedule 定时任务。执行器走 PTC（run_code 的宿主）。Node 与 Bun 双运行时，Bun 缝由自带迷你 runtime 层修补。",
  "scripts": {
    "start": "node --no-warnings src/index.ts",
    "start:bun": "node runtime/run-bun.mjs",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@deepseek-ai/cordis": "4.1.0",
    "@deepseek-ai/cordis-plugin-group": "1.1.0",
    "@deepseek-ai/cordis-plugin-include": "1.1.0",
    "@deepseek-ai/cordis-plugin-loader": "1.1.0",
    "@deepseek-ai/cordis-plugin-timer": "1.2.0",
    "@deepseek-ai/dsh-agent": "0.2.2-rc.3",
    "@deepseek-ai/dsh-agent-loop": "0.2.2-rc.3",
    "@deepseek-ai/dsh-app-boot": "0.2.2-rc.3",
    "@deepseek-ai/dsh-command-goal": "0.2.2-rc.3",
    "@deepseek-ai/dsh-commands": "0.2.2-rc.3",
    "@deepseek-ai/dsh-deepseek-llm-api-extensions": "0.2.2-rc.3",
    "@deepseek-ai/dsh-fs-sandbox": "0.2.2-rc.3",
    "@deepseek-ai/dsh-goal": "0.2.2-rc.3",
    "@deepseek-ai/dsh-goal-round-driver": "0.2.2-rc.3",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.3",
    "@deepseek-ai/dsh-jobs-local": "0.2.2-rc.3",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.3",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.3",
    "@deepseek-ai/dsh-ptc-runtime-node": "0.2.2-rc.3",
    "@deepseek-ai/dsh-sandbox-local": "0.2.2-rc.3",
    "@deepseek-ai/dsh-sandbox-policy": "0.2.2-rc.3",
    "@deepseek-ai/dsh-schedule": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-log-deepseek": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-persistence-jsonl": "0.2.2-rc.3",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.3",
    "@deepseek-ai/dsh-storage": "0.2.2-rc.3",
    "@deepseek-ai/dsh-storage-domain": "0.2.2-rc.3",
    "@deepseek-ai/dsh-storage-json": "0.2.2-rc.3",
    "@deepseek-ai/dsh-subagent": "0.2.2-rc.3",
    "@deepseek-ai/dsh-subagent-spawn-in-process": "0.2.2-rc.3",
    "@deepseek-ai/dsh-subprocess-local": "0.2.2-rc.3",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-executor-ptc": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-goal": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-jobs": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-schedule": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tool-workflow": "0.2.2-rc.3",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.3",
    "@deepseek-ai/dsh-working-directory": "0.2.2-rc.3",
    "@deepseek-ai/dsh-workflow-ptc": "0.2.2-rc.3"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

`tsconfig.json` 与 [dsh-agent-loop-demo](../dsh-agent-loop-demo/tsconfig.json)
逐字一致（SHA256 相同，14 行）：ES2023 + nodenext + strict + noEmit +
allowImportingTsExtensions + verbatimModuleSyntax，include 只有 src。

`src/index.ts` 全文（235 行，五场景 + 断言）：

```ts
/**
 * dsh-jobs-demo —— 长期运行的工作，全部离线（不跑模型 turn，不需要 key）：
 *   S1 后台任务：producer 推输出进环、游标读取、kill 取消；
 *   S2 目标生命周期：create → pause → resume → complete + /goal 命令；
 *   S3 PTC run_code：程序传输面在沙箱子进程里执行代码；
 *   S4 workflow：脚本编排（phase/log/args 钩子，不 fan-out 子代理）；
 *   S5 schedule：durable 定时任务的创建、列表、删除。
 * 关键认识：活得比 turn 久的东西都走"注册 + 持久化 + 可观测"——状态落在
 * 会话日志或存储域里，而不是只活在某个 Promise 里。
 * Node 与 Bun 双运行时：Bun 的五条缝（runner 分隔符、node:module 导出、
 * worker env 白名单、fd 控制通道、data URL 误判）由 runtime/ 迷你层修补。
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-jobs-local'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-commands'
import { callTool, preview } from './tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })
// 宿主进程调 stripTypeScriptTypes 会报实验警告（带随机 pid，破坏双运行时
// 输出逐行一致）：start 脚本用 node --no-warnings 抑制；Bun 侧无此警告。

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-jobs-demo', CONFIG,
  loadOverlayPatches('dsh-jobs-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const suffix = Date.now().toString(36)
const handle = await ctx.agents.create({
  sessionId: SessionId(`jobs-${suffix}`),
  meta: { cwd: process.cwd() },
})
const agent = handle.agent
const sid = agent.session.id

// ── S1：后台任务与输出环 ───────────────────────────────────────────────────
console.log('\n=== S1 后台任务与输出环 ===')
{
  // JobSpec 没有 "command 字符串" 字段：producer 自己在 run(handle) 里推输出，
  // registry 只负责有界环缓冲、生命周期事件和按游标读取。
  const id = ctx.jobs.start({
    kind: 'bash',
    label: 'S1 演示任务',
    owner: sid,
    run(job) {
      job.append('第一行输出\n', { channel: 'stdout' })
      job.append('第二行输出\n', { channel: 'stdout' })
      job.updateProgress('2/2 done')
      // JobHooks 两项都必需：cancel 同步幂等，done 必须不 reject。
      return {
        cancel: () => {},
        done: Promise.resolve({ status: 'completed' as const, detail: 'S1 完成' }),
      }
    },
  })
  const listed = ctx.jobs.list(sid)
  console.log(`会话可见 job 数：${listed.length}`)
  assert(listed.length >= 1, 'job 未出现在列表里')

  const first = ctx.jobs.read(id, sid)
  console.log(`首次读：${first.chunks.length} 个 chunk，status=${first.job.status}`)
  assert(first.chunks.length === 2, '应当一次读到两个 chunk')
  const second = ctx.jobs.read(id, sid)
  console.log(`游标再读：${second.chunks.length} 个 chunk（游标已推进）`)
  assert(second.chunks.length === 0, '游标之后的重复读应当为空')

  // 第二个任务演示 kill：producer 的 done 悬着，cancel 钩子负责收尾。
  let release: (() => void) | undefined
  const id2 = ctx.jobs.start({
    kind: 'bash',
    label: 'S1 可取消任务',
    owner: sid,
    run(job) {
      job.append('等待取消\n', { channel: 'stdout' })
      return {
        cancel: () => release?.(),
        done: new Promise(resolve => {
          release = () => resolve({ status: 'killed' as const, detail: '被演示取消' })
        }),
      }
    },
  })
  const outcome = ctx.jobs.kill(id2, sid, '演示取消')
  console.log(`kill 返回：${outcome}`)
  assert(outcome === 'requested', 'kill 应当返回 requested')
  // 等 producer 的 cancel 钩子把 done 收尾。
  for (let i = 0; i < 100 && ctx.jobs.read(id2, sid).job.status !== 'killed'; i++) {
    await new Promise(r => setTimeout(r, 10))
  }
  const killed = ctx.jobs.read(id2, sid)
  console.log(`取消后状态：${killed.job.status}`)
  assert(killed.job.status === 'killed', '被 kill 的任务应当进入 killed')
}

// ── S2：目标生命周期 ───────────────────────────────────────────────────────
console.log('\n=== S2 目标生命周期 ===')
{
  console.log(`初始目标：${ctx.goals.get(agent) === undefined ? '(无)' : '(已存在)'}`)
  const goal = ctx.goals.create(agent, { objective: 'S2：演示目标对象落在会话日志里' })
  console.log(`create：phase=${goal.phase}，activation=${goal.activation}`)
  assert(goal.phase === 'active', '新目标应当 active')
  // 挂了续跑驱动时 create 即 armed（随时准备自动续跑）；离线演示用 disarm
  // 同步解除，避免驱动在 idle 边缘偷跑一个没有适配器的 turn。
  const disarmed = ctx.goals.disarm(agent)
  console.log(`disarm：activation=${disarmed?.activation}`)
  assert(disarmed?.activation === 'disarmed', 'disarm 应当解除续跑武装')

  const paused = ctx.goals.pause(agent, { id: goal.id, revision: disarmed?.revision ?? goal.revision })
  const resumed = ctx.goals.resume(agent, { id: paused.id, revision: paused.revision })
  console.log(`pause → ${paused.phase}；resume → ${resumed.phase}（activation=${resumed.activation}）`)
  assert(paused.phase === 'paused' && resumed.phase === 'active', 'pause/resume 相位迁移失败')
  assert(resumed.activation === 'armed', 'resume 应当重新武装续跑')
  ctx.goals.disarm(agent)

  // 重复 create 被拒：一个会话同时只容一个未完成目标。
  let duplicate = ''
  try { ctx.goals.create(agent, { objective: '重复目标' }) } catch (error) {
    duplicate = error instanceof Error ? error.message : String(error)
  }
  console.log(`重复 create：${preview(duplicate.replace(/goal "[^"]+"/, 'goal "<id>"'), 80)}`)
  assert(duplicate.includes('already exists'), '重复 create 应当被拒绝')

  const names = ctx.commands.list(agent).map(command => command.name)
  console.log(`/goal 命令可见：${names.includes('goal')}`)
  assert(names.includes('goal'), '/goal 命令未注册（command-goal 行）')
  const shown = await ctx.commands.execute(agent, '/goal', [], new AbortController().signal)
  console.log(`/goal 执行：kind=${shown?.result.kind}`)
  assert(shown?.result.kind === 'success', '/goal 执行失败')

  const done = ctx.goals.complete(agent, { id: resumed.id, revision: ctx.goals.get(agent)?.revision ?? resumed.revision })
  console.log(`complete：phase=${done.phase}`)
  assert(done.phase === 'complete', 'complete 应当进入 complete 相位')
}

// ── S3：PTC run_code ───────────────────────────────────────────────────────
console.log('\n=== S3 PTC run_code ===')
{
  // run_code 不在 tools.schemas() 里：它是执行器拥有的传输面，在注册能力之外
  // 构建（tool-executor-ptc/src/ptc.ts:268）。PTC 模式下顶层只容 run_code，
  // 直接调别的工具会被拒——其他工具要从程序内的 SDK 绑定调。
  const direct = await callTool(ctx, 'workflow', {
    script: 'return 1', meta: { name: 'x', description: 'x' },
  }, agent)
  console.log(`顶层直调 workflow：isError=${direct.isError}，${preview(direct.content, 80)}`)
  assert(direct.isError && direct.content.includes('run_code'), 'PTC 模式应当拒绝顶层直调其他工具')

  // per-call 模式：程序是 async 函数体，return 即输出；在沙箱子进程里执行。
  const result = await callTool(ctx, 'run_code', { code: 'return 6 * 7', description: '演示程序传输面' }, agent)
  console.log(`run_code：isError=${result.isError}，${preview(result.content, 80)}`)
  assert(!result.isError && result.content.includes('42'), 'run_code 执行失败')
}

// ── S4：workflow 脚本编排 ──────────────────────────────────────────────────
console.log('\n=== S4 workflow 脚本编排 ===')
{
  const tools = ctx.tools.schemas().map(schema => schema.name)
  console.log(`workflow 工具已注册：${tools.includes('workflow')}（在 SDK 声明里，不在顶层）`)
  assert(tools.includes('workflow'), 'workflow 工具未注册')
  // 脚本只用 phase/log/args 钩子，不 fan-out 子代理——离线可跑。
  // PTC 模式下 workflow 要从 run_code 程序内的 SDK 绑定调。
  const result = await callTool(ctx, 'run_code', {
    code: 'return await tools.workflow({ script: \'phase("compute"); log("adding two numbers"); return args.a + args.b\', meta: { name: "add-two-numbers", description: "演示 workflow 脚本钩子" }, args: { a: 20, b: 22 } })',
    description: '在程序内调 workflow',
  }, agent)
  console.log(`workflow：isError=${result.isError}，${preview(result.content.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'), 80)}`)
  assert(!result.isError && result.content.includes('42'), 'workflow 脚本执行失败')
}

// ── S5：schedule 定时任务 ──────────────────────────────────────────────────
console.log('\n=== S5 schedule 定时任务 ===')
{
  // 存储是 durable 的：上次运行残留的任务还在。先幂等清理，保证计数确定。
  for (const item of (await ctx.schedule.list()).items) {
    await ctx.schedule.edit({ id: item.id, action: 'delete' }, sid)
  }
  // 服务 API 直接驱动（不经工具面）：一小时后的一次性提醒，创建后立刻删除。
  // 目标选已存在的会话：默认 new_once 要 Host 能建会话（sessionController），
  // 本示例没挂那条缝。
  const entry = await ctx.schedule.create({
    title: '演示提醒',
    prompt: '检查演示状态',
    timing: { kind: 'after', after_seconds: 3600 },
    target: { kind: 'session', sessionId: sid },
  }, sid)
  console.log(`create：status=${entry.status}，title=${entry.title}`)
  assert(entry.status === 'active', '新建任务应当 active')

  const listed = await ctx.schedule.list()
  console.log(`list：total=${listed.total}`)
  assert(listed.total === 1, '应当恰好一个任务')

  // 工具面（schedule_create/list/edit）在 PTC 模式下从程序内调：
  // 注意工具面与服务 API 的参数形状不同——timing 换成 rrule（RFC 5545 子集），
  // target 换成枚举 this_session/new_once/new（tool-schedule/src/index.ts:375-383）。
  const viaTool = await callTool(ctx, 'run_code', {
    code: `const created = await tools.schedule_create({ title: "工具面提醒", prompt: "检查工具面", rrule: "DTSTART:20270101T000000Z\\nRRULE:FREQ=DAILY;COUNT=1", target: "this_session" });
const listed = await tools.schedule_list({});
const deleted = await tools.schedule_edit({ id: created.id, action: "delete" });
return { total: listed.total, deleted: deleted.deleted === true }`,
    description: '在程序内调 schedule 工具面',
  }, agent)
  console.log(`工具面 create/list/delete：isError=${viaTool.isError}，${preview(viaTool.content, 80)}`)
  assert(!viaTool.isError && /"total":\s*2/.test(viaTool.content) && /"deleted":\s*true/.test(viaTool.content), 'schedule 工具面执行失败')

  const deleted = await ctx.schedule.edit({ id: entry.id, action: 'delete' }, sid)
  console.log(`delete：deleted=${'deleted' in deleted ? deleted.deleted : '?'}`)
  assert('deleted' in deleted && deleted.deleted === true, '删除应当成功')
  const after = await ctx.schedule.list()
  console.log(`删除后 list：total=${after.total}`)
  assert(after.total === 0, '删除后应当没有任务')
}

await handle.dispose()
await ctx.fiber.dispose()
console.log('\nJOBS_OK')
```

`src/tools.ts` 全文（78 行，与
[dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/src/tools.ts) 逐字一致，
SHA256 相同）：

```ts
/**
 * tools.ts —— 单次工具调用的便利封装。
 *
 * 0.2.2 起 `ctx.tools.execute()` 的输入是一整批模型原始调用（ToolBatchInput，
 * calls 里是 ToolCallBlock，参数为 JSON 字符串），返回 ToolBatchResult。
 * 这里把"单次调用"这层封装固定下来，场景代码只关心一次调用的结果。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

/** 一次调用的精简结果。 */
export interface CalledTool {
  readonly isError: boolean
  readonly content: string
  /** 成功时的规范值（canonical JSON value）。 */
  readonly value: unknown
}

/** 把 content block 数组拼成一行文本。 */
export function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: { type?: string; text?: string }) => (block?.type === 'text' ? (block.text ?? '') : `[${block?.type ?? '?'}]`))
    .join(' ')
}

/**
 * 执行一个已注册的工具（不经过模型），返回原生 ToolExecutionResult。
 * 批接口要求 ToolCallBlock.arguments 是模型产出的 JSON 字符串——这是真实协议形状。
 */
export async function executeTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
): Promise<ToolExecutionResult> {
  const batch = await ctx.tools.execute({
    calls: [
      {
        type: 'tool-call',
        id: ToolCallId(`demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
        name,
        arguments: args === undefined ? '{}' : JSON.stringify(args),
      },
    ],
    ...(agent === undefined ? {} : { agent }),
    signal: new AbortController().signal,
  })
  const settled = batch.results[0]
  if (settled === undefined) throw new Error(`工具 ${name} 没有返回结果（批次为空）`)
  return settled.result
}

/** 调用一个已注册的工具并压成一行可打印结果。 */
export async function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: Agent,
): Promise<CalledTool> {
  const result = await executeTool(ctx, name, args, agent)
  const isError = result.isError === true
  return {
    isError,
    content: blocksToText(result.content),
    value: isError ? undefined : result.value,
  }
}

/** 截断到一行，便于日志。 */
export function preview(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + '…'
}
```

`runtime/run-bun.mjs` 全文（54 行，Bun 侧入口）：

```js
/**
 * run-bun.mjs —— `npm run start:bun` 的入口：用 Node 拉起 Bun，并注入 preload。
 *
 * 为什么需要这一层：subprocess-local 的 runner 是**孙进程**，命令行 --preload
 * 到不了那一层，只有 BUN_OPTIONS 环境变量会一路继承。所以在这里把
 * `--preload <bun-preload.mjs>` 写进 BUN_OPTIONS，再 spawn bun src/index.ts。
 *
 * 顺带清掉继承来的 NODE_OPTIONS / BUN_OPTIONS：机器上装了 tsx、或用户全局
 * 设了别的 preload 时，会让"本工程的运行环境"取决于外部状态。
 *
 * @module dsh-jobs-demo/runtime/run-bun
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRELOAD = fileURLToPath(new URL('./bun-preload.mjs', import.meta.url))
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))

/**
 * Bun 用 shell 风格切分 BUN_OPTIONS，但不认引号：反斜杠转义空格，
 * 路径统一正斜杠（Windows 上 Bun 同样接受）。
 */
function escapeBunOptionPath(path) {
  return path.replace(/\\/g, '/').replace(/ /g, '\\ ')
}

const env = { ...process.env }
delete env.NODE_OPTIONS
delete env.BUN_OPTIONS
env.BUN_OPTIONS = `--preload ${escapeBunOptionPath(PRELOAD)}`

// PATH 上没有可 spawn 的 bun 时的回退候选：npm 全局包（npm i -g bun，
// 版本新）优先于官方安装器默认位置 ~/.bun/bin（可能是旧版，缺
// node:util.getSystemErrorMessage 会让 subprocess-local 导入失败）。
const candidates = [
  // npm 全局根：Windows 在 %APPDATA%\npm，POSIX 在 node 安装目录的 ../lib。
  process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', 'bun', 'bin', 'bun.exe')
    : join(dirname(process.execPath), '..', 'lib', 'node_modules', 'bun', 'bin', 'bun'),
  join(homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun'),
]
const BUN = candidates.find(existsSync) ?? 'bun'

const child = spawn(BUN, [ENTRY], { env, stdio: 'inherit' })
child.on('error', (error) => {
  console.error(`无法启动 bun：${error.message}（需要 Bun >= 1.4.4 在 PATH 上）`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  process.exit(signal !== null ? 1 : code ?? 0)
})
```

runtime/ 其余四件是加载期补丁的实现体，合计约 515 行，不在此重复镜像，
结构说明 + 文件指针（每条缝的根因与修法见坑 1–5）：

- [runtime/bun-preload.mjs](runtime/bun-preload.mjs)（181 行）：五条缝的总入口。
  `Bun.plugin` 的 onLoad 按包名 filter 收得很窄（ptc-runtime-node 的 lib 全部
  js、workflow-ptc 的宿主 index.js、subprocess-local 的 runner 入口），字符串
  精确匹配替换，不匹配就原样返回并在 stderr 留警告——上游改了写法应当立刻
  被看见，而不是静默失效。缝 1 用 `DSH_SUBPROCESS_RUNNER` + 文件名双判定只在
  runner 入口补 `--`；缝 3 在宿主 spawn 锚点前注入 `env.BUN_OPTIONS`。
- [runtime/lib/bun-shim.mjs](runtime/lib/bun-shim.mjs)（171 行）：缝 2 的
  `node:module` 替身。`Bun.Transpiler` 实现 stripTypeScriptTypes，保留上游
  `slice(35, -2)` 依赖的 35 字节前缀/`\n}` 后缀；registerHooks 降级空壳
  `{ deregister() {} }`（代价见坑 2）。
- [runtime/lib/bun-control-channel.mjs](runtime/lib/bun-control-channel.mjs)
  （131 行）：缝 4 的 koffi 直调 kernel32 管道 Duplex——扫句柄、PeekNamedPipe
  确认恰好一根非 std 管道、overlapped ReadFile + manual-reset event 轮询。
- [runtime/lib/bun-guest-import.mjs](runtime/lib/bun-guest-import.mjs)
  （32 行）：缝 5 的 data URL 解码落盘（`.bun-guest-cache/<sha1>.mjs`）再 import。

按顺序验证：

```bash
# 1 安装依赖
npm install

# 2 Windows：给工程目录补 FullControl（坑 11，只需一次）

# 3 类型检查（0 错误）
npm run typecheck

# 4 Node 侧：末行 JOBS_OK
npm start

# 5 Bun 侧：除 runtime 行外与 Node 逐行一致，末行 JOBS_OK
npm run start:bun

# 6 再跑一遍 Node：schedule 幂等清理生效，计数断言仍全过
npm start
```

本示例不依赖任何环境变量、端口或外部服务：`DSH_HOME` 由代码自己指向工程内的
`.dsh-home`，不需要 API key，存储与缓存全部落在本工程目录里（已 gitignore）。

## 7 小结

这个示例验证了 4 件事：

1. **状态要落盘**——jobs 输出环、goal 会话日志、schedule 存储域，没有一样
   只活在 Promise 里；durable 残留用幂等清理消化。
2. **传输面与能力面分层**——run_code 是执行器拥有的顶层入口，其他工具从
   程序内 `tools.*` 绑定调；顶层直调被大声拒绝。
3. **续跑由 armed 开关控制**——armed/disarmed 决定 round-driver 是否接管，
   离线演示必须 disarm；revision 乐观锁贯穿 goal 的每次相位迁移。
4. **Bun 的五条缝可以在加载期修完**——runner 分隔符、node:module 导出、
   worker env 白名单、fd 控制通道、data URL 误判，全部由本工程自带的
   runtime/ 迷你层修补，未动 node_modules，双运行时输出逐行一致。

兄弟示例：[dsh-sandbox-demo](../dsh-sandbox-demo/README.md)（run_code 脚下的
边界栈）、[dsh-subagent-demo](../dsh-subagent-demo/README.md)（workflow fan-out
的宿主与深度预算）、[dsh-session-demo](../dsh-session-demo/README.md)（goal 与
schedule 落脚的会话日志）。