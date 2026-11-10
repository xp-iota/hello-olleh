# M01 · 工具管线：从注册、可见性到执行前后策略

模型"能调用工具"这件事，在 dsh 里不是一张 `name → function` 的字典，而是一条**五段可干预管线**。这一章把五个干预点逐个打开。

## 学习目标

分清四个控制面，并理解它们为什么必须分开：

| 控制面 | 问题 | 干预点 |
|---|---|---|
| 注册 | 这个工具存在吗 | `ctx.tools.register` |
| 可见性 | 这个 agent 看得见它吗 | `ctx.tools.restrict` |
| 执行前 | 这次调用放不放行 | `tools/pre-execute`、`ctx.tools.guard` |
| 执行后 | 模型看到的还是原始结果吗 | `tools/post-execute`、`tools/result` |

把权限写死在工具实现里，是这类系统最常见的架构错误：同一个工具需要按会话、按 agent、按模式给出不同结论，而工具实现只有一份。

## 运行

```bash
npm run M01          # 全部 5 个阶段
npm run M01 -- 2     # 只跑第 2 个阶段
```

不需要 `LLM_API_KEY`：本章全部是 `mechanism` 阶段，直接在进程内驱动工具管线。

## 代码地图

```text
M01-tool-pipeline/index.ts
├─ wordCountPlugin                  # 一个最小 cordis 插件：inject + apply + defineTool
├─ M01.1 registerAndDispose         # 注册 → 调用 → fiber.dispose() → 工具消失
├─ M01.2 denyByPreExecute           # tools/pre-execute 返回 {kind:'deny'}
├─ M01.3 appendNotice               # tools/post-execute 返回 {kind:'accept', content}
├─ M01.4 restrictScope              # 按 agent 收紧可见集合
└─ M01.5 guardIsMonotonic           # guard 只能拒绝，不能被 allow 覆盖
```

`src/lab/runner.ts` 给每个阶段一个独立的插件 fiber，所以阶段之间的监听不会互相污染——这一点在 M01.5 特别关键，否则 M01.2 的"一律拒绝"会活到下一个阶段。

## 五个阶段各看什么

### M01.1 注册与回收

`defineTool` 的三段式：`parameters`（模型看到并填写的 schema）、`execute`（返回**规范值**）、`output.render`（把规范值渲染成模型可读内容）。

规范值和渲染内容是两回事：`execute` 返回 `{words: 3, chars: 31}`，`render` 把它变成 `"3 词 / 31 字符"`。审计、压缩、重放都依赖前者，模型只看见后者。

注册是 effect：`ctx.plugin()` 返回 fiber，`fiber.dispose()` 之后工具自动从注册表消失。热重载不是额外功能，是 cordis effect 的自然结果。

### M01.2 执行前裁决

`tools/pre-execute` 是 **waterfall**：监听要么给出决定（`allow` / `deny` / `ask` / `cancel`），要么 `next()` 交给下一个监听。返回 `deny` 就"认领"了这次调用，后面的监听不再运行。

注意 `deny` 的 `reason` 是**给模型看的**——模型需要知道为什么被拒，才能换个做法。

### M01.3 执行结果变换

`tools/post-execute` 也是 waterfall，但它的输入已经是结果。返回 `{kind:'accept', content}` 可以整段替换模型可见内容，而规范值不变。

这就是"模型看到摘要、日志保存全文"的实现位置——`dsh-tool-result-pruner` 和 `dsh-spill-policy` 都挂在这里（见 M02）。

### M01.4 按 agent 收紧可见工具

`agentCtx.tools.restrict({allow: ['word_count']})` 只影响该 agent 的下一次装配。全局注册表不变，所以另一个 agent 仍然看见全部工具（基础 26 个，加上本阶段注册的 `word_count`，共 27 个）。

单向收紧是刻意的：agent 作用域**只能减少**工具，不能凭空增加。否则一个子 agent 就能给自己授权父级没有的能力。

### M01.5 单调守卫

`ctx.tools.guard()` 在**所有** `pre-execute` 监听之后运行，且**没有 allow 返回值**——它只能返回拒绝理由或 `undefined`。

这个不对称设计是安全属性：无论前面的监听怎么放行，守卫都能兜住。如果守卫也能"放行"，那么监听顺序就会变成权限来源，而顺序是配置细节，不该承担安全责任。

## 排错

| 现象 | 原因 |
|---|---|
| `cannot get property "tools" without inject` | 插件没写 `inject: ['tools']`；cordis 强制访问控制 |
| 阶段之间的行为互相污染 | 监听直接挂在根 `ctx` 上，没给阶段独立 fiber |
| `defineTool` 报 schema 错 | object 类型必须显式写 `additionalProperties`，必填字段写在各 property 的 `required: true` 上 |
| `dispose` 后工具还在 | 注册没走 `ctx.tools.register` 的返回值，或用了外部变量持有 |

## 练习

1. 把 M01.2 的 `deny` 改成 `{kind:'ask', reason: ...}`，然后在 `dsh-lab chat` 里触发它——观察终端弹审批、拒绝后模型收到什么。
2. 写一个 `post-execute` 监听，把 `word_count` 的结果改成 JSON 字符串。规范值变了吗？用 `tools/result` 监听验证。
3. 在 M01.4 里把 `allow` 换成 `deny: ['write', 'edit']`，确认全局视图仍然完整。
