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
