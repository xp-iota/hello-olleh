# M12 · Cordis 运行时与装配树

最后一章回到本工程自身的形态。`cordis.yml` + `cordis.patch.yml` 这两份文件就是整个应用的装配清单，`boot()` 把它们变成一棵服务树。**没有一行服务是在代码里手工 `new` 出来的。**

## 学习目标

- 理解"可逆 effect"为什么是整棵树的地基；
- 知道 `inject` 缺席时会发生什么（以及为什么这是好事）；
- 会读写 patch 层的三种操作：`insert` / 覆盖 / `disabled`；
- 认同"装配期错误必须在装配期抛出"。

## 运行

```bash
npm run M12
```

## 代码地图

```text
M12-cordis-runtime/index.ts
├─ M12.1 reversibleEffect      # 插件装载 → 注册生效 → dispose → 全部回收
├─ M12.2 dependencyInjection   # inject 缺席时 apply 不被调用
├─ M12.3 patchOverride         # 行 id、覆盖、disabled、insert 语法
├─ M12.4 failLoud              # 非法 Config 在装配期抛错
└─ M12.5 describeTree          # 工具/命令/路由全部来自装配清单

cordis.yml                     # 根表：空数组
cordis.patch.yml               # patch 层：约 70 行
src/boot.ts                    # boot() 调用点
```

## 可逆 effect

```ts
const fiber = await ctx.plugin(plugin)
// ... 插件注册的一切都生效了
await fiber.dispose()
// ... 插件注册的一切都消失了
```

一条规则贯穿全部 12 章：**注册必须挂在 fiber 上**。工具注册、事件监听、prompt section、命令——全部是 effect。fiber 销毁时按注册逆序回收。

这不是便利功能，是可组合性的前提。没有它，你就无法安全地"临时装一个能力试试"。

## 依赖注入

```ts
const plugin = { name: 'x', inject: ['labServiceThatDoesNotExist'], apply() { /* 不会执行 */ } }
await ctx.plugin(plugin)   // apply 没被调用，fiber 停在 pending
```

M12.2 验证 `applied === false`。

cordis 的访问控制是**强制的**：不写在 `inject` 里的服务，插件里读 `ctx.xxx` 会抛

```text
cannot get property "tools" without inject
```

第一次遇到会觉得啰嗦，但它是装配期检查的来源：依赖没声明，就无法在启动时发现缺失，只能等到运行期某个分支才炸。

`src/lab/runner.ts` 里有一个副作用：阶段包装插件必须把 21 个服务全列进 `inject`，因为阶段脚本要摸整棵树。可选服务（如 `schedule`）用 `ctx.get(name)` 读，不进 inject——那正是 `ctx.get` 存在的意义。

## patch 层的三种操作

```yaml
# 1. 新增（可嵌套 group）
- insert:
    - id: tool-bash
      name: '@deepseek-ai/dsh-tool-bash'

# 2. 覆盖已有行的配置（整段替换，不是合并）
- id: agent
  config:
    agents: []

# 3. 禁用（可按平台条件禁用）
- id: bash-sandbox
  disabled: !!js process.platform !== 'linux'
```

`!!js` 表达式在 `with (ctx) { return eval(expr) }` 里求值，所以 `process`、`ctx.get(...)`、`dshHomePath(...)` 都在作用域内。本工程用它按平台在 `bash-sandbox` 与 `pwsh-sandbox` 之间选择。

行 `id` 是覆盖的锚点。同一个 id 在后一个 patch 层里出现，就替换前一层的 config——这是"用户配置覆盖默认配置"的实现方式，比"到处 if 判断有没有配置过"干净得多。

## 失败即大声

M12.4 注册一个 Config 非法的插件，`ctx.plugin()` 当场抛错。

这条规则的价值在长跑项目里才显现：允许"带病启动"的系统，故障会在几小时后以一个不相关的形式出现。装配期报错至少告诉你哪一行不对。

`boot()` 最后还会跑 `auditStartupEntries(ctx, binName)`——它检查装配清单里的行是否真的都激活了，避免"写了但没生效"这种静默失败。

## 装配树的规模

M12.5 打印当前树的事实：

```text
工具 26 个：ask_user_question, create_goal, edit, exit_goal, ...
命令 5 个：/compact, /feedback, /goal, /permission, /plan
路由 2 条：anthropic-compat, deepseek-official
以上全部来自 cordis.patch.yml —— 没有一行是代码里手工 new 出来的
```

对照旧工程：`runtime/harness.ts` 曾用 581 行手工装配 ~20 个服务，还要自己实现一个 `MemorySettingsProvider`。现在那些全被官方 `boot()` + 声明式清单取代了。**这就是"清理冗余父工程实现"的具体含义。**

## 排错

| 现象 | 原因 |
|---|---|
| `cannot get property "x" without inject` | 插件声明缺服务 |
| 插件装了但没生效 | 依赖未满足，fiber pending |
| 覆盖没起作用 | id 拼错；patch 层的 id 必须与目标行完全一致 |
| 启动了但工具不全 | 某行 `disabled: true`，或依赖链断了 |
| 启动慢 | 正常；树越大越慢，用 `dsh-lab info` 看规模 |

## 练习

1. 在 `cordis.patch.yml` 里禁用 `tool-todo`，跑 `dsh-lab info` 确认 `todo_write` 消失了，再跑 M06.5 看它失败。
2. 把 `tool-result-pruner` 的 `thresholdChars` 改小，观察 M02 里裁剪生效。
3. 在 M12.1 里加第二个注册（一个命令），验证 dispose 后两条都消失。
