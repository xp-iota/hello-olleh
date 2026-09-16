# 第 07 课 · 执行侧后端：I/O、进程与沙箱边界

> **本课任务**：写出两个**会改外部世界**的工具（写文件、跑子进程），它们不碰 `node:fs` /
> `node:child_process`，只消费 `ctx.fs` / `ctx.subprocess`；再用取消、超时、沙箱包装与
> fail-closed 四条通路把"这次执行被允许碰什么"钉死。
> **运行命令**：`cd dsh-example && npm run M07`
> **你将看到**：文件真的落盘又真的没被第二次写；取消产出 `ABORTED_BEFORE_DISPATCH` 和
> `ABORTED` 两个不同 code；`kill()` 对已结束进程返回 `false`；沙箱包装出 argv 或在强制不了时抛错。

前置：[第 01 课 · 工具管线](01-tool-pipeline.md)。本课所有输出都来自真实运行，不是示意。

---

## 1. 本课任务

第 01 课的工具是**纯计算**：不接触外部世界，错了重算一次就行。这一课的工具是**副作用**：
写文件、起进程。副作用带来三个必须分开回答的问题，也就是本课的三个层：

| 层 | 回答的问题 | 本课对应实现 |
|---|---|---|
| **工具的 I/O 意图** | 要写哪个文件、跑哪条命令？ | [`impl/01-fs-shell-side-effects.ts`](../M07-execution-backends/impl/01-fs-shell-side-effects.ts) |
| **执行 seam 选后端** | 这次 I/O 交给哪个执行世界（本地 / 沙箱 / 远端）？ | `ctx.fs`、`ctx.subprocess`、`ctx.shell`、`ctx.sandbox` |
| **沙箱把策略变成过程边界** | 这次 spawn 到底允许碰什么？ | [`impl/03-sandbox-seam.ts`](../M07-execution-backends/impl/03-sandbox-seam.ts) 的 `confine` |

核心直觉一句话：**工具只表达意图，不决定在哪执行**。工具代码里没有一行 `node:fs`，
所以同一份代码换个后端就自动落进沙箱或远端；取消、审计、超时也都由 seam 统一提供，
不需要每个工具自己实现一遍。

```bash
cd dsh-example && npm run M07
```

---

## 2. 真实输出

```text
████ M07 · 执行侧后端：I/O、进程与沙箱边界 ████
provider=anthropic-compat model=fuyao-coding timeout=120000ms

──── M07.1 · 通过 fs/subprocess seam 执行副作用 ────
① 已注册模型可见工具: [ 'write_note', 'run_cmd' ]
   seam 后端: LocalFileSystem / LocalSubprocessRuntime

----- ② write_note：经 ctx.fs seam 真实写盘 -----
    isError=false, 成功 | render: 已写入 /tmp/dsh-example-16-1789536735896.txt（53 字节）

----- ③ 用同一个 seam 读回，验证真的落盘 -----
   读回内容: "hello from the fs seam\n第二行：中文也没问题"

----- ④ run_cmd：经 ctx.subprocess seam 真跑一条命令 -----
    isError=false, 成功 | value: {"exitCode":0,"stdout":"stdout from child: 2\n","stderr":""}

----- ⑤ 派发前取消：注册表短路，工具主体根本不执行 -----
    isError=true, code=ABORTED_BEFORE_DISPATCH
    render: Error: tool call aborted before dispatch
    文件内容仍是: "hello from the fs seam\n第二行：中文也没问题"
    注意 code = ABORTED_BEFORE_DISPATCH：impl/01-fs-shell-side-effects.ts 里那句 `signal.aborted` 守卫
    在这条路径上是够不着的 —— 注册表在调用工具主体之前就已经返回了。

----- ⑤b 派发后取消：主体已启动，被中止并收敛（code 不同） -----
    isError=true, code=ABORTED
    耗时: 315 ms（子进程本身要跑 5000ms）
    子进程被提前掐掉了，而不是等它自然跑完。

⑥ 清理：演示文件已删除 = /tmp/dsh-example-16-1789536735896.txt
REAL_STAGE_OK M07.1 calls=1 ms=720 in=0 out=77 finish=stop

──── M07.2 · 消费 shell 的 run/start 双形态 ────
[shell-service] shell seam 可用: LocalBashExecutor | sandboxMode = (未装沙箱)

① resolve：补默认值并夹紧上限（请求 999_999ms）
   spec = {"command":"echo hello-shell","workdir":"/home/hanl5/coding/hello-olleh/dsh-example","timeoutMs":600000,"stdoutMaxBytes":64000}

② run：正常退出（resolve 出结果，非 reject）
   exitCode = 0 | stdout = "hello-shell" | truncated = false

③ run：非零退出同样 resolve（不 reject）
   exitCode = 42 | stderr = "oops"

④ run：超时杀 → timedOut: true（依然 resolve，不 reject）
   exitCode = null | timedOut = true | aborted = false | signal = SIGTERM

⑤ start：后台句柄立即返回；readOutput 增量读 { delta, lossy }；done 是 Promise<void> 且永不 reject
   status = running （立即返回，进程还在跑）
   第一次读: "line1\n"
   done settle 后: status = completed | exitCode = 0
   第二次读（只剩增量）: "line2\n"

⑥ kill 幂等：对已结束的进程再 kill
   kill() → false | 再 kill() → false
REAL_STAGE_OK M07.2 calls=1 ms=826 in=0 out=110 finish=stop

──── M07.3 · 用 sandbox provider 强制策略 ────
[sandbox] 已装载 WrapSandbox（enforcement=full）
① 调用方给出的策略: {"mode":"workspace-write","workspaceRoot":"/home/hanl5/coding/hello-olleh/dsh-example"}

② confine：把调用者 argv 包装成受约束的 argv（argv 是程序+参数，不是 shell 字符串）
   包装后 argv : ["demo-sandbox-exec","--mode=workspace-write","--allow-write=/home/hanl5/coding/hello-olleh/dsh-example","--allow-write=/tmp","--","bash","-c","echo hi"]
   强制力      : full
   拒绝签名    : ["[sandbox: file access denied under workspace-write mode]"]

③ 一个 context 只能有一个实现：重复装载同一 seam 直接抛错
   service "sandbox" has been registered at <WrapSandbox>

④ 换后端要先卸掉旧的（effect-based：dispose 即还原）
   卸掉 WrapSandbox → ctx.sandbox = undefined
   装上 RefuseSandbox → ctx.sandbox = RefuseSandbox

⑤ fail-closed：强制不了的模式抛 SandboxUnavailableError，绝不静默放行
   workspace-write → sandbox mode "workspace-write" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. Install bubblewrap or run a Landlock-enforcing kernel (Linux), ensure sandbox-exec is usable (macOS), or ensure the ACL restricted-token runner can start (Windows) — otherwise switch the consumer to danger-full-access. Runner failure: 本后端只会 read-only
   read-only 仍给出可执行的包装: ["demo-sandbox-exec","--mode=read-only","--","ls"]

⑥ 最后卸掉 RefuseSandbox → seam 回到未装
   ctx.sandbox = undefined
REAL_STAGE_OK M07.3 calls=1 ms=1221 in=0 out=49 finish=stop

──── M07.4 · 观察 terminal backend 注册边界 ────
terminals: {
  backends: [],
  rejection: { name: 'TerminalError', code: 'NO_BACKEND' },
  nativeBackendSkipped: 'npm install scripts were not approved'
}
REAL_STAGE_OK M07.4 calls=1 ms=1466 in=0 out=71 finish=stop

──── M07.5 · 解析共享 sandbox policy ────
sandboxPolicy: {
  default: 'read-only',
  sessionOverride: 'workspace-write',
  workspaceRoot: '/home/hanl5/coding/hello-olleh/dsh-example'
}
REAL_STAGE_OK M07.5 calls=1 ms=661 in=0 out=95 finish=stop

REAL_MODULE_OK M07 stages=5 calls=5 failed=0
```

**对照自己的输出**：末行必须精确是 `REAL_MODULE_OK M07 stages=5 calls=5 failed=0`。
再核三行关键信号：① 的 `seam 后端: LocalFileSystem / LocalSubprocessRuntime`（本地后端真的装上了）、
⑤ 的 `code=ABORTED_BEFORE_DISPATCH`（与 ⑤b 的 `code=ABORTED` 成对出现）、
⑥ 的 `kill() → false | 再 kill() → false`。输出里的绝对路径与毫秒数随机器/时刻不同，
但 ⑤b 那行的 `耗时:` 一定远小于 5000ms，否则说明取消根本没生效。

---

## 3. 工具的 I/O 意图：只写 `ctx.fs`，不写 `node:fs`

打开 [`impl/01-fs-shell-side-effects.ts`](../M07-execution-backends/impl/01-fs-shell-side-effects.ts)。
文件顶部是 `node:fs` 一行都没有的——连 `import` 都不需要，因为工具拿不到、也不该拿到它。

声明依赖，让 `apply` 运行时三个 seam 一定已就位：

```ts
// `name` 是插件/Fiber 名称；它和下方注册的工具名没有关系。
export const name = 'fs-shell-side-effects'
export const inject = ['tools', 'fs', 'subprocess']
```

写文件的工具，全部 I/O 都把 `exec.signal` 透传下去：

```ts
async execute(args, exec) {
  if (exec.signal.aborted) throw new Error('aborted before dispatch')
  const target = await ctx.fs.resolve(args.path, { cwd: cwdOf(exec), signal: exec.signal })
  await ctx.fs.writeText(target, args.content, undefined, exec.signal)
  const bytes = new TextEncoder().encode(args.content).length
  return { path: ctx.fs.processPath(target), bytes }
}
```

跑命令的工具，注意 `spawn` 的 spec 是**完整**的——seam 不替调用方猜默认值：

```ts
const handle = ctx.subprocess.spawn({
  argv: args.argv,
  cwd: cwdOf(exec),
  // 显式的输出收集策略：seam 不替调用方猜上限。
  stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
  graceMs: 2000,
  signal: exec.signal,
})
const outcome = await handle.done
```

第 2 节的 ②③④ 三行就是这条 seam 的实证：

```text
② render: 已写入 /tmp/dsh-example-16-1789536735896.txt（53 字节）   ← 写盘
③ 读回内容: "hello from the fs seam\n第二行：中文也没问题"           ← 用同一个 seam 读回，证明真落盘
④ value: {"exitCode":0,"stdout":"stdout from child: 2\n","stderr":""}  ← 子进程真跑了，退出码是事实
```

**为什么值得这么写**：`ctx.fs` / `ctx.subprocess` 是两个最底层的 seam，上层 Bash、PTY、LSP
全都建在它们之上。换掉这两个 provider，整条执行链跟着换世界——这也是
[03 § 能力 seam 与服务](../../docs/hello-dsh/03-capability-seams-and-services.md) 里 "no provider forks" 的兑现处。
契约细节见 [08 § 8.10](../../docs/hello-dsh/08-execution-services.md)。

---

## 4. 取消的两条路径：`isError` 单独看会骗人

这是本课最容易被误读的一节。打开 [`scenes/01-write-and-run.ts`](../M07-execution-backends/scenes/01-write-and-run.ts)，
它把结局打印成 `outcome(...)`，而 `outcome` 刻意不只打印 `isError`：

```ts
const outcome = (result: ToolExecutionResult) =>
  result.isError ? `isError=true, code=${result.error.info?.code ?? '(无)'}` : 'isError=false, 成功'
```

| 时机 | code | 发生了什么 |
|---|---|---|
| **派发前**就 abort | `ABORTED_BEFORE_DISPATCH` | 注册表短路，**工具主体根本没执行**；工具里那句 `signal.aborted` 守卫够不着 |
| **派发后**才 abort | `ABORTED` | 主体已启动，被中止并收敛 |

两条路径都是 `isError: true`。**这个标志的含义是"本次调用没产出 value"，不是"操作失败了"**。
真正区分二者的是 `error.info.code`：

```text
⑤ 派发前取消
   isError=true, code=ABORTED_BEFORE_DISPATCH
   render: Error: tool call aborted before dispatch
   文件内容仍是: "hello from the fs seam\n第二行：中文也没问题"
⑤b 派发后取消
   isError=true, code=ABORTED
   耗时: 315 ms（子进程本身要跑 5000ms）
```

⑤ 的**决定性证据是"文件内容没变"**：取消确实拦住了副作用，而不是"跑完再报失败"。
如果工具主体真的执行过，文件里会是 `should never be written`。这条证据把"取消"和"失败"
在因果上分开了——失败意味着副作用可能已经发生一半。

⑤b 则说明取消是**真的把子进程掐掉了**：脚本安排的是 5000ms 后打印，实际 315ms 就返回。
`setTimeout(() => midway.abort(), 300)` 那句注释也点明了为什么必须走 `ctx.tools.execute`：
`harness.callTool` 固定用自己的 signal。

> 工具内那句 `if (exec.signal.aborted) throw new Error('aborted before dispatch')` 是**兜底**，
> 兜的是"派发之后、I/O 开始之前"那一小段窗口，不是主路径。

---

## 5. shell：`run` 永不 reject，`start` 返回句柄

打开 [`impl/02-shell-service.ts`](../M07-execution-backends/impl/02-shell-service.ts)——它**没有注册任何行为**，
只消费服务，用来演示"seam 也可以只消费"：

```ts
export const name = 'shell-service'
export const inject = ['shell']

export function apply(ctx: Context) {
  console.log('[shell-service] shell seam 可用:', ctx.shell.constructor.name, '| sandboxMode =', ctx.shell.sandboxMode ?? '(未装沙箱)')
}
```

### `resolve` 补默认值并夹紧上限

打开 [`scenes/02-run-and-start.ts`](../M07-execution-backends/scenes/02-run-and-start.ts)：
`run`/`start` **只收 resolved spec**，不收原始 request，默认值和上限由实现自己填。

```ts
const spec = shell.resolve({ command: 'echo hello-shell', timeoutMs: 999_999 })
```

请求 999999ms，输出里是 `timeoutMs":600000`——**上限由实现夹紧**，同时补上了
`workdir` 与 `stdoutMaxBytes:64000` 两个默认值：

```text
spec = {"command":"echo hello-shell","workdir":"...","timeoutMs":600000,"stdoutMaxBytes":64000}
```

### `run`：三种"失败"都 resolve

契约是：**非零退出、超时杀、取消都 resolve 出 `ShellRunResult`，只有基础设施失败才 reject**。

```ts
const ok  = await shell.run(shell.resolve({ command: 'echo hello-shell' }))
const bad = await shell.run(shell.resolve({ command: 'echo oops >&2; exit 42' }))
const slow = await shell.run(shell.resolve({ command: 'sleep 5', timeoutMs: 100 }))
```

```text
② exitCode = 0  | stdout = "hello-shell" | truncated = false
③ exitCode = 42 | stderr = "oops"
④ exitCode = null | timedOut = true | aborted = false | signal = SIGTERM
```

三个细节值得记住：

- `stdout`/`stderr` 是 `CollectedOutput`（`{ text, truncated }`），**不是裸字符串**——输出可能被上限截断，
  所以 `②` 行单独打印了 `truncated = false`。
- `timedOut` 与 `aborted` **互斥**：同一个 deadline 只会有一个"第一因"。
- 超时结果是 `exitCode = null` + `signal = SIGTERM`：它是被信号杀掉的，不是自己退出的。

### `start`：句柄、三态、增量读、幂等 kill

```ts
const proc = shell.start(shell.resolve({ command: 'echo line1; sleep 0.2; echo line2' }))
console.log('   status =', proc.status, '（立即返回，进程还在跑）')
await harness.ctx.timeout(100)
console.log('   第一次读:', JSON.stringify(proc.readOutput().delta))
await proc.done // done 只等关闭；退出事实落在句柄字段上
console.log('   done settle 后: status =', proc.status, '| exitCode =', proc.exitCode)
console.log('   第二次读（只剩增量）:', JSON.stringify(proc.readOutput().delta))
```

```text
status = running （立即返回，进程还在跑）
第一次读: "line1\n"
done settle 后: status = completed | exitCode = 0
第二次读（只剩增量）: "line2\n"
```

四点分工要分清：

| 字段 | 性质 |
|---|---|
| `status` | 三态 `running` / `completed` / `killed` |
| `done` | `Promise<void>`，**永不 reject**；退出事实落在句柄字段上 |
| `readOutput()` | **增量**：连续读不重复投递，返回 `{ delta, lossy }` |
| `kill()` | **幂等**，返回 boolean |

幂等在输出里看得最清楚——对已经结束的进程再 kill 两次都是 `false`：

```text
kill() → false | 再 kill() → false
```

`done` 永不 reject 更值得记：spawn 失败会以 `killed` 状态 + stderr 上的错误收敛，
而不是把异常抛给 `await proc.done` 的调用方。这样调用方只有一条收尾路径，不用 try/catch 两头写法。

> 三层分工见 [08 § 8.9](../../docs/hello-dsh/08-execution-services.md)，
> `SubprocessRuntime` / `ShellExecutor` 的抽象方法见 § 8.10、§ 8.11。

---

## 6. sandbox：要么可强制执行，要么 fail-closed

打开 [`impl/03-sandbox-seam.ts`](../M07-execution-backends/impl/03-sandbox-seam.ts)。`confine(argv, policy)`
**只有两种合法结局**：返回可强制执行的 argv，或抛 `SandboxUnavailableError`。
**禁止静默放行未加约束的命令**——返回原 argv 才是真正危险的选项。

先看"能强制"的那一端：

```ts
confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
  // writableRoots 是真实包导出的策略助手：把 policy 展开成允许写入的规范化根列表。
  const roots = writableRoots(policy)
  return {
    argv: ['demo-sandbox-exec', `--mode=${policy.mode}`, ...roots.map((root) => `--allow-write=${root}`), '--', ...argv],
    enforcement: 'full',
    // 调用方靠这些签名把"沙箱拒绝"和"程序自己失败"分开。
    denialSignatures: [sandboxDenialMarker(policy.mode)],
    runnerFailureRules: [{ fatalSignatures: ['demo-sandbox-exec: cannot start'] }],
  }
}
```

输出里的 ② 行就是它的展开结果：

```text
② 包装后 argv : ["demo-sandbox-exec","--mode=workspace-write","--allow-write=...","--allow-write=/tmp","--","bash","-c","echo hi"]
   强制力      : full
   拒绝签名    : ["[sandbox: file access denied under workspace-write mode]"]
```

四个设计点全在这一段里：

1. **`argv` 是程序 + 参数数组，不是 shell 字符串**。场景传的就是 `['bash','-c','echo hi']`
   （`scenes/03` 第 19 行）——shell 形态的调用方自己负责拼 `['bash','-c',command]`。
2. **策略由调用方给**，没有 `ctx.sandboxPolicy` 这样的服务在 `confine` 里读。
   `SandboxPolicy` 把 mode 收窄成可约束的两档（`read-only` / `workspace-write`）；
   `danger-full-access` **在类型层面就进不了 `confine()`**，因为它根本不需要沙箱。
3. **`denialSignatures`**：调用方怎么识别"是沙箱拒的"（EPERM/EACCES 长得都一样）。
4. **`runnerFailureRules`**：怎么区分 runner 自身失败 vs 被约束程序失败。

再看"强制不了"的那一端——`RefuseSandbox` 只支持 `read-only`：

```ts
confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
  if (policy.mode === 'read-only') {
    return { argv: ['demo-sandbox-exec', '--mode=read-only', '--', ...argv], enforcement: 'full', ... }
  }
  // fail-closed：强制不了就抛 SandboxUnavailableError。返回未加约束的 argv 才是真正危险的选项。
  throw new SandboxUnavailableError(policy.mode, '本后端只会 read-only')
}
```

```text
⑤ workspace-write → sandbox mode "workspace-write" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. ... Runner failure: 本后端只会 read-only
   read-only 仍给出可执行的包装: ["demo-sandbox-exec","--mode=read-only","--","ls"]
```

注意那两行的对比：**同一个后端，`workspace-write` 抛错、`read-only` 照常给包装**。
fail-closed 是"这个模式我强制不了"的具体判断，不是"整个沙箱服务坏了"。
这条铁律的抽象契约见 [08 § 8.18](../../docs/hello-dsh/08-execution-services.md) 与 § 8.23。

---

## 7. 注册边界：一个 context 只留一个实现

seam 是**服务**，不是配置项。`SandboxProvider` 在 `super(ctx)` 里把服务名钉成 `sandbox`，
构造即挂载（effect-based），不存在 `ctx.provide('sandbox', impl)` 这种写法。

于是**同一个 context 里塞第二个实现会直接抛错**：

```text
③ service "sandbox" has been registered at <WrapSandbox>
```

换后端的唯一正确姿势是**先卸旧的**——dispose 即还原：

```ts
await wrapFiber.dispose()
console.log('   卸掉 WrapSandbox → ctx.sandbox =', ctx.sandbox)
const refuseFiber = await harness.loadPlugin(plugin.RefuseSandbox)
console.log('   装上 RefuseSandbox → ctx.sandbox =', ctx.sandbox.constructor.name)
```

```text
④ 卸掉 WrapSandbox → ctx.sandbox = undefined
   装上 RefuseSandbox → ctx.sandbox = RefuseSandbox
⑥ 最后卸掉 RefuseSandbox → ctx.sandbox = undefined
```

`undefined` 说明卸干净了，不是留一个半死的旧实例。这条规则和第 01 课
`tools.register` 的 fiber 归属是同一条原则：**服务的一生挂在 fiber 上**。

### 同一原则在 `terminals` 上的体现

打开 [`scenes/04-terminal-backend-guard.ts`](../M07-execution-backends/scenes/04-terminal-backend-guard.ts)。
`terminals` 是 owner-scoped 的 PTY registry；**没注册 backend 时它不返回半死会话，
而是以稳定的 `NO_BACKEND` 失败**：

```text
terminals: {
  backends: [],
  rejection: { name: 'TerminalError', code: 'NO_BACKEND' },
  nativeBackendSkipped: 'npm install scripts were not approved'
}
```

第三行是本示例的边界声明：默认教学路径**不启动需要 native 安装脚本的 PTY**，
所以 `backends` 是空的。这正是本节想教的形状——**能力缺席时给出稳定错误码，而不是假装可用**。

### `sandboxPolicy`：默认 + 会话覆盖 + 显式授权

打开 [`scenes/05-merge-session-policy.ts`](../M07-execution-backends/scenes/05-merge-session-policy.ts)：

```ts
await harness.loadPlugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: process.cwd() })
const before = harness.ctx.sandboxPolicy.resolve({ session: harness.agent.session })
setSandboxMode(harness.agent.session, 'workspace-write')
const after = harness.ctx.sandboxPolicy.resolve({ session: harness.agent.session })
```

```text
sandboxPolicy: {
  default: 'read-only',
  sessionOverride: 'workspace-write',
  workspaceRoot: '...'
}
```

部署默认是 `read-only`，**会话日志里的覆盖**把它抬到 `workspace-write`。
`resolve()` 的输入是 `{ session }`——也就是说策略是**按调用**合成的，
而不是在服务构造时定死的一个全局值。

---

## 8. 排障：想换更严的沙箱，程序却抛 registered

### 症状

你写了一个更严的 `SandboxProvider`，直接 `await harness.loadPlugin(MyStrictSandbox)`，
程序立刻抛错退出：

```text
service "sandbox" has been registered at <WrapSandbox>
```

### 定位

1. 先确认这是**装载期**抛错还是 `confine()` 抛错——两者的诊断名字完全不同：
   装不上是 `service "..." has been registered at <...>`，强制不了是 `SandboxUnavailableError`。
2. 再检查在这个 context 的生命周期里，`ctx.sandbox` 是否已经指向某个实例
   （`console.log(ctx.sandbox?.constructor.name)`）。

### 原因与修改

**一个 context 只持有一个 seam 实现**，第二个注册被拒绝——这是 [第 01 课](01-tool-pipeline.md)
那条 effect 归属原则在服务侧的同一张脸。修法是显式换装：

```ts
const wrapFiber = await harness.loadPlugin(plugin)     // 旧后端
await wrapFiber.dispose()                              // 必须先卸
const strictFiber = await harness.loadPlugin(MyStrictSandbox)
```

`dispose()` 返回后 `ctx.sandbox` 会回到上一个状态（本示例里没有更早的实现，所以是 `undefined`）。
注意这与 `confine()` 的 fail-closed 是**两个不同层面**的失败：前者是"装不上"，
后者是"装上了但这个模式强制不了"。排障时先分清是哪一层，能省掉一半时间。

---

## 9. 代码在哪

```bash
cd dsh-example && ls M07-execution-backends/impl M07-execution-backends/scenes
```

| 文件 | 看哪几处 |
|---|---|
| [`impl/01-fs-shell-side-effects.ts`](../M07-execution-backends/impl/01-fs-shell-side-effects.ts) | `inject = ['tools','fs','subprocess']`；`ctx.fs.resolve/writeText/processPath`；`spawn` 的完整 spec |
| [`impl/02-shell-service.ts`](../M07-execution-backends/impl/02-shell-service.ts) | 只消费不注册的 seam 形状；`sandboxMode` 探测 |
| [`impl/03-sandbox-seam.ts`](../M07-execution-backends/impl/03-sandbox-seam.ts) | `WrapSandbox.confine` 的四段返回；`RefuseSandbox` 的 fail-closed 抛错 |
| [`impl/04-terminal-sessions.ts`](../M07-execution-backends/impl/04-terminal-sessions.ts) | 三行 re-export：服务与 backend 是两个包 |
| [`impl/05-sandbox-policy.ts`](../M07-execution-backends/impl/05-sandbox-policy.ts) | `setSandboxMode` / `SANDBOX_MODES` 的导出面 |
| [`scenes/01-write-and-run.ts`](../M07-execution-backends/scenes/01-write-and-run.ts) | `outcome()` 为什么要打印 code；⑤ 的"文件内容没变"证据 |
| [`scenes/03-confine-and-fail-closed.ts`](../M07-execution-backends/scenes/03-confine-and-fail-closed.ts) | 重复装载的 catch；dispose → 换装 → fail-closed 的完整顺序 |

读法：**先读 scene 看它怎么"演"，再读 impl 看它怎么"实现"**。

---

## 10. 动手练习

### 练习 A：把 fail-closed 改成静默放行，看会发生什么

打开 [`impl/03-sandbox-seam.ts`](../M07-execution-backends/impl/03-sandbox-seam.ts)，把 `RefuseSandbox.confine`
里那个 `throw` 换成返回未加约束的 `argv`（即 `{ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }`）。

**验证命令**

```bash
cd dsh-example && node M07-execution-backends/scenes/03-confine-and-fail-closed.ts
```

**可验证答案**：第 ⑤ 段那行 `workspace-write → sandbox mode ...` 消失，代之以 `竟然放行了?!`
（scene 里那个 try 分支的兜底打印）。这说明**fail-closed 是后端作者写下的纪律，不是类型系统替你挡住的**——
`confine` 的签名允许你返回任何 argv，唯一阻止静默放行的就是你自己不写那一行。

### 练习 B：验证两条取消路径的 code 不同

打开 [`scenes/01-write-and-run.ts`](../M07-execution-backends/scenes/01-write-and-run.ts) 的 ⑤ 段，
把 `aborted.abort()` 那一行注释掉（于是 signal 从未 abort）。

**验证命令**

```bash
cd dsh-example && node M07-execution-backends/scenes/01-write-and-run.ts
```

**可验证答案**：⑤ 变成 `isError=false, 成功`，紧接着那行 `文件内容仍是:` 打印出
`should never be written`——因为这次工具主体真的执行了。反向验证：恢复 `abort()` 后文件内容不变。
⑤b 那段不受影响，仍是 `code=ABORTED`、耗时几百毫秒。

### 练习 C（进阶）：确认 `resolve` 的上限是"夹紧"而不是"报错"

把 [`scenes/02-run-and-start.ts`](../M07-execution-backends/scenes/02-run-and-start.ts) 第 14 行的
`timeoutMs: 999_999` 改成 `timeoutMs: 5_000_000`，再跑：

```bash
cd dsh-example && node M07-execution-backends/scenes/02-run-and-start.ts
```

**可验证答案**：① 行的 `timeoutMs` 仍然是 `600000`——**超限不报错，而是被夹到实现的上限**。
同时 `stdoutMaxBytes` 仍是 `64000`，因为请求里根本没给这个字段，它来自实现的默认值：
`resolve()` 的职责就是"补齐默认 + 夹紧上限"，一次做完。

---

**下一课** → [第 08 课 · 委派与预设](08-delegation-presets.md)：注册表里有子代理，不代表模型看得见它。
