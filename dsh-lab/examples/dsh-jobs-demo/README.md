# dsh-jobs-demo —— 长期运行的工作：后台任务、目标、PTC、workflow、schedule

> 配套文章：[09 § 9.20–9.23](../../../docs/hello-dsh/09-host-runtime-and-storage.md)
> （五种「多步推进」机制）与 [08](../../../docs/hello-dsh/08-execution-services.md)（goal 组）。
> 本工程完全独立：整目录拷走，`npm install` 后 `npm start`（Node）或
> `npm run start:bun`（Bun）即可运行，不需要 API key——jobs/goal/schedule 直接
> 驱动服务 API，run_code/workflow 用 `callTool` 走真实工具管线，不跑模型 turn。

## 1. 问题

一个 turn 结束了，它启动的东西怎么办？dsh 对「活得比 turn 久的东西」给出五种
机制，职责清晰不同：

| 机制 | 服务/包 | 回答的问题 |
|:-----|:--------|:-----------|
| 后台任务 | `jobs-local` + `tool-jobs` | 长命令的输出放哪、怎么按游标读、怎么取消？ |
| 目标 | `goal` + `goal-round-driver` + `tool-goal` + `command-goal` | 同会话的长期目标怎么落日志、怎么驱动自动续跑？ |
| 程序传输面 | `tool-executor-ptc` + `ptc-runtime-node` | 模型写的代码在哪个进程、什么边界里执行？ |
| 工作流 | `workflow-ptc` + `tool-workflow` + `subagent` | 多步脚本怎么编排 phase/log/args、怎么 fan-out 子代理？ |
| 定时 | `schedule` + `tool-schedule` | 到点把一条 prompt 送进会话，重启后还在吗？ |

关键认识：这五样东西都走「**注册 + 持久化 + 可观测**」——状态落在会话日志或
存储域里，而不是只活在某个 Promise 里。按位置分：Jobs 与 Schedule 在 turn 之外，
Goal 在 turn 之内；本示例全部离线驱动，不烧一个 token。

## 2. 装配树

九行 base（执行器用 **tool-executor-ptc 替换 native**——`run_code` 只在 PTC
执行器下暴露）+ 二十五行功能栈，共 34 行。依赖链：`ptc-runtime-node` 注入
`fs + subprocess + sandbox + sandboxPolicy`；`workflow-ptc` 注入
`subagents + ptcRuntime + sandboxPolicy + workingDirectory`；`schedule` 注入
`agents + sessions + storageDomain + sessionPersistence`；`goal-round-driver`
注入 `agents + goals + sessions`。完整 `cordis.patch.yml`：

```yaml
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

`cordis.yml` 留空（`[]`）：装配全部来自 patch，见 [dsh-boot-demo](../dsh-boot-demo/README.md)。

## 3. 实测输出

`npm start`（Node v26.12.1，Windows，工作目录即本工程目录）：

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
（`Compare-Object` 实测 34 行全同），同样以 `JOBS_OK` 收尾。`npm run typecheck`
0 错误。尾部 `…` 是 `preview()` 的 80 字符截断；`<id>`/`<uuid>` 是随机标识符的
规范化占位；`File sandbox enforcement is partial on this host.` 是 Windows 上
fs-sandbox 附加的能力警告，不是错误。

## 4. 逐场景机制

**S1 后台任务与输出环。** `JobSpec` 没有「command 字符串」字段：producer 自己在
`run(job)` 里 `job.append(chunk, { channel })` 推输出，registry 只负责有界环缓冲、
生命周期事件和按游标读取。`read(id, sid)` 每读一次游标推进一次，重复读为空。
`JobHooks` 两项都必需：`cancel` 同步幂等，`done` 必须不 reject。`kill` 返回
`'requested'`——它只是请求，真正收尾靠 producer 的 cancel 钩子把 done resolve
成 `{ status: 'killed' }`，所以演示里轮询等状态落定。

```ts
const id = ctx.jobs.start({
  kind: 'bash', label: 'S1 演示任务', owner: sid,
  run(job) {
    job.append('第一行输出\n', { channel: 'stdout' })
    job.append('第二行输出\n', { channel: 'stdout' })
    return { cancel: () => {}, done: Promise.resolve({ status: 'completed', detail: 'S1 完成' }) }
  },
})
```

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

## 5. 坑（全部实测）

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

## 6. 从零复现

目录结构（node_modules、.dsh-home、.bun-guest-cache 除外）：

```text
dsh-jobs-demo/
├── cordis.yml              # []，装配全在 patch
├── cordis.patch.yml        # 34 行树（上文全文）
├── package.json            # 41 个依赖，版本见下
├── tsconfig.json
├── src/
│   ├── index.ts            # 五场景，约 235 行
│   └── tools.ts            # callTool/preview 封装（与 tool-pipeline-demo 同源）
├── runtime/
│   ├── run-bun.mjs         # Node 拉 Bun + BUN_OPTIONS 注入 + 版本回退候选
│   ├── bun-preload.mjs     # 五条缝的总入口（加载期锚点补丁）
│   └── lib/
│       ├── bun-shim.mjs            # 缝 2：node:module 导出（Bun.Transpiler）
│       ├── bun-control-channel.mjs # 缝 4：koffi 管道 Duplex
│       └── bun-guest-import.mjs    # 缝 5：data URL 落盘导入
└── README.md
```

版本面：`@deepseek-ai/*` 全部 **0.2.2-rc.3**（npm `next` 通道，与
`sources/deepseek-harness` 快照同版）；peer `@deepseek-ai/cordis` **4.1.0**；
`cordis-plugin-timer` 1.2.0、loader/include/group 1.1.0；
devDeps `typescript` 5.9.3 + `@types/node` 22.10.2。
运行时：Node ≥ 22.18（实测 v26.12.1）、Bun ≥ 1.4.4（实测 1.4.4）。

```bash
npm install
# Windows：先按坑 11 给工程目录补 FullControl（只需一次）
npm start          # Node
npm run start:bun  # Bun
npm run typecheck
```

## 7. 小结

长期运行的教学点浓缩成三句：**状态要落盘**（jobs 输出环、goal 会话日志、
schedule 存储域——没有一样只活在 Promise 里）；**传输面与能力面分层**
（run_code 是执行器拥有的顶层入口，其他工具从程序内 `tools.*` 绑定调）；
**续跑是武装出来的**（armed/disarmed 决定 round-driver 是否接管，离线演示
必须 disarm）。Bun 侧的五条缝（runner 分隔符、node:module 导出、worker env
白名单、fd 控制通道、data URL 误判）全部由本工程自带的 runtime/ 迷你层在
加载期修补，未动 node_modules，双运行时输出逐行一致。

兄弟示例：[dsh-sandbox-demo](../dsh-sandbox-demo/README.md)（run_code 脚下的
边界栈）、[dsh-subagent-demo](../dsh-subagent-demo/README.md)（workflow fan-out
的宿主与深度预算）、[dsh-session-demo](../dsh-session-demo/README.md)（goal 与
schedule 落脚的会话日志）。