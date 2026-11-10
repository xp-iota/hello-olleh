# 安全护栏（safety-guardrail）

dsh-lab 自己的一个 cordis 插件：**在模型发起的工具调用真正执行之前**先看一眼，把
将要发生的 `tool`、调用方 `agent` 和参数预览写到日志里。

当前实现只观察、不拦截。先把"每一次工具调用都留下证据"这件事做稳，再在这个接缝上
接拒绝、审批或参数策略——扩展点已经在代码里留好（`decide()`）。

```text
[safety-guardrail] pre-execute tool=read agent=5cbcb16a-... args={"file_path":"README.md"}
[safety-guardrail] pre-execute tool=pwsh agent=5cbcb16a-... args={"command":"npm test","description":"跑测试"}
```

## 它站在哪一层

![安全护栏的三层同心结构：cordis → dsh → dsh-lab](./architecture.svg)

图源：[architecture.svg](./architecture.svg)（手写自包含 SVG；archify 的 `architecture` 只有正交边界，没有径向布局）。读法：**越靠内越稳定**。

| 层 | 是什么 | 本工程与它的关系 |
|---|---|---|
| 最内层 · cordis | 插件树、依赖注入、fiber 生命周期；`Loader` / `Include` / `Group` / `Timer` 是它的 built-in 组件 | 只通过官方 `boot()` 使用，不改源码 |
| 中间层 · dsh | 官方能力包：`agent-loop`、`tools`、`llm`、`session`、`sandbox`、`tool-executor-native`…… | 全部由 `cordis.patch.yml` 装配，不手工 `new` |
| 最外层 · dsh-lab | CLI、M01–M12、自写 provider、**本插件**、双运行时 | 本工程真正写代码的地方 |

安全护栏在最外层：它不修改 dsh 的工具实现，也不进入 cordis 内核，只是在官方暴露的
`tools/pre-execute` 事件上挂了一个监听。

## 在工具执行前，它到底插在哪

```text
模型输出 tool-call block
  → dsh-agent-loop 把本步的调用收成 ToolBatchInput
  → dsh-tools 选出 executor（本工程挂的是 tool-executor-native）
  → tools/pre-execute   ←  安全护栏在这里：记录 + 决定
  → tools/execute       ←  工具函数体真正开始
  → tools/post-execute
  → tools/result
```

`tools/pre-execute` 是 **waterfall**：每个监听要么返回一个决定（`allow` / `deny` /
`ask` / `cancel`），要么调用 `next()` 把决定权交给下一个监听。护栏现在写日志后
`next()`，所以后续监听（例如 M01.2 的拒绝门）仍然可以改变结果。

这也是为什么护栏日志写 `pre-execute` 而不是 `allow`：它只保证"我看见了这次调用"，
不保证这次调用最终一定被执行。真正的最终判决由整条 waterfall 决定。

## 为什么不用 `ctx.tools.guard()`

官方还有一条更窄的接缝：`ctx.tools.guard()`。它是**单调守卫**——只能返回拒绝理由，
不能放行，也不能要求审批。适合"绝对禁止"的硬规则。

护栏选 `pre-execute` 是因为它保留了全部四种决定：

| 决定 | 含义 | 现在用了吗 |
|---|---|---|
| `allow` | 继续执行 | 是（通过 `next()` 交给后续监听） |
| `deny` | 拒绝，并把 reason 交给模型 | 代码路径已留，策略未启用 |
| `ask` | 先走审批 | 未启用 |
| `cancel` | 按取消处理 | 未启用 |

## 配置

装配行在 [`cordis.patch.yml`](../../../cordis.patch.yml) 的「工具运行时（M01）」段：

```yaml
- id: safety-guardrail
  name: './src/plugins/safety-guardrail/index.ts'
  disabled: !!js "process.env.DSH_GUARDRAIL === '0'"
  config:
    previewChars: 240
```

| 字段 | 默认 | 作用 |
|---|---|---|
| `previewChars` | `240` | 参数 JSON 的最大字符数，超出截断并加 `…` |
| `redactKeys` | `apiKey` / `api_key` / `authorization` / `cookie` / `credential` / `password` / `secret` / `token` | 键名去掉 `_` / `-`、转小写后做精确或后缀匹配；命中的值替换成 `[REDACTED]`（`maxTokens` 不会被 `token` 误伤） |
| `sink` | `stderr` | 日志流；默认走 stderr，避免打断 REPL 在 stdout 上的流式渲染 |
| `prefix` | `[safety-guardrail]` | 日志行前缀 |

整行开关：`DSH_GUARDRAIL=0`。它同时适用于 `chat`、`traj` 和所有模块阶段，便于做
"有护栏 / 没护栏"的对照。

## 怎么看到它

任选一条，日志都会出现在工具执行之前：

```bash
npm run chat                         # 让模型读一个文件
npm run M01                          # M01.1 调 word_count 前就会打印
npm run M07                          # write / read / pwsh / edit 每次调用前都会打印
```

M01 的输出里可以直接看到顺序：

```text
  注册后新增：word_count
[safety-guardrail] pre-execute tool=word_count agent=(standalone) args={"text":"DeepSeek Harness 里每一次工具调用都是可观察的"}
  调用结果：3 词 / 31 字符
```

`agent=(standalone)` 表示这次调用不来自某个 agent（阶段脚本直接调 `ctx.tools.execute`
时就是这种形状）；从 REPL 发起的调用会显示该会话的 id。

## 脱敏与截断

两件小事决定了这条日志能不能长期开着：

- **脱敏**：递归遍历参数对象，命中 `redactKeys` 的键只替换值，键名保留。这样日志里
  能看出"这里本来有一个 token"，但拿不到 token 本身。
- **截断**：参数超过 `previewChars` 就截断；循环引用等无法序列化的参数退化成
  `[unserializable]`，**绝不让日志本身把一次工具调用搞崩**。

⚠️ 脱敏只看**键名**，不扫描值的正文。`write` 的 `content`、`pwsh` 的 `command` 这类
字段仍会按 `previewChars` 截断后进入日志。对含敏感正文的工具，把相应键加进
`redactKeys`，或把 `previewChars` 调小。

两个纯函数（`redactValue` / `previewArguments`）都有单测，见
[`index.test.ts`](./index.test.ts)。

## 从"观察"升级为"拦截"

改一个函数即可，不需要动装配清单：

```ts
function decide(exec: Readonly<ToolExecution>): PreToolDecision {
  if (exec.name === 'pwsh' && containsDangerousCommand(exec.arguments)) {
    return { kind: 'deny', reason: '安全护栏：命令命中危险模式' }
  }
  return { kind: 'allow' }
}
```

注意三点：

1. **参数已经过 schema 校验**，`exec.arguments` 是解析后的对象，不是模型原始 JSON 串。
2. **拒绝要写进日志**：`apply()` 里已经为 `deny` 预留了带 `reason` 的日志行；"谁在
   什么时候被哪条规则拦下"是护栏唯一的审计证据。
3. **`ask` 需要审批服务在位**；没有审批支持时，官方管线会把 `ask` 当成拒绝处理。

## 验证

```bash
npm test                             # 27 个用例，含"日志先于工具函数体"的顺序断言
npm run typecheck
node runtime/boot-probe.ts           # BOOT_PROBE {"missing":[],"tools":26}
```

顺序断言不是"调用完能搜到日志"，而是在**工具函数体内部**检查护栏日志是否已经写出
（`src/boot.test.ts`）。这样才能证明它真的在 `tools/execute` 之前，而不是事后补一条。

## 代码地图

```text
src/plugins/safety-guardrail/
├─ index.ts            # 插件本体：Config / apply / pre-execute 监听 / decide()
├─ index.test.ts       # 脱敏、截断、循环引用的纯函数单测
├─ architecture.svg    # 三层同心结构图（README 内嵌）
└─ README.md           # 本文件
```

相关接缝：

- `@deepseek-ai/dsh-tools` 的 `tools/pre-execute` 事件与 `PreToolDecision` 类型；
- `@deepseek-ai/dsh-tool-executor-native`：真正调度工具批次的执行器；
- [`M01-tool-pipeline`](../../../M01-tool-pipeline/README.md)：同一接缝上的注册、
  可见性、post-execute 与 guard 教学。
