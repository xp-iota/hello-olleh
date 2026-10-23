# M02 · 上下文装配与经济学

模型每次请求看到的"上下文"不是一份静态文件，而是**每次请求现算出来的**：System Prompt 由有序 section 拼装、工具 schema 按作用域收集、运行时事实（cwd、沙箱模式）作为快照注入。而窗口有限，于是还有三件配套机制：token 计量、历史压缩、超大结果溢写。

## 学习目标

- 说清 System Prompt 的 `section` / `context` / `tools` / `variable` 四类贡献各自解决什么；
- 理解变量插值是**严格的**（未定义即报错，不会把 `{{x}}` 原样送给模型）；
- 知道"模型表面"（surface）是日志折叠的结果，不是另一份存储；
- 认识三条经济学防线：裁剪、溢写、压缩。

## 运行

```bash
npm run M02
```

不需要 key。M02.3 只用一条空会话验证 surface 与 tokenMeter 在位。

## 代码地图

```text
M02-context-assembly-economics/index.ts
├─ M02.1 assemblePrompt        # 运行时注册 section → 看装配顺序 → 移除后消失
├─ M02.2 interpolateVariable   # 变量插值 + 未定义变量严格报错
├─ M02.3 foldHistory           # sessionQuery.readSurface() 与 tokenMeter
├─ M02.4 estimatePressure      # token 压力估算
├─ M02.5 pruneLongResult       # tool-result-pruner 装配检查
└─ M02.6 spillToFile           # spill-policy 装配检查
```

## 四类贡献

`ctx.systemPrompt` 收集四种东西，它们在不同时机求值：

| 贡献 | 注册方式 | 求值时机 | 典型用途 |
|---|---|---|---|
| `section` | `systemPrompt.section()` | 每次装配 | 人格、工具使用说明、模式策略 |
| `context` | `systemPrompt.context()` | 装配 + 准入刷新 | cwd、沙箱模式这类"当前事实" |
| `tools` | `systemPrompt.tools()` | 每次装配 | 可见工具 schema |
| `variable` | `systemPrompt.variable()` | 渲染时 | section 里的 `{{name}}` |

`section` 按 `order` 升序拼接。**顺序是全局资源**：如果每个插件随便写 `order: 1000`，装配结果就取决于加载次序。所以 `dsh-system-prompt` 导出了 `SECTION_ORDERS` 常量表（`TOOL_BASH: 1000`、`TOOL_READ: 1100`……），插件应当查表而不是自己编数字。

### M02.2 为什么插值要严格

未定义变量会**抛错**，而不是留下 `{{lab_missing}}`。理由：把 `{{x}}` 原样送给模型，模型会以为那是语法而不是缺值，于是"帮我看看 {{x}}" 这种指令会被当真执行。装配期失败比运行期误解更便宜。

`interpolate: false` 的 section 保留字面量——这是给"我要教模型写模板"这类场景留的出口。

### M02.3 模型表面

`readSurface()` 返回的是**日志折叠后的结果**：哪些事件进入了模型可见历史、哪些被标记为 `ignorable`。它不是另一份存储，而是对同一条日志的投影。

这条性质很重要：调试"模型为什么没看到某条消息"时，要看 surface，不要猜日志。

## 三条经济学防线

窗口有限，dsh 用三层应对，代价递增：

1. **裁剪**（`tool-result-pruner`）：单条工具结果超过 `thresholdChars` 就截断成"头 + 尾 + 中间省略"。无损可逆（全文还在日志里）。
2. **溢写**（`spill-policy`）：单条结果超过 `maxInlineTokens` 就换成"预览 + 文件路径"，模型需要时自己读回来。模型可见内容变少，但信息不丢。
3. **压缩**（`compaction-basic`）：整段历史超过预算就折叠成摘要。**这一步是有损的**，所以它有独立的触发条件和审计事件。

顺序是有意的：先试无损的，再试可逆的，最后才动有损的。

## 排错

| 现象 | 原因 |
|---|---|
| `unknown prompt variable "{{x}}"` | 变量没注册，或注册在别的 scope |
| section 顺序诡异 | `order` 撞车；查 `SECTION_ORDERS` |
| 模型看不到某条消息 | 用 `dsh-lab traj <id> --surface` 看折叠结果 |
| 上下文突然变短 | 触发了压缩；日志里会有 compaction 事件 |

## 练习

1. 在 M02.1 里把 `order` 改成 `-2000`，观察 section 跑到最前面。这说明 `order` 是全局的，不是相对的。
2. 注册一个返回 `undefined` 的变量，看渲染时会发生什么。
3. 用 `dsh-lab traj <id> --surface` 对比 `--no-events` 的输出，找出哪些事件进了模型可见历史。
