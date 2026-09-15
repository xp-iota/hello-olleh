# M02 · 上下文装配与经济学

模型上下文通过结构化投影组织内容，记录来源并控制 token 预算。

## 学习目标

理解 Prompt 贡献、装配改写、历史压缩与结果溢出如何组成一条连续的上下文治理链。

## 运行

```bash
npm run M02   # 真实推理服务；需要 LLM_API_KEY，会发起网络请求
```

## 实现与场景

| 场景 | 类型 | 实现（`impl/`） | 场景脚本（`scenes/`） | 观察什么 |
|---|---|---|---|---|
| 1 Prompt 段落 | 教学主线 | `impl/01-prompt-section.ts` | `scenes/01-assemble-system-prompt.ts` | section 按 order 组合，插件只贡献自己的段落 |
| 2 装配改写 | 教学主线 | `impl/02-prompt-variable-assemble.ts` | `scenes/02-interpolate-variable.ts` | variable 延迟求值；waterfall 保留结构化 assembly |
| 3 历史压缩 | 教学主线 | `impl/03-compaction-provider.ts` | `scenes/03-fold-history.ts` | 压缩 Provider、触发条件与 surface replace |
| 4 Token 计量 | 扩展面 | `impl/04-token-meter.ts` | `scenes/04-estimate-token-pressure.ts` | 从可回放日志估算 surface 与请求压力 |
| 5 结果裁剪 | 扩展面 | `impl/05-tool-result-pruner.ts` | `scenes/05-prune-long-result.ts` | Unicode 安全的头尾保留与可审计替换 |
| 6 结果溢出 | 扩展面 | `impl/06-spill-policy.ts` | `scenes/06-spill-to-file.ts` | 完整结果落本地私有文件，模型只接收预览和 locator |

## 完整链路

section 与 variable 先进入 `PromptAssembly`，渲染器最后生成模型请求；历史来自追加日志的 surface 投影。超过阈值时，压缩 Provider 追加检查点并用 replace 遮蔽旧区间，计量、裁剪与 spill 再把预算落实为可观察策略。

## 边界

压缩不删除事实日志；spill 场景在结束时删除临时根目录。

## `LocalSpillStore` 与 `spillPolicy` 如何配合

这两个插件分别负责“存在哪里”和“什么时候外溢”，必须按下面顺序装载：

```ts
import LocalSpillStore from '@deepseek-ai/dsh-spill-local'
import * as spillPolicy from '@deepseek-ai/dsh-spill-policy'

await ctx.plugin(LocalSpillStore, {
  root: config.root,
  cleanupPeriodDays: 0,
})
await ctx.plugin(spillPolicy, {
  maxInlineBytes: config.maxInlineBytes,
})
```

`LocalSpillStore` 是 `ctx.spillStore` 的本地 Provider。它按 session 建立目录，把完整 UTF-8 文本写入文件，并返回一个 locator；`root` 指定文件根目录。`cleanupPeriodDays` 控制启动时的一次性过期文件清理，示例设为 `0` 表示关闭清理，因为场景脚本最后会显式删除临时目录。

`spillPolicy` 是工具结果策略。它监听工具结果中的纯文本：结果字节数不超过 `maxInlineBytes` 时原样返回；超过阈值时，先调用 `ctx.spillStore.saveText()` 保存**完整结果**，再把模型可见内容替换成有界预览、被省略的字节数、locator 和读取提示。它不会凭空提供存储；没有 `ctx.spillStore` 或保存失败时会保留原文（best effort）。因此，local 插件提供能力，policy 插件决定是否使用能力。

本例把阈值设为 `256` 字节：`scenes/06-spill-to-file.ts` 注册一个返回长文本的工具，调用后可观察 `harness.ctx.spillStore` 的 Provider 类型、返回内容的字节数以及 locator 是否指向 `root`。模型上下文只携带预览和 locator，后续宿主或工具可根据 locator 读取原始文件。
