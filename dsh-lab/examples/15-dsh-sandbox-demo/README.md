# 15 · dsh 的执行边界示例

本示例演示 dsh 的执行边界栈：沙箱化文件读写、一次性 shell 命令、沙箱模式、
观察策略（写前必须先读）、/permission 权限预设。24 个服务全部在
cordis.patch.yml 里声明，boot 后全程在位，代码里没有一处 ctx.plugin()。
版本面：`@deepseek-ai/*` 0.2.2-rc.5 + `@deepseek-ai/cordis` 4.1.0；
Node v26.12.1 与 Bun 1.4.4 双运行时实测，输出除 runtime 行外逐行一致。

> 配套文章：[08 执行服务](../../../docs/hello-dsh/08-execution-services.md)。
> 本工程完全独立：整目录拷走，`pnpm install` 后 `pnpm start`（Node）或
> `pnpm run start:bun`（Bun）即可运行，不需要 API key——全部场景用 `callTool`
> 直接驱动真实工具管线，不跑模型 turn。

## 1 能力与权限是两层

工具注册了就能执行吗？不能。dsh 把「能力」和「权限」分成两层：工具管线决定
**能不能调**，边界栈决定**调了之后允许做什么**。本示例离线触发整条边界栈：

| 层 | 服务/包 | 回答的问题 |
|:---|:--------|:-----------|
| 文件边界 | `fs-sandbox` | 这次读写落在允许的路径里吗？ |
| 进程边界 | `sandbox-local` + `pwsh/bash-sandbox` | shell 命令以什么令牌跑？ |
| 策略 | `sandbox-policy` | 当前会话是 read-only / workspace-write / danger-full-access 哪一档？ |
| 观察策略 | `fs-observation-policy` | 编辑之前**读过**这个文件吗？ |
| 预设 | `permission-presets` | `/permission` 一条命令联动沙箱模式与审批策略 |

> 关键认识：判决不发生在工具里，而发生在策略缝上——同一个 `write` 工具，
> 换个会话模式就从放行变成拒绝，工具代码一行没改。

## 2 装配树：九行 base + 十五行边界栈

base 九行与 [dsh-agent-loop-demo](../11-dsh-agent-loop-demo/README.md) 相同
（执行器是 native，不是 jobs 示例的 PTC）。边界栈十五行按职责分四组：

| 组 | 行 | 职责 |
|:---|:---|:-----|
| 审批与命令（2） | user-approval / commands | /permission 预设切换需要 approval 服务与命令注册表 |
| 进程边界（8） | subprocess / sandbox / sandbox-policy / bash-sandbox / pwsh-sandbox / shell-env / tool-bash / tool-pwsh | 受限令牌子进程跑一次性命令，shell 执行器与工具按平台二选一 |
| 文件边界（4） | fs-sandbox / fs-observation-policy / tool-fs / working-directory | 沙箱化 fs + 写前必读的观察登记 |
| 预设（1） | permission | 三档预设联动沙箱模式与审批策略，注册 /permission 命令 |

> 依赖链：`pwsh/bash-sandbox` 注入 `subprocess + sandbox + sandboxPolicy`
> 提供 shell 服务；`tool-pwsh/tool-bash` 注入 `tools + shell + systemPrompt +
> shellEnv + workingDirectory`；`fs-sandbox` 注入 `sandboxPolicy` 提供沙箱化 fs
> （**不需要另挂 fs-local**，多挂一行反而制造两个 fs 提供者）；`working-directory` 注入 `fs + sessionProjections +
> systemPrompt`；`permission-presets` 注入 `shell + approval + sessions +
> agents + sessionProjections`。

两处配置值得单独看。平台二选一（同一份 patch 在 Windows 与 POSIX 都能装配）：

```yaml
    # 一次性 shell 执行器：Windows 走 pwsh，其他平台走 bash（按平台二选一）。
    - id: bash-sandbox
      name: '@deepseek-ai/dsh-bash-sandbox'
      disabled: !!js "process.platform === 'win32'"
      config:
        timeoutMs: 60000

    - id: pwsh-sandbox
      name: '@deepseek-ai/dsh-pwsh-sandbox'
      disabled: !!js "process.platform !== 'win32'"
```

三档权限预设（/permission 命令的联动目标）：

```yaml
    - id: permission
      name: '@deepseek-ai/dsh-permission-presets'
      config:
        presets:
          read-only:
            sandbox: read-only
            approval: ask
          workspace-write:
            sandbox: workspace-write
            approval: ask
          danger-full-access:
            sandbox: danger-full-access
            approval: never
```

## 3 逐场景机制

**S1 沙箱内写文件并读回。** `write`/`read` 走 tool-fs → fs-sandbox。fs-sandbox
把每次读写交给 `sandboxPolicy.resolve({ session })` 判决：会话头 `cwd` 是
workspace-write 的边界，`.dsh-home` 在边界内所以放行。文件名带时间戳后缀：
观察策略按会话记忆，固定文件名会让第二次运行变成「未读先写已存在文件」
而被拒，误报成沙箱故障。

**S2 一次性 shell 命令。** `pwsh` 工具 → pwsh-sandbox（提供 shell 服务）→
subprocess-local 的私有 runner 子进程 → sandbox-local 施加的受限令牌。
Windows 上 sandbox-local 的 runner 链是 `['windows-acl']`
（`sandbox-local/src/index.ts:184`）：先给工作目录与临时目录授「能力 SID 写权限 +
Low 完整性标签 + 拒绝 Everyone 的 ambient 删除权」，再以低完整性受限令牌跑命令。

这一步对工作目录的 ACL 有硬要求：**必须给当前用户 FullControl（含
WRITE_OWNER），否则 Win32 5**，报
`sandbox-local: windows-acl workspace grant failed: Win32Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(<工作目录>)`。
根因是 `grantWrite` 一次调用同时写 DACL 和 **Low 完整性标签**，标签住在
SACL 里，而目录所有者的隐式权利只覆盖 READ_CONTROL 与 WRITE_DAC——源码
注释写明「The directory must be owned by the caller AND grant WRITE_OWNER」
（`sandbox-windows-acl/src/acl.ts:368`）。修法（在工程目录里执行一次）：

```powershell
$acl = Get-Acl .
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  $env:USERNAME, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.SetAccessRule($rule)
Set-Acl . $acl
```

首次 grant 会把可继承 ACE 传播到整棵目录树（含 node_modules），大目录会慢；
之后的运行命中幂等跳过（精确 ACE + deny + label 三者齐备就不再 apply）。
[dsh-jobs-demo](../17-dsh-jobs-demo/README.md) 等挂 sandbox-local 的示例同样
受这条约束。

**S3 沙箱模式。** 服务上没有现成的 `mode` 字段：部署默认叫 `defaultMode`
（patch 里配的 `workspace-write`；不配时 fail-safe 默认是 `read-only`，
`sandbox-policy/src/index.ts:138`），生效策略要按会话 `resolve()`——
优先级是「显式批准覆盖 > 会话最后一条 `sandbox/mode` 事件 > 部署默认」，
workspaceRoot 取会话头 cwd、无会话时退回配置根（`index.ts:208-220`）。

**S4 观察策略。** fs-observation-policy 无 inject，纯挂 `fs/*` 监听登记「观察」：
演示必须用 `writeFileSync` 直接落盘建文件——若用 `write` 工具建文件，那次
write 本身就登记了一次观察，后面的 edit 自然合法，演示不出拒绝。直接落盘的
文件没有观察记录，`edit` 被拒（`cannot modify …`）；`read` 一次之后同样的
`edit` 放行。这是防「模型凭记忆盲改文件」的缝。

**S5 /permission 切换。** permission-presets 注册 `/permission` 命令，一条命令
同时改沙箱模式与审批策略（预设三档见上文）。切到 read-only 后 `write` 被
fs-sandbox 拒绝，拒绝文案自带升级指引（`[sandbox: escalation …]`）；切回
workspace-write 后同一路径写入恢复。判决随会话走，工具与代码全程未变。

## 4 运行 sandbox 示例

`cordis.yml` 全文（根配置留空，装配全部来自 patch，见
[dsh-boot-demo](../07-dsh-boot-demo/README.md) 的装配哲学）：

```yaml
# 根配置留空：装配全部来自 cordis.patch.yml（见 dsh-boot-demo 的装配哲学）。
[]
```

`cordis.patch.yml` 全文（24 行树）：

```yaml
# 执行边界的最小树：九行 base + 十五行边界栈。
# 本示例不跑模型 turn：全部场景用 callTool 直接驱动真实工具管线（不需要 key）。
# 依赖链：pwsh/bash-sandbox 注入 subprocess + sandbox + sandboxPolicy → 提供 shell 服务；
#         tool-pwsh/tool-bash 注入 tools + shell + systemPrompt + shellEnv + workingDirectory；
#         fs-sandbox 注入 sandboxPolicy → 提供沙箱化 fs 服务；
#         working-directory 注入 fs + sessionProjections + systemPrompt；
#         permission-presets 注入 shell + approval + sessions + agents + sessionProjections。
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'

    - id: system-prompt
      name: '@deepseek-ai/dsh-system-prompt'

    - id: tools
      name: '@deepseek-ai/dsh-tools'

    - id: tool-executor-native
      name: '@deepseek-ai/dsh-tool-executor-native'

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

    # ── 边界栈十五行 ──────────────────────────────────────────────────────
    # 审批与命令：/permission 预设切换需要 approval 服务与命令注册表。
    - id: user-approval
      name: '@deepseek-ai/dsh-user-approval'
      config:
        policy: ask

    - id: commands
      name: '@deepseek-ai/dsh-commands'

    # 进程边界：subprocess-local 用私有 runner 子进程执行命令（Bun 缝见 runtime/）。
    - id: subprocess
      name: '@deepseek-ai/dsh-subprocess-local'

    - id: sandbox
      name: '@deepseek-ai/dsh-sandbox-local'

    - id: sandbox-policy
      name: '@deepseek-ai/dsh-sandbox-policy'
      config:
        mode: workspace-write
        workspaceRoot: !!js "process.cwd()"

    # 一次性 shell 执行器：Windows 走 pwsh，其他平台走 bash（按平台二选一）。
    - id: bash-sandbox
      name: '@deepseek-ai/dsh-bash-sandbox'
      disabled: !!js "process.platform === 'win32'"
      config:
        timeoutMs: 60000

    - id: pwsh-sandbox
      name: '@deepseek-ai/dsh-pwsh-sandbox'
      disabled: !!js "process.platform !== 'win32'"

    - id: shell-env
      name: '@deepseek-ai/dsh-shell-env'

    - id: tool-bash
      name: '@deepseek-ai/dsh-tool-bash'
      disabled: !!js "process.platform === 'win32'"

    - id: tool-pwsh
      name: '@deepseek-ai/dsh-tool-pwsh'
      disabled: !!js "process.platform !== 'win32'"

    # 文件边界：fs-sandbox 把读写都包在沙箱策略里（不需要另挂 fs-local）。
    - id: fs-sandbox
      name: '@deepseek-ai/dsh-fs-sandbox'

    # 观察策略：写之前必须先读、编辑必须基于已读内容（无 inject，挂 fs/* 监听）。
    - id: fs-observation-policy
      name: '@deepseek-ai/dsh-fs-observation-policy'

    - id: tool-fs
      name: '@deepseek-ai/dsh-tool-fs'

    - id: working-directory
      name: '@deepseek-ai/dsh-working-directory'

    # 权限预设：read-only / workspace-write / danger-full-access 三档，
    # 与沙箱模式、审批策略联动；注册 /permission 命令。
    - id: permission
      name: '@deepseek-ai/dsh-permission-presets'
      config:
        presets:
          read-only:
            sandbox: read-only
            approval: ask
          workspace-write:
            sandbox: workspace-write
            approval: ask
          danger-full-access:
            sandbox: danger-full-access
            approval: never
```

`src/index.ts` 的 boot 入口（节选）——官方 `boot()` 读两份 YAML，场景代码
只驱动工具管线与命令：

```ts
const ctx = await boot(
  'dsh-sandbox-demo', CONFIG,
  loadOverlayPatches('dsh-sandbox-demo', PATCH),
  undefined, BASE_URL,
)
```

```bash
# 安装依赖（31 个运行时依赖 + 2 个 devDependencies）
pnpm install

# Windows：先给工程目录补 FullControl（只需一次，见 §3 S2）

# Node 侧
pnpm start

# Bun 侧（run-bun.mjs 用 Node 拉起 Bun 并注入 preload，见 runtime/bun-preload.mjs）
pnpm run start:bun

# 类型检查
pnpm run typecheck
```

`pnpm start` 实测输出（Node v26.12.1，Windows，工作目录即本工程目录）：

```text
runtime = node v26.12.1

=== S1 沙箱内写文件并读回 ===
write：isError=false，<path>D:\coding\creative\hello-olleh\dsh-lab\examples\dsh-sandbox-demo\.dsh-hom…
read：isError=false，<path>D:\coding\creative\hello-olleh\dsh-lab\examples\dsh-sandbox-demo\.dsh-hom…

=== S2 一次性 shell 命令 ===
pwsh：isError=false，sandbox ok

=== S3 沙箱模式 ===
部署默认：defaultMode=workspace-write，fallbackRoot=D:\coding\creative\hello-olleh\dsh-lab\examples\dsh-sandbox-demo
会话解析：mode=workspace-write，workspaceRoot=D:\coding\creative\hello-olleh\dsh-lab\examples\dsh-sandbox-demo

=== S4 观察策略 ===
未读先编辑：isError=true，Error: cannot modify "D:\coding\creative\hello-olleh\dsh-lab\examples\dsh-sandb…
读过之后编辑：isError=false，The file D:\coding\creative\hello-olleh\dsh-lab\examples\dsh-sandbox-demo\.dsh-…

=== S5 /permission 切换 ===
/permission 命令可见：true
切到 read-only：kind=success
read-only 下写：isError=true，Error: [sandbox: file access denied under read-only mode] [sandbox: escalation …
切回 workspace-write：kind=success，写 isError=false

SANDBOX_OK
```

`pnpm run start:bun`（Bun 1.4.4）除首行 `runtime = bun 1.4.4` 外**逐行一致**
（归一化比对实测，正文 23 行全同），同样以 `SANDBOX_OK` 收尾。
`pnpm run typecheck` 0 错误。路径尾部的 `…` 是 `preview()` 的 80 字符截断，
不是输出缺失；`<path>` 是工具返回里的路径标记。

6 个值得注意的数字与事实：

- **24 行 patch、31 个运行时依赖**，代码里没有一处 ctx.plugin()——装配全部
  来自清单，boot 后全程在位。
- **0 个模型 turn**：全部场景用 callTool 直接驱动真实工具管线，不需要 key。
- **同一个 write 工具**：切到 read-only 被拒、切回 workspace-write 恢复，
  工具代码一行没改——判决在策略缝上，随会话走。
- **观察策略按会话记忆**：writeFileSync 直接落盘的文件没有观察记录，edit
  被拒；read 一次之后同样的 edit 放行。
- **平台二选一**：bash/pwsh 的执行器与工具四行用 `disabled: !!js` 按平台
  开关，同一份 patch 在 Windows 与 POSIX 都能装配。
- **双运行时逐行一致**：除 runtime 行与包管理器提示外正文 23 行全同；
  typecheck 0 错误。

留档：[runtime/out-node.txt](runtime/out-node.txt) ·
[runtime/out-bun.txt](runtime/out-bun.txt)（含 包管理器提示行的完整输出）。

## 5 从零复现：完整文件与运行路径

前置条件：Node ≥ 22.18（实测 v26.12.1，原生 TypeScript 类型剥离）；跑 Bun 侧
需要 Bun ≥ 1.4.4（实测 1.4.4；1.3.x 缺 `node:util.getSystemErrorMessage`，
subprocess-local 直接导入失败，四个插件连锁不激活）。Windows 上先给工程
目录补一次 FullControl（见 §3 S2）。不需要 API key，不访问网络（pnpm install
除外）。

目录结构（node_modules、.dsh-home、.cordis 除外：前两者已 gitignore，
`.cordis/` 是 cordis 启动时自动生成的 resolve 缓存，自带 gitignore，都不用
手工维护）：

```text
dsh-sandbox-demo/
├── cordis.yml              # []，装配全在 patch
├── cordis.patch.yml        # 24 行树（上文全文）
├── package.json            # 31 个运行时依赖，全文见下
├── tsconfig.json
├── .gitignore              # node_modules/ 与 .dsh-home/
├── src/
│   ├── index.ts            # 五场景，134 行
│   └── tools.ts            # callTool/preview 封装（与 tool-pipeline-demo 逐字一致）
├── runtime/
│   ├── run-bun.mjs         # Node 拉 Bun + BUN_OPTIONS 注入 + 版本回退候选
│   ├── bun-preload.mjs     # 只修 runner 分隔符（本示例不挂 ptc，无需 shim）
│   ├── out-node.txt        # Node 侧留档
│   └── out-bun.txt         # Bun 侧留档
└── README.md
```

`package.json` 全文：

```json
{
  "name": "dsh-sandbox-demo",
  "private": true,
  "type": "module",
  "description": "执行边界：沙箱化文件读写、一次性 shell 命令、观察策略（写前必须先读）、/permission 会话级权限切换。subprocess-local 的 Bun 缝由自带迷你 runtime 层修补。Node 与 Bun 双运行时。",
  "scripts": {
    "start": "node src/index.ts",
    "start:bun": "node runtime/run-bun.mjs",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@deepseek-ai/cordis": "4.1.0",
    "@deepseek-ai/cordis-plugin-group": "1.1.0",
    "@deepseek-ai/cordis-plugin-include": "1.1.0",
    "@deepseek-ai/cordis-plugin-loader": "1.1.0",
    "@deepseek-ai/cordis-plugin-timer": "1.2.0",
    "@deepseek-ai/dsh-agent": "0.2.2-rc.5",
    "@deepseek-ai/dsh-agent-loop": "0.2.2-rc.5",
    "@deepseek-ai/dsh-app-boot": "0.2.2-rc.5",
    "@deepseek-ai/dsh-bash-sandbox": "0.2.2-rc.5",
    "@deepseek-ai/dsh-commands": "0.2.2-rc.5",
    "@deepseek-ai/dsh-fs-observation-policy": "0.2.2-rc.5",
    "@deepseek-ai/dsh-fs-sandbox": "0.2.2-rc.5",
    "@deepseek-ai/dsh-home-paths": "0.2.2-rc.5",
    "@deepseek-ai/dsh-launch-environment": "0.2.2-rc.5",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.5",
    "@deepseek-ai/dsh-permission-presets": "0.2.2-rc.5",
    "@deepseek-ai/dsh-pwsh-sandbox": "0.2.2-rc.5",
    "@deepseek-ai/dsh-sandbox-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-sandbox-policy": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session": "0.2.2-rc.5",
    "@deepseek-ai/dsh-session-projection": "0.2.2-rc.5",
    "@deepseek-ai/dsh-shell-env": "0.2.2-rc.5",
    "@deepseek-ai/dsh-subprocess-local": "0.2.2-rc.5",
    "@deepseek-ai/dsh-system-prompt": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-bash": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-executor-native": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-fs": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tool-pwsh": "0.2.2-rc.5",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.5",
    "@deepseek-ai/dsh-user-approval": "0.2.2-rc.5",
    "@deepseek-ai/dsh-working-directory": "0.2.2-rc.5"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.9.3"
  }
}
```

`tsconfig.json` 与 [dsh-agent-loop-demo](../11-dsh-agent-loop-demo/tsconfig.json)
逐字一致（SHA256 相同，14 行）：ES2023 + nodenext + strict + noEmit +
allowImportingTsExtensions + verbatimModuleSyntax，include 只有 src。

`src/index.ts` 全文（134 行，五场景 + 断言）：

```ts
/**
 * dsh-sandbox-demo —— 执行后端与边界，全部离线（不跑模型 turn，不需要 key）：
 *   S1 沙箱内写文件并读回（fs-sandbox + tool-fs）；
 *   S2 一次性 shell 命令（pwsh/bash → subprocess-local 的私有 runner 子进程）；
 *   S3 沙箱模式与 workspaceRoot（sandbox-policy）；
 *   S4 观察策略：未读先编辑被拒，读过之后编辑放行（fs-observation-policy）；
 *   S5 /permission 会话级权限切换：read-only 拒写，workspace-write 恢复。
 * 关键认识："能力"和"权限"是两层——工具注册不等于放行，判决发生在沙箱策略与审批策略上。
 * Node 与 Bun 双运行时：Bun 的 subprocess runner 分隔符缝由 runtime/ 迷你层修补。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands'
import { callTool, preview } from './tools.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_URL = new URL('..', import.meta.url).href
const CONFIG = resolve(ROOT, 'cordis.yml')
const PATCH = resolve(ROOT, 'cordis.patch.yml')

const HOME = resolve(ROOT, '.dsh-home')
process.env.DSH_HOME = HOME
mkdirSync(HOME, { recursive: true })

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`
console.log(`runtime = ${runtime}`)

const ctx = await boot(
  'dsh-sandbox-demo', CONFIG,
  loadOverlayPatches('dsh-sandbox-demo', PATCH),
  undefined, BASE_URL,
)

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`断言失败：${message}`)
}

const suffix = Date.now().toString(36)
const handle = await ctx.agents.create({
  sessionId: SessionId(`sandbox-${suffix}`),
  meta: { cwd: process.cwd() },
})
const agent = handle.agent

// ── S1：沙箱内写文件并读回 ─────────────────────────────────────────────────
console.log('\n=== S1 沙箱内写文件并读回 ===')
{
  // 文件名带时间戳：观察策略要求覆盖已存在文件前先读过它，
  // 固定文件名会让第二次运行变成"未读先写"，从而误报失败。
  const path = resolve(HOME, `sandbox-write-${suffix}.txt`)
  const write = await callTool(ctx, 'write', { file_path: path, content: '沙箱内写入\n' }, agent)
  console.log(`write：isError=${write.isError}，${preview(write.content, 80)}`)
  assert(!write.isError, '在沙箱内写新文件失败')
  const read = await callTool(ctx, 'read', { file_path: path }, agent)
  console.log(`read：isError=${read.isError}，${preview(read.content, 80)}`)
  assert(!read.isError && read.content.includes('沙箱内写入'), '读回自己写的文件失败')
}

// ── S2：一次性 shell 命令 ──────────────────────────────────────────────────
console.log('\n=== S2 一次性 shell 命令 ===')
{
  const toolName = process.platform === 'win32' ? 'pwsh' : 'bash'
  const command = process.platform === 'win32' ? "'sandbox ok' | Write-Output" : 'echo "sandbox ok"'
  const result = await callTool(ctx, toolName, { command, description: '演示一次性 shell 命令' }, agent)
  console.log(`${toolName}：isError=${result.isError}，${preview(result.content, 80)}`)
  assert(!result.isError && result.content.includes('sandbox ok'), `${toolName} 执行失败`)
}

// ── S3：沙箱模式 ───────────────────────────────────────────────────────────
console.log('\n=== S3 沙箱模式 ===')
{
  // 服务上没有现成的 mode 字段：部署默认叫 defaultMode，生效策略要按会话
  // resolve()——会话头 cwd 是 workspace-write 边界，会话 sandbox/mode 事件
  // 覆盖部署默认（sandbox-policy/src/index.ts:208-220）。
  const policy = ctx.get('sandboxPolicy' as never) as unknown as {
    defaultMode: string
    workspaceRoot: string
    resolve(request?: { session?: unknown }): { mode: string; workspaceRoot: string }
  }
  const resolved = policy.resolve({ session: agent.session })
  console.log(`部署默认：defaultMode=${policy.defaultMode}，fallbackRoot=${policy.workspaceRoot}`)
  console.log(`会话解析：mode=${resolved.mode}，workspaceRoot=${resolved.workspaceRoot}`)
  assert(policy.defaultMode === 'workspace-write', '部署默认应当是 workspace-write（patch 行）')
  assert(resolved.mode === 'workspace-write', '会话解析策略应当是 workspace-write')
}

// ── S4：观察策略——写前必须先读 ─────────────────────────────────────────────
console.log('\n=== S4 观察策略 ===')
{
  const path = resolve(HOME, `sandbox-obs-${suffix}.txt`)
  // 关键：用 node 直接落盘，不经过工具。若用 write 工具建立文件，那次 write
  // 本身就登记了一次"观察"，后面的 edit 自然合法——那样就演示不出策略了。
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'original\n', 'utf8')

  const blind = await callTool(ctx, 'edit', { file_path: path, old_string: 'original', new_string: 'changed' }, agent)
  console.log(`未读先编辑：isError=${blind.isError}，${preview(blind.content, 80)}`)
  assert(blind.isError, '观察策略应当拒绝未读先编辑')

  await callTool(ctx, 'read', { file_path: path }, agent)
  const informed = await callTool(ctx, 'edit', { file_path: path, old_string: 'original', new_string: 'changed' }, agent)
  console.log(`读过之后编辑：isError=${informed.isError}，${preview(informed.content, 80)}`)
  assert(!informed.isError, '读后编辑应当成功')
}

// ── S5：/permission 会话级权限切换 ─────────────────────────────────────────
console.log('\n=== S5 /permission 切换 ===')
{
  const names = ctx.commands.list(agent).map(command => command.name)
  console.log(`/permission 命令可见：${names.includes('permission')}`)
  assert(names.includes('permission'), '/permission 命令未注册（permission-presets 行）')

  const signal = new AbortController().signal
  const toReadOnly = await ctx.commands.execute(agent, '/permission read-only', [], signal)
  console.log(`切到 read-only：kind=${toReadOnly?.result.kind}`)
  assert(toReadOnly?.result.kind === 'success', '/permission read-only 执行失败')

  const deniedPath = resolve(HOME, `sandbox-readonly-${suffix}.txt`)
  const denied = await callTool(ctx, 'write', { file_path: deniedPath, content: '不该写进去\n' }, agent)
  console.log(`read-only 下写：isError=${denied.isError}，${preview(denied.content, 80)}`)
  assert(denied.isError, 'read-only 下写操作应当被拒绝')

  const toWrite = await ctx.commands.execute(agent, '/permission workspace-write', [], signal)
  const restored = await callTool(ctx, 'write', { file_path: deniedPath, content: '恢复后可写\n' }, agent)
  console.log(`切回 workspace-write：kind=${toWrite?.result.kind}，写 isError=${restored.isError}`)
  assert(toWrite?.result.kind === 'success' && !restored.isError, '切回 workspace-write 后应当恢复写入')
}

await handle.dispose()
await ctx.fiber.dispose()
console.log('\nSANDBOX_OK')
```

`src/tools.ts` 全文（78 行，与
[dsh-tool-pipeline-demo](../08-dsh-tool-pipeline-demo/src/tools.ts) 逐字一致，
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
 * run-bun.mjs —— `pnpm run start:bun` 的入口：用 Node 拉起 Bun，并注入 preload。
 *
 * 为什么需要这一层：subprocess-local 的 runner 是**孙进程**，命令行 --preload
 * 到不了那一层，只有 BUN_OPTIONS 环境变量会一路继承。所以在这里把
 * `--preload <bun-preload.mjs>` 写进 BUN_OPTIONS，再 spawn bun src/index.ts。
 *
 * 顺带清掉继承来的 NODE_OPTIONS / BUN_OPTIONS：机器上装了 tsx、或用户全局
 * 设了别的 preload 时，会让"本工程的运行环境"取决于外部状态。
 *
 * @module dsh-sandbox-demo/runtime/run-bun
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

`runtime/bun-preload.mjs` 全文（48 行，只修一条缝）：

```js
/**
 * bun-preload.mjs —— Bun 侧的加载期补丁：只修 subprocess-local 的 runner 分隔符缝。
 *
 * 用法（由 runtime/run-bun.mjs 自动注入，无需手工调用）：
 *
 *     BUN_OPTIONS="--preload <abs path to this file>" bun src/index.ts
 *
 * `dsh-subprocess-local` 用一个私有 runner 子进程执行 shell 命令：
 *
 *     process.execPath <runner.js> -- <target argv…>
 *
 * 子进程里的 parseRunnerTargetArgv(process.argv.slice(2)) 要求第一项正好是 `--`。
 * Node 保留它，Bun **会吞掉脚本路径之后的第一个 `--`**：
 *
 *     node x.js -- a b  →  argv = [execPath, x.js, '--', 'a', 'b']
 *     bun  x.js -- a b  →  argv = [execPath, x.js, 'a', 'b']
 *
 * 于是 Bun 下一次性 shell 命令报：
 *
 *     subprocess runner requires target argv after a private -- delimiter
 *
 * 修法：preload 在任何主模块代码之前跑，此时 process.argv 已是最终形态，
 * 把 `--` 补回索引 2 即可。**只在 runner 入口生效**（私有环境变量 + 文件名
 * 双重判定），否则会污染所有普通脚本的 argv。
 *
 * 为什么必须是 preload 而不是改 child_process.spawn：runner 是被 provider
 * spawn 出来的孙进程，命令行的 --preload 到不了那一层，只有 BUN_OPTIONS
 * 会继承下去（见 run-bun.mjs）。
 *
 * 本示例不挂 ptc-runtime，所以不需要 stripTypeScriptTypes shim。
 *
 * @module dsh-sandbox-demo/runtime/bun-preload
 */

function restoreRunnerDelimiter() {
  if (process.env.DSH_SUBPROCESS_RUNNER === undefined) return

  const entry = process.argv[1]
  if (entry === undefined) return
  // runner 入口可能是 runner.js（构建产物）或 bin.ts（源码形态）。
  const name = entry.split(/[\\/]/).pop()
  if (name !== 'runner.js' && name !== 'bin.ts') return
  if (process.argv[2] === '--') return

  process.argv.splice(2, 0, '--')
}

restoreRunnerDelimiter()
```

按顺序验证：

```bash
# 1 安装依赖
pnpm install

# 2 Windows：给工程目录补 FullControl（只需一次，见 §3 S2）

# 3 类型检查（0 错误）
pnpm run typecheck

# 4 Node 侧：末行 SANDBOX_OK
pnpm start

# 5 Bun 侧：除 runtime 行外与 Node 逐行一致，末行 SANDBOX_OK
pnpm run start:bun

# 6 再跑一遍 Node：时间戳文件名保证观察策略断言仍全过
pnpm start
```

本示例不依赖任何环境变量、端口或外部服务：`DSH_HOME` 由代码自己指向工程内的
`.dsh-home`，不需要 API key；唯一的宿主前置是 Windows 的工作目录 ACL（见 §3 S2）。

## 6 小结

这个示例验证了 3 件事：

1. **能力与权限分层**——工具注册 ≠ 放行，判决在策略缝上；同一个 write
   工具随会话模式从放行变拒绝，代码一行没改。
2. **策略随会话走**——resolve 按会话 cwd 与 sandbox/mode 事件解析，
   /permission 一条命令联动沙箱模式与审批策略；观察策略按会话登记「读过」。
3. **边界有平台成本**——Windows 的 ACL/完整性标签要求真实权限（FullControl
   含 WRITE_OWNER），Bun 的 runner 协议缝需要加载期补丁；两者都已在本工程内
   处理好，双运行时输出逐行一致。

兄弟示例：[dsh-tool-pipeline-demo](../08-dsh-tool-pipeline-demo/README.md)（工具管线本体）、
[dsh-hitl-demo](../14-dsh-hitl-demo/README.md)（审批判决链，与 permission-presets 的
approval 联动同源）、[dsh-jobs-demo](../17-dsh-jobs-demo/README.md)（run_code 与
workflow 脚下的另一套边界栈）。