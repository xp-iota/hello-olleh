# M07 · 执行侧后端

真实副作用应分成三层：工具表达 I/O 意图，执行 seam 选择后端，沙箱把策略落实到进程边界。

## 学习目标

理解 fs、subprocess、shell、terminal 与 sandbox policy 如何共同形成可替换、可取消、可约束的执行面。

## 运行

```bash
npm run M07
```

## 阶段与观察点

| 阶段 | 类型 | 实现 | 观察什么 |
|---|---|---|---|
| 1 fs/subprocess | 教学主线 | `steps/01-fs-shell-side-effects.ts` | 文件读写、命令执行、取消与临时文件清理 |
| 2 shell service | 教学主线 | `steps/02-shell-service.ts` | resolve、run、start、增量输出与幂等 kill |
| 3 sandbox seam | 教学主线 | `steps/03-sandbox-seam.ts` | Provider 栈、策略模式与缺 Provider 时 fail closed |
| 4 Terminal | 扩展面 | `steps/04-terminal-sessions.ts` | owner-scoped PTY registry 与稳定 `NO_BACKEND` |
| 5 共享策略 | 扩展面 | `steps/05-sandbox-policy.ts` | 默认策略与会话日志覆盖如何合并 |

## 完整链路

工具调用 Context 能力；执行后端解析路径或命令；sandbox 在派发前把策略转换成可强制执行的 argv；`exec.signal` 同时覆盖派发前和派发后的取消。

## 边界

默认教学路径不启动需要原生安装脚本的 PTY；无法强制执行的沙箱模式必须拒绝，不能静默降级。

**结论：**工具不应直接绕过宿主调用 Node API，副作用必须经过统一执行与安全边界。
