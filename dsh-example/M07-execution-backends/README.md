# M07 · 执行侧后端

本模块把原 16、24、25 合为一条真实副作用链：**工具提出 I/O 意图，执行 seam 选择后端，沙箱把策略落实到进程边界**。

## 运行

```bash
npm run M07
```

## 阶段

| 阶段 | 独立插件 | 关键观察 |
|---|---|---|
| fs/subprocess | `steps/01-fs-shell-side-effects.ts` | 文件写读、命令执行、发前/发后取消与临时文件清理 |
| shell service | `steps/02-shell-service.ts` | resolve、前台 run、后台 start、增量输出与幂等 kill |
| sandbox seam | `steps/03-sandbox-seam.ts` | provider 栈、read-only/workspace-write、缺 provider 时 fail closed |

工具不直接调用 Node API，而是消费 Context 上的能力缝，因此测试可替换后端、宿主可统一观测，生产环境也能在同一入口施加沙箱。`exec.signal` 同时覆盖尚未派发与已经派发的取消语义。

**结论：**副作用能力应分成“做什么”“由谁执行”“在哪些约束下执行”三层，避免工具代码绕过宿主策略。


## A4 · 终端与共享策略

- `terminals` 是 owner-scoped PTY registry；未注册 backend 返回稳定 `NO_BACKEND`。
- `sandboxPolicy` 将默认策略和 `sandbox/mode` 日志覆盖解析成每次执行的边界。
- npm 拦截的 `node-pty` 原生安装脚本未被擅自批准，因此默认教学路径不启动 bash PTY。
