# dsh-sandbox-demo —— 执行边界：沙箱、观察策略、权限预设

> 配套文章：`docs/hello-dsh/` 的执行服务章节。本工程完全独立：整目录拷走，
> `npm install` 后 `npm start`（Node）或 `npm run start:bun`（Bun）即可运行，
> 不需要 API key——全部场景用 `callTool` 直接驱动真实工具管线，不跑模型 turn。

## 1. 问题

工具注册了就能执行吗？不能。dsh 把「能力」和「权限」分成两层：工具管线决定
**能不能调**，边界栈决定**调了之后允许做什么**。本示例离线触发整条边界栈：

| 层 | 服务/包 | 回答的问题 |
|:---|:--------|:-----------|
| 文件边界 | `fs-sandbox` | 这次读写落在允许的路径里吗？ |
| 进程边界 | `sandbox-local` + `pwsh/bash-sandbox` | shell 命令以什么令牌跑？ |
| 策略 | `sandbox-policy` | 当前会话是 read-only / workspace-write / danger-full-access 哪一档？ |
| 观察策略 | `fs-observation-policy` | 编辑之前**读过**这个文件吗？ |
| 预设 | `permission-presets` | `/permission` 一条命令联动沙箱模式与审批策略 |

关键认识：判决不发生在工具里，而发生在策略缝上——同一个 `write` 工具，
换个会话模式就从放行变成拒绝，工具代码一行没改。

## 2. 装配树

九行 base（与 [dsh-agent-loop-demo](../dsh-agent-loop-demo/README.md) 相同）+ 十五行边界栈，
共 24 行。依赖链：`pwsh/bash-sandbox` 注入 `subprocess + sandbox + sandboxPolicy` 提供 shell 服务；
`fs-sandbox` 注入 `sandboxPolicy` 提供沙箱化 fs（**不需要另挂 fs-local**）；
`permission-presets` 注入 `shell + approval + sessions + agents + sessionProjections`。
完整 `cordis.patch.yml`：

```yaml
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
    - id: user-approval
      name: '@deepseek-ai/dsh-user-approval'
      config:
        policy: ask

    - id: commands
      name: '@deepseek-ai/dsh-commands'

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

    - id: fs-sandbox
      name: '@deepseek-ai/dsh-fs-sandbox'

    - id: fs-observation-policy
      name: '@deepseek-ai/dsh-fs-observation-policy'

    - id: tool-fs
      name: '@deepseek-ai/dsh-tool-fs'

    - id: working-directory
      name: '@deepseek-ai/dsh-working-directory'

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

`cordis.yml` 留空（`[]`）：装配全部来自 patch，见 [dsh-boot-demo](../dsh-boot-demo/README.md)。

## 3. 实测输出

`npm run start`（Node v26.12.1，Windows，工作目录即本工程目录）：

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

`npm run start:bun`（Bun 1.4.4）除首行 `runtime = bun 1.4.4` 外**逐行一致**，
同样以 `SANDBOX_OK` 收尾。`npm run typecheck` 0 错误。
（路径尾部的 `…` 是 `preview()` 的 80 字符截断，不是输出缺失。）

## 4. 逐场景机制

**S1 沙箱内写文件并读回。** `write`/`read` 走 tool-fs → fs-sandbox。fs-sandbox
把每次读写交给 `sandboxPolicy.resolve({ session })` 判决：会话头 `cwd` 是
workspace-write 的边界，`.dsh-home` 在边界内所以放行。文件名带时间戳后缀——
原因见坑 4。

**S2 一次性 shell 命令。** `pwsh` 工具 → pwsh-sandbox（提供 shell 服务）→
subprocess-local 的私有 runner 子进程 → sandbox-local 施加的受限令牌。
Windows 上 sandbox-local 的 runner 链是 `['windows-acl']`
（`sandbox-local/src/index.ts:184`）：先给工作目录与临时目录授「能力 SID 写权限 +
Low 完整性标签 + 拒绝 Everyone 的 ambient 删除权」，再以低完整性受限令牌跑命令。
**这一步对工作目录的 ACL 有硬要求，见坑 1。**

**S3 沙箱模式。** 服务上没有现成的 `mode` 字段：部署默认叫 `defaultMode`
（patch 里配的 `workspace-write`；不配时 fail-safe 默认是 `read-only`，
`sandbox-policy/src/index.ts:138`），生效策略要按会话 `resolve()`——
优先级是「显式批准覆盖 > 会话最后一条 `sandbox/mode` 事件 > 部署默认」，
workspaceRoot 取会话头 cwd、无会话时退回配置根（`index.ts:208-220`）。

**S4 观察策略。** fs-observation-policy 无 inject，纯挂 `fs/*` 监听登记「观察」：
用 node 直接落盘的文件没有观察记录，`edit` 被拒（`cannot modify …`）；
`read` 一次之后同样的 `edit` 放行。这是防「模型凭记忆盲改文件」的缝。

**S5 /permission 切换。** permission-presets 注册 `/permission` 命令，一条命令
同时改沙箱模式与审批策略（预设三档见 patch）。切到 read-only 后 `write` 被
fs-sandbox 拒绝，拒绝文案自带升级指引（`[sandbox: escalation …]`）；切回
workspace-write 后同一路径写入恢复。判决随会话走，工具与代码全程未变。

## 5. 坑（全部实测）

1. **Windows 工作目录必须给当前用户 FullControl（含 WRITE_OWNER），否则 Win32 5。**
   首跑 S2 报：
   `sandbox-local: windows-acl workspace grant failed: Win32Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(<工作目录>)`。
   根因不是 rc.3 回归：`grantWrite` 一次调用同时写 DACL 和 **Low 完整性标签**，
   标签住在 SACL 里，而目录所有者的隐式权利只覆盖 READ_CONTROL 与 WRITE_DAC——
   源码注释写明「The directory must be owned by the caller AND grant WRITE_OWNER」
   （`sandbox-windows-acl/src/acl.ts:368`，rc.1 同文）。实测对照：新建的示例目录
   继承来的 ACL 只有 Modify → 失败；旧实验室目录恰好有 FullControl → 同机通过。
   修法（在工程目录里执行一次）：

   ```powershell
   $acl = Get-Acl .
   $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
     $env:USERNAME, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
   $acl.SetAccessRule($rule)
   Set-Acl . $acl
   ```

   首次 grant 会把可继承 ACE 传播到整棵目录树（含 node_modules），大目录会慢；
   之后的运行命中幂等跳过（精确 ACE + deny + label 三者齐备就不再 apply）。
2. **`ctx.sandboxPolicy` 没有 `mode` 字段。** 直接读 `policy.mode` 得到 undefined。
   部署默认读 `defaultMode`，生效策略用 `resolve({ session })`（见 S3）。
3. **观察策略演示必须绕过工具建文件。** 若用 `write` 工具建文件，那次 write 本身
   就登记了一次观察，后面的 edit 自然合法——演示不出拒绝。所以 S4 用
   `writeFileSync` 直接落盘。
4. **文件名要带时间戳。** 观察策略按会话记忆；固定文件名会让第二次运行变成
   「未读先写已存在文件」而被拒，误报成沙箱故障。
5. **Bun 的 runner 分隔符缝。** subprocess-local 的协议是
   `process.execPath runner.js -- <argv>`，Bun 吞掉脚本后第一个 `--`。
   本工程自带迷你 runtime 层：`runtime/bun-preload.mjs` 只在 runner 入口
   （`DSH_SUBPROCESS_RUNNER` 环境变量 + 文件名双判定）补回 `--`；
   `runtime/run-bun.mjs` 用 Node 拉起 Bun 并经 **BUN_OPTIONS** 注入 preload——
   runner 是孙进程，命令行 `--preload` 到不了那一层，只有环境变量一路继承。
6. **Bun 必须 ≥ 1.4.4。** 1.3.x 缺 `node:util.getSystemErrorMessage`，
   subprocess-local 直接导入失败（实测 1.3.11：`Export named 'getSystemErrorMessage'
   not found in module 'node:util'`，四个插件连锁不激活）。机器上可能同时存在
   新旧两份 Bun：`run-bun.mjs` 的回退候选按「npm 全局包（新）→ ~/.bun/bin（可能旧）」
   排序，PATH 上无可 spawn 的 bun 时才用回退。
7. **fs-sandbox 不需要 fs-local。** 它注入 `sandboxPolicy` 后自己提供沙箱化 fs；
   多挂一行 fs-local 反而制造两个 fs 提供者。shell 执行器与工具按平台
   `disabled: !!js` 二选一，同一份 patch 在 Windows 与 POSIX 都能装配。

## 6. 从零复现

目录结构（node_modules 与 .dsh-home 除外）：

```text
dsh-sandbox-demo/
├── cordis.yml              # []，装配全在 patch
├── cordis.patch.yml        # 24 行树（上文全文）
├── package.json            # 31 个依赖，版本见下
├── tsconfig.json
├── src/
│   ├── index.ts            # 五场景，约 135 行
│   └── tools.ts            # callTool/preview 封装（与 tool-pipeline-demo 同源）
├── runtime/
│   ├── run-bun.mjs         # Node 拉 Bun + BUN_OPTIONS 注入 + 版本回退候选
│   └── bun-preload.mjs     # 只修 runner 分隔符（本示例不挂 ptc，无需 shim）
└── README.md
```

版本面：`@deepseek-ai/*` 全部 **0.2.2-rc.3**（npm `next` 通道，与
`sources/deepseek-harness` 快照同版）；peer `@deepseek-ai/cordis` **4.1.0**；
`cordis-plugin-timer` 1.2.0、loader/include/group 1.1.0；
devDeps `typescript` 5.9.3 + `@types/node` 22.10.2。
运行时：Node ≥ 22.18（实测 v26.12.1）、Bun ≥ 1.4.4（实测 1.4.4）。

```bash
npm install
# Windows：先按坑 1 给工程目录补 FullControl（只需一次）
npm start          # Node
npm run start:bun  # Bun
npm run typecheck
```

## 7. 小结

边界栈的教学点浓缩成三句：**能力与权限分层**（工具注册 ≠ 放行，判决在策略缝）；
**策略随会话走**（resolve 按会话 cwd 与 mode 事件解析，/permission 一条命令联动
沙箱与审批）；**边界有平台成本**（Windows 的 ACL/完整性标签要求真实权限，
Bun 的 runner 协议缝需要加载期补丁——两者都已在本工程内闭环）。

兄弟示例：[dsh-tool-pipeline-demo](../dsh-tool-pipeline-demo/README.md)（工具管线本体）、
[dsh-hitl-demo](../dsh-hitl-demo/README.md)（审批判决链，与 permission-presets 的
approval 联动同源）、[dsh-subagent-demo](../dsh-subagent-demo/README.md)（委派与深度预算）。