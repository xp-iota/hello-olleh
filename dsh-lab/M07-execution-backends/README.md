# M07 · 执行后端与边界

模型说要读文件、写文件、跑命令——这些动作最终都撞在"边界"上。这一章的核心认识是：**能力（capability）和权限（permission）是两层**。

注册了 `write` 工具，不等于任何 agent 都能写任何路径。放行判决发生在沙箱策略和审批策略上。

## 学习目标

- 认识 `read-only` / `workspace-write` / `danger-full-access` 三档沙箱语义；
- 理解观察策略（写前必须先读）为什么是**正确性**要求而不是纪律要求；
- 知道 `bash` / `pwsh` 工具为什么需要 `description` 参数；
- 会诊断 Windows 沙箱的权限问题。

## 运行

```bash
npm run M07
```

不需要 key。M07.1、M07.2、M07.4 会真的写文件和跑命令（在 `.dsh-home/` 内）。

## 代码地图

```text
M07-execution-backends/index.ts
├─ M07.1 writeAndRun         # 沙箱内写文件并读回
├─ M07.2 runShell            # bash / pwsh 一次性命令
├─ M07.3 sandboxMode         # 当前策略与 provider
├─ M07.4 observationPolicy   # 未读先编辑被拒 → 读过之后成功
└─ M07.5 switchPolicy        # /permission 命令在位
```

## 三档沙箱

| 模式 | 读 | 写工作区 | 写工作区外 | 典型场景 |
|---|---|---|---|---|
| `read-only` | ✓ | ✗ | ✗ | 代码审查、只读分析 |
| `workspace-write` | ✓ | ✓ | ✗ | 日常开发（默认） |
| `danger-full-access` | ✓ | ✓ | ✓ | 需要动系统配置时，人工确认后临时切换 |

模式来自 `DSH_PERMISSION_MODE`，会话内可用 `/permission` 切换。**切换会写进会话日志**（`sandbox/mode` 事件），所以重放时能还原当时的边界——这是审计要求，不是日志冗余。

## 观察策略：为什么必须"先读后写"

M07.4 演示：用 node 直接落盘建一个文件（**不经过工具**），然后让 agent 去 `edit` 它：

```text
未读先编辑：isError=true
  Error: cannot modify "...m07-obs.txt": file has not been read — read the f...
读过之后编辑：isError=false
```

为什么要求这么严？因为 `edit` 的参数是 `old_string` / `new_string`。如果 agent 没读过文件就猜 `old_string`，它会基于**想象中的内容**做替换——可能改错地方，也可能悄悄什么都没改。

所以"必须先读"不是流程洁癖，是让替换操作有事实依据。`dsh-fs-observation-policy` 记录"这个 owner 读过这个文件的哪个版本"，编辑时校验版本。

这里还藏着一个教学陷阱：如果你用 `write` 工具建立文件，那次 write 本身就登记了一次观察，后面的 `edit` 自然合法——那就演示不出策略了。所以 M07.4 特意用 `writeFileSync` 绕开工具。

## `bash` / `pwsh` 的 `description`

M07.2 一开始踩到过：

```text
pwsh: isError=true Error: invalid arguments: missing required property "description"
```

`description` 是**必填**的，因为审批 UI 要显示"这条命令是干什么的"。人类看到一个裸命令行很难判断风险，一句描述能显著提高审批质量。这不是可选的元数据。

## Windows 沙箱的一个真实坑

在 Windows 上，沙箱跑命令前会建一个临时目录并给它加 ACL。这一步要求父目录可写，而本机 `TEMP` 指向 `D:\TEMP`（owner 是 Administrators，当前用户没有 `WRITE_DAC`），于是：

```text
sandbox-local windows-acl temp grant materialization failed and its cleanup also failed
```

`src/boot.ts` 的 `ensureWritableTemp()` 处理了它：**真跑一次**沙箱自己的 ACL 授权来探测，失败就换到 `%LOCALAPPDATA%\Temp`。

这里有个方法论教训值得记住：最初的探针用 `icacls` 试写 DACL，在 `D:\TEMP` 上返回 0（成功），但沙箱实际调用仍然失败。原因是沙箱那一次 `SetNamedSecurityInfoW` 同时写了 DACL **和完整性标签**，而 `icacls` 只碰 DACL。**探针必须复现被测实现的真实动作**，否则会给出假阳性。

## 排错

| 现象 | 原因 |
|---|---|
| `file has not been read` | 观察策略；先 `read` 再 `edit` |
| `missing required property "description"` | `bash`/`pwsh` 必须带描述 |
| `sandbox-local ... temp grant` | 见上文；`DSH_LAB_TEMP` 可显式指定临时根 |
| `SetNamedSecurityInfoW failed (Win32 5)` | 目标目录的 ACL 不允许当前用户改；需要修权限或换目录 |
| 写入被拒但模式是 `workspace-write` | 路径在 workspace 外；查 `sandboxPolicy.workspaceRoot` |

## 练习

1. 把 `DSH_PERMISSION_MODE` 设成 `read-only` 跑 M07.1，观察错误信息。
2. 在 M07.4 里去掉"先读"那一步，确认编辑被拒（这就是策略在起作用）。
3. 把 `DSH_LAB_TEMP` 指向一个有权限的目录，验证沙箱恢复正常。
