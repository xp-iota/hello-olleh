# M02 · 上下文装配与经济学

本模块把原 02、10、14 串成“**装入上下文 → 在装配点改写 → 历史过长时压缩**”的生命周期。重点不是拼一个大字符串，而是管理模型上下文的结构、来源和成本。

## 运行

```bash
npm run M02
```

## 三层能力

| 层 | 独立插件 | 关键机制 |
|---|---|---|
| Prompt 段落 | `steps/01-prompt-section.ts` | section 按 order 组合，插件只贡献自己负责的段 |
| 装配改写 | `steps/02-prompt-variable-assemble.ts` | variable 延迟求值；`system-prompt/assemble` waterfall 改结构化 assembly |
| 上下文压缩 | `steps/03-compaction-provider.ts` | `CompactionEngine` seam、压力/溢出触发、日志 surface replace |

## 数据流

section 与 variable 先进入 `PromptAssembly`，渲染器才在最后生成模型请求；会话历史则来自追加式日志的 surface 投影。当历史越过阈值，压缩 provider 追加 `user/message` 检查点，以 `{ op: 'replace', startSeq, endSeq }` 遮蔽旧 surface 区间，同时保留原始事件作为可审计事实。

每个 step 保持原插件形状，可独立装配；`run.ts` 仅按教学顺序展示段落排序、缺失变量 fail-loud、自动/手动压缩和 provider 卸载。

**结论：**上下文预算不是在请求前粗暴截字符串，而是通过结构化装配和可追溯投影做持续治理。


## A4 · 上下文预算服务

| 步骤 | 服务/能力 | 观察点 |
|---|---|---|
| 04 | `tokenMeter` | 从可回放日志估算 surface 与请求压力 |
| 05 | `toolResultPruner` | Unicode code point 安全的头尾保留，替换仍可审计 |
| 06 | `spillStore` + spill policy | 完整结果仅写本地私有文件，模型只接收预算内预览和 locator |

三个步骤默认离线；阶段结束会删除临时 spill 根目录。
